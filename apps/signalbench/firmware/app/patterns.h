/**
 * @file patterns.h
 * @brief Table-driven warning-light flash patterns.
 *
 * A pattern is a list of (head mask, duration) steps that loops forever.
 * The output is a pure function of elapsed time, so patterns are
 * deterministic, unit-testable, and could be phase-synchronised between
 * vehicles from a shared time base.
 */
#ifndef APP_PATTERNS_H
#define APP_PATTERNS_H

#include <stdint.h>

typedef struct {
    uint16_t mask;        /**< lightbar heads lit during this step */
    uint16_t duration_ms;
} pattern_step_t;

typedef struct {
    const char           *name;
    const pattern_step_t *steps;
    uint8_t               num_steps;
} pattern_t;

typedef enum {
    PATTERN_OFF = 0,
    PATTERN_SLOW_WIGWAG,  /**< stage 1: halves alternate, 75 FPM-ish     */
    PATTERN_FAST_WIGWAG,  /**< stage 2: halves alternate, double-flash   */
    PATTERN_QUAD_ALT,     /**< stage 3: quad flash, alternating sides    */
    PATTERN_COUNT
} pattern_id_t;

const pattern_t *pattern_get(pattern_id_t id);
/** Total loop length of a pattern in ms (0 for OFF). */
uint32_t pattern_period_ms(const pattern_t *p);
/** Head mask lit at time t (ms since the pattern started). */
uint16_t pattern_mask_at(const pattern_t *p, uint32_t t_ms);

#endif
