import "@fontsource/ibm-plex-sans-condensed/400.css";
import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles.css";

import { appInfo, buildFirmware, onBuildDone, onBuildLog, onSnapshot, send } from "./api";
import { BenchAudio } from "./audio";
import { Bench } from "./bench";
import { CAN_NAMES, decode, hex } from "./can";
import { Scope } from "./scope";
import { BUTTONS, PIN_NAMES, type CanEntry, type Snapshot } from "./types";

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(sel));
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

let last: Snapshot | null = null;
let firmwareDir: string | null = null;
let building = false;
const audio = new BenchAudio();

// ------------------------------------------------------------------ tabs --
$$("[data-tabs]").forEach((bar) => {
  const panels = bar.nextElementSibling as HTMLElement;
  bar.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-tab]");
    if (!btn) return;
    $$("[data-tab]", bar).forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
    $$(":scope > .panel", panels).forEach((p) => p.classList.toggle("active", p.dataset.panel === btn.dataset.tab));
    // logs filled while hidden couldn't scroll; jump them to the newest line
    $$(".term", panels).forEach((t) => (t.scrollTop = t.scrollHeight));
    if (btn.dataset.tab === "uart") $("#uart-in").focus();
  });
});

// ---------------------------------------------------------------- bench --
const pressKey = (idx: number, pressed: boolean) => {
  audio.unlock();
  send({ type: "button", idx, pressed });
};
const bench = new Bench($("#viewport"), pressKey);
$$("[data-view]").forEach((b) => b.addEventListener("click", () => bench.setView(b.dataset.view as never)));

// keypad overlay + keys 1-8
const keypad = $("#keypad");
BUTTONS.forEach((b, i) => {
  const el = document.createElement("button");
  el.innerHTML = `<span class="led"></span>${b.label}<kbd>${i + 1}</kbd>`;
  el.title = b.hint;
  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId);
    el.classList.add("held");
    pressKey(i, true);
  });
  const up = () => {
    if (!el.classList.contains("held")) return;
    el.classList.remove("held");
    pressKey(i, false);
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  keypad.appendChild(el);
});
const typing = () => ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "");
const held = new Set<number>();
window.addEventListener("keydown", (e) => {
  if (typing() || e.repeat) return;
  const n = Number(e.key);
  if (n >= 1 && n <= 8 && !held.has(n)) {
    held.add(n);
    keypad.children[n - 1].classList.add("held");
    pressKey(n - 1, true);
  }
});
window.addEventListener("keyup", (e) => {
  const n = Number(e.key);
  if (held.delete(n)) {
    keypad.children[n - 1].classList.remove("held");
    pressKey(n - 1, false);
  }
});

// --------------------------------------------------------------- top bar --
const pill = $("#fw-pill");
const events = $("#events-out");
function logEvent(line: string, cls = "") {
  const atBottom = events.clientHeight === 0 || events.scrollHeight - events.scrollTop - events.clientHeight < 40;
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = line + "\n";
  events.appendChild(span);
  while (events.childNodes.length > 1500) events.firstChild!.remove();
  if (atBottom) events.scrollTop = events.scrollHeight;
}

$("#btn-flash").addEventListener("click", async () => {
  audio.unlock();
  if (building) return;
  if (!firmwareDir) {
    const dir = prompt("Path to the firmware folder (contains CMakeLists.txt):");
    if (!dir) return;
    firmwareDir = dir;
  }
  building = true;
  pill.dataset.state = "building";
  pill.textContent = "Building…";
  logEvent(`building target '${$<HTMLSelectElement>("#fw-target").value}' in ${firmwareDir}`, "sys");
  try {
    await buildFirmware(firmwareDir, $<HTMLSelectElement>("#fw-target").value);
  } catch (err) {
    building = false;
    logEvent(String(err), "err");
  }
});
onBuildLog((line) => logEvent(line, /error|failed/i.test(line) ? "err" : line.startsWith("$") ? "sys" : ""));
onBuildDone((d) => {
  building = false;
  if (d.ok && d.exe) {
    logEvent(`flashing ${d.exe}`, "ok");
    $("#uart-out").textContent = "";
    send({ type: "start_firmware", path: d.exe });
  } else {
    logEvent("build failed - see the log above", "err");
    $<HTMLButtonElement>('[data-tab="events"]').click();
  }
});
$("#btn-reset").addEventListener("click", () => send({ type: "reset_mcu" }));
$("#btn-stop").addEventListener("click", () => send({ type: "stop_firmware" }));
$("#btn-pause").addEventListener("click", () => send({ type: "pause", paused: !last?.paused }));
$$("[data-step]").forEach((b) => b.addEventListener("click", () => send({ type: "step", ms: Number(b.dataset.step) })));
$<HTMLSelectElement>("#speed").addEventListener("change", (e) =>
  send({ type: "speed", speed: Number((e.target as HTMLSelectElement).value) }),
);
$<HTMLInputElement>("#debug-freeze").addEventListener("change", (e) =>
  send({ type: "debug_freeze", on: (e.target as HTMLInputElement).checked }),
);
$("#btn-mute").addEventListener("click", (e) => {
  audio.unlock();
  audio.muted = !audio.muted;
  (e.target as HTMLElement).textContent = audio.muted ? "Sound off" : "Sound on";
});

