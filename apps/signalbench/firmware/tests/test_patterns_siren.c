#include "can_db.h"
#include "patterns.h"
#include "siren.h"
#include "unity.h"

void setUp(void) {}
void tearDown(void) {}

static void test_off_pattern_is_dark(void)
{
    const pattern_t *p = pattern_get(PATTERN_OFF);
    TEST_ASSERT_EQUAL_UINT32(0, pattern_period_ms(p));
    TEST_ASSERT_EQUAL_HEX16(0, pattern_mask_at(p, 1234));
}

static void test_slow_wigwag_alternates_sides(void)
{
    const pattern_t *p = pattern_get(PATTERN_SLOW_WIGWAG);
    TEST_ASSERT_EQUAL_UINT32(800, pattern_period_ms(p));
    TEST_ASSERT_EQUAL_HEX16(LB_MASK_RED, pattern_mask_at(p, 0));
    TEST_ASSERT_EQUAL_HEX16(LB_MASK_RED, pattern_mask_at(p, 399));
    TEST_ASSERT_EQUAL_HEX16(LB_MASK_BLUE, pattern_mask_at(p, 400));
    TEST_ASSERT_EQUAL_HEX16(LB_MASK_RED, pattern_mask_at(p, 800)); /* loops */
}

static void test_patterns_never_light_both_sides(void)
{
    for (int id = PATTERN_SLOW_WIGWAG; id < PATTERN_COUNT; id++) {
        const pattern_t *p = pattern_get((pattern_id_t)id);
        for (uint32_t t = 0; t < 2 * pattern_period_ms(p); t++) {
            uint16_t m = pattern_mask_at(p, t);
            TEST_ASSERT_FALSE((m & LB_MASK_RED) && (m & LB_MASK_BLUE));
            TEST_ASSERT_EQUAL_HEX16(0, m & ~LB_MASK_ALL);
        }
    }
}

static void test_invalid_pattern_falls_back_to_off(void)
{
    TEST_ASSERT_EQUAL_PTR(pattern_get(PATTERN_OFF), pattern_get((pattern_id_t)99));
}

static void test_wail_sweeps_within_band(void)
{
    TEST_ASSERT_EQUAL_UINT32(SIREN_FREQ_MIN_HZ, siren_freq_hz(SIREN_WAIL, 0));
    TEST_ASSERT_EQUAL_UINT32(SIREN_FREQ_MAX_HZ, siren_freq_hz(SIREN_WAIL, 2000));
    TEST_ASSERT_EQUAL_UINT32(1000, siren_freq_hz(SIREN_WAIL, 1000));
    for (uint32_t t = 0; t < 8000; t += 7) {
        uint32_t f = siren_freq_hz(SIREN_WAIL, t);
        TEST_ASSERT_TRUE(f >= SIREN_FREQ_MIN_HZ && f <= SIREN_FREQ_MAX_HZ);
    }
}

static void test_siren_modes(void)
{
    TEST_ASSERT_EQUAL_UINT32(0, siren_freq_hz(SIREN_OFF, 500));
    TEST_ASSERT_EQUAL_UINT32(SIREN_HORN_HZ, siren_freq_hz(SIREN_HORN, 500));
    TEST_ASSERT_EQUAL(SIREN_WAIL, siren_next_mode(SIREN_OFF));
    TEST_ASSERT_EQUAL(SIREN_YELP, siren_next_mode(SIREN_WAIL));
    TEST_ASSERT_EQUAL(SIREN_PHASER, siren_next_mode(SIREN_YELP));
    TEST_ASSERT_EQUAL(SIREN_OFF, siren_next_mode(SIREN_PHASER));
    TEST_ASSERT_EQUAL_STRING("yelp", siren_mode_name(SIREN_YELP));
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_off_pattern_is_dark);
    RUN_TEST(test_slow_wigwag_alternates_sides);
    RUN_TEST(test_patterns_never_light_both_sides);
    RUN_TEST(test_invalid_pattern_falls_back_to_off);
    RUN_TEST(test_wail_sweeps_within_band);
    RUN_TEST(test_siren_modes);
    return UNITY_END();
}
