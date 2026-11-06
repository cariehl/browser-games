/**
 * @file sim_protocol.h
 * @brief Wire protocol between hal_sim.c (virtual MCU) and the simulator.
 *
 * Transport: TCP, default 127.0.0.1:47800 (override with env
 * SIGNALBENCH_ADDR=host:port). Every message is
 *
 *     u8 type | u16 payload_len (LE) | payload
 *
 * All integers little-endian. The simulator is the time master: it sends a
 * TICK, the firmware runs, then answers TICK_DONE with its output latches.
 * Requests that need an answer mid-tick (I2C) are answered immediately.
 * Mirrored in sim/core/src/protocol.rs - keep them in sync.
 */
#ifndef SIGNALBENCH_SIM_PROTOCOL_H
#define SIGNALBENCH_SIM_PROTOCOL_H

#define SIM_DEFAULT_PORT   47800
#define SIM_MAGIC          0x48434253u /* "SBCH" */
#define SIM_PROTO_VERSION  1u

/* firmware -> simulator */
#define MSG_HELLO       0x10 /* u32 magic, u16 version, u8 name_len, name   */
#define MSG_CAN_TX      0x11 /* u32 id, u8 dlc, u8 data[8]                  */
#define MSG_UART_TX     0x12 /* raw bytes                                   */
#define MSG_I2C_XFER    0x13 /* u8 addr, u8 tx_len, u8 rx_len, tx[tx_len]   */
#define MSG_WDT         0x14 /* u8 op (0 start, 1 kick), u32 timeout_ms     */
#define MSG_SYS_RESET   0x15 /* (empty) software reset request              */
#define MSG_TICK_DONE   0x1F /* u32 gpio_out, 4 x {u32 freq_hz, u16 duty}   */

/* simulator -> firmware */
#define MSG_WELCOME     0x81 /* u16 version, u8 reset_reason                */
#define MSG_TICK        0x82 /* u32 now_ms, u32 gpio_in, u16 adc[4],
                                i32 encoder, u8 n_can, n x CAN(13 bytes),
                                u16 uart_len, uart bytes                    */
#define MSG_I2C_RESULT  0x83 /* u8 status, rx bytes                         */
#define MSG_RESET       0x84 /* u8 reason: firmware process must restart    */

#define SIM_EXIT_RESET  3    /* process exit code meaning "MCU reset"       */

#endif
