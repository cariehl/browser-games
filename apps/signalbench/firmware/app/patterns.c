#include "patterns.h"

#include "can_db.h"

#include <stddef.h>

#define L LB_MASK_RED   /* left half, red   */
#define R LB_MASK_BLUE  /* right half, blue */

static const pattern_step_t k_slow_wigwag[] = {
    { L, 400 },
    { R, 400 },
};

static const pattern_step_t k_fast_wigwag[] = {
    { L, 70 }, { 0, 50 }, { L, 70 }, { 0, 60 },
    { R, 70 }, { 0, 50 }, { R, 70 }, { 0, 60 },
};

static const pattern_step_t k_quad_alt[] = {
    { L, 40 }, { 0, 35 }, { L, 40 }, { 0, 35 },
    { L, 40 }, { 0, 35 }, { L, 40 }, { 0, 60 },
    { R, 40 }, { 0, 35 }, { R, 40 }, { 0, 35 },
    { R, 40 }, { 0, 35 }, { R, 40 }, { 0, 60 },
};

#define N(a) ((uint8_t)(sizeof(a) / sizeof((a)[0])))

static const pattern_t k_patterns[PATTERN_COUNT] = {
    [PATTERN_OFF]         = { "off",         NULL,          0 },
    [PATTERN_SLOW_WIGWAG] = { "slow wigwag", k_slow_wigwag, N(k_slow_wigwag) },
    [PATTERN_FAST_WIGWAG] = { "fast wigwag", k_fast_wigwag, N(k_fast_wigwag) },
    [PATTERN_QUAD_ALT]    = { "quad alt",    k_quad_alt,    N(k_quad_alt) },
};

const pattern_t *pattern_get(pattern_id_t id)
{
    return (unsigned)id < PATTERN_COUNT ? &k_patterns[id] : &k_patterns[PATTERN_OFF];
}

uint32_t pattern_period_ms(const pattern_t *p)
{
    uint32_t total = 0;
    for (uint8_t i = 0; p && i < p->num_steps; i++) total += p->steps[i].duration_ms;
    return total;
}

uint16_t pattern_mask_at(const pattern_t *p, uint32_t t_ms)
{
    uint32_t period = pattern_period_ms(p);
    if (period == 0) return 0;
    uint32_t t = t_ms % period;
    for (uint8_t i = 0; i < p->num_steps; i++) {
        if (t < p->steps[i].duration_ms) return p->steps[i].mask;
        t -= p->steps[i].duration_ms;
    }
    return 0; /* unreachable */
}
