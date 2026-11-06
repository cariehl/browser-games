/**
 * @file hal_sim.c
 * @brief HAL implementation backed by the SignalBench simulator.
 *
 * Your firmware is a normal host process; this file turns it into a virtual
 * MCU by exchanging lock-step messages with the simulator (sim_protocol.h).
 */
#include "hal.h"
#include "sim_protocol.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <winsock2.h>
#  include <ws2tcpip.h>
#  include <windows.h>
#  include <process.h>
typedef SOCKET sock_t;
#  define SOCK_INVALID INVALID_SOCKET
#  define sock_close closesocket
static void sleep_ms(unsigned ms) { Sleep(ms); }
#else
#  include <arpa/inet.h>
#  include <netdb.h>
#  include <netinet/in.h>
#  include <netinet/tcp.h>
#  include <sys/socket.h>
#  include <unistd.h>
typedef int sock_t;
#  define SOCK_INVALID (-1)
#  define sock_close close
static void sleep_ms(unsigned ms) { usleep(ms * 1000u); }
#endif

/* Writing to a socket the simulator closed must fail with an error, not
 * kill the process with SIGPIPE (Linux). */
#ifdef MSG_NOSIGNAL
#  define SEND_FLAGS MSG_NOSIGNAL
#else
#  define SEND_FLAGS 0
#endif

/* ---------------------------------------------------------------- state -- */

#define RX_FIFO_LEN   64u
#define UART_RX_LEN   256u
#define TX_BUF_LEN    8192u
#define CAN_TX_PER_TICK 8u

static sock_t   s_sock = SOCK_INVALID;
static uint32_t s_now_ms;
static uint32_t s_gpio_in;
static uint32_t s_gpio_out;
static uint32_t s_pwm_freq[PWM_NUM_CH];
static uint16_t s_pwm_duty[PWM_NUM_CH];
static uint16_t s_adc[ADC_NUM_CH];
static int32_t  s_encoder;
static reset_reason_t s_reset_reason = RESET_POWER_ON;

static can_frame_t s_rx_fifo[RX_FIFO_LEN];
static unsigned s_rx_head, s_rx_tail, s_rx_count;
static uint32_t s_rx_overruns;
static unsigned s_can_tx_this_tick;

static uint8_t  s_uart_rx[UART_RX_LEN];
static unsigned s_uart_head, s_uart_tail;

static uint8_t  s_txbuf[TX_BUF_LEN];
static size_t   s_txlen;

/* ---------------------------------------------------------- byte helpers -- */

static void put_u8(uint8_t **p, uint8_t v)   { *(*p)++ = v; }
static void put_u16(uint8_t **p, uint16_t v) { put_u8(p, (uint8_t)v); put_u8(p, (uint8_t)(v >> 8)); }
static void put_u32(uint8_t **p, uint32_t v) { put_u16(p, (uint16_t)v); put_u16(p, (uint16_t)(v >> 16)); }
static uint16_t get_u16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }
static uint32_t get_u32(const uint8_t *p) { return (uint32_t)get_u16(p) | ((uint32_t)get_u16(p + 2) << 16); }

static void fatal(const char *msg)
{
    fprintf(stderr, "[hal] %s\n", msg);
    fflush(stderr);
    exit(2);
}

/* ------------------------------------------------------------- transport -- */

static void flush_tx(void)
{
    size_t off = 0;
    while (off < s_txlen) {
        int n = (int)send(s_sock, (const char *)s_txbuf + off, (int)(s_txlen - off), SEND_FLAGS);
        if (n <= 0) fatal("simulator connection lost (send)");
        off += (size_t)n;
    }
    s_txlen = 0;
}

static void queue_msg(uint8_t type, const uint8_t *payload, size_t len)
{
    if (s_txlen + 3 + len > TX_BUF_LEN) flush_tx();
    if (3 + len > TX_BUF_LEN) return; /* oversized, drop */
    uint8_t *p = s_txbuf + s_txlen;
    put_u8(&p, type);
    put_u16(&p, (uint16_t)len);
    if (len) memcpy(p, payload, len);
    s_txlen += 3 + len;
}

