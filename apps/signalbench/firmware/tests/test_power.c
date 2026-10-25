#include "power.h"
#include "unity.h"

static power_mgr_t pm;
static const shed_rule_t rules[] = {
    { PDM_CH_SCENE, 11900, 13000, 5000 },
    { PDM_CH_MDT,   11700, 13000, 10000 },
};

void setUp(void) { power_init(&pm, rules, 2); }
void tearDown(void) {}

static uint8_t run(uint16_t mv, uint32_t from, uint32_t to)
{
    for (uint32_t t = from; t <= to; t += 100) power_update(&pm, mv, t);
    return pm.shed_mask;
}

static void test_healthy_battery_sheds_nothing(void)
{
    TEST_ASSERT_EQUAL_HEX8(0, run(12600, 0, 60000));
}

static void test_brief_dip_is_ignored(void)
{
    run(11500, 0, 4000);          /* shorter than the 5 s delay */
    run(12500, 4100, 4200);
    TEST_ASSERT_EQUAL_HEX8(0, run(11500, 4300, 8000));
}

static void test_sheds_in_priority_order(void)
{
    run(11600, 0, 5000);
    TEST_ASSERT_TRUE(power_is_shed(&pm, PDM_CH_SCENE));
    TEST_ASSERT_FALSE(power_is_shed(&pm, PDM_CH_MDT));
    run(11600, 5100, 10000);
    TEST_ASSERT_TRUE(power_is_shed(&pm, PDM_CH_MDT));
}

static void test_restore_needs_charging_voltage(void)
{
    run(11600, 0, 10000);
    TEST_ASSERT_EQUAL_HEX8((1u << PDM_CH_SCENE) | (1u << PDM_CH_MDT), pm.shed_mask);
    /* shedding lifts the battery to 12.4 V: not enough to restore (hysteresis) */
    TEST_ASSERT_NOT_EQUAL(0, run(12400, 10100, 30000));
    /* engine started: 14.1 V for the hold time restores everything */
    run(14100, 30100, 30100 + POWER_RESTORE_HOLD_MS);
    TEST_ASSERT_EQUAL_HEX8(0, pm.shed_mask);
}

static void test_unknown_voltage_holds_state(void)
{
    run(11600, 0, 10000);
    uint8_t before = pm.shed_mask;
    TEST_ASSERT_EQUAL_HEX8(before, run(0, 10100, 40000));
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_healthy_battery_sheds_nothing);
    RUN_TEST(test_brief_dip_is_ignored);
    RUN_TEST(test_sheds_in_priority_order);
    RUN_TEST(test_restore_needs_charging_voltage);
    RUN_TEST(test_unknown_voltage_holds_state);
    return UNITY_END();
}
