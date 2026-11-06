/**
 * @file debounce.h
 * @brief Counter-based debouncer for up to 32 digital inputs.
 *
 * Call debounce_update() once per tick with the raw input word. An input's
 * stable state only changes after it has read the new level for
 * `threshold` consecutive samples.
 *
 * Edges are latched so a slower consumer (e.g. a 10 ms task) never misses a
 * press that happened between its runs: debounce_take_rose()/fell() return
 * every edge since the previous call and clear the latch.
 */
#ifndef APP_DEBOUNCE_H
#define APP_DEBOUNCE_H

#include <stdint.h>

typedef struct {
    uint32_t stable;      /**< debounced state            */
    uint32_t rose_latch;  /**< 0->1 edges not yet taken   */
    uint32_t fell_latch;  /**< 1->0 edges not yet taken   */
    uint8_t  count[32];
    uint8_t  threshold;
} debounce_t;

void     debounce_init(debounce_t *d, uint8_t threshold, uint32_t initial);
uint32_t debounce_update(debounce_t *d, uint32_t raw);
uint32_t debounce_take_rose(debounce_t *d, uint32_t mask);
uint32_t debounce_take_fell(debounce_t *d, uint32_t mask);

#endif