// ---------------------------------------------------------- side panels --
function toggleRow(label: string, key: "ignition" | "engine") {
  return `<div class="row"><span>${label}</span><span class="switch" data-veh="${key}">
    <button data-v="false">Off</button><button data-v="true">On</button></span></div>`;
}
$("#panel-vehicle").innerHTML = `
  <div>
    <h2>Vehicle</h2>
    ${toggleRow("Ignition", "ignition")}
    ${toggleRow("Engine running", "engine")}
    <div class="row"><span>Transmission</span><span class="switch" data-veh="park">
      <button data-v="true">Park</button><button data-v="false">Drive</button></span></div>
    <p class="note">The light arm only deploys in park and stows itself when you shift into drive.</p>
  </div>
  <div>
    <h2>Battery</h2>
    <div class="row"><span>Voltage</span><span class="val" id="v-vbat">—</span></div>
    <div class="row"><span>Total load</span><span class="val" id="v-load">—</span></div>
    <div class="slider"><div class="row"><span>State of charge</span><span class="val" id="v-soc">—</span></div>
      <input type="range" min="0" max="100" id="in-soc" /></div>
    <p class="note">A small, fast-draining demo battery: with the engine off, heavy loads trigger the firmware's load shedding within a minute or two.</p>
  </div>
  <div>
    <h2>Environment</h2>
    <div class="slider"><div class="row"><span>Ambient light</span><span class="val" id="v-amb">—</span></div>
      <input type="range" min="0" max="100" id="in-amb" /></div>
    <div class="slider"><div class="row"><span>Ambient temperature</span><span class="val" id="v-temp">—</span></div>
      <input type="range" min="-20" max="60" id="in-temp" /></div>
    <div class="row"><span>Board temperature (TMP102)</span><span class="val" id="v-btemp">—</span></div>
    <div class="row"><span>PDM temperature</span><span class="val" id="v-ptemp">—</span></div>
    <p class="note">Below ~20% light the firmware dims the lightbar; above 70 °C board temperature it derates.</p>
  </div>
  <div><button id="btn-power-cycle">Power-cycle the bench</button></div>`;

$$("[data-veh]").forEach((sw) =>
  sw.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (b) send({ type: "vehicle", [sw.dataset.veh!]: b.dataset.v === "true" } as never);
  }),
);
const slider = (id: string, f: (v: number) => object) =>
  $<HTMLInputElement>(id).addEventListener("input", (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    send({ type: "vehicle", ...f(v) } as never);
  });
slider("#in-soc", (v) => ({ soc: v / 100 }));
slider("#in-amb", (v) => ({ ambient_light: v / 100 }));
slider("#in-temp", (v) => ({ ambient_temp: v }));
$("#btn-power-cycle").addEventListener("click", () => send({ type: "reset_world" }));

