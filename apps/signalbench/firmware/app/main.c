/**
 * @file main.c
 * @brief SB-CTRL reference firmware: emergency-vehicle lighting & power
 *        controller.
 *
 * Architecture: bare-metal super-loop at the 1 ms SysTick + a cooperative
 * time-triggered scheduler. All policy lives in pure, unit-tested modules
 * (pdm, power, arm, patterns, siren, debounce); this file is the I/O glue.
 *
 *   tick (1 ms)  sample + debounce inputs, drain CAN RX, poll UART CLI
 *   2 ms         siren tone
 *   10 ms        keypad handling, arm state machine, indicators
 *   20 ms        CAN TX: PDM output command, lightbar command
 *   100 ms       PDM housekeeping (retry / comms), load shedding
 *   500 ms       heartbeat LED
 *   1000 ms      TMP102 temperature
 */
#include "arm.h"
#include "board.h"
#include "can_db.h"
#include "debounce.h"
#include "hal.h"
#include "patterns.h"
#include "pdm.h"
#include "power.h"
#include "scheduler.h"
#include "siren.h"
#include "tmp102.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define FW_VERSION         "1.2.0"
#define WDT_TIMEOUT_MS     250u
#define DEBOUNCE_TICKS     10u
#define NIGHT_AMBIENT      800u   /* ADC counts below which we dim */
#define HOT_CENTI_C        7000   /* 70.00 C -> derate lights      */

/* ------------------------------------------------------------- app state -- */

static scheduler_t g_sched;
static debounce_t  g_inputs;
static pdm_t       g_pdm;
static power_mgr_t g_power;
static arm_t       g_arm;
static arm_inputs_t g_arm_in;

static struct {
    uint8_t      stage;          /* warning stage 0..3              */
    siren_mode_t siren;
    bool         horn;
    bool         scene;
    bool         takedown;
    bool         rear;
    uint32_t     pattern_t0;     /* time base of the active pattern */
    uint32_t     siren_t0;
    int16_t      temp_centi;
    bool         temp_ok;
    uint16_t     lb_failed;
    uint32_t     lb_last_rx;
    bool         lb_seen;
    uint32_t     beep_until;
    uint8_t      beep_count;     /* remaining error beeps           */
    uint32_t     can_led_until;
} g;

static bool ignition(void) { return (g_inputs.stable >> PIN_IN_IGNITION) & 1u; }
static bool in_park(void)  { return (g_inputs.stable >> PIN_IN_PARK) & 1u; }

/* ---------------------------------------------------------------- beeper -- */

static void beep_ok(uint32_t now)
{
    g.beep_count = 0;
    g.beep_until = now + 40;
    hal_pwm_set(PWM_BEEPER, 2400, 500);
}

static void beep_error(uint32_t now)
{
    g.beep_count = 3;
    g.beep_until = now + 90;
    hal_pwm_set(PWM_BEEPER, 400, 500);
}

static void beeper_service(uint32_t now)
{
    if (!g.beep_until || (int32_t)(now - g.beep_until) < 0) return;
    if (g.beep_count > 1) {          /* gap, then next error beep */
        g.beep_count--;
        g.beep_until = now + 180;
        bool on = (g.beep_count % 2) == 0;
        hal_pwm_set(PWM_BEEPER, on ? 400 : 0, on ? 500 : 0);
        return;
    }
    g.beep_until = 0;
    g.beep_count = 0;
    hal_pwm_set(PWM_BEEPER, 0, 0);
}

/* ------------------------------------------------------- feature control -- */

static void set_stage(uint8_t stage, uint32_t now)
{
    if (stage > 3) stage = 0;
    if (stage != g.stage) g.pattern_t0 = now;
    g.stage = stage;
    if (stage == 0) g.siren = SIREN_OFF; /* siren requires lights */
}

static void set_siren(siren_mode_t m, uint32_t now)
{
    if (m != g.siren) g.siren_t0 = now;
    g.siren = m;
}

static void clear_all_faults(void)
{
    pdm_reset_faults(&g_pdm);
    arm_clear_fault(&g_arm, &g_arm_in);
    hal_printf("faults cleared\r\n");
}

