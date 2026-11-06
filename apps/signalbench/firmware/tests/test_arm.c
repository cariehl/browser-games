/* Arm state machine tests, using a tiny kinematic stand-in for the plant. */
#include "arm.h"
#include "board.h"
#include "unity.h"

static arm_t a;
static arm_inputs_t in;
static double angle;   /* plant: degrees */
static bool jammed;
static bool encoder_dead;
static uint32_t now;

static void plant_step(uint32_t dt)
{
    double speed = a.out.need_power ? a.out.duty_permille * 0.03 : 0; /* deg/s */
    double delta = speed * dt / 1000.0 * (a.out.dir_up ? 1 : -1);
    if (!jammed) angle += delta;
    if (angle < 0) angle = 0;
    if (angle > 95) angle = 95;
    bool stalled = a.out.duty_permille && (jammed || angle <= 0 || angle >= 95);
    in.motor_ma = stalled ? 20000 : (a.out.duty_permille ? 2500 : 0);
    in.lim_stowed = angle < 0.5;
    in.lim_deployed = angle > 89.5;
    if (!encoder_dead) in.enc_count = (int32_t)(angle * ARM_COUNTS_PER_DEG);
}

static void run_ms(uint32_t ms)
{
    for (uint32_t i = 0; i < ms; i += 10) {
        plant_step(10);
        now += 10;
        arm_update(&a, &in, now);
    }
}

void setUp(void)
{
    angle = 0; jammed = false; encoder_dead = false; now = 1000;
    in = (arm_inputs_t){ .in_park = true };
    plant_step(0);
    arm_init(&a, &in, now);
}
void tearDown(void) {}

static void test_boots_stowed_and_homed(void)
{
    TEST_ASSERT_EQUAL(ARM_STOWED, a.state);
    TEST_ASSERT_TRUE(a.homed);
    TEST_ASSERT_EQUAL_INT32(0, arm_angle_decideg(&a, &in));
}

static void test_boots_unknown_mid_travel(void)
{
    angle = 45; plant_step(0);
    arm_init(&a, &in, now);
    TEST_ASSERT_EQUAL(ARM_UNKNOWN, a.state);
    TEST_ASSERT_EQUAL_INT32(-1, arm_angle_decideg(&a, &in));
}

static void test_deploy_refused_out_of_park(void)
{
    in.in_park = false;
    TEST_ASSERT_FALSE(arm_cmd_deploy(&a, &in, now));
    TEST_ASSERT_EQUAL(ARM_STOWED, a.state);
}

static void test_deploys_to_limit_and_stops(void)
{
    TEST_ASSERT_TRUE(arm_cmd_deploy(&a, &in, now));
    run_ms(6000);
    TEST_ASSERT_EQUAL(ARM_DEPLOYED, a.state);
    TEST_ASSERT_EQUAL_UINT16(0, a.out.duty_permille);
    TEST_ASSERT_FALSE(a.out.need_power);
    TEST_ASSERT_TRUE(angle > 89.5 && angle < 92);
}

static void test_slows_down_near_end_stop(void)
{
    arm_cmd_deploy(&a, &in, now);
    while (angle < 85) run_ms(10);
    TEST_ASSERT_EQUAL_UINT16(ARM_SLOW_DUTY, a.out.duty_permille);
}

static void test_auto_stows_when_leaving_park(void)
{
    arm_cmd_deploy(&a, &in, now);
    run_ms(6000);
    in.in_park = false;
    run_ms(10);
    TEST_ASSERT_EQUAL(ARM_STOWING, a.state);
    run_ms(8000);
    TEST_ASSERT_EQUAL(ARM_STOWED, a.state);
}

static void test_jam_trips_stall_fault(void)
{
    arm_cmd_deploy(&a, &in, now);
    run_ms(1000);
    jammed = true;
    run_ms(500);
    TEST_ASSERT_EQUAL(ARM_FAULT, a.state);
    TEST_ASSERT_EQUAL(ARM_FAULT_STALL, a.fault);
    TEST_ASSERT_EQUAL_UINT16(0, a.out.duty_permille);
    /* faulted arm ignores commands until cleared */
    TEST_ASSERT_FALSE(arm_cmd_stow(&a, now));
    jammed = false;
    arm_clear_fault(&a, &in);
    TEST_ASSERT_EQUAL(ARM_STOPPED, a.state);
    TEST_ASSERT_TRUE(arm_cmd_stow(&a, now));
}

static void test_dead_encoder_detected(void)
{
    encoder_dead = true;
    arm_cmd_deploy(&a, &in, now);
    run_ms(1000);
    TEST_ASSERT_EQUAL(ARM_FAULT, a.state);
    TEST_ASSERT_EQUAL(ARM_FAULT_ENCODER, a.fault);
}

static void test_both_limits_is_a_fault(void)
{
    in.lim_deployed = true; /* stuck switch: both active */
    arm_update(&a, &in, now);
    TEST_ASSERT_EQUAL(ARM_FAULT_LIMITS, a.fault);
}

static void test_toggle_mid_deploy_stops(void)
{
    arm_cmd_deploy(&a, &in, now);
    run_ms(1000);
    arm_cmd_toggle(&a, &in, now);
    TEST_ASSERT_EQUAL(ARM_STOPPED, a.state);
    TEST_ASSERT_EQUAL_UINT16(0, a.out.duty_permille);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_boots_stowed_and_homed);
    RUN_TEST(test_boots_unknown_mid_travel);
    RUN_TEST(test_deploy_refused_out_of_park);
    RUN_TEST(test_deploys_to_limit_and_stops);
    RUN_TEST(test_slows_down_near_end_stop);
    RUN_TEST(test_auto_stows_when_leaving_park);
    RUN_TEST(test_jam_trips_stall_fault);
    RUN_TEST(test_dead_encoder_detected);
    RUN_TEST(test_both_limits_is_a_fault);
    RUN_TEST(test_toggle_mid_deploy_stops);
    return UNITY_END();
}
