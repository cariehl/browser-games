#include "siren.h"

static const char *const k_names[SIREN_MODE_COUNT] = {
    "off", "wail", "yelp", "phaser", "horn",
};

const char *siren_mode_name(siren_mode_t m)
{
    return (unsigned)m < SIREN_MODE_COUNT ? k_names[m] : "?";
}

/* Triangle sweep between MIN and MAX over `period` ms, integer only. */
static uint32_t sweep(uint32_t t_ms, uint32_t period)
{
    const uint32_t span = SIREN_FREQ_MAX_HZ - SIREN_FREQ_MIN_HZ;
    uint32_t half = period / 2;
    uint32_t t = t_ms % period;
    uint32_t pos = t < half ? t : period - t; /* 0..half..0 */
    return SIREN_FREQ_MIN_HZ + (span * pos) / half;
}

uint32_t siren_freq_hz(siren_mode_t m, uint32_t t_ms)
{
    switch (m) {
    case SIREN_WAIL:   return sweep(t_ms, 4000);
    case SIREN_YELP:   return sweep(t_ms, 320);
    case SIREN_PHASER: return sweep(t_ms, 100);
    case SIREN_HORN:   return SIREN_HORN_HZ;
    default:           return 0;
    }
}

siren_mode_t siren_next_mode(siren_mode_t m)
{
    switch (m) {
    case SIREN_OFF:  return SIREN_WAIL;
    case SIREN_WAIL: return SIREN_YELP;
    case SIREN_YELP: return SIREN_PHASER;
    default:         return SIREN_OFF;
    }
}