static void recv_exact(uint8_t *dst, size_t len)
{
    size_t got = 0;
    while (got < len) {
        int n = (int)recv(s_sock, (char *)dst + got, (int)(len - got), 0);
        if (n <= 0) fatal("simulator connection lost (recv)");
        got += (size_t)n;
    }
}

/* Reads one message; returns type, payload copied into buf (max cap). */
static uint8_t recv_msg(uint8_t *buf, size_t cap, size_t *len_out)
{
    uint8_t hdr[3];
    recv_exact(hdr, 3);
    size_t len = get_u16(hdr + 1);
    if (len > cap) fatal("message too large");
    recv_exact(buf, len);
    *len_out = len;
    return hdr[0];
}

static void restart_process(uint8_t reason)
{
    const char *why = reason == RESET_WATCHDOG ? "watchdog" :
                      reason == RESET_SOFTWARE ? "software" : "power";
    fprintf(stderr, "[hal] MCU reset (%s)\n", why);
    fflush(stderr);
    if (s_sock != SOCK_INVALID) sock_close(s_sock);
    /* When the simulator launched us, it restarts us. Otherwise re-exec. */
    if (!getenv("SIGNALBENCH_SUPERVISED")) {
#ifdef _WIN32
        char path[MAX_PATH];
        if (GetModuleFileNameA(NULL, path, MAX_PATH)) {
            _spawnl(_P_NOWAIT, path, path, NULL);
        }
#else
        char path[1024];
        ssize_t n = readlink("/proc/self/exe", path, sizeof path - 1);
        if (n > 0) { path[n] = 0; execl(path, path, (char *)NULL); }
#endif
    }
    exit(SIM_EXIT_RESET);
}

static void parse_tick(const uint8_t *p, size_t len)
{
    if (len < 4 + 4 + 2 * ADC_NUM_CH + 4 + 1) fatal("short TICK");
    const uint8_t *end = p + len;
    s_now_ms = get_u32(p); p += 4;
    s_gpio_in = get_u32(p); p += 4;
    for (unsigned i = 0; i < ADC_NUM_CH; i++) { s_adc[i] = get_u16(p); p += 2; }
    s_encoder = (int32_t)get_u32(p); p += 4;
    unsigned n_can = *p++;
    for (unsigned i = 0; i < n_can && p + 13 <= end; i++, p += 13) {
        if (s_rx_count == RX_FIFO_LEN) { s_rx_overruns++; continue; }
        can_frame_t *f = &s_rx_fifo[s_rx_head];
        f->id = get_u32(p);
        f->dlc = p[4] > 8 ? 8 : p[4];
        memcpy(f->data, p + 5, 8);
        s_rx_head = (s_rx_head + 1) % RX_FIFO_LEN;
        s_rx_count++;
    }
    if (p + 2 <= end) {
        unsigned n_uart = get_u16(p); p += 2;
        for (unsigned i = 0; i < n_uart && p < end; i++) {
            unsigned next = (s_uart_head + 1) % UART_RX_LEN;
            if (next != s_uart_tail) { s_uart_rx[s_uart_head] = *p; s_uart_head = next; }
            p++;
        }
    }
    s_can_tx_this_tick = 0;
}

static void wait_for_tick(void)
{
    static uint8_t buf[65536];
    for (;;) {
        size_t len;
        uint8_t type = recv_msg(buf, sizeof buf, &len);
        if (type == MSG_TICK) { parse_tick(buf, len); return; }
        if (type == MSG_RESET) restart_process(len ? buf[0] : RESET_POWER_ON);
        /* ignore anything else */
    }
}

