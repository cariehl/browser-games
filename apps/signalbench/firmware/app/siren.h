/**
 * @file siren.h
 * @brief Electronic siren tone generator (frequency vs. time).
 */
#ifndef APP_SIREN_H
#define APP_SIREN_H

#include <stdint.h>

typedef enum {
    SIREN_OFF = 0,
    SIREN_WAIL,    /**< slow 500..1500 Hz sweep, 4 s cycle           */
    SIREN_YELP,    /**< fast sweep, 320 ms cycle                     */
    SIREN_PHASER,  /**< very fast sweep, 100 ms cycle                */
    SIREN_HORN,    /**< air-horn: low, rough fixed tone              */
    SIREN_MODE_COUNT
} siren_mode_t;

#define SIREN_FREQ_MIN_HZ 500u
#define SIREN_FREQ_MAX_HZ 1500u
#define SIREN_HORN_HZ     290u

const char *siren_mode_name(siren_mode_t m);
/** Tone frequency at t ms into the mode (0 = silent). */
uint32_t siren_freq_hz(siren_mode_t m, uint32_t t_ms);
/** Next mode for the keypad SIREN button (OFF->WAIL->YELP->PHASER->OFF). */
siren_mode_t siren_next_mode(siren_mode_t m);

#endif
