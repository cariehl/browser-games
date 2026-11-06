#include "debounce.h"
#include "unity.h"

static debounce_t d;

void setUp(void) { debounce_init(&d, 5, 0); }
void tearDown(void) {}

static void feed(uint32_t raw, int n) { while (n--) debounce_update(&d, raw); }

static void test_level_must_hold_for_threshold(void)
{
    feed(1, 4);
    TEST_ASSERT_EQUAL_HEX32(0, d.stable);
    feed(1, 1);
    TEST_ASSERT_EQUAL_HEX32(1, d.stable);
}

static void test_bounce_restarts_count(void)
{
    /* 1,1,1,0,1,1,1,1 : the glitch resets the counter */
    feed(1, 3); feed(0, 1); feed(1, 4);
    TEST_ASSERT_EQUAL_HEX32(0, d.stable);
    feed(1, 1);
    TEST_ASSERT_EQUAL_HEX32(1, d.stable);
}

static void test_edges_latch_until_taken(void)
{
    feed(1, 5);              /* press  */
    feed(0, 5);              /* release, before anyone looked */
    TEST_ASSERT_EQUAL_HEX32(1, debounce_take_rose(&d, 0xFF));
    TEST_ASSERT_EQUAL_HEX32(1, debounce_take_fell(&d, 0xFF));
    TEST_ASSERT_EQUAL_HEX32(0, debounce_take_rose(&d, 0xFF)); /* consumed */
}

static void test_take_respects_mask(void)
{
    feed(0x101, 5);
    TEST_ASSERT_EQUAL_HEX32(0x001, debounce_take_rose(&d, 0xFF));
    TEST_ASSERT_EQUAL_HEX32(0x100, debounce_take_rose(&d, 0xFFFFFFFF));
}

static void test_independent_bits(void)
{
    feed(0x3, 5);
    feed(0x1, 5);
    TEST_ASSERT_EQUAL_HEX32(0x1, d.stable);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_level_must_hold_for_threshold);
    RUN_TEST(test_bounce_restarts_count);
    RUN_TEST(test_edges_latch_until_taken);
    RUN_TEST(test_take_respects_mask);
    RUN_TEST(test_independent_bits);
    return UNITY_END();
}