const PDM_SHORT = ["Lightbar", "Siren amp", "Scene light", "Arm motor", "Rear flashers", "MDT / radio"];
$("#panel-faults").innerHTML = `
  <div>
    <h2>Harness</h2>
    <div class="fault-grid">
      ${PDM_SHORT.map((n, i) => `<span>${n}</span>
        <button class="danger" data-fault="short" data-ch="${i}">Short</button>
        <button class="danger" data-fault="open" data-ch="${i}">Open</button>`).join("")}
    </div>
    <p class="note">A short trips the PDM eFuse instantly; the firmware retries with back-off, then locks the channel out until you press Aux.</p>
  </div>
  <div>
    <h2>Light arm</h2>
    <div class="fault-list">
      <button class="danger" data-fault="jam">Jam the arm mechanically</button>
      <button class="danger" data-fault="encoder">Disconnect the encoder</button>
      <button class="danger" data-fault="lim_stuck">Stick the stowed limit switch</button>
    </div>
  </div>
  <div>
    <h2>Bus, sensors &amp; power</h2>
    <div class="fault-list">
      <button class="danger" data-fault="can_ctrl">Unplug the controller from CAN</button>
      <button class="danger" data-fault="tmp102">TMP102 stops answering on I²C</button>
      <button class="danger" data-fault="alternator">Alternator failure</button>
    </div>
  </div>
  <div>
    <h2>Lightbar heads</h2>
    <div class="heads">${Array.from({ length: 12 }, (_, i) =>
      `<button class="danger" data-fault="lb_head" data-ch="${i}" data-c="${i < 5 ? "r" : i < 7 ? "w" : "b"}" title="Fail head ${i}">${i}</button>`).join("")}</div>
  </div>
  <div><button id="btn-clear-faults">Remove all faults</button></div>`;

$("#panel-faults").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-fault]");
  if (!b) return;
  const on = b.getAttribute("aria-pressed") !== "true";
  send({ type: "fault", kind: b.dataset.fault!, channel: b.dataset.ch ? Number(b.dataset.ch) : undefined, on });
});
$("#btn-clear-faults").addEventListener("click", () => send({ type: "clear_faults" }));

$("#panel-pdm").innerHTML = `
  <div>
    <h2>SB-PDM8 outputs</h2>
    <table class="pdm-table">
      <thead><tr><th>Channel</th><th>Duty</th><th>Current / limit</th><th></th></tr></thead>
      <tbody id="pdm-body"></tbody>
    </table>
    <p class="note" id="pdm-note"></p>
  </div>`;

$("#panel-io").innerHTML = `
  <div><h2>GPIO inputs</h2><div class="pins" id="pins-in"></div></div>
  <div><h2>GPIO outputs</h2><div class="pins" id="pins-out"></div></div>
  <div><h2>PWM</h2><table class="kv" id="pwm-table"></table></div>
  <div><h2>ADC and timers</h2><table class="kv" id="adc-table"></table></div>`;

function pinsHtml(word: number, lo: number, hi: number) {
  let h = "";
  for (let p = lo; p <= hi; p++) {
    const name = PIN_NAMES[p];
    if (!name) continue;
    h += `<span class="pin ${(word >>> p) & 1 ? "hi" : ""}"><i></i><code>${p}</code>${name}</span>`;
  }
  return h;
}

// ----------------------------------------------------------------- UART --
const uartOut = $("#uart-out");
function appendUart(text: string) {
  const atBottom = uartOut.clientHeight === 0 || uartOut.scrollHeight - uartOut.scrollTop - uartOut.clientHeight < 40;
  uartOut.append(text.replace(/\r/g, ""));
  if (uartOut.textContent!.length > 200_000) uartOut.textContent = uartOut.textContent!.slice(-150_000);
  if (atBottom) uartOut.scrollTop = uartOut.scrollHeight;
}
$("#uart-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const inp = $<HTMLInputElement>("#uart-in");
  if (inp.value.trim()) send({ type: "uart_send", text: inp.value });
  inp.value = "";
});
$$("[data-cmd]").forEach((b) => b.addEventListener("click", () => send({ type: "uart_send", text: b.dataset.cmd! })));

