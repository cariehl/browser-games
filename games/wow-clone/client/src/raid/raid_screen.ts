// The raid: the three.js scene, nameplates, party frames and a way out.
// Resolves when the player leaves the raid or loses the connection for good.

import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Callbacks, type Room } from '@colyseus/sdk';
import { ROLE_INFO, type Role } from '../../../shared/roles';
import type { RaidState } from '../../../shared/state';
import { el, show } from '../dom';
import { buildArena } from './arena';
import { CameraRig } from './camera_rig';
import { RaiderView } from './raider_view';

export function raidScreen(room: Room<any, RaidState>, canvas: HTMLCanvasElement): Promise<{ lost: boolean }> {
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
    const views = new Map<string, RaiderView>();

    // The HTML overlay: party frames and the leave button.
    const hud = el('div', 'hud');
    const frames = el('div', 'party-frames');
    const leave = el('button', 'quiet leave', 'Leave raid');
    const banner = el('div', 'banner');
    hud.append(frames, leave, banner, labels.domElement);
    show(hud);

    const renderFrames = () => {
      if (!room.state.raiders) return;
      frames.replaceChildren(...[...room.state.raiders.entries()].map(([id, r]) => {
        const frame = el('div', `frame${r.connected ? '' : ' away'}${id === room.sessionId ? ' me' : ''}`);
        const tag = el('span', 'tag', ROLE_INFO[r.role as Role]?.label ?? r.role);
        tag.style.setProperty('--role', `#${(ROLE_INFO[r.role as Role]?.color ?? 0x888888).toString(16).padStart(6, '0')}`);
        frame.append(tag, el('span', 'name', r.name), el('span', 'muted small', r.connected ? '' : 'reconnecting…'));
        return frame;
      }));
    };

    const callbacks = Callbacks.get(room);
    callbacks.onAdd('raiders', (raider, id) => {
      const view = new RaiderView(raider, id === room.sessionId);
      views.set(id, view);
      scene.add(view.root);
      callbacks.listen(raider, 'connected', renderFrames);
      renderFrames();
    });
    callbacks.onRemove('raiders', (_raider, id) => {
      views.get(id)?.dispose();
      views.delete(id);
      renderFrames();
    });

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      labels.setSize(w, h);
      rig.resize(w, h);
    };
    window.addEventListener('resize', resize);
    resize();

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.1);
      for (const view of views.values()) view.update(dt);
      const me = views.get(room.sessionId);
      if (me) rig.target.set(me.root.position.x, 1.4, me.root.position.z);
      rig.update();
      renderer.render(scene, rig.camera);
      labels.render(scene, rig.camera);
    });

    let done = false;
    const finish = (lost: boolean) => {
      if (done) return;
      done = true;
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      rig.dispose();
      for (const view of views.values()) view.dispose();
      renderer.dispose();
      room.removeAllListeners();
      resolve({ lost });
    };

    room.onDrop(() => banner.textContent = 'Connection lost. Reconnecting…');
    room.onReconnect(() => banner.textContent = '');
    room.onLeave((code) => finish(code !== 1000));
    leave.onclick = () => {
      room.leave();
      finish(false);
    };
  });
}
