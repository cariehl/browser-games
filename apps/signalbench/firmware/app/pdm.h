/**
 * @file pdm.h
 * @brief Client for the SB-PDM8 power distribution module over CAN.
 *
 * Responsibilities:
 *   - hold the commanded duty of each output and encode PDM_CMD frames
 *   - decode PDM status frames (currents, battery, trip / open-load flags)
 *   - detect loss of communication
 *   - auto-retry tripped outputs with back-off, then lock them out so a
 *     shorted harness cannot be hammered forever
 *
 * Pure logic: no HAL calls, so it is fully unit-testable.
 */
#ifndef APP_PDM_H
#define APP_PDM_H

#include <stdbool.h>
#include <stdint.h>

#include "can_db.h"
#include "hal.h" /* can_frame_t */

#define PDM_OFFLINE_TIMEOUT_MS 300u
#define PDM_MAX_RETRIES        3u
#define PDM_RETRY_BASE_MS      1000u  /* back-off: 1 s, 2 s, 3 s           */
#define PDM_RETRY_GRACE_MS     300u   /* ignore stale trip flag after clear */
#define PDM_RETRY_FORGIVE_MS   10000u /* healthy this long -> retries reset */

typedef enum {
    PDM_RETRY_IDLE = 0,
    PDM_RETRY_WAITING,   /* tripped, waiting for back-off to elapse */
    PDM_RETRY_CLEARED,   /* clear sent, in grace period             */
} pdm_retry_state_t;

typedef struct {
    /* commanded */
    uint8_t  duty[PDM_NUM_CH];
    /* reported */
    uint16_t current_ma[PDM_NUM_CH];
    uint16_t vbat_mv;
    uint8_t  tripped;
    uint8_t  open_load;
    uint8_t  flags;
    int8_t   temp_c;
    uint32_t last_rx_ms;
    bool     ever_rx;
    bool     online;
    /* retry bookkeeping */
    pdm_retry_state_t retry_state[PDM_NUM_CH];
    uint8_t  retry_count[PDM_NUM_CH];
    uint32_t retry_at_ms[PDM_NUM_CH];
    uint32_t healthy_since_ms[PDM_NUM_CH];
    uint8_t  locked_out;
    uint8_t  pending_clear;
} pdm_t;

void pdm_init(pdm_t *p);
void pdm_set(pdm_t *p, pdm_ch_t ch, uint8_t duty);

/** Encode the PDM_CMD frame (locked-out channels are forced off). */
void pdm_build_cmd(const pdm_t *p, can_frame_t *out);

/** Feed a received frame. @return true if it was a PDM frame. */
bool pdm_handle_frame(pdm_t *p, const can_frame_t *f, uint32_t now_ms);

/** Periodic housekeeping: comms timeout and retry state machine. */
void pdm_update(pdm_t *p, uint32_t now_ms);

/** If a fault-clear is pending, encode it and return true. */
bool pdm_take_fault_clear(pdm_t *p, can_frame_t *out);

/** Operator reset: forget retry history and clear every latched trip. */
void pdm_reset_faults(pdm_t *p);

uint32_t pdm_total_current_ma(const pdm_t *p);

#endif
