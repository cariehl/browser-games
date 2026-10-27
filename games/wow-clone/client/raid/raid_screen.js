// The raid: the three.js scene, the units in it, the player's controls,
// targeting, abilities and the HUD. Resolves when the player leaves the raid
// or loses the connection for good.

import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { ABILITIES, CLASSES } from '../../shared/classes.js';
import { distance, isFacing, reach, TAB_RANGE } from '../../shared/combat.js';
import { show } from '../dom.js';
import { Keybinds } from '../keybinds.js';
import { Callbacks } from '../net.js';
import { buildArena } from './arena.js';
import { CameraRig } from './camera_rig.js';
import { CombatText } from './combat_text.js';
import { Controls } from './controls.js';
import { Hud } from './hud.js';
import { KeybindPanel } from './keybind_panel.js';
import { UnitView } from './unit_view.js';

/** A press this close to the end of the GCD or a cast waits and goes off when it ends (WoW's spell queue). */
const QUEUE_WINDOW = 0.4;

/** The server's clock (RaidState.time), run forward locally between patches. */
class ServerClock {
  base = 0;
  at = performance.now();

  sync(time) {
    this.base = time;
    this.at = performance.now();
  }

  now() {
    return this.base + Math.min((performance.now() - this.at) / 1000, 0.25);
  }
}

