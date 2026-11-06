/**
 * blinky.c - the smallest possible SignalBench firmware.
 *
 * Blinks the green heartbeat LED at 1 Hz and lights keypad LED 1 while
 * keypad button 1 is held (raw, un-debounced - watch it chatter on the scope).
 *
 * Build:  cmake --build build --target blinky
 */
#include "hal.h"

int main(void)
{
    hal_init();
    hal_printf("blinky: hello from the virtual MCU\r\n");

    uint32_t next = 0;
    for (;;) {
        hal_tick_wait();                      /* 1 ms SysTick */
        uint32_t now = hal_millis();

        if ((int32_t)(now - next) >= 0) {
            hal_gpio_toggle(PIN_LED_HEARTBEAT);
            next += 500;
        }
        hal_gpio_write(PIN_KP_LED(0), hal_gpio_read(PIN_BTN_LIGHTS));
    }
}
