/**
 * my_sequence.c - Custom firmware to run a "hello" light/sound sequence on boot, then return to a standby state.
 *
 * Flashes the lights in a chase sequence three times, while raising and then lowering the arm and blaring the siren.
 *
 * Build:  cmake --build build --target blinky
 */
#include "hal.h"

int main(void)
{
	hal_init();
	hal_printf("my_sequence: hello from the virtual MCU\r\n");

	uint16_t chase_light = 0, next_chase_light = 50;

	for (;;)
	{
		hal_tick_wait(); /* 1 ms SysTick */
		uint32_t now = hal_millis();

		if ((int32_t)(now - next_chase_light) >= 0)
		{
			hal_gpio_toggle(PIN_LED_HEARTBEAT);
			next_chase_light += 50;
		}
		hal_gpio_write(PIN_KP_LED(0), hal_gpio_read(PIN_BTN_LIGHTS));
	}
}