/** [room]: the joined raid room. Resolves to { lost }: true if the connection was lost. */
export function raidScreen(room, canvas) {
  return new Promise((resolve) => {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    const labels = new CSS2DRenderer();
    labels.domElement.className = 'labels';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x15141a);
    scene.fog = new THREE.Fog(0x15141a, 30, 80);
    scene.add(new THREE.HemisphereLight(0xb8c4ff, 0x2a2420, 1.2));
    const sun = new THREE.DirectionalLight(0xffe2b8, 2);
    sun.position.set(10, 25, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 });
    scene.add(sun, buildArena());

    const rig = new CameraRig(canvas);
    const keybinds = new Keybinds();
    const clock = new ServerClock();
    const combatText = new CombatText(scene);
    /** Unit views by id: raiders by session id, enemies by enemy id. */
    const views = new Map();
    let targetId = '';
    let queued = null;

    const me = () => room.state.raiders?.get(room.sessionId);

    const setTarget = (id) => {
      if (id === targetId) return;
      targetId = id;
      room.send('target', { id });
    };

    /** Where the player is: the prediction, which runs ahead of the server. */
    const pose = () => (controls.pos ? { ...controls.pos, facing: controls.facing } : me());

    /** Why [abilityId] would fail on the current target, or null: greys out the action button. */
    const blocker = (abilityId) => {
      const ability = ABILITIES[abilityId];
      if (ability.target === 'enemy') {
        const target = room.state.enemies.get(targetId);
        if (!target || target.health <= 0) return 'no target';
        if (reach(pose(), target) > ability.range) return 'out of range';
      } else if (ability.target === 'friendly') {
        const target = room.state.raiders.get(targetId);
        if (target && target.health <= 0) return 'dead';
        if (target && reach(pose(), target) > ability.range) return 'out of range';
      }
      return null;
    };

    const send = (abilityId) => room.send('cast', { ability: abilityId });

    /** Uses an ability: now, after the GCD or cast if it's nearly over, or not (with a reason). */
    const cast = (abilityId) => {
      const m = me();
      if (!m) return;
      hud.flash(abilityId);
      const now = clock.now();
      const ability = ABILITIES[abilityId];
      if (m.health <= 0) return hud.showError('You are dead.');
      if ((m.cooldowns.get(abilityId) ?? 0) - now > QUEUE_WINDOW) return hud.showError('That ability is on cooldown.');
      const wait = Math.max(
        ability.gcd !== false ? m.gcdEnd - now : 0,
        m.castAbility ? m.castEnd - now : 0,
        (m.cooldowns.get(abilityId) ?? 0) - now,
      );
      if (wait > QUEUE_WINDOW) return hud.showError(m.castAbility ? 'You are already casting.' : 'Not ready yet.');
      if (wait > 0) queued = { abilityId, at: now + wait };
      else send(abilityId);
    };

    /** Tab: the nearest living enemy in front, then the next one out on each press. */
    const targetNextEnemy = () => {
      const p = pose();
      if (!p) return;
      const candidates = [...room.state.enemies.entries()]
        .filter(([, e]) => e.health > 0 && distance(p, e) <= TAB_RANGE)
        .map(([id, e]) => ({ id, d: distance(p, e), front: isFacing(p, e) ? 1 : 0 }))
        .sort((a, b) => b.front - a.front || a.d - b.d);
      if (!candidates.length) return;
      const i = candidates.findIndex((c) => c.id === targetId);
      setTarget(candidates[(i + 1) % candidates.length].id);
    };

    const onAction = (action) => {
      const m = me();
      if (!m) return;
      if (action.startsWith('action')) {
        const abilityId = CLASSES[m.role]?.abilities[Number(action.slice(6)) - 1];
        if (abilityId) cast(abilityId);
      } else if (action === 'targetNext') {
        targetNextEnemy();
      } else if (action === 'targetSelf') {
        setTarget(room.sessionId);
      } else if (action.startsWith('targetParty')) {
        const others = [...room.state.raiders.keys()].filter((id) => id !== room.sessionId);
        const id = others[Number(action.slice(11)) - 1];
        if (id) setTarget(id);
      } else if (action === 'clear') {
        if (queued) queued = null;
        else if (m.castAbility) room.send('stopCast', {});
        else setTarget('');
      }
    };

    const controls = new Controls(room, rig, keybinds, onAction);
    const panel = new KeybindPanel(keybinds, () => (controls.paused = false));
    const hud = new Hud(keybinds, {
      cast,
      target: setTarget,
      release: () => room.send('release', {}),
      leave: () => {
        room.leave();
        finish(false);
      },
      keybinds: () => {
        controls.paused = true;
        controls.held.clear();
        panel.show();
      },
    });
    // Nameplates and combat text under the HUD, the keybinding panel over it.
    hud.root.prepend(labels.domElement);
    hud.root.append(panel.root);
    show(hud.root);

    // As in WoW: left-click a unit to target it; right-click to target it
    // and, if it's an enemy, start attacking. Clicking empty ground keeps the
    // target (Esc clears it).
    const raycaster = new THREE.Raycaster();
    rig.onClick = (button, e) => {
      const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(ndc, rig.camera);
      const [hit] = raycaster.intersectObjects([...views.values()].map((v) => v.hitbox), false);
      if (!hit) return;
      const id = hit.object.userData.unitId;
      setTarget(id);
      if (button === 2 && room.state.enemies.has(id)) room.send('attack', { on: true });
    };
    rig.onButtonDown = (code) => controls.press(code);
    rig.onButtonUp = (code) => controls.release(code);

    const callbacks = Callbacks.get(room);
    const addView = (id, unit, enemy) => {
      const view = new UnitView(id, unit, { enemy, isMe: id === room.sessionId });
      views.set(id, view);
      scene.add(view.root);
    };
    const removeView = (id) => {
      views.get(id)?.dispose();
      views.delete(id);
    };
    callbacks.onAdd('raiders', (raider, id) => addView(id, raider, false));
    callbacks.onRemove('raiders', (_raider, id) => removeView(id));
    callbacks.onAdd('enemies', (enemy, id) => addView(id, enemy, true));
    callbacks.onRemove('enemies', (_enemy, id) => removeView(id));
    callbacks.listen('time', (time) => clock.sync(time));

    room.onMessage('hit', (hit) => {
      const mine = hit.source === room.sessionId;
      const onMe = hit.target === room.sessionId;
      const view = views.get(hit.target);
      if ((!mine && !onMe) || !view) return;
      if (hit.heal) {
        if (hit.amount > 0) combatText.spawn(view, `+${hit.amount}`, 'heal', hit.crit);
      } else {
        combatText.spawn(view, String(hit.amount), onMe ? 'hurt' : 'damage', hit.crit);
      }
    });
    room.onMessage('error', ({ text }) => hud.showError(text));

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      labels.setSize(w, h);
      rig.resize(w, h);
    };
    window.addEventListener('resize', resize);
    resize();

    const timer = new THREE.Timer();
    renderer.setAnimationLoop(() => {
      timer.update();
      const dt = Math.min(timer.getDelta(), 0.1);
      const now = clock.now();
      const m = me();
      if (m) controls.update(dt, m);
      if (queued && m) {
        if (now >= queued.at && !m.castAbility) {
          send(queued.abilityId);
          queued = null;
        } else if (now > queued.at + 1) {
          queued = null; // Something else held it up: give up rather than fire late.
        }
      }

      for (const [id, view] of views) {
        view.update(dt, id === room.sessionId ? pose() : view.unit);
        view.setSelected(id === targetId);
      }
      const mine = views.get(room.sessionId);
      if (mine) rig.target.set(mine.root.position.x, 1.4, mine.root.position.z);
      rig.update();
      combatText.update(dt);
      if (room.state.raiders) hud.update({ state: room.state, myId: room.sessionId, targetId, now, blocker });
      renderer.render(scene, rig.camera);
      labels.render(scene, rig.camera);
    });

    let done = false;
    const finish = (lost) => {
      if (done) return;
      done = true;
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      rig.dispose();
      controls.dispose();
      panel.dispose();
      combatText.dispose();
      for (const view of views.values()) view.dispose();
      renderer.dispose();
      room.removeAllListeners();
      resolve({ lost });
    };

    room.onDrop(() => (hud.banner.textContent = 'Connection lost. Reconnecting…'));
    room.onReconnect(() => (hud.banner.textContent = ''));
    room.onLeave((code) => finish(code !== 1000));
  });
}
