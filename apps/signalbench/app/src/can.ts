// CAN database decode for the trace view (mirrors firmware/sdk/include/can_db.h).
import type { CanEntry } from "./types";

const CH = ["LB", "SIR", "SCN", "ARM", "REAR", "MDT", "AX1", "AX2"];
const u16 = (d: number[], i: number) => d[i] | (d[i + 1] << 8);

export const CAN_NAMES: Record<number, string> = {
  0x100: "PDM_CMD",
  0x101: "PDM_FAULT_CLEAR",
  0x180: "PDM_STATUS_A",
  0x181: "PDM_STATUS_B",
  0x182: "PDM_STATUS_C",
  0x300: "LB_CMD",
  0x380: "LB_STATUS",
};

export function decode(f: CanEntry): string {
  const d = f.data;
  switch (f.id) {
    case 0x100: {
      const on = d.slice(0, 8).map((v, i) => (v ? `${CH[i]}=${v}` : "")).filter(Boolean);
      return on.length ? on.join(" ") : "all off";
    }
    case 0x101:
      return `clear ${maskNames(d[0])}`;
    case 0x180:
    case 0x181: {
      const base = f.id === 0x180 ? 0 : 4;
      return [0, 1, 2, 3].map((k) => `${CH[base + k]} ${(u16(d, k * 2) / 100).toFixed(2)}A`).join("  ");
    }
    case 0x182: {
      const parts = [`${(u16(d, 0) / 1000).toFixed(2)}V`, `${(d[4] << 24) >> 24}°C`];
      if (d[2]) parts.push(`TRIP ${maskNames(d[2])}`);
      if (d[3]) parts.push(`open ${maskNames(d[3])}`);
      if (d[5] & 1) parts.push("FAILSAFE");
      return parts.join("  ");
    }
    case 0x300: {
      const mask = u16(d, 0);
      const heads = Array.from({ length: 12 }, (_, i) => ((mask >> i) & 1 ? (i < 5 ? "R" : i < 7 ? "W" : "B") : "·")).join("");
      return `${heads}  int ${d[2]}`;
    }
    case 0x380: {
      const failed = u16(d, 1);
      return `fw ${d[0].toString(16)} ${failed ? `failed 0x${failed.toString(16)}` : "heads ok"} ${(d[3] << 24) >> 24}°C`;
    }
    default:
      return "";
  }
}

function maskNames(m: number): string {
  const n = CH.filter((_, i) => (m >> i) & 1);
  return n.length ? n.join(",") : "none";
}

export const hex = (v: number, w = 2) => v.toString(16).toUpperCase().padStart(w, "0");
