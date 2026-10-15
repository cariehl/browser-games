// Boots the game in the browser: loads the content, maps and models, joins
// the game server (or, with ?offline, picks up the local save), then builds
// the 3D views and the UI around the world and runs the frame loop.
//
// The sim (src/sim/) knows nothing about any of this. Offline, each frame's
// time goes into a GameLoop in this page, which runs whole 0.6s ticks.
// Online, the server runs them and a NetLoop mirrors each one as it arrives.
// Either way views read the World and interpolate between ticks with the
// loop's alpha.

import * as THREE from 'three';
import { Content, CONTENT_FILES } from './sim/defs.js';
import * as actions from './sim/actions.js';
import { MapData } from './sim/map_data.js';
import { World, DEFAULT_MAP } from './sim/world.js';
import { ClientState } from './client/client_state.js';
import { SimulatedLink } from './client/simulated_link.js';
import { PlayerController } from './client/player_controller.js';
import { SaveManager } from './client/save_manager.js';
import { NetLink, join, savedName, askName } from './client/net_client.js';
import { Models } from './view/models.js';
import { WorldViews, modelFiles } from './view/world_views.js';
import { CameraRig } from './view/camera_rig.js';
import { ClickMarker } from './view/click_marker.js';
import { DebugOverlay } from './view/debug_overlay.js';
import { color } from './view/tile_math.js';
import { Screen, el } from './ui/screen.js';
import { HoverText } from './ui/hover_text.js';
import { ContextMenu } from './ui/context_menu.js';
import { InspectWindow } from './ui/inspect_window.js';
import { CombatOverlay } from './ui/combat_overlay.js';
import { XpDrops } from './ui/xp_drops.js';
import { MessageLog } from './ui/message_log.js';
import { PlayerPanel } from './ui/player_panel.js';
import { SkillGuide } from './ui/skill_guide.js';
import { CraftMenu } from './ui/craft_menu.js';
import { StorageMenu } from './ui/storage_menu.js';
import { DebugHud } from './ui/debug_hud.js';
import { DialogueBox } from './ui/dialogue_box.js';
import { QuestJournal } from './ui/quest_journal.js';
import { TradeWindow } from './ui/trade_window.js';

/** Longest frame fed to the game, so a hidden tab doesn't come back to a burst of ticks. */
const MAX_FRAME_SECONDS = 0.25;

async function loadContent() {
  const bundle = {};
  await Promise.all(Object.entries(CONTENT_FILES).map(async ([kind, file]) => {
    bundle[kind] = await fetchOk(`data/${file}.json`).then((r) => r.json());
  }));
  Content.load(bundle);
  // The world layout, then every map it places.
  const layoutText = await fetchOk(DEFAULT_MAP).then((r) => r.text());
  MapData.register(DEFAULT_MAP, layoutText);
  const maps = JSON.parse(layoutText).areas.map((area) => area.map);
  await Promise.all(maps.map(async (path) => MapData.register(path, await fetchOk(path).then((r) => r.text()))));
}

async function fetchOk(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't load ${url} (${response.status})`);
  return response;
}

function makeRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

/**
 * Light to match the Godot scene: a sun at rotation (-55°, 35°, 0°) with
 * shadows, a flat ambient, and a flat sky colour. Godot's light energy 1 is
 * three.js intensity π (three divides diffuse light by π; Godot doesn't).
 */
const SKY = [0.55, 0.62, 0.68];
/** Underground (dark areas): a dim, close, blue-black world lit by its lamps. */
const DARK_SKY = [0.04, 0.045, 0.06];

function addEnvironment(scene) {
  scene.background = color(SKY);
  const ambient = new THREE.AmbientLight(color([0.6, 0.62, 0.66]), 0.6 * Math.PI);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, Math.PI);
  // The direction the light travels: Godot's -Z after its rotation.
  const travel = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(-55), THREE.MathUtils.degToRad(35), 0, 'YXZ',
  ));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -22;
  s.right = 22;
  s.top = 22;
  s.bottom = -22;
  s.near = 1;
  s.far = 120;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);
  scene.fog = new THREE.Fog(color(SKY), 60, 140);
  let dark = null;
  /**
   * Keeps the shadow box centred on what the camera is looking at, and sets
   * the mood for the area the player is in.
   */
  return (focus, area) => {
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(travel, -50);
    const isDark = !!(area && area.dark);
    if (isDark === dark) return;
    dark = isDark;
    const sky = color(isDark ? DARK_SKY : SKY);
    scene.background = sky;
    scene.fog.color.copy(sky);
    scene.fog.near = isDark ? 10 : 60;
    scene.fog.far = isDark ? 34 : 140;
    ambient.intensity = (isDark ? 0.16 : 0.6) * Math.PI;
    sun.intensity = (isDark ? 0.12 : 1) * Math.PI;
  };
}

