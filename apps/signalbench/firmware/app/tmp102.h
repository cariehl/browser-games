/**
 * @file tmp102.h
 * @brief Driver for the TI TMP102 I2C temperature sensor.
 *
 * Uses hal_i2c_write_read(); unit tests substitute a fake at link time.
 */
#ifndef APP_TMP102_H
#define APP_TMP102_H

#include <stdint.h>

#include "hal.h"

#define TMP102_REG_TEMP   0x00
#define TMP102_REG_CONFIG 0x01

/** Probe the sensor (reads CONFIG). HAL_NACK if absent. */
hal_status_t tmp102_init(uint8_t addr7);
/** Read temperature in hundredths of a degree C. */
hal_status_t tmp102_read_centi(uint8_t addr7, int16_t *centi_c);
/** Convert the raw 16-bit TEMP register (12-bit, left-aligned) to centi-C. */
int16_t tmp102_raw_to_centi(uint16_t raw);

#endif