static void handle_keypad(uint32_t now)
{
    uint32_t pressed = debounce_take_rose(&g_inputs, 0xFFu);
    uint32_t released = debounce_take_fell(&g_inputs, 0xFFu);
    bool held_horn = (g_inputs.stable >> PIN_BTN_HORN) & 1u;

    if (!ignition()) {
        if (pressed) beep_error(now);
        g.horn = false;
        return;
    }

    if (pressed & (1u << PIN_BTN_LIGHTS)) { set_stage((uint8_t)(g.stage + 1), now); beep_ok(now); }
    if (pressed & (1u << PIN_BTN_SIREN)) {
        if (g.stage == 0) beep_error(now);
        else { set_siren(siren_next_mode(g.siren), now); beep_ok(now); }
    }
    if (pressed & (1u << PIN_BTN_SCENE))    { g.scene = !g.scene; beep_ok(now); }
    if (pressed & (1u << PIN_BTN_TAKEDOWN)) { g.takedown = !g.takedown; beep_ok(now); }
    if (pressed & (1u << PIN_BTN_REAR))     { g.rear = !g.rear; beep_ok(now); }
    if (pressed & (1u << PIN_BTN_ARM)) {
        if (arm_cmd_toggle(&g_arm, &g_arm_in, now)) beep_ok(now);
        else beep_error(now);
    }
    if (pressed & (1u << PIN_BTN_AUX)) { clear_all_faults(); beep_ok(now); }

    if ((pressed | released) & (1u << PIN_BTN_HORN)) g.siren_t0 = now;
    g.horn = held_horn;
}

static bool any_fault(void)
{
    return g_pdm.tripped || g_pdm.locked_out || !g_pdm.online ||
           g_arm.state == ARM_FAULT || g.lb_failed ||
           (g.stage && g.lb_seen && (uint32_t)(hal_millis() - g.lb_last_rx) > 500) ||
           !g.temp_ok;
}

static void update_indicators(uint32_t now)
{
    bool blink_slow = (now / 400) & 1u;
    bool blink_fast = (now / 120) & 1u;

    hal_gpio_write(PIN_KP_LED(0), g.stage > 0);
    hal_gpio_write(PIN_KP_LED(1), g.siren != SIREN_OFF);
    hal_gpio_write(PIN_KP_LED(2), g.horn);
    hal_gpio_write(PIN_KP_LED(3), g.scene && (!power_is_shed(&g_power, PDM_CH_SCENE) || blink_slow));
    bool arm_led;
    switch (g_arm.state) {
    case ARM_DEPLOYED:  arm_led = true; break;
    case ARM_DEPLOYING:
    case ARM_STOWING:   arm_led = blink_slow; break;
    case ARM_FAULT:     arm_led = blink_fast; break;
    default:            arm_led = false; break;
    }
    hal_gpio_write(PIN_KP_LED(4), arm_led);
    hal_gpio_write(PIN_KP_LED(5), g.takedown);
    hal_gpio_write(PIN_KP_LED(6), g.rear);
    bool fault = any_fault();
    hal_gpio_write(PIN_KP_LED(7), fault && blink_fast);
    hal_gpio_write(PIN_LED_FAULT, fault || (g_power.shed_mask && blink_slow));
    hal_gpio_write(PIN_LED_CAN, (int32_t)(now - g.can_led_until) < 0);
}

/* ----------------------------------------------------------------- tasks -- */

static void task_siren(uint32_t now)
{
    siren_mode_t mode = g.horn ? SIREN_HORN : g.siren;
    uint32_t f = siren_freq_hz(mode, now - g.siren_t0);
    hal_pwm_set(PWM_SIREN, f, f ? 500 : 0);
}

static void task_control(uint32_t now)
{
    g_arm_in.lim_stowed   = (g_inputs.stable >> PIN_LIM_STOWED) & 1u;
    g_arm_in.lim_deployed = (g_inputs.stable >> PIN_LIM_DEPLOYED) & 1u;
    g_arm_in.in_park      = in_park();
    g_arm_in.enc_count    = hal_encoder_count();
    g_arm_in.motor_ma     = ADC_TO_ARM_MA(hal_adc_read(ADC_ARM_ISENSE));

    handle_keypad(now);

    if (!ignition()) {
        set_stage(0, now);
        g.scene = g.takedown = g.rear = false;
    }

    arm_state_t before = g_arm.state;
    arm_update(&g_arm, &g_arm_in, now);
    if (g_arm.state != before) {
        hal_printf("arm: %s -> %s%s%s\r\n", arm_state_name(before), arm_state_name(g_arm.state),
                   g_arm.state == ARM_FAULT ? " fault=" : "",
                   g_arm.state == ARM_FAULT ? arm_fault_name(g_arm.fault) : "");
    }
    hal_gpio_write(PIN_ARM_DIR, g_arm.out.dir_up);
    hal_pwm_set(PWM_ARM_MOTOR, 20000, g_arm.out.duty_permille);

    beeper_service(now);
    update_indicators(now);
}