// ------------------------------------------------------------ CAN trace --
const canRows: CanEntry[] = [];
let canPaused = false;
let canDirty = false;
$("#can-pause").addEventListener("click", (e) => {
  canPaused = !canPaused;
  (e.target as HTMLElement).textContent = canPaused ? "Resume trace" : "Pause trace";
});
$("#can-filter").addEventListener("input", () => (canDirty = true));
$("#can-hide-status").addEventListener("change", () => (canDirty = true));
function renderCan() {
  if (!canDirty || !$('[data-panel="can"]').classList.contains("active")) return;
  canDirty = false;
  const q = $<HTMLInputElement>("#can-filter").value.trim().toLowerCase();
  const hidePeriodic = $<HTMLInputElement>("#can-hide-status").checked;
  const out: string[] = [];
  for (let i = canRows.length - 1; i >= 0 && out.length < 250; i--) {
    const f = canRows[i];
    if (hidePeriodic && [0x180, 0x181, 0x182, 0x380, 0x100, 0x300].includes(f.id)) continue;
    const name = CAN_NAMES[f.id] ?? "";
    const dec = decode(f);
    if (q && !`${hex(f.id, 3)} ${name} ${f.src}`.toLowerCase().includes(q)) continue;
    const alert = /TRIP|FAILSAFE|failed|clear/.test(dec);
    out.push(
      `<tr data-src="${f.src}" class="${alert ? "alert" : ""}"><td>${(f.t / 1000).toFixed(3)}</td><td>${f.src}</td><td>${hex(f.id, 3)}</td><td>${name}</td><td>${f.data
        .slice(0, f.dlc)
        .map((b) => hex(b))
        .join(" ")}</td><td>${esc(dec)}</td></tr>`,
    );
  }
  $("#can-body").innerHTML = out.join("");
}

// ----------------------------------------------------------------- scope --
const scope = new Scope($<HTMLCanvasElement>("#scope"));
const COLORS = ["#f2b134", "#ff7a7a", "#7cc4ff", "#c9a7ff", "#5fe0b0", "#ffd25a", "#e9f1f8", "#3dd68c"];
function buildScopeToolbar(names: string[]) {
  scope.names = names;
  $("#scope-toolbar").innerHTML =
    names
      .map((n, i) => `<label class="scope-ch"><input type="checkbox" data-ch="${i}" ${scope.enabled[i] ? "checked" : ""}/><i style="background:${COLORS[i]}"></i>${n}</label>`)
      .join("") +
    `<label class="field">Window <select id="scope-win">
      <option value="100">100 ms</option><option value="500">500 ms</option><option value="1000">1 s</option>
      <option value="5000" selected>5 s</option><option value="10000">10 s</option><option value="20000">20 s</option></select></label>
     <button id="scope-freeze">Freeze</button>`;
  $$("[data-ch]", $("#scope-toolbar")).forEach((cb) =>
    cb.addEventListener("change", () => (scope.enabled[Number(cb.dataset.ch)] = (cb as HTMLInputElement).checked)),
  );
  $("#scope-win").addEventListener("change", (e) => (scope.windowMs = Number((e.target as HTMLSelectElement).value)));
  $("#scope-freeze").addEventListener("click", (e) => {
    scope.frozen = !scope.frozen;
    (e.target as HTMLElement).textContent = scope.frozen ? "Run" : "Freeze";
  });
}

// ------------------------------------------------------------- snapshot --
function setPressed(sel: string, root: ParentNode, pred: (el: HTMLElement) => boolean) {
  $$(sel, root).forEach((el) => el.setAttribute("aria-pressed", String(pred(el))));
}
function setSlider(id: string, v: number) {
  const el = $<HTMLInputElement>(id);
  if (document.activeElement !== el) el.value = String(Math.round(v));
}

let scopeBuilt = false;
let lastDomUpdate = 0;
onSnapshot((s) => {
  last = s;
  bench.update(s);
  audio.set(s.siren_freq, s.siren_sounding, s.beeper_freq);
  if (s.uart) appendUart(s.uart);
  for (const line of s.console) logEvent(line, /FAULT|TRIP|RESET|hung|failed/i.test(line) ? "err" : "sys");
  if (!scopeBuilt && s.scope_names) { buildScopeToolbar(s.scope_names); scopeBuilt = true; }
  scope.push(s.scope);
  if (!canPaused && s.can.length) {
    canRows.push(...s.can);
    if (canRows.length > 3000) canRows.splice(0, canRows.length - 3000);
    canDirty = true;
  }

  const now = performance.now();
  if (now - lastDomUpdate < 90) return; // ~10 Hz is plenty for text
  lastDomUpdate = now;
  updateDom(s);
});

