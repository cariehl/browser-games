#include "pdm.h"

#include <string.h>

static uint16_t rd16(const uint8_t *b) { return (uint16_t)(b[0] | (b[1] << 8)); }

void pdm_init(pdm_t *p)
{
    memset(p, 0, sizeof *p);
}

void pdm_set(pdm_t *p, pdm_ch_t ch, uint8_t duty)
{
    if ((unsigned)ch < PDM_NUM_CH) p->duty[ch] = duty;
}

void pdm_build_cmd(const pdm_t *p, can_frame_t *out)
{
    memset(out, 0, sizeof *out);
    out->id = CAN_ID_PDM_CMD;
    out->dlc = 8;
    for (unsigned i = 0; i < PDM_NUM_CH; i++) {
        out->data[i] = (p->locked_out & (1u << i)) ? 0 : p->duty[i];
    }
}

bool pdm_handle_frame(pdm_t *p, const can_frame_t *f, uint32_t now_ms)
{
    switch (f->id) {
    case CAN_ID_PDM_STATUS_A:
    case CAN_ID_PDM_STATUS_B: {
        if (f->dlc < 8) return true;
        unsigned base = f->id == CAN_ID_PDM_STATUS_A ? 0 : 4;
        for (unsigned i = 0; i < 4; i++) {
            p->current_ma[base + i] = (uint16_t)(rd16(&f->data[i * 2]) * 10u);
        }
        break;
    }
    case CAN_ID_PDM_STATUS_C:
        if (f->dlc < 6) return true;
        p->vbat_mv = rd16(&f->data[0]);
        p->tripped = f->data[2];
        p->open_load = f->data[3];
        p->temp_c = (int8_t)f->data[4];
        p->flags = f->data[5];
        break;
    default:
        return false;
    }
    p->last_rx_ms = now_ms;
    p->ever_rx = true;
    p->online = true;
    return true;
}

void pdm_update(pdm_t *p, uint32_t now_ms)
{
    p->online = p->ever_rx && (uint32_t)(now_ms - p->last_rx_ms) < PDM_OFFLINE_TIMEOUT_MS;
    if (!p->online) return; /* trip flags are stale while offline */

    for (unsigned ch = 0; ch < PDM_NUM_CH; ch++) {
        uint8_t bit = (uint8_t)(1u << ch);
        bool tripped = (p->tripped & bit) != 0;

        if (p->locked_out & bit) continue;

        /* Grace period over: back to IDLE and evaluate the flag right away. */
        if (p->retry_state[ch] == PDM_RETRY_CLEARED &&
            (int32_t)(now_ms - p->retry_at_ms[ch]) >= 0) {
            p->retry_state[ch] = PDM_RETRY_IDLE;
            p->healthy_since_ms[ch] = now_ms;
        }

        switch (p->retry_state[ch]) {
        case PDM_RETRY_IDLE:
            if (tripped) {
                if (p->retry_count[ch] >= PDM_MAX_RETRIES) {
                    p->locked_out |= bit;
                } else {
                    p->retry_state[ch] = PDM_RETRY_WAITING;
                    p->retry_at_ms[ch] = now_ms +
                        PDM_RETRY_BASE_MS * (uint32_t)(p->retry_count[ch] + 1u);
                }
            } else if (p->retry_count[ch] &&
                       (uint32_t)(now_ms - p->healthy_since_ms[ch]) >= PDM_RETRY_FORGIVE_MS) {
                p->retry_count[ch] = 0;
            }
            break;

        case PDM_RETRY_WAITING:
            if ((int32_t)(now_ms - p->retry_at_ms[ch]) >= 0) {
                p->pending_clear |= bit;
                p->retry_count[ch]++;
                p->retry_state[ch] = PDM_RETRY_CLEARED;
                p->retry_at_ms[ch] = now_ms + PDM_RETRY_GRACE_MS;
            }
            break;

        case PDM_RETRY_CLEARED:
            break; /* still inside the grace period */
        }
    }
}

bool pdm_take_fault_clear(pdm_t *p, can_frame_t *out)
{
    if (!p->pending_clear) return false;
    memset(out, 0, sizeof *out);
    out->id = CAN_ID_PDM_FAULT_CLEAR;
    out->dlc = 1;
    out->data[0] = p->pending_clear;
    p->pending_clear = 0;
    return true;
}

void pdm_reset_faults(pdm_t *p)
{
    for (unsigned ch = 0; ch < PDM_NUM_CH; ch++) {
        p->retry_state[ch] = PDM_RETRY_IDLE;
        p->retry_count[ch] = 0;
    }
    p->locked_out = 0;
    p->pending_clear = 0xFF;
}

uint32_t pdm_total_current_ma(const pdm_t *p)
{
    uint32_t sum = 0;
    for (unsigned i = 0; i < PDM_NUM_CH; i++) sum += p->current_ma[i];
    return sum;
}
