/**
 * @file can_db.h
 * @brief CAN message database for the SignalBench vehicle network.
 *
 * Bus: classic CAN 2.0A, 500 kbit/s, little-endian signals.
 * Nodes: SB-CTRL (your firmware), SB-PDM8 power distribution module,
 *        SB-LB12 smart lightbar. See docs/CAN_PROTOCOL.md.
 */
#ifndef SIGNALBENCH_CAN_DB_H
#define SIGNALBENCH_CAN_DB_H

/* ---- SB-PDM8: 8-channel smart power distribution module ----------------- */

/** CTRL -> PDM. 8 bytes, byte n = PWM duty of channel n (0 = off, 255 = on).
 *  Must be sent at least every PDM_CMD_TIMEOUT_MS or the PDM fails safe and
 *  switches every output off. */
#define CAN_ID_PDM_CMD          0x100u
/** CTRL -> PDM. byte0 = bitmask of channels whose latched trip to clear. */
#define CAN_ID_PDM_FAULT_CLEAR  0x101u
/** PDM -> CTRL every 20 ms. ch0..3 load current, u16 LE in 10 mA units. */
#define CAN_ID_PDM_STATUS_A     0x180u
/** PDM -> CTRL every 20 ms. ch4..7 load current, u16 LE in 10 mA units. */
#define CAN_ID_PDM_STATUS_B     0x181u
/** PDM -> CTRL every 100 ms.
 *  [0..1] battery voltage, u16 LE, mV
 *  [2]    tripped mask   (latched over-current / short, needs FAULT_CLEAR)
 *  [3]    open-load mask (channel commanded on but no current)
 *  [4]    PDM temperature, int8 degC
 *  [5]    flags: bit0 = command-timeout failsafe active
 *  [6]    rolling counter
 *  [7]    reserved */
#define CAN_ID_PDM_STATUS_C     0x182u

#define PDM_CMD_TIMEOUT_MS      500u
#define PDM_NUM_CH              8u
#define PDM_FLAG_FAILSAFE       0x01u

typedef enum {
    PDM_CH_LIGHTBAR = 0, /**< 15 A  SB-LB12 lightbar supply              */
    PDM_CH_SIREN    = 1, /**< 15 A  siren amplifier supply               */
    PDM_CH_SCENE    = 2, /**< 10 A  LED scene light (PWM dimmable)       */
    PDM_CH_ARM      = 3, /**< 25 A  arm motor H-bridge supply            */
    PDM_CH_REAR     = 4, /**<  8 A  rear flashers (PWM / flash-capable)  */
    PDM_CH_MDT      = 5, /**< 10 A  mobile data terminal / radio         */
    PDM_CH_AUX1     = 6, /**< 10 A  unused                               */
    PDM_CH_AUX2     = 7, /**< 10 A  unused                               */
} pdm_ch_t;

/* ---- SB-LB12: 12-head smart lightbar ------------------------------------ */

/** CTRL -> LIGHTBAR.
 *  [0..1] head on-mask, u16 LE, bit n = head n (heads 0..11, left->right)
 *  [2]    intensity 0..255
 *  The lightbar blanks if no command is received for LB_CMD_TIMEOUT_MS. */
#define CAN_ID_LB_CMD           0x300u
/** LIGHTBAR -> CTRL every 100 ms while powered.
 *  [0]    firmware version
 *  [1..2] failed-head mask, u16 LE
 *  [3]    temperature, int8 degC */
#define CAN_ID_LB_STATUS        0x380u

#define LB_NUM_HEADS            12u
#define LB_CMD_TIMEOUT_MS       1000u
/* Head colours: 0..4 red, 5..6 white (takedown), 7..11 blue */
#define LB_MASK_RED             0x001Fu
#define LB_MASK_WHITE           0x0060u
#define LB_MASK_BLUE            0x0F80u
#define LB_MASK_ALL             0x0FFFu

#endif /* SIGNALBENCH_CAN_DB_H */