/** Asks for a name if there isn't one, and joins; asks again if the server turns it away. */
async function joinServer(status) {
  let name = savedName();
  let error = '';
  for (;;) {
    if (!name || error) name = await askName(status, name, error);
    status.textContent = `Joining as ${name}…`;
    try {
      return await join(name, DEFAULT_MAP);
    } catch (e) {
      console.error(e);
      error = e.message || "Couldn't reach the game server.";
    }
  }
}

/** A red line at the top of the screen while the connection is down. */
function watchConnection(room, ui) {
  const banner = el('div', 'connection-banner', '', ui);
  banner.style.display = 'none';
  const show = (text) => {
    banner.textContent = text;
    banner.style.display = text ? '' : 'none';
  };
  room.onDrop(() => show('Connection lost. Reconnecting…'));
  room.onReconnect(() => show(''));
  room.onLeave(() => show('Disconnected from the server. Reload the page to rejoin.'));
}

async function main() {
  const status = document.getElementById('loading');
  const offline = new URLSearchParams(window.location.search).has('offline');
  await loadContent();
  status.textContent = 'Loading models…';
  await Models.preload(modelFiles(Content));

  let net = null;
  if (offline) {
    const { world, notice } = SaveManager.startingWorld(() => new World(DEFAULT_MAP));
    ClientState.start(world);
    ClientState.notice = notice;
    ClientState.localPlayer();
  } else {
    net = await joinServer(status);
    ClientState.online = true;
    ClientState.start(net.loop.world, net.loop);
    ClientState.localPlayerId = net.id;
    ClientState.notice = `You're playing as ${ClientState.me().display_name}.`;
  }
  const world = ClientState.world;
  status.remove();

  const canvas = document.getElementById('game');
  const ui = document.getElementById('ui');
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const followSun = addEnvironment(scene);

  const views = new WorldViews(scene, world);
  Screen.groundMesh = views.groundMesh;
  const rig = new CameraRig(canvas);
  rig.target = views.playerView;
  rig.snap();
  Screen.camera = rig.camera;
  Screen.layer = el('div', 'labels', '', ui);

  const marker = new ClickMarker();
  scene.add(marker);
  const overlay = new DebugOverlay();
  scene.add(overlay);

  const link = net ? new NetLink(net.room) : new SimulatedLink();
  const combat = new CombatOverlay(ui, views.entities);
  const xpDrops = new XpDrops(views.playerView);
  const messageLog = new MessageLog(ui, link);
  const saves = net ? null : new SaveManager(messageLog);
  if (net) {
    watchConnection(net.room, ui);
    net.room.onMessage('notice', ({ text }) => messageLog.push(text));
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && ['s', 'l'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        messageLog.push('The server saves the world by itself every minute.');
      }
    });
  }
  const hover = new HoverText(ui);
  const menu = new ContextMenu(ui);
  const inspector = new InspectWindow(ui);
  const guide = new SkillGuide(ui);
  const panel = new PlayerPanel(ui, { link, menu, inspector, hover, guide, extraTabs: [new QuestJournal()] });
  const dialogue = new DialogueBox(ui, link);
  const craft = new CraftMenu(ui, link);
  const storage = new StorageMenu(ui, link, menu);
  const trade = new TradeWindow(ui, link, menu);
  const hud = new DebugHud(ui, { overlay, link, saves, messageLog, cheats: net ? net.debug : true });
  const controller = new PlayerController(canvas, { link, marker, hover, menu, inspector });

  // Through a hatch or a lift: the camera jumps with you instead of sweeping across the map.
  ClientState.onTick(() => {
    if (world.events.some((e) => e.type === 'teleport' && e.entity === ClientState.localPlayerId)) rig.snapNextFrame = true;
  });

  // The game has its own right-click menu.
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    rig.camera.aspect = w / h;
    rig.camera.updateProjectionMatrix();
    Screen.width = w;
    Screen.height = h;
  };
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  const frame = (now) => {
    const real = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
    last = now;
    // Frame time scaled by the debug tick speed, like Godot's Engine.time_scale.
    const delta = real * ClientState.speed;
    link.update();
    ClientState.loop.advance(delta);
    views.update(delta);
    marker.update(delta);
    rig.update(real);
    const me = ClientState.me();
    followSun(rig.position, me ? world.areaAt(me.tile) : null);
    views.decorLights.update(rig.position);
    overlay.update();
    combat.update(delta);
    xpDrops.update(delta);
    controller.update();
    inspector.update();
    panel.update();
    craft.update();
    storage.update();
    trade.update();
    dialogue.update();
    hud.update();
    renderer.render(scene, rig.camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // For poking at the game from the browser console.
  window.mechscape = { ClientState, actions, Content, views, link, saves, rig, renderer, scene, room: net && net.room };
}

main().catch((error) => {
  console.error(error);
  const status = document.getElementById('loading');
  if (status) {
    status.textContent = `Couldn't start the game: ${error.message}`;
    status.classList.add('error');
  }
});
