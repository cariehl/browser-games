/**
 * pdm_hello.c - drive a load through the PDM over CAN.
 *
 * Keypad 4 (SCENE) toggles the scene light. The PDM needs its command frame
 * at least every 500 ms or it fails safe, so we send it every 50 ms.
 * Also prints the scene-light current from the PDM status frames.
 *
 * Build:  cmake --build build --target pdm_hello
 */
#include "can_db.h"
#include "hal.h"

#include <string.h>

int main(void)
{
    hal_init();
    hal_printf("pdm_hello: press keypad 4 to toggle the scene light\r\n");

    bool light = false, last_btn = false;
    uint32_t next_tx = 0, next_print = 0;
    uint16_t scene_ma = 0;

    for (;;) {
        hal_tick_wait();
        uint32_t now = hal_millis();

        bool btn = hal_gpio_read(PIN_BTN_SCENE);   /* naive edge detect */
        if (btn && !last_btn) light = !light;
        last_btn = btn;
        hal_gpio_write(PIN_KP_LED(3), light);

        if ((int32_t)(now - next_tx) >= 0) {
            can_frame_t f;
            memset(&f, 0, sizeof f);
            f.id = CAN_ID_PDM_CMD;
            f.dlc = 8;
            f.data[PDM_CH_SCENE] = light ? 255 : 0;
            f.data[PDM_CH_MDT] = 255;
            hal_can_send(&f);
            next_tx = now + 50;
        }

        can_frame_t rx;
        while (hal_can_recv(&rx)) {
            if (rx.id == CAN_ID_PDM_STATUS_A) {
                scene_ma = (uint16_t)((rx.data[4] | (rx.data[5] << 8)) * 10u);
            }
        }

        if ((int32_t)(now - next_print) >= 0) {
            hal_printf("scene light: %s  %u mA\r\n", light ? "ON " : "off", scene_ma);
            next_print = now + 1000;
        }
    }
}
