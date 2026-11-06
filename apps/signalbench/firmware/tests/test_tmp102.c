/* TMP102 driver tests. hal_i2c_write_read() is replaced at link time by the
 * fake below (link seam), so the real driver code runs unmodified. */
#include "tmp102.h"
#include "unity.h"

#include <string.h>

static hal_status_t fake_status;
static uint8_t fake_rx[2];
static uint8_t last_addr, last_reg;

hal_status_t hal_i2c_write_read(uint8_t addr7, const uint8_t *tx, size_t tx_len,
                                uint8_t *rx, size_t rx_len)
{
    last_addr = addr7;
    last_reg = tx_len ? tx[0] : 0xFF;
    if (fake_status == HAL_OK && rx) memcpy(rx, fake_rx, rx_len < 2 ? rx_len : 2);
    return fake_status;
}

void setUp(void) { fake_status = HAL_OK; memset(fake_rx, 0, sizeof fake_rx); }
void tearDown(void) {}

static void test_raw_conversion_from_datasheet(void)
{
    TEST_ASSERT_EQUAL_INT16(2500, tmp102_raw_to_centi(0x1900));  /*  25.0 C   */
    TEST_ASSERT_EQUAL_INT16(6, tmp102_raw_to_centi(0x0010));     /*  0.0625 C */
    TEST_ASSERT_EQUAL_INT16(0, tmp102_raw_to_centi(0x0000));
    TEST_ASSERT_EQUAL_INT16(-25, tmp102_raw_to_centi(0xFFC0));   /* -0.25 C   */
    TEST_ASSERT_EQUAL_INT16(-2500, tmp102_raw_to_centi(0xE700)); /* -25.0 C   */
    TEST_ASSERT_EQUAL_INT16(12793, tmp102_raw_to_centi(0x7FF0)); /* 127.9375  */
}

static void test_read_selects_temp_register(void)
{
    fake_rx[0] = 0x32; fake_rx[1] = 0x00; /* 50 C */
    int16_t t = 0;
    TEST_ASSERT_EQUAL(HAL_OK, tmp102_read_centi(0x48, &t));
    TEST_ASSERT_EQUAL_HEX8(0x48, last_addr);
    TEST_ASSERT_EQUAL_HEX8(TMP102_REG_TEMP, last_reg);
    TEST_ASSERT_EQUAL_INT16(5000, t);
}

static void test_nack_propagates_and_leaves_output(void)
{
    fake_status = HAL_NACK;
    int16_t t = 1234;
    TEST_ASSERT_EQUAL(HAL_NACK, tmp102_read_centi(0x48, &t));
    TEST_ASSERT_EQUAL_INT16(1234, t);
    TEST_ASSERT_EQUAL(HAL_NACK, tmp102_init(0x48));
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_raw_conversion_from_datasheet);
    RUN_TEST(test_read_selects_temp_register);
    RUN_TEST(test_nack_propagates_and_leaves_output);
    return UNITY_END();
}
