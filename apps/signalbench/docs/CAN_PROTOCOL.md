# SignalBench CAN protocol

Classic CAN 2.0A, 11-bit identifiers, 500 kbit/s. Multi-byte signals are
little-endian. The C definitions live in `firmware/sdk/include/can_db.h`; the
simulator mirrors them in `sim/core/src/model.rs`.

| ID | Name | From → To | Period | DLC |
|---|---|---|---|---|
| 0x100 | PDM_CMD | CTRL → PDM | ≤ 500 ms (app sends every 20 ms) | 8 |
| 0x101 | PDM_FAULT_CLEAR | CTRL → PDM | on demand | 1 |
| 0x180 | PDM_STATUS_A | PDM → CTRL | 20 ms | 8 |
| 0x181 | PDM_STATUS_B | PDM → CTRL | 20 ms | 8 |
| 0x182 | PDM_STATUS_C | PDM → CTRL | 100 ms | 8 |
| 0x300 | LB_CMD | CTRL → LB | ≤ 1 s (app sends every 20 ms while lit) | 3 |
| 0x380 | LB_STATUS | LB → CTRL | 100 ms while powered | 4 |

## SB-PDM8 power distribution module

**0x100 PDM_CMD**: byte *n* is the PWM duty of output *n*, 0 = off,
255 = fully on. If no PDM_CMD arrives for 500 ms the PDM enters failsafe and
switches every output off until the next command.

**0x101 PDM_FAULT_CLEAR**: byte 0 is a bitmask of channels whose latched trip
should be cleared. A channel that is still shorted trips again immediately.

**0x180 / 0x181 PDM_STATUS_A / B**: four `u16` load currents in 10 mA units,
channels 0–3 and 4–7.

**0x182 PDM_STATUS_C**

| Byte | Signal |
|---|---|
| 0–1 | battery voltage, `u16`, mV |
| 2 | tripped mask (latched; needs PDM_FAULT_CLEAR) |
| 3 | open-load mask (commanded on, < 50 mA) |
| 4 | PDM temperature, `i8`, °C |
| 5 | flags: bit 0 = command-timeout failsafe active |
| 6 | rolling counter |
| 7 | reserved |

**Outputs and protection**

| Ch | Load | Limit | Trip |
|---|---|---|---|
| 0 | SB-LB12 lightbar | 15 A | > limit for 250 ms, or > 3 × limit instantly |
| 1 | siren amplifier | 15 A | " |
| 2 | LED scene light (dimmable) | 10 A | " |
| 3 | arm motor H-bridge supply | 20 A | " |
| 4 | rear flashers | 8 A | " |
| 5 | MDT / radio | 10 A | " |
| 6–7 | unused (shows open-load if switched on) | 10 A | " |

## SB-LB12 lightbar

**0x300 LB_CMD**: bytes 0–1 are the head mask (`u16`, bit *n* = head *n*,
left to right); byte 2 is intensity 0–255. Heads 0–4 are red, 5–6 white,
7–11 blue. The lightbar only listens while its supply (PDM ch 0) is above 9 V,
and blanks if commands stop for 1 s.

**0x380 LB_STATUS**: byte 0 firmware version, bytes 1–2 failed-head mask,
byte 3 temperature (`i8`, °C).
