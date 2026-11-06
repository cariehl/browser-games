#include "tmp102.h"

int16_t tmp102_raw_to_centi(uint16_t raw)
{
    int16_t counts = (int16_t)raw >> 4;          /* sign-extending 12-bit */
    return (int16_t)((int32_t)counts * 625 / 100); /* 0.0625 C per count   */
}

hal_status_t tmp102_init(uint8_t addr7)
{
    uint8_t reg = TMP102_REG_CONFIG;
    uint8_t cfg[2];
    return hal_i2c_write_read(addr7, &reg, 1, cfg, 2);
}

hal_status_t tmp102_read_centi(uint8_t addr7, int16_t *centi_c)
{
    uint8_t reg = TMP102_REG_TEMP;
    uint8_t b[2];
    hal_status_t st = hal_i2c_write_read(addr7, &reg, 1, b, 2);
    if (st != HAL_OK) return st;
    *centi_c = tmp102_raw_to_centi((uint16_t)((b[0] << 8) | b[1]));
    return HAL_OK;
}
