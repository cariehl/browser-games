/**
 * @file scheduler.h
 * @brief Minimal cooperative, time-triggered task scheduler.
 *
 * Tasks run to completion from the super-loop. Each task has a period and a
 * phase offset so periodic work can be spread across ticks.
 */
#ifndef APP_SCHEDULER_H
#define APP_SCHEDULER_H

#include <stdbool.h>
#include <stdint.h>

#define SCHED_MAX_TASKS 16

typedef void (*task_fn_t)(uint32_t now_ms);

typedef struct {
    const char *name;
    task_fn_t   fn;
    uint32_t    period_ms;
    uint32_t    next_ms;
    uint32_t    runs;
    uint32_t    late;       /**< times the task started >= 1 period late */
} sched_task_t;

typedef struct {
    sched_task_t tasks[SCHED_MAX_TASKS];
    uint8_t      count;
} scheduler_t;

void sched_init(scheduler_t *s);
/** @return task index, or -1 if full / bad args. */
int  sched_add(scheduler_t *s, const char *name, task_fn_t fn,
               uint32_t period_ms, uint32_t offset_ms);
/** Run every task that is due at now_ms (wrap-safe). @return tasks run. */
int  sched_run(scheduler_t *s, uint32_t now_ms);

#endif
