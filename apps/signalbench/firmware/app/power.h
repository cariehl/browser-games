/**
 * @file power.h
 * @brief Battery-protection load shedding.
 *
 * With the engine off, emergency loads can flatten a battery quickly. Each
 * rule sheds one PDM channel when battery voltage stays below a threshold for
 * a delay, and restores it only once voltage recovers above a (higher)
 * restore threshold for POWER_RESTORE_HOLD_MS. The gap between the two
 * thresholds plus the time qualification gives hysteresis, so a load whose
 * removal lifts the voltage doesn't oscillate on/off.
 *
 * Safety loads (lightbar, siren) are intentionally never in the rule table.
 */
#ifndef APP_POWER_H
#define APP_POWER_H

#include <stdbool.h>
#include <stdint.h>

#include "can_db.h"

#define POWER_RESTORE_HOLD_MS 2000u
#define POWER_MAX_RULES       8u

typedef struct {
    pdm_ch_t ch;
    uint16_t shed_below_mv;
    uint16_t restore_above_mv;
    uint32_t shed_delay_ms;
} shed_rule_t;

typedef struct {
    const shed_rule_t *rules;
    uint8_t  num_rules;
    uint8_t  shed_mask;                     /**< bit = PDM channel shed */
    bool     timing[POWER_MAX_RULES];
    uint32_t since_ms[POWER_MAX_RULES];
} power_mgr_t;

extern const shed_rule_t power_default_rules[];
extern const uint8_t power_default_rule_count;

void    power_init(power_mgr_t *pm, const shed_rule_t *rules, uint8_t n);
/** @param vbat_mv 0 = unknown (no update). @return current shed mask. */
uint8_t power_update(power_mgr_t *pm, uint16_t vbat_mv, uint32_t now_ms);
bool    power_is_shed(const power_mgr_t *pm, pdm_ch_t ch);

#endif
