#include "arm.h"

#include "board.h"

#include <string.h>

static void stop_motor(arm_t *a)
{
    a->out.duty_permille = 0;
    a->out.need_power = false;
    a->oc_timing = false;
}

static void enter_fault(arm_t *a, arm_fault_t f)
{
    stop_motor(a);
    a->state = ARM_FAULT;
    a->fault = f;
}

static void begin_move(arm_t *a, arm_state_t moving, const arm_inputs_t *in, uint32_t now)
{
    if (a->state != moving) {
        a->move_start_ms = now;
        a->last_enc = in ? in->enc_count : a->last_enc;
        a->last_enc_change_ms = now;
        a->oc_timing = false;
    }
    a->state = moving;
    a->out.dir_up = (moving == ARM_DEPLOYING);
    a->out.need_power = true;
}

/* State implied by the limit switches when not moving. */
static arm_state_t resting_state(const arm_t *a, const arm_inputs_t *in)
{
    if (in->lim_stowed) return ARM_STOWED;
    if (in->lim_deployed) return ARM_DEPLOYED;
    return a->homed ? ARM_STOPPED : ARM_UNKNOWN;
}

void arm_init(arm_t *a, const arm_inputs_t *in, uint32_t now_ms)
{
    memset(a, 0, sizeof *a);
    (void)now_ms;
    if (in->lim_stowed && in->lim_deployed) {
        enter_fault(a, ARM_FAULT_LIMITS);
        return;
    }
    if (in->lim_stowed) {
        a->homed = true;
        a->enc_zero = in->enc_count;
    } else if (in->lim_deployed) {
        a->homed = true;
        a->enc_zero = in->enc_count - ARM_DEPLOYED_DEG * ARM_COUNTS_PER_DEG;
    }
    a->state = resting_state(a, in);
}

bool arm_cmd_deploy(arm_t *a, const arm_inputs_t *in, uint32_t now_ms)
{
    if (a->state == ARM_FAULT || !in->in_park) return false;
    if (a->state == ARM_DEPLOYED || a->state == ARM_DEPLOYING) return true;
    begin_move(a, ARM_DEPLOYING, in, now_ms);
    return true;
}

bool arm_cmd_stow(arm_t *a, uint32_t now_ms)
{
    if (a->state == ARM_FAULT) return false;
    if (a->state == ARM_STOWED || a->state == ARM_STOWING) return true;
    begin_move(a, ARM_STOWING, NULL, now_ms);
    return true;
}

bool arm_cmd_toggle(arm_t *a, const arm_inputs_t *in, uint32_t now_ms)
{
    switch (a->state) {
    case ARM_STOWED:
    case ARM_STOWING:
        return arm_cmd_deploy(a, in, now_ms);
    case ARM_DEPLOYING: /* pressing again mid-travel stops the arm */
        stop_motor(a);
        a->state = resting_state(a, in);
        return true;
    default:
        return arm_cmd_stow(a, now_ms);
    }
}

void arm_clear_fault(arm_t *a, const arm_inputs_t *in)
{
    if (a->state != ARM_FAULT) return;
    a->fault = ARM_FAULT_NONE;
    stop_motor(a);
    a->state = resting_state(a, in);
}

int32_t arm_angle_decideg(const arm_t *a, const arm_inputs_t *in)
{
    if (!a->homed) return -1;
    return ((in->enc_count - a->enc_zero) * 10) / ARM_COUNTS_PER_DEG;
}

void arm_update(arm_t *a, const arm_inputs_t *in, uint32_t now)
{
    if (in->lim_stowed && in->lim_deployed) {
        if (a->state != ARM_FAULT) enter_fault(a, ARM_FAULT_LIMITS);
        return;
    }
    if (a->state == ARM_FAULT) { stop_motor(a); return; }

    /* Re-home whenever we sit on the stowed switch. */
    if (in->lim_stowed && a->state != ARM_DEPLOYING) {
        a->enc_zero = in->enc_count;
        a->homed = true;
    }

    /* Interlock: never stay up when the vehicle is out of PARK. */
    if (!in->in_park && a->state != ARM_STOWED && a->state != ARM_STOWING) {
        begin_move(a, ARM_STOWING, in, now);
    }

    if (a->state != ARM_DEPLOYING && a->state != ARM_STOWING) {
        stop_motor(a);
        return;
    }

    /* End of travel */
    bool up = a->state == ARM_DEPLOYING;
    if (up && in->lim_deployed) { stop_motor(a); a->state = ARM_DEPLOYED; return; }
    if (!up && in->lim_stowed)  { stop_motor(a); a->state = ARM_STOWED;   return; }

    uint32_t elapsed = now - a->move_start_ms;
    if (elapsed >= ARM_TRAVEL_TIMEOUT_MS) { enter_fault(a, ARM_FAULT_TIMEOUT); return; }

    /* Stall / jam detection (after inrush blanking) */
    if (elapsed >= ARM_INRUSH_BLANK_MS && in->motor_ma >= ARM_STALL_MA) {
        if (!a->oc_timing) { a->oc_timing = true; a->oc_since_ms = now; }
        else if (now - a->oc_since_ms >= ARM_STALL_MS) { enter_fault(a, ARM_FAULT_STALL); return; }
    } else {
        a->oc_timing = false;
    }

    /* Encoder plausibility */
    if (in->enc_count != a->last_enc) {
        a->last_enc = in->enc_count;
        a->last_enc_change_ms = now;
    } else if (elapsed >= ARM_RAMP_MS && now - a->last_enc_change_ms >= ARM_ENC_STUCK_MS) {
        enter_fault(a, ARM_FAULT_ENCODER);
        return;
    }

    /* Motion profile: soft-start ramp, then slow zone near the end stop. */
    uint32_t duty = elapsed >= ARM_RAMP_MS ? ARM_MAX_DUTY
                                           : ARM_SLOW_DUTY / 2 + (ARM_MAX_DUTY - ARM_SLOW_DUTY / 2) * elapsed / ARM_RAMP_MS;
    int32_t ang = arm_angle_decideg(a, in);
    if (ang >= 0) {
        int32_t to_go = up ? (ARM_DEPLOYED_DEG * 10 - ang) : ang;
        if (to_go < ARM_SLOW_ZONE_DEG * 10 && duty > ARM_SLOW_DUTY) duty = ARM_SLOW_DUTY;
    } else if (!up && duty > ARM_SLOW_DUTY) {
        duty = ARM_SLOW_DUTY; /* unknown position: home gently */
    }
    a->out.duty_permille = (uint16_t)duty;
    a->out.dir_up = up;
    a->out.need_power = true;
}

const char *arm_state_name(arm_state_t s)
{
    static const char *const n[] = {
        "unknown", "stowed", "deploying", "deployed", "stowing", "stopped", "FAULT",
    };
    return (unsigned)s < sizeof n / sizeof n[0] ? n[s] : "?";
}

const char *arm_fault_name(arm_fault_t f)
{
    static const char *const n[] = { "none", "timeout", "stall", "encoder", "limits" };
    return (unsigned)f < sizeof n / sizeof n[0] ? n[f] : "?";
}