function updateDom(s: Snapshot) {
  // firmware status
  if (!building) {
    pill.dataset.state = s.fw.state;
    pill.textContent = s.fw.state === "running" ? `Running ${s.fw.name}` : s.fw.state === "stalled" ? "MCU hung" : s.fw.supervised ? "Booting…" : "No firmware";
  }
  $("#btn-pause").textContent = s.paused ? "Resume" : "Pause";
  $("#btn-pause").classList.toggle("on", s.paused);
  $<HTMLInputElement>("#debug-freeze").checked = s.debug_freeze;

  // keypad LEDs
  Array.from(keypad.children).forEach((el, i) => el.classList.toggle("lit", ((s.gpio_out >>> (24 + i)) & 1) === 1));

  // title block
  const cls = (el: string, c: string) => ($(el).className = c);
  $("#tb-vbat").textContent = `${s.vbat.toFixed(2)} V  ${(s.soc * 100).toFixed(0)}%`;
  cls("#tb-vbat", s.vbat < 11.9 ? "warn" : "");
  const trips = s.pdm.filter((c) => c.tripped).length;
  $("#tb-load").textContent = `${s.i_total.toFixed(1)} A${trips ? `  ${trips} tripped` : ""}${s.pdm_failsafe ? "  failsafe" : ""}`;
  cls("#tb-load", trips || s.pdm_failsafe ? "bad" : "");
  $("#tb-can").textContent = `${(s.bus_load * 100).toFixed(1)}%  ${s.frames_per_s} fr/s`;
  $("#tb-mcu").textContent = s.fw.state === "disconnected" ? "no firmware" : `${s.fw.state}  ${(s.fw.mcu_ms / 1000).toFixed(1)} s`;
  cls("#tb-mcu", s.fw.state === "running" ? "ok" : s.fw.state === "stalled" ? "bad" : "warn");
  $("#tb-wdt").textContent = s.fw.wdt_ms ? `${Math.max(0, s.fw.wdt_left ?? 0)} / ${s.fw.wdt_ms} ms  ${s.fw.resets} reset${s.fw.resets === 1 ? "" : "s"}` : `off  ${s.fw.resets} resets`;
  cls("#tb-wdt", s.fw.last_reset === "watchdog" && s.fw.resets ? "warn" : "");
  $("#tb-time").textContent = `${(s.t_ms / 1000).toFixed(2)} s  ${s.paused ? "paused" : `${s.rt_factor.toFixed(2)}×`}`;
  $("#tb-fw").textContent = s.fw.exe ? s.fw.exe.split(/[\\/]/).pop()! : "no image";

  // vehicle panel
  setPressed("[data-veh=ignition] button", document, (b) => (b.dataset.v === "true") === s.ignition);
  setPressed("[data-veh=engine] button", document, (b) => (b.dataset.v === "true") === s.engine);
  setPressed("[data-veh=park] button", document, (b) => (b.dataset.v === "true") === s.park);
  $("#v-vbat").textContent = `${s.vbat.toFixed(2)} V`;
  $("#v-load").textContent = `${s.i_total.toFixed(1)} A`;
  $("#v-soc").textContent = `${(s.soc * 100).toFixed(1)}%`;
  $("#v-amb").textContent = `${(s.ambient_light * 100).toFixed(0)}%`;
  $("#v-temp").textContent = `${s.ambient_temp.toFixed(0)} °C`;
  $("#v-btemp").textContent = s.faults.tmp102_missing ? "no reply" : `${s.board_temp.toFixed(1)} °C`;
  $("#v-ptemp").textContent = `${s.pdm_temp.toFixed(1)} °C`;
  setSlider("#in-soc", s.soc * 100);
  setSlider("#in-amb", s.ambient_light * 100);
  setSlider("#in-temp", s.ambient_temp);

  // faults panel
  const f = s.faults;
  setPressed("[data-fault]", $("#panel-faults"), (b) => {
    const ch = Number(b.dataset.ch ?? 0);
    switch (b.dataset.fault) {
      case "short": return f.short[ch];
      case "open": return f.open[ch];
      case "jam": return f.arm_jam;
      case "encoder": return f.encoder_dead;
      case "lim_stuck": return f.lim_stowed_stuck;
      case "can_ctrl": return f.can_ctrl_off;
      case "tmp102": return f.tmp102_missing;
      case "alternator": return f.alternator_fail;
      case "lb_head": return ((f.lb_failed_heads >> ch) & 1) === 1;
    }
    return false;
  });

  // PDM panel
  $("#pdm-body").innerHTML = s.pdm
    .map((c, i) => {
      const chip = c.tripped ? `<span class="chip trip">tripped</span>`
        : c.open_load ? `<span class="chip open">open load</span>`
        : c.duty_eff ? `<span class="chip on">on</span>` : `<span class="chip">off</span>`;
      return `<tr><td>${i} ${c.name}</td>
        <td>${Math.round((c.duty_eff / 255) * 100)}%<div class="bar"><i style="width:${(c.duty_eff / 255) * 100}%"></i></div></td>
        <td>${c.current.toFixed(2)} / ${c.limit} A<div class="bar"><i style="width:${Math.min(100, (c.current / c.limit) * 100)}%;${c.current > c.limit ? "background:var(--red)" : ""}"></i></div></td>
        <td>${chip}</td></tr>`;
    })
    .join("");
  $("#pdm-note").innerHTML = s.pdm_failsafe
    ? `<span class="chip fs">failsafe</span> No PDM_CMD frame in 500 ms, so every output is off.`
    : `Temperature ${s.pdm_temp.toFixed(1)} °C. Commands arrive over CAN as 0x100; status goes out as 0x180–0x182.`;

  // I/O panel
  $("#pins-in").innerHTML = pinsHtml(s.gpio_in, 0, 15);
  $("#pins-out").innerHTML = pinsHtml(s.gpio_out, 16, 31);
  const pwmNames = ["ARM_MOTOR", "SIREN", "BEEPER", "SPARE"];
  $("#pwm-table").innerHTML = s.pwm
    .map(([fr, d], i) => `<tr><td>${i} ${pwmNames[i]}</td><td>${fr ? `${fr.toLocaleString()} Hz` : "—"}</td><td>${(d / 10).toFixed(1)}%</td></tr>`)
    .join("");
  const adcNames = ["VBAT", "ARM_ISENSE", "AMBIENT", "SPARE"];
  const adcConv = [
    (c: number) => `${((c * 3.3 * 6) / 4095).toFixed(2)} V`,
    (c: number) => `${((c * 3.3 * 10) / 4095).toFixed(2)} A`,
    (c: number) => `${((c / 4095) * 100).toFixed(0)}%`,
    () => "",
  ];
  $("#adc-table").innerHTML =
    s.adc.map((c, i) => `<tr><td>ADC${i} ${adcNames[i]}</td><td>${c}</td><td>${adcConv[i](c)}</td></tr>`).join("") +
    `<tr><td>TIM encoder</td><td>${s.encoder}</td><td>${(s.encoder / 20).toFixed(1)}°</td></tr>`;
}

