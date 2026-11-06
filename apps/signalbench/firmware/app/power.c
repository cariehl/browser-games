#include "power.h"

#include <string.h>

const shed_rule_t power_default_rules[] = {
    /* channel        shed below  restore above  delay */
    { PDM_CH_SCENE,   11900,      13000,          5000 },
    { PDM_CH_MDT,     11700,      13000,         10000 },
    { PDM_CH_REAR,    11500,      13000,          5000 },
};
const uint8_t power_default_rule_count =
    (uint8_t)(sizeof power_default_rules / sizeof power_default_rules[0]);

void power_init(power_mgr_t *pm, const shed_rule_t *rules, uint8_t n)
{
    memset(pm, 0, sizeof *pm);
    pm->rules = rules;
    pm->num_rules = n > POWER_MAX_RULES ? POWER_MAX_RULES : n;
}

uint8_t power_update(power_mgr_t *pm, uint16_t vbat_mv, uint32_t now_ms)
{
    if (vbat_mv == 0) return pm->shed_mask;

    for (uint8_t i = 0; i < pm->num_rules; i++) {
        const shed_rule_t *r = &pm->rules[i];
        uint8_t bit = (uint8_t)(1u << r->ch);
        bool shed = (pm->shed_mask & bit) != 0;

        /* Condition that would move us to the other state */
        bool want_change = shed ? (vbat_mv > r->restore_above_mv)
                                : (vbat_mv < r->shed_below_mv);
        uint32_t hold = shed ? POWER_RESTORE_HOLD_MS : r->shed_delay_ms;

        if (!want_change) {
            pm->timing[i] = false;
            continue;
        }
        if (!pm->timing[i]) {
            pm->timing[i] = true;
            pm->since_ms[i] = now_ms;
        }
        if ((uint32_t)(now_ms - pm->since_ms[i]) >= hold) {
            pm->shed_mask ^= bit;
            pm->timing[i] = false;
        }
    }
    return pm->shed_mask;
}

bool power_is_shed(const power_mgr_t *pm, pdm_ch_t ch)
{
    return (pm->shed_mask >> ch) & 1u;
}
