/**
 * @file board.h
 * @brief Pin map for the SignalBench "SB-CTRL" control board.
 *
 * The control board is a Cortex-M class MCU with:
 *   - an 8-button keypad (with indicator LEDs) and vehicle inputs
 *   - an H-bridge driving the scene-light arm motor, plus quadrature encoder
 *     and two limit switches
 *   - a siren tone output into the siren amplifier
 *   - a CAN transceiver to the PDM and the lightbar
 *   - a TMP102 temperature sensor on I2C
 *
 * All digital inputs are conditioned to active-high logic levels.
 * Mechanical inputs (buttons, limit switches) BOUNCE for a few ms; debounce
 * them in firmware.
 */
#ifndef SIGNALBENCH_BOARD_H
#define SIGNALBENCH_BOARD_H

#include <stdint.h>

/* ---- GPIO --------------------------------------------------------------- */
typedef enum {
    /* inputs 0..15 */
    PIN_BTN_LIGHTS   = 0,  /**< keypad 1: warning lights (cycles stages)  */
    PIN_BTN_SIREN    = 1,  /**< keypad 2: siren tone                       */
    PIN_BTN_HORN     = 2,  /**< keypad 3: air horn (momentary)             */
    PIN_BTN_SCENE    = 3,  /**< keypad 4: scene light                      */
    PIN_BTN_ARM      = 4,  /**< keypad 5: deploy / stow light arm          */
    PIN_BTN_TAKEDOWN = 5,  /**< keypad 6: takedown (white) lights          */
    PIN_BTN_REAR     = 6,  /**< keypad 7: rear flashers                    */
    PIN_BTN_AUX      = 7,  /**< keypad 8: aux / fault reset                */
    PIN_IN_IGNITION  = 8,  /**< vehicle ignition sense                      */
    PIN_IN_PARK      = 9,  /**< transmission in PARK                        */
    PIN_LIM_STOWED   = 10, /**< arm limit switch: fully stowed             */
    PIN_LIM_DEPLOYED = 11, /**< arm limit switch: fully deployed           */

    /* outputs 16..31 */
    PIN_LED_HEARTBEAT = 16, /**< green board LED                            */
    PIN_LED_FAULT     = 17, /**< red board LED                              */
    PIN_LED_CAN       = 18, /**< yellow board LED                           */
    PIN_ARM_DIR       = 19, /**< H-bridge direction: 1 = deploy (up)        */
    PIN_KP_LED0       = 24, /**< keypad indicator LEDs 24..31 (one per key) */
    PIN_KP_LED7       = 31,
} pin_t;

#define BOARD_NUM_BUTTONS 8
#define PIN_KP_LED(n) ((pin_t)(PIN_KP_LED0 + (n)))

/* ---- PWM ---------------------------------------------------------------- */
typedef enum {
    PWM_ARM_MOTOR = 0, /**< H-bridge enable. Typ. 20 kHz, duty = speed     */
    PWM_SIREN     = 1, /**< tone into siren amp. freq = pitch, duty 500    */
    PWM_BEEPER    = 2, /**< keypad beeper                                   */
    PWM_SPARE     = 3,
    PWM_NUM_CH    = 4,
} pwm_ch_t;

/* ---- ADC (12-bit, 3.3 V) ------------------------------------------------ */
typedef enum {
    ADC_VBAT       = 0, /**< battery via 1:6 divider -> 0..19.8 V           */
    ADC_ARM_ISENSE = 1, /**< H-bridge current sense, 100 mV/A               */
    ADC_AMBIENT    = 2, /**< photocell, 0 = dark .. 4095 = full daylight    */
    ADC_SPARE      = 3,
    ADC_NUM_CH     = 4,
} adc_ch_t;

#define ADC_FULL_SCALE   4095u
#define ADC_VREF_MV      3300u
#define VBAT_DIVIDER     6u
/** Convert ADC_VBAT counts to millivolts at the battery. */
#define ADC_TO_VBAT_MV(c) ((uint32_t)(c) * ADC_VREF_MV * VBAT_DIVIDER / ADC_FULL_SCALE)
/** Convert ADC_ARM_ISENSE counts to milliamps. */
#define ADC_TO_ARM_MA(c)  ((uint32_t)(c) * ADC_VREF_MV * 10u / ADC_FULL_SCALE)

/* ---- Arm encoder -------------------------------------------------------- */
#define ARM_COUNTS_PER_DEG 20 /**< x4 quadrature counts per degree of arm   */
#define ARM_DEPLOYED_DEG   90

/* ---- I2C ---------------------------------------------------------------- */
#define I2C_ADDR_TMP102 0x48

#endif /* SIGNALBENCH_BOARD_H */
