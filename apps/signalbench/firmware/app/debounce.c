#include "debounce.h"

#include <string.h>

void debounce_init(debounce_t *d, uint8_t threshold, uint32_t initial)
{
    memset(d, 0, sizeof *d);
    d->threshold = threshold ? threshold : 1;
    d->stable = initial;
}

uint32_t debounce_update(debounce_t *d, uint32_t raw)
{
    uint32_t before = d->stable;
    uint32_t diff = raw ^ d->stable;
    for (unsigned i = 0; i < 32; i++) {
        uint32_t bit = 1u << i;
        if (diff & bit) {
            if (++d->count[i] >= d->threshold) {
                d->stable ^= bit;
                d->count[i] = 0;
            }
        } else {
            d->count[i] = 0; /* bounced back: restart the count */
        }
    }
    d->rose_latch |= d->stable & ~before;
    d->fell_latch |= ~d->stable & before;
    return d->stable;
}

uint32_t debounce_take_rose(debounce_t *d, uint32_t mask)
{
    uint32_t r = d->rose_latch & mask;
    d->rose_latch &= ~mask;
    return r;
}

uint32_t debounce_take_fell(debounce_t *d, uint32_t mask)
{
    uint32_t f = d->fell_latch & mask;
    d->fell_latch &= ~mask;
    return f;
}
