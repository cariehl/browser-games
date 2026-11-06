#include "scheduler.h"
#include "unity.h"

static scheduler_t s;
static int calls_a, calls_b;
static uint32_t last_a;

static void task_a(uint32_t now) { calls_a++; last_a = now; }
static void task_b(uint32_t now) { (void)now; calls_b++; }

void setUp(void) { sched_init(&s); calls_a = calls_b = 0; last_a = 0; }
void tearDown(void) {}

static void test_runs_at_period_and_offset(void)
{
    sched_add(&s, "a", task_a, 10, 0);
    sched_add(&s, "b", task_b, 10, 5);
    for (uint32_t t = 0; t < 100; t++) sched_run(&s, t);
    TEST_ASSERT_EQUAL(10, calls_a);
    TEST_ASSERT_EQUAL(10, calls_b);
    TEST_ASSERT_EQUAL_UINT32(90, last_a);
}

static void test_rejects_bad_tasks(void)
{
    TEST_ASSERT_EQUAL(-1, sched_add(&s, "z", task_a, 0, 0));
    TEST_ASSERT_EQUAL(-1, sched_add(&s, "z", NULL, 10, 0));
    for (int i = 0; i < SCHED_MAX_TASKS; i++) TEST_ASSERT_EQUAL(i, sched_add(&s, "t", task_a, 1, 0));
    TEST_ASSERT_EQUAL(-1, sched_add(&s, "full", task_a, 1, 0));
}

static void test_late_task_realigns_without_burst(void)
{
    sched_add(&s, "a", task_a, 10, 0);
    sched_run(&s, 0);
    sched_run(&s, 55);            /* missed 5 periods */
    TEST_ASSERT_EQUAL(2, calls_a);
    TEST_ASSERT_EQUAL_UINT32(1, s.tasks[0].late);
    sched_run(&s, 60);            /* not due until 65 */
    TEST_ASSERT_EQUAL(2, calls_a);
    sched_run(&s, 65);
    TEST_ASSERT_EQUAL(3, calls_a);
}

static void test_survives_32bit_wrap(void)
{
    uint32_t start = 0xFFFFFFF0u;
    sched_add(&s, "a", task_a, 8, start);
    for (uint32_t i = 0; i < 64; i++) sched_run(&s, start + i);
    TEST_ASSERT_EQUAL(8, calls_a);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_runs_at_period_and_offset);
    RUN_TEST(test_rejects_bad_tasks);
    RUN_TEST(test_late_task_realigns_without_burst);
    RUN_TEST(test_survives_32bit_wrap);
    return UNITY_END();
}