static int connect_sim(void)
{
    const char *env = getenv("SIGNALBENCH_ADDR");
    char host[128] = "127.0.0.1";
    char port[16];
    snprintf(port, sizeof port, "%d", SIM_DEFAULT_PORT);
    if (env && *env) {
        const char *colon = strrchr(env, ':');
        if (colon) {
            size_t hl = (size_t)(colon - env);
            if (hl >= sizeof host) hl = sizeof host - 1;
            memcpy(host, env, hl); host[hl] = 0;
            snprintf(port, sizeof port, "%s", colon + 1);
        }
    }
    struct addrinfo hints, *res = NULL;
    memset(&hints, 0, sizeof hints);
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    if (getaddrinfo(host, port, &hints, &res) != 0 || !res) return 0;
    s_sock = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
    int ok = s_sock != SOCK_INVALID &&
             connect(s_sock, res->ai_addr, (int)res->ai_addrlen) == 0;
    freeaddrinfo(res);
    if (!ok) {
        if (s_sock != SOCK_INVALID) sock_close(s_sock);
        s_sock = SOCK_INVALID;
        return 0;
    }
    int one = 1;
    setsockopt(s_sock, IPPROTO_TCP, TCP_NODELAY, (const char *)&one, sizeof one);
    return 1;
}

/* ------------------------------------------------------------------ core -- */

void hal_init(void)
{
    setvbuf(stdout, NULL, _IONBF, 0);
#ifdef _WIN32
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) fatal("WSAStartup failed");
#endif
    int announced = 0;
    for (int attempt = 0; !connect_sim(); attempt++) {
        if (!announced) {
            fprintf(stderr, "[hal] waiting for simulator on port %d...\n", SIM_DEFAULT_PORT);
            announced = 1;
        }
        if (attempt > 300) fatal("could not reach simulator");
        sleep_ms(100);
    }

    uint8_t hello[64], *p = hello;
    const char *name = "sb-ctrl";
    put_u32(&p, SIM_MAGIC);
    put_u16(&p, SIM_PROTO_VERSION);
    put_u8(&p, (uint8_t)strlen(name));
    memcpy(p, name, strlen(name)); p += strlen(name);
    queue_msg(MSG_HELLO, hello, (size_t)(p - hello));
    flush_tx();

    uint8_t buf[256];
    size_t len;
    for (;;) {
        uint8_t type = recv_msg(buf, sizeof buf, &len);
        if (type == MSG_WELCOME) {
            if (len >= 3) s_reset_reason = (reset_reason_t)buf[2];
            break;
        }
    }
    fprintf(stderr, "[hal] connected to simulator\n");
    wait_for_tick();
}

void hal_tick_wait(void)
{
    uint8_t done[4 + PWM_NUM_CH * 6], *p = done;
    put_u32(&p, s_gpio_out);
    for (unsigned i = 0; i < PWM_NUM_CH; i++) {
        put_u32(&p, s_pwm_freq[i]);
        put_u16(&p, s_pwm_duty[i]);
    }
    queue_msg(MSG_TICK_DONE, done, sizeof done);
    flush_tx();
    wait_for_tick();
}

uint32_t hal_millis(void) { return s_now_ms; }

void hal_delay_ms(uint32_t ms)
{
    uint32_t start = s_now_ms;
    while ((uint32_t)(s_now_ms - start) < ms) hal_tick_wait();
}

reset_reason_t hal_reset_reason(void) { return s_reset_reason; }

void hal_system_reset(void)
{
    queue_msg(MSG_SYS_RESET, NULL, 0);
    flush_tx();
    for (;;) wait_for_tick(); /* simulator answers with MSG_RESET */
}

/* ------------------------------------------------------------------ GPIO -- */

bool hal_gpio_read(pin_t pin)
{
    if ((unsigned)pin >= 32) return false;
    if (pin >= 16) return (s_gpio_out >> pin) & 1u; /* outputs read back */
    return (s_gpio_in >> pin) & 1u;
}

void hal_gpio_write(pin_t pin, bool level)
{
    if ((unsigned)pin < 16 || (unsigned)pin >= 32) return; /* input or bad pin */
    if (level) s_gpio_out |= (1u << pin);
    else       s_gpio_out &= ~(1u << pin);
}

void hal_gpio_toggle(pin_t pin) { hal_gpio_write(pin, !hal_gpio_get_output(pin)); }

bool hal_gpio_get_output(pin_t pin)
{
    return (unsigned)pin < 32 && ((s_gpio_out >> pin) & 1u);
}

/* ---------------------------------------------------------- PWM / timers -- */