static uint8_t lightbar_intensity(void)
{
    uint8_t level = 255;
    if (hal_adc_read(ADC_AMBIENT) < NIGHT_AMBIENT) level = 110;       /* night dim */
    if (g.temp_ok && g.temp_centi > HOT_CENTI_C && level > 128) level = 128; /* derate */
    return level;
}

static void task_can_tx(uint32_t now)
{
    bool lights_on = g.stage > 0 || g.takedown;
    bool rear_on = g.rear || g.stage >= 1;
    bool rear_phase = (now / 350) & 1u;
    bool hot = g.temp_ok && g.temp_centi > HOT_CENTI_C;

    pdm_set(&g_pdm, PDM_CH_LIGHTBAR, lights_on ? 255 : 0);
    pdm_set(&g_pdm, PDM_CH_SIREN, (g.siren != SIREN_OFF || g.horn) ? 255 : 0);
    pdm_set(&g_pdm, PDM_CH_SCENE, g.scene ? (hot ? 140 : 255) : 0);
    pdm_set(&g_pdm, PDM_CH_ARM, g_arm.out.need_power ? 255 : 0);
    pdm_set(&g_pdm, PDM_CH_REAR, rear_on && rear_phase ? 255 : 0);
    pdm_set(&g_pdm, PDM_CH_MDT, ignition() ? 255 : 0);
    for (unsigned ch = 0; ch < PDM_NUM_CH; ch++) {
        if (power_is_shed(&g_power, (pdm_ch_t)ch)) pdm_set(&g_pdm, (pdm_ch_t)ch, 0);
    }

    can_frame_t f;
    pdm_build_cmd(&g_pdm, &f);
    hal_can_send(&f);
    if (pdm_take_fault_clear(&g_pdm, &f)) hal_can_send(&f);

    if (lights_on) {
        uint16_t mask = pattern_mask_at(pattern_get((pattern_id_t)g.stage), now - g.pattern_t0);
        if (g.takedown) mask |= LB_MASK_WHITE;
        memset(&f, 0, sizeof f);
        f.id = CAN_ID_LB_CMD;
        f.dlc = 3;
        f.data[0] = (uint8_t)mask;
        f.data[1] = (uint8_t)(mask >> 8);
        f.data[2] = lightbar_intensity();
        hal_can_send(&f);
    }
}

static void task_housekeeping(uint32_t now)
{
    static uint8_t last_tripped, last_locked, last_shed;
    static bool last_online = false;

    pdm_update(&g_pdm, now);
    uint8_t shed = power_update(&g_power, g_pdm.online ? g_pdm.vbat_mv : 0, now);

    if (g_pdm.online != last_online) {
        hal_printf("pdm: %s\r\n", g_pdm.online ? "online" : "OFFLINE (no status frames)");
        last_online = g_pdm.online;
    }
    if (g_pdm.tripped != last_tripped) {
        hal_printf("pdm: tripped mask 0x%02X\r\n", g_pdm.tripped);
        last_tripped = g_pdm.tripped;
    }
    if (g_pdm.locked_out != last_locked) {
        if (g_pdm.locked_out & ~last_locked)
            hal_printf("pdm: channel(s) 0x%02X LOCKED OUT after %u retries - press AUX to reset\r\n",
                       g_pdm.locked_out & ~last_locked, PDM_MAX_RETRIES);
        last_locked = g_pdm.locked_out;
    }
    if (shed != last_shed) {
        hal_printf("power: load shed mask 0x%02X (vbat %u mV)\r\n", shed, g_pdm.vbat_mv);
        last_shed = shed;
    }
}

static void task_heartbeat(uint32_t now)
{
    (void)now;
    hal_gpio_toggle(PIN_LED_HEARTBEAT);
}

static void task_temperature(uint32_t now)
{
    (void)now;
    int16_t t;
    bool ok = tmp102_read_centi(I2C_ADDR_TMP102, &t) == HAL_OK;
    if (ok != g.temp_ok) hal_printf("tmp102: %s\r\n", ok ? "ok" : "NOT RESPONDING");
    g.temp_ok = ok;
    if (ok) g.temp_centi = t;
}

/* ------------------------------------------------------------- CAN input -- */

