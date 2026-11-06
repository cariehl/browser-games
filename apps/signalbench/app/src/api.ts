import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SimCommand, Snapshot } from "./types";

export interface AppInfo {
  port: number;
  firmware_dir: string | null;
  exe_suffix: string;
  scenarios: { name: string; source: string }[];
  autoflash: string | null;
  autoscript: string | null;
}

export interface BuildDone {
  ok: boolean;
  exe: string | null;
  target: string;
}

export const send = (cmd: SimCommand) => invoke("sim_command", { cmd }).catch(console.error);
export const appInfo = () => invoke<AppInfo>("app_info");
export const buildFirmware = (dir: string, target: string) =>
  invoke<void>("build_firmware", { dir, target });

export const onSnapshot = (cb: (s: Snapshot) => void): Promise<UnlistenFn> =>
  listen<Snapshot>("snapshot", (e) => cb(e.payload));
export const onBuildLog = (cb: (line: string) => void) => listen<string>("build-log", (e) => cb(e.payload));
export const onBuildDone = (cb: (d: BuildDone) => void) => listen<BuildDone>("build-done", (e) => cb(e.payload));
