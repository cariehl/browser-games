#include "pdm.h"
#include "unity.h"

#include <string.h>

static pdm_t p;

void setUp(void) { pdm_init(&p); }
void tearDown(void) {}

static void rx_status_c(uint16_t vbat, uint8_t tripped, uint8_t open, uint32_t now)
{
    can_frame_t f = { .id = CAN_ID_PDM_STATUS_C, .dlc = 8 };
    f.data[0] = (uint8_t)vbat; f.data[1] = (uint8_t)(vbat >> 8);
    f.data[2] = tripped; f.data[3] = open; f.data[4] = (uint8_t)(int8_t)41; f.data[5] = 0;
    TEST_ASSERT_TRUE(pdm_handle_frame(&p, &f, now));
}

static void test_cmd_frame_encodes_duties(void)
{
    pdm_set(&p, PDM_CH_SCENE, 255);
    pdm_set(&p, PDM_CH_REAR, 128);
    can_frame_t f;
    pdm_build_cmd(&p, &f);
    TEST_ASSERT_EQUAL_HEX32(CAN_ID_PDM_CMD, f.id);
    TEST_ASSERT_EQUAL(8, f.dlc);
    TEST_ASSERT_EQUAL_HEX8(255, f.data[PDM_CH_SCENE]);
    TEST_ASSERT_EQUAL_HEX8(128, f.data[PDM_CH_REAR]);
    TEST_ASSERT_EQUAL_HEX8(0, f.data[PDM_CH_LIGHTBAR]);
}

static void test_decodes_currents_and_status(void)
{
    can_frame_t a = { .id = CAN_ID_PDM_STATUS_A, .dlc = 8,
                      .data = { 0x2C, 0x01, 0, 0, 0xE8, 0x03, 0, 0 } }; /* 300, 1000 */
    pdm_handle_frame(&p, &a, 10);
    rx_status_c(12650, 0x04, 0x40, 10);
    TEST_ASSERT_EQUAL_UINT16(3000, p.current_ma[0]);
    TEST_ASSERT_EQUAL_UINT16(10000, p.current_ma[2]);
    TEST_ASSERT_EQUAL_UINT16(12650, p.vbat_mv);
    TEST_ASSERT_EQUAL_HEX8(0x04, p.tripped);
    TEST_ASSERT_EQUAL_HEX8(0x40, p.open_load);
    TEST_ASSERT_EQUAL_INT8(41, p.temp_c);
    TEST_ASSERT_EQUAL_UINT32(13000, pdm_total_current_ma(&p));
}

static void test_ignores_foreign_frames(void)
{
    can_frame_t f = { .id = 0x123, .dlc = 2 };
    TEST_ASSERT_FALSE(pdm_handle_frame(&p, &f, 0));
    TEST_ASSERT_FALSE(p.ever_rx);
}

static void test_goes_offline_without_status(void)
{
    rx_status_c(12600, 0, 0, 1000);
    pdm_update(&p, 1000 + PDM_OFFLINE_TIMEOUT_MS - 1);
    TEST_ASSERT_TRUE(p.online);
    pdm_update(&p, 1000 + PDM_OFFLINE_TIMEOUT_MS);
    TEST_ASSERT_FALSE(p.online);
}

/* Drive the retry state machine for a channel that keeps tripping. */
static void test_retries_with_backoff_then_locks_out(void)
{
    can_frame_t f;
    uint32_t t = 0;
    uint32_t clear_times[PDM_MAX_RETRIES];
    int clears = 0;

    for (; t < 20000 && !(p.locked_out & 0x04); t += 10) {
        rx_status_c(12600, 0x04, 0, t);        /* scene channel tripped */
        pdm_update(&p, t);
        if (pdm_take_fault_clear(&p, &f)) {
            TEST_ASSERT_EQUAL_HEX8(0x04, f.data[0]);
            TEST_ASSERT_TRUE(clears < (int)PDM_MAX_RETRIES);
            clear_times[clears++] = t;
        }
    }
    TEST_ASSERT_EQUAL(PDM_MAX_RETRIES, clears);
    TEST_ASSERT_TRUE(p.locked_out & 0x04);
    /* back-off grows: 1 s, then 2 s (+grace), then 3 s (+grace) */
    TEST_ASSERT_EQUAL_UINT32(1000, clear_times[0]);
    TEST_ASSERT_EQUAL_UINT32(clear_times[0] + PDM_RETRY_GRACE_MS + 2000, clear_times[1]);
    TEST_ASSERT_EQUAL_UINT32(clear_times[1] + PDM_RETRY_GRACE_MS + 3000, clear_times[2]);

    /* locked-out channel is forced off in the command */
    pdm_set(&p, PDM_CH_SCENE, 255);
    pdm_build_cmd(&p, &f);
    TEST_ASSERT_EQUAL_HEX8(0, f.data[PDM_CH_SCENE]);
}

static void test_operator_reset_clears_lockout(void)
{
    p.locked_out = 0x04;
    p.retry_count[2] = 3;
    pdm_reset_faults(&p);
    TEST_ASSERT_EQUAL_HEX8(0, p.locked_out);
    can_frame_t f;
    TEST_ASSERT_TRUE(pdm_take_fault_clear(&p, &f));
    TEST_ASSERT_EQUAL_HEX8(0xFF, f.data[0]);
}

static void test_single_trip_recovers_and_is_forgiven(void)
{
    can_frame_t f;
    uint32_t t = 0;
    for (; t <= 1000; t += 10) { rx_status_c(12600, 0x01, 0, t); pdm_update(&p, t); }
    TEST_ASSERT_TRUE(pdm_take_fault_clear(&p, &f));
    TEST_ASSERT_EQUAL(1, p.retry_count[0]);
    for (; t < 1000 + PDM_RETRY_GRACE_MS + PDM_RETRY_FORGIVE_MS + 100; t += 10) {
        rx_status_c(12600, 0x00, 0, t);        /* healthy after the clear */
        pdm_update(&p, t);
    }
    TEST_ASSERT_EQUAL(0, p.retry_count[0]);
    TEST_ASSERT_EQUAL_HEX8(0, p.locked_out);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_cmd_frame_encodes_duties);
    RUN_TEST(test_decodes_currents_and_status);
    RUN_TEST(test_ignores_foreign_frames);
    RUN_TEST(test_goes_offline_without_status);
    RUN_TEST(test_retries_with_backoff_then_locks_out);
    RUN_TEST(test_operator_reset_clears_lockout);
    RUN_TEST(test_single_trip_recovers_and_is_forgiven);
    return UNITY_END();
}