static void drain_can_rx(uint32_t now)
{
    can_frame_t f;
    while (hal_can_recv(&f)) {
        g.can_led_until = now + 30;
        if (pdm_handle_frame(&g_pdm, &f, now)) continue;
        if (f.id == CAN_ID_LB_STATUS && f.dlc >= 3) {
            uint16_t failed = (uint16_t)(f.data[1] | (f.data[2] << 8));
            if (failed != g.lb_failed) hal_printf("lightbar: failed heads 0x%03X\r\n", failed);
            g.lb_failed = failed;
            g.lb_last_rx = now;
            g.lb_seen = true;
        }
    }
}

/* ------------------------------------------------------------- UART CLI -- */

static void cli_status(void)
{
    hal_printf("t=%lu ms  ign=%d park=%d  stage=%u siren=%s scene=%d takedown=%d rear=%d\r\n",
               (unsigned long)hal_millis(), ignition(), in_park(), g.stage,
               siren_mode_name(g.horn ? SIREN_HORN : g.siren), g.scene, g.takedown, g.rear);
    hal_printf("vbat=%u mV  total=%lu mA  shed=0x%02X  temp=%d.%02d C%s\r\n",
               g_pdm.vbat_mv, (unsigned long)pdm_total_current_ma(&g_pdm), g_power.shed_mask,
               g.temp_centi / 100, abs(g.temp_centi % 100), g.temp_ok ? "" : " (sensor fault)");
    hal_printf("arm=%s angle=%ld.%ld deg fault=%s\r\n", arm_state_name(g_arm.state),
               (long)(arm_angle_decideg(&g_arm, &g_arm_in) / 10),
               (long)labs(arm_angle_decideg(&g_arm, &g_arm_in) % 10), arm_fault_name(g_arm.fault));
}

static void cli_pdm(void)
{
    static const char *const names[PDM_NUM_CH] = {
        "lightbar", "siren", "scene", "arm", "rear", "mdt", "aux1", "aux2",
    };
    hal_printf("PDM %s  vbat=%u mV temp=%d C flags=0x%02X\r\n",
               g_pdm.online ? "online" : "OFFLINE", g_pdm.vbat_mv, g_pdm.temp_c, g_pdm.flags);
    for (unsigned i = 0; i < PDM_NUM_CH; i++) {
        uint8_t b = (uint8_t)(1u << i);
        hal_printf("  ch%u %-8s duty=%3u  %5u mA %s%s%s retries=%u\r\n", i, names[i],
                   g_pdm.duty[i], g_pdm.current_ma[i],
                   (g_pdm.tripped & b) ? "TRIP " : "", (g_pdm.open_load & b) ? "OPEN " : "",
                   (g_pdm.locked_out & b) ? "LOCKOUT " : "", g_pdm.retry_count[i]);
    }
}

static void cli_tasks(void)
{
    for (uint8_t i = 0; i < g_sched.count; i++) {
        const sched_task_t *t = &g_sched.tasks[i];
        hal_printf("  %-12s every %4lu ms  runs=%lu late=%lu\r\n", t->name,
                   (unsigned long)t->period_ms, (unsigned long)t->runs, (unsigned long)t->late);
    }
}

static void cli_exec(char *line, uint32_t now)
{
    char *cmd = strtok(line, " ");
    char *arg = strtok(NULL, " ");
    if (!cmd) return;
    if (!strcmp(cmd, "help")) {
        hal_printf("commands: status pdm tasks clear deploy stow lights <0-3> "
                   "siren <off|wail|yelp|phaser> reboot hang version\r\n");
    } else if (!strcmp(cmd, "status")) {
        cli_status();
    } else if (!strcmp(cmd, "pdm")) {
        cli_pdm();
    } else if (!strcmp(cmd, "tasks")) {
        cli_tasks();
    } else if (!strcmp(cmd, "clear")) {
        clear_all_faults();
    } else if (!strcmp(cmd, "deploy")) {
        hal_printf("%s\r\n", arm_cmd_deploy(&g_arm, &g_arm_in, now) ? "ok" : "refused (park? fault?)");
    } else if (!strcmp(cmd, "stow")) {
        hal_printf("%s\r\n", arm_cmd_stow(&g_arm, now) ? "ok" : "refused (fault?)");
    } else if (!strcmp(cmd, "lights") && arg) {
        set_stage((uint8_t)atoi(arg), now);
        hal_printf("stage %u\r\n", g.stage);
    } else if (!strcmp(cmd, "siren") && arg) {
        siren_mode_t m = SIREN_OFF;
        for (int i = 0; i < SIREN_HORN; i++) if (!strcmp(arg, siren_mode_name((siren_mode_t)i))) m = (siren_mode_t)i;
        if (m != SIREN_OFF && g.stage == 0) hal_printf("refused: lights are off\r\n");
        else { set_siren(m, now); hal_printf("siren %s\r\n", siren_mode_name(m)); }
    } else if (!strcmp(cmd, "reboot")) {
        hal_printf("rebooting...\r\n");
        hal_system_reset();
    } else if (!strcmp(cmd, "hang")) {
        /* Deliberate bug for the demo: a busy-wait that never yields. Outputs
         * freeze (the arm motor keeps running if it was moving!) until the
         * watchdog resets the MCU. */
        hal_printf("simulating a stuck loop... watchdog should bite in %u ms\r\n", WDT_TIMEOUT_MS);
        hal_tick_wait(); /* flush the message */
        volatile uint32_t spin = 0;
        for (;;) spin++;
    } else if (!strcmp(cmd, "version")) {
        hal_printf("SB-CTRL firmware " FW_VERSION "\r\n");
    } else {
        hal_printf("unknown command '%s' (try help)\r\n", cmd);
    }
}