// draw loop for 2D canvases
function tick() {
  if ($('[data-panel="scope"]').classList.contains("active")) scope.draw();
  renderCan();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ------------------------------------------------------------- scenarios --
let scenarios: { name: string; source: string }[] = [];
function playScenario(name: string) {
  const sc = scenarios.find((s) => s.name === name || `${s.name}.sbs` === name);
  if (!sc) return logEvent(`scenario '${name}' not found`, "err");
  $<HTMLButtonElement>('[data-tab="events"]').click();
  send({ type: "reset_world" }); // start from a known bench state
  setTimeout(() => send({ type: "run_script", name: sc.name, source: sc.source }), 400);
}
$("#scenario-run").addEventListener("click", () => {
  audio.unlock();
  playScenario($<HTMLSelectElement>("#scenario").value);
});
$("#scenario-stop").addEventListener("click", () => send({ type: "stop_script" }));

// boot
appInfo()
  .then((info) => {
    firmwareDir = info.firmware_dir;
    scenarios = info.scenarios;
    if (scenarios.length) {
      $("#scenario").innerHTML = scenarios.map((s) => `<option value="${esc(s.name)}">${esc(s.name.replace(/^\d+_/, "").replace(/_/g, " "))}</option>`).join("");
    }
    logEvent(`simulator listening on 127.0.0.1:${info.port} — any firmware built against hal_sim.c can connect`, "sys");
    logEvent(firmwareDir ? `firmware folder: ${firmwareDir}` : "firmware folder not found; you will be asked for it on first flash", "sys");
    if (info.autoflash) {
      $<HTMLSelectElement>("#fw-target").value = info.autoflash;
      $("#btn-flash").click();
    }
    if (info.autoscript) {
      // wait until the firmware is up, then play
      const waitUp = setInterval(() => {
        if (last?.fw.state === "running") {
          clearInterval(waitUp);
          setTimeout(() => playScenario(info.autoscript!), 800);
        }
      }, 200);
    }
  })
  .catch((e) => logEvent(`not running inside Tauri: ${e}`, "err"));
