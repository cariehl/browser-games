/**
 * @file hal.h
 * @brief SignalBench hardware abstraction layer.
 *
 * This is the only interface firmware uses to touch "hardware". The same API
 * is implemented by:
 *   - hal_sim.c   : talks to the SignalBench simulator over TCP (lock-step,
 *                   1 kHz SysTick), so the firmware drives the virtual bench.
 *   - test doubles: unit tests link their own fakes instead (see tests/).
 *
 * Timing model
 * ------------
 * The virtual MCU only advances in time when firmware calls hal_tick_wait()
 * (think: WFI until the next SysTick interrupt). Between two calls you are
 * "inside" one 1 ms tick: inputs are a stable snapshot, outputs are latched
 * and applied when the tick ends. A super-loop looks like:
 *
 *     hal_init();
 *     for (;;) {
 *         hal_tick_wait();      // sleep until next 1 ms tick
 *         ...do work...
 *     }
 *
 * If you never call hal_tick_wait() (e.g. a busy loop), simulated time stops
 * and the simulator reports the core as stalled; with the watchdog enabled it
 * resets the MCU, just like real hardware.
 */
#ifndef SIGNALBENCH_HAL_H
#define SIGNALBENCH_HAL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "board.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    HAL_OK = 0,
    HAL_ERR = 1,       /**< generic failure                       */
    HAL_NACK = 2,      /**< I2C: no device acknowledged           */
    HAL_BUSY = 3,      /**< resource full (e.g. CAN TX FIFO)      */
    HAL_TIMEOUT = 4,
} hal_status_t;

/* ------------------------------------------------------------------------ */
/* Core / time                                                               */
/* ------------------------------------------------------------------------ */

/** Connect to the simulator and wait for the first tick. Call once at boot. */
void hal_init(void);

/** Sleep until the next 1 ms SysTick. Flushes latched outputs. */
void hal_tick_wait(void);

/** Milliseconds since reset (SysTick counter). */
uint32_t hal_millis(void);

/** Blocking delay; burns ticks just like a busy-wait would on silicon. */
void hal_delay_ms(uint32_t ms);

/** Reason the MCU last came out of reset. */
typedef enum {
    RESET_POWER_ON = 0,
    RESET_WATCHDOG = 1,
    RESET_SOFTWARE = 2,
} reset_reason_t;
reset_reason_t hal_reset_reason(void);

/** Request a software reset (NVIC_SystemReset equivalent). Does not return. */
void hal_system_reset(void);

/* ------------------------------------------------------------------------ */
/* GPIO  (pins defined in board.h)                                           */
/* ------------------------------------------------------------------------ */

bool hal_gpio_read(pin_t pin);              /**< inputs: raw pin level     */
void hal_gpio_write(pin_t pin, bool level); /**< outputs only              */
void hal_gpio_toggle(pin_t pin);
bool hal_gpio_get_output(pin_t pin);        /**< read back output latch    */

/* ------------------------------------------------------------------------ */
/* PWM / timers                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Configure a PWM channel.
 * @param freq_hz        carrier / tone frequency (0 = output low)
 * @param duty_permille  0..1000
 */
void hal_pwm_set(pwm_ch_t ch, uint32_t freq_hz, uint16_t duty_permille);

/** Quadrature encoder timer count (arm position), wraps as int32. */
int32_t hal_encoder_count(void);

/* ------------------------------------------------------------------------ */
/* ADC  (12-bit, 3.3 V reference)                                            */
/* ------------------------------------------------------------------------ */

uint16_t hal_adc_read(adc_ch_t ch);

/* ------------------------------------------------------------------------ */
/* CAN  (classic CAN 2.0A, 500 kbit/s)                                       */
/* ------------------------------------------------------------------------ */

typedef struct {
    uint32_t id;      /**< 11-bit standard identifier */
    uint8_t  dlc;     /**< 0..8                       */
    uint8_t  data[8];
} can_frame_t;

/** Queue a frame for transmission. HAL_BUSY if the TX FIFO is full. */
hal_status_t hal_can_send(const can_frame_t *frame);

/** Pop one received frame. Returns false when the RX FIFO is empty. */
bool hal_can_recv(can_frame_t *out);

/** Frames dropped because the RX FIFO overflowed since boot. */
uint32_t hal_can_rx_overruns(void);

/* ------------------------------------------------------------------------ */
/* I2C  (master, blocking)                                                   */
/* ------------------------------------------------------------------------ */

/** Write tx then repeated-start read rx. Either length may be 0. */
hal_status_t hal_i2c_write_read(uint8_t addr7,
                                const uint8_t *tx, size_t tx_len,
                                uint8_t *rx, size_t rx_len);

/* ------------------------------------------------------------------------ */
/* UART  (debug console, shown in the simulator)                             */
/* ------------------------------------------------------------------------ */

void hal_uart_write(const char *buf, size_t len);
/** Next received byte, or -1 if none. */
int  hal_uart_getc(void);
/** printf to the debug UART. */
int  hal_printf(const char *fmt, ...)
#if defined(__GNUC__)
    __attribute__((format(printf, 1, 2)))
#endif
    ;

/* ------------------------------------------------------------------------ */
/* Independent watchdog                                                      */
/* ------------------------------------------------------------------------ */

/** Start the watchdog. Once started it cannot be stopped (like an IWDG). */
void hal_wdt_start(uint32_t timeout_ms);
void hal_wdt_kick(void);

#ifdef __cplusplus
}
#endif

#endif /* SIGNALBENCH_HAL_H */