void hal_pwm_set(pwm_ch_t ch, uint32_t freq_hz, uint16_t duty_permille)
{
    if ((unsigned)ch >= PWM_NUM_CH) return;
    s_pwm_freq[ch] = freq_hz;
    s_pwm_duty[ch] = duty_permille > 1000 ? 1000 : duty_permille;
}

int32_t hal_encoder_count(void) { return s_encoder; }

uint16_t hal_adc_read(adc_ch_t ch)
{
    return (unsigned)ch < ADC_NUM_CH ? s_adc[ch] : 0;
}

/* ------------------------------------------------------------------- CAN -- */

hal_status_t hal_can_send(const can_frame_t *f)
{
    if (!f || f->dlc > 8 || f->id > 0x7FF) return HAL_ERR;
    if (s_can_tx_this_tick >= CAN_TX_PER_TICK) return HAL_BUSY;
    uint8_t msg[13], *p = msg;
    put_u32(&p, f->id);
    put_u8(&p, f->dlc);
    memcpy(p, f->data, 8);
    queue_msg(MSG_CAN_TX, msg, sizeof msg);
    s_can_tx_this_tick++;
    return HAL_OK;
}

bool hal_can_recv(can_frame_t *out)
{
    if (!s_rx_count) return false;
    *out = s_rx_fifo[s_rx_tail];
    s_rx_tail = (s_rx_tail + 1) % RX_FIFO_LEN;
    s_rx_count--;
    return true;
}

uint32_t hal_can_rx_overruns(void) { return s_rx_overruns; }

/* ------------------------------------------------------------------- I2C -- */

hal_status_t hal_i2c_write_read(uint8_t addr7, const uint8_t *tx, size_t tx_len,
                                uint8_t *rx, size_t rx_len)
{
    if (tx_len > 32 || rx_len > 32) return HAL_ERR;
    uint8_t msg[3 + 32], *p = msg;
    put_u8(&p, addr7);
    put_u8(&p, (uint8_t)tx_len);
    put_u8(&p, (uint8_t)rx_len);
    if (tx_len) memcpy(p, tx, tx_len);
    queue_msg(MSG_I2C_XFER, msg, 3 + tx_len);
    flush_tx();

    uint8_t buf[64];
    size_t len;
    for (;;) {
        uint8_t type = recv_msg(buf, sizeof buf, &len);
        if (type == MSG_I2C_RESULT) break;
        if (type == MSG_RESET) restart_process(len ? buf[0] : 0);
    }
    if (len < 1) return HAL_ERR;
    hal_status_t st = (hal_status_t)buf[0];
    if (st == HAL_OK && rx && rx_len) {
        size_t n = len - 1 < rx_len ? len - 1 : rx_len;
        memcpy(rx, buf + 1, n);
    }
    return st;
}

/* ------------------------------------------------------------------ UART -- */

void hal_uart_write(const char *buf, size_t len)
{
    while (len) {
        size_t chunk = len > 1024 ? 1024 : len;
        queue_msg(MSG_UART_TX, (const uint8_t *)buf, chunk);
        buf += chunk;
        len -= chunk;
    }
}

int hal_uart_getc(void)
{
    if (s_uart_head == s_uart_tail) return -1;
    int c = s_uart_rx[s_uart_tail];
    s_uart_tail = (s_uart_tail + 1) % UART_RX_LEN;
    return c;
}

int hal_printf(const char *fmt, ...)
{
    char buf[512];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    if (n < 0) return n;
    hal_uart_write(buf, (size_t)n < sizeof buf ? (size_t)n : sizeof buf - 1);
    return n;
}

/* -------------------------------------------------------------- watchdog -- */

void hal_wdt_start(uint32_t timeout_ms)
{
    uint8_t msg[5], *p = msg;
    put_u8(&p, 0);
    put_u32(&p, timeout_ms);
    queue_msg(MSG_WDT, msg, sizeof msg);
}

void hal_wdt_kick(void)
{
    uint8_t msg[5], *p = msg;
    put_u8(&p, 1);
    put_u32(&p, 0);
    queue_msg(MSG_WDT, msg, sizeof msg);
}
