// Mirrors sim/core/src/engine.rs `Snapshot` (serde field names).

export interface PdmChannel {
  name: string;
  limit: number;
  duty_cmd: number;
  duty_eff: number;
  v_out: number;
  current: number;
  tripped: boolean;
  open_load: boolean;
}

export interface CanEntry {
  t: number;
  src: "CTRL" | "PDM" | "LB";
  id: number;
  dlc: number;
  data: number[];
}

export interface Faults {
  short: boolean[];
  open: boolean[];
  encoder_dead: boolean;
  arm_jam: boolean;
  lim_stowed_stuck: boolean;
  can_ctrl_off: boolean;
  tmp102_missing: boolean;
  lb_failed_heads: number;
  alternator_fail: boolean;
}

export interface FwStatus {
  state: "disconnected" | "running" | "stalled";
  name: string;
  supervised: boolean;
  exe: string | null;
  pid: number | null;
  resets: number;
  last_reset: string;
  wdt_ms: number | null;
  wdt_left: number | null;
  mcu_ms: number;
}

export interface Snapshot {
  t_ms: number;
  speed: number;
  paused: boolean;
  debug_freeze: boolean;
  rt_factor: number;
  fw: FwStatus;
  ignition: boolean;
  park: boolean;
  engine: boolean;
  ambient_light: number;
  ambient_temp: number;
  vbat: number;
  soc: number;
  i_total: number;
  buttons: boolean[];
  gpio_in: number;
  gpio_out: number;
  pwm: [number, number][];
  adc: number[];
  encoder: number;
  pdm: PdmChannel[];
  pdm_failsafe: boolean;
  pdm_temp: number;
  lb_alive: boolean;
  lb_lit: number;
  lb_intensity: number;
  siren_freq: number;
  siren_sounding: boolean;
  beeper_freq: number;
  scene_level: number;
  rear_lit: boolean;
  mdt_on: boolean;
  arm_deg: number;
  arm_current: number;
  board_temp: number;
  faults: Faults;
  bus_load: number;
  frames_per_s: number;
  can: CanEntry[];
  uart: string;
  console: string[];
  scope_names: string[];
  scope: number[][];
}

export type SimCommand =
  | { type: "button"; idx: number; pressed: boolean }
  | {
      type: "vehicle";
      ignition?: boolean;
      park?: boolean;
      engine?: boolean;
      ambient_light?: number;
      ambient_temp?: number;
      soc?: number;
    }
  | { type: "fault"; kind: string; channel?: number; on: boolean }
  | { type: "clear_faults" }
  | { type: "speed"; speed: number }
  | { type: "pause"; paused: boolean }
  | { type: "step"; ms: number }
  | { type: "debug_freeze"; on: boolean }
  | { type: "uart_send"; text: string }
  | { type: "reset_mcu" }
  | { type: "reset_world" }
  | { type: "start_firmware"; path: string }
  | { type: "stop_firmware" }
  | { type: "run_script"; name: string; source: string }
  | { type: "stop_script" };

export const BUTTONS = [
  { label: "Lights", hint: "Cycle warning stage 0-3" },
  { label: "Siren", hint: "Wail / yelp / phaser (needs lights)" },
  { label: "Horn", hint: "Air horn while held" },
  { label: "Scene", hint: "Scene light on/off" },
  { label: "Arm", hint: "Deploy / stow light arm (in park)" },
  { label: "Takedown", hint: "White takedown lights" },
  { label: "Rear", hint: "Rear flashers" },
  { label: "Aux", hint: "Clear faults" },
];

export const PIN_NAMES: Record<number, string> = {
  0: "BTN_LIGHTS", 1: "BTN_SIREN", 2: "BTN_HORN", 3: "BTN_SCENE",
  4: "BTN_ARM", 5: "BTN_TAKEDOWN", 6: "BTN_REAR", 7: "BTN_AUX",
  8: "IN_IGNITION", 9: "IN_PARK", 10: "LIM_STOWED", 11: "LIM_DEPLOYED",
  16: "LED_HEARTBEAT", 17: "LED_FAULT", 18: "LED_CAN", 19: "ARM_DIR",
  24: "KP_LED0", 25: "KP_LED1", 26: "KP_LED2", 27: "KP_LED3",
  28: "KP_LED4", 29: "KP_LED5", 30: "KP_LED6", 31: "KP_LED7",
};