static void cli_poll(uint32_t now)
{
    static char line[80];
    static size_t len;
    int c;
    while ((c = hal_uart_getc()) >= 0) {
        if (c == '\r' || c == '\n') {
            if (len) {
                line[len] = 0;
                hal_printf("> %s\r\n", line);
                cli_exec(line, now);
                len = 0;
            }
        } else if (len < sizeof line - 1) {
            line[len++] = (char)c;
        }
    }
}

/* ------------------------------------------------------------------ main -- */

int main(void)
{
    hal_init();
    hal_wdt_start(WDT_TIMEOUT_MS);

    static const char *const reasons[] = { "power-on", "WATCHDOG", "software" };
    hal_printf("\r\nSB-CTRL firmware " FW_VERSION " - reset: %s\r\n", reasons[hal_reset_reason() % 3]);
    hal_printf("type 'help' for commands\r\n");

    uint32_t now = hal_millis();
    debounce_init(&g_inputs, DEBOUNCE_TICKS, 0);
    /* Prime the debouncer with the boot-time input state (2x the threshold so
     * a switch still bouncing at power-up settles before we read it). */
    for (unsigned i = 0; i < 2 * DEBOUNCE_TICKS; i++) {
        uint32_t raw = 0;
        for (unsigned p = 0; p < 16; p++) if (hal_gpio_read((pin_t)p)) raw |= 1u << p;
        debounce_update(&g_inputs, raw);
        hal_wdt_kick();
        hal_tick_wait();
    }
    debounce_take_rose(&g_inputs, 0xFFFFFFFFu); /* boot levels are not presses */
    debounce_take_fell(&g_inputs, 0xFFFFFFFFu);
    now = hal_millis();

    pdm_init(&g_pdm);
    power_init(&g_power, power_default_rules, power_default_rule_count);
    g_arm_in.lim_stowed   = (g_inputs.stable >> PIN_LIM_STOWED) & 1u;
    g_arm_in.lim_deployed = (g_inputs.stable >> PIN_LIM_DEPLOYED) & 1u;
    g_arm_in.in_park      = in_park();
    g_arm_in.enc_count    = hal_encoder_count();
    arm_init(&g_arm, &g_arm_in, now);
    hal_printf("arm: boot state %s\r\n", arm_state_name(g_arm.state));

    g.temp_ok = tmp102_init(I2C_ADDR_TMP102) == HAL_OK;
    if (!g.temp_ok) hal_printf("tmp102: not responding\r\n");

    sched_init(&g_sched);
    sched_add(&g_sched, "siren",       task_siren,         2,    0);
    sched_add(&g_sched, "control",     task_control,       10,   1);
    sched_add(&g_sched, "can_tx",      task_can_tx,        20,   3);
    sched_add(&g_sched, "housekeep",   task_housekeeping,  100,  5);
    sched_add(&g_sched, "heartbeat",   task_heartbeat,     500,  0);
    sched_add(&g_sched, "temperature", task_temperature,   1000, 7);

    for (;;) {
        hal_tick_wait();
        now = hal_millis();
        hal_wdt_kick();

        uint32_t raw = 0;
        for (unsigned p = 0; p < 16; p++) if (hal_gpio_read((pin_t)p)) raw |= 1u << p;
        debounce_update(&g_inputs, raw); /* edges latch until the control task takes them */

        drain_can_rx(now);
        cli_poll(now);
        sched_run(&g_sched, now);
    }
}
