#include "scheduler.h"

#include <string.h>

void sched_init(scheduler_t *s)
{
    memset(s, 0, sizeof *s);
}

int sched_add(scheduler_t *s, const char *name, task_fn_t fn,
              uint32_t period_ms, uint32_t offset_ms)
{
    if (!s || !fn || period_ms == 0 || s->count >= SCHED_MAX_TASKS) return -1;
    sched_task_t *t = &s->tasks[s->count];
    t->name = name;
    t->fn = fn;
    t->period_ms = period_ms;
    t->next_ms = offset_ms;
    t->runs = 0;
    t->late = 0;
    return s->count++;
}

/* "a is at or after b" in modular 32-bit time */
static bool time_reached(uint32_t now, uint32_t deadline)
{
    return (int32_t)(now - deadline) >= 0;
}

int sched_run(scheduler_t *s, uint32_t now_ms)
{
    int ran = 0;
    for (uint8_t i = 0; i < s->count; i++) {
        sched_task_t *t = &s->tasks[i];
        if (!time_reached(now_ms, t->next_ms)) continue;
        if ((uint32_t)(now_ms - t->next_ms) >= t->period_ms) {
            t->late++;
            /* re-align instead of running a burst of catch-up calls */
            t->next_ms = now_ms;
        }
        t->fn(now_ms);
        t->runs++;
        t->next_ms += t->period_ms;
        ran++;
    }
    return ran;
}
