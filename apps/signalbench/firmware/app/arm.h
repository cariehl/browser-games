/**
 * @file arm.h
 * @brief Scene-light arm controller (state machine + motion profile).
 *
 * Hardware: brushed gear-motor on an H-bridge (PWM + DIR), quadrature encoder
 * (incremental - zeroed when the STOWED limit switch is seen), and STOWED /
 * DEPLOYED limit switches. Limit switches are the authoritative end stops;
 * the encoder is used for the slow-down zone and plausibility checking.
 *
 * Protections:
 *   - travel timeout                       -> ARM_FAULT_TIMEOUT
 *   - motor over-current (jam / hard stop) -> ARM_FAULT_STALL
 *   - motor driven but encoder not moving  -> ARM_FAULT_ENCODER
 *   - both limit switches active           -> ARM_FAULT_LIMITS
 *   - interlock: deploy only in PARK; auto-stow when shifted out of PARK
 *
 * Pure logic (no HAL calls). Call arm_update() at a fixed rate (10 ms).
 */
#ifndef APP_ARM_H
#define APP_ARM_H

#include <stdbool.h>
#include <stdint.h>

#define ARM_MAX_DUTY          900u   /* permille                        */
#define ARM_SLOW_DUTY         350u
#define ARM_RAMP_MS           300u   /* 0 -> max duty soft start        */
#define ARM_SLOW_ZONE_DEG     10
#define ARM_TRAVEL_TIMEOUT_MS 8000u
#define ARM_STALL_MA          12000u
#define ARM_STALL_MS          150u
#define ARM_INRUSH_BLANK_MS   250u
#define ARM_ENC_STUCK_MS      400u

typedef enum {
    ARM_UNKNOWN = 0, /**< position unknown (not on a limit, not homed) */
    ARM_STOWED,
    ARM_DEPLOYING,
    ARM_DEPLOYED,
    ARM_STOWING,
    ARM_STOPPED,     /**< halted mid-travel                             */
    ARM_FAULT,
} arm_state_t;

typedef enum {
    ARM_FAULT_NONE = 0,
    ARM_FAULT_TIMEOUT,
    ARM_FAULT_STALL,
    ARM_FAULT_ENCODER,
    ARM_FAULT_LIMITS,
} arm_fault_t;

typedef struct {
    bool     lim_stowed;   /**< debounced */
    bool     lim_deployed; /**< debounced */
    bool     in_park;
    int32_t  enc_count;
    uint32_t motor_ma;
} arm_inputs_t;

typedef struct {
    uint16_t duty_permille;
    bool     dir_up;
    bool     need_power;   /**< request PDM_CH_ARM supply */
} arm_outputs_t;

typedef struct {
    arm_state_t   state;
    arm_fault_t   fault;
    bool          homed;
    int32_t       enc_zero;
    int32_t       last_enc;
    uint32_t      move_start_ms;
    uint32_t      last_enc_change_ms;
    uint32_t      oc_since_ms;
    bool          oc_timing;
    arm_outputs_t out;
} arm_t;

void arm_init(arm_t *a, const arm_inputs_t *in, uint32_t now_ms);
/** @return false if refused (fault, interlock). */
bool arm_cmd_deploy(arm_t *a, const arm_inputs_t *in, uint32_t now_ms);
bool arm_cmd_stow(arm_t *a, uint32_t now_ms);
bool arm_cmd_toggle(arm_t *a, const arm_inputs_t *in, uint32_t now_ms);
void arm_clear_fault(arm_t *a, const arm_inputs_t *in);
void arm_update(arm_t *a, const arm_inputs_t *in, uint32_t now_ms);

/** Arm angle in tenths of a degree, or -1 if not homed. */
int32_t     arm_angle_decideg(const arm_t *a, const arm_inputs_t *in);
const char *arm_state_name(arm_state_t s);
const char *arm_fault_name(arm_fault_t f);

#endif
