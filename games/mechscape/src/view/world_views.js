// Builds and keeps in step everything drawn for the World: the map, gather
// nodes (husks come and go), stations, players and NPCs, items on the
// ground, and the local player's wrecks.

import * as THREE from 'three';
import { ClientState } from '../client/client_state.js';
import { tileToWorld, color, darkened, setGroundSource } from './tile_math.js';
import { buildDecor } from './decor_view.js';
import { buildBackdrop } from './backdrop_view.js';
import { Models } from './models.js';
import { Hitbox, HitboxKind } from './hitbox.js';
import { EntityView } from './entity_view.js';
import { ModelAnimator } from './model_animator.js';
import { PlayerAppearance, PaintTint } from './player_appearance.js';
import { Bursts } from './bursts.js';
import { GatherNodeView } from './gather_node_view.js';
import { StationView } from './station_view.js';
import { buildGrid, rebuildTerrain } from './grid_view.js';
import { WorldLabel } from '../ui/screen.js';
import { buildWalker, showInstalled, WalkerAnimator } from './mech_view.js';
import { Mechs } from '../sim/mech.js';
import { Content } from '../sim/defs.js';
import { Combat } from '../sim/combat.js';
import { HazardViews } from './hazard_view.js';
import { PieceView, PieceGhost } from './piece_view.js';

export const PLAYER_MODEL = 'player.glb';
/** Ground one Walk and one Run cycle of the player model cover, in metres. */
const PLAYER_WALK_CYCLE = 1.5;
const PLAYER_RUN_CYCLE = 2.3;
const GROUND_BLOCK = [0.26, 0.14, 0.26];
const TICK_SECONDS = 0.6;
/** How long a chat line floats over whoever said it. */
const CHAT_SECONDS = 5;

/** Every model file the world's content refers to, to preload. */
export function modelFiles(content) {
  const names = [PLAYER_MODEL];
  for (const def of [...Object.values(content.nodes), ...Object.values(content.npcs), ...Object.values(content.stations)]) {
    if (def.model) names.push(def.model);
    if (def.depleted_model) names.push(def.depleted_model);
  }
  return names;
}

export class WorldViews {
  constructor(scene, world) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    setGroundSource(world);
    const grid = buildGrid(world);
    this.root.add(grid.group);
    this._terrain = grid.terrain;
    this._openedKey = JSON.stringify(world.opened || []);
    /** The ground mesh, to find the tile under the mouse. */
    this.groundMesh = grid.ground;
    const decor = buildDecor(world);
    this.root.add(decor.group);
    /** The land and scenery beyond the areas' edges (see backdrop_view.js). */
    this.backdrop = buildBackdrop(world);
    this.root.add(this.backdrop.group);
    const pools = [decor.lights, this.backdrop.lights];
    this.decorLights = { update: (focus) => { for (const pool of pools) pool.update(focus); } };
    /** entity id -> EntityView */
    this.entities = new Map();
    /** node id -> GatherNodeView */
    this._nodes = new Map();
    this._stations = [];
    /** ground item id -> { view, label } */
    this._ground = new Map();
    /** wreck id -> { view, label } */
    this._wrecks = new Map();
    for (const station of world.stations.values()) {
      const view = new StationView(station, world);
      this.root.add(view);
      this._stations.push(view);
    }
    for (const state of world.entities.values()) this._addEntity(state);
    this._syncNodes();
    /** hab piece id -> PieceView */
    this._pieces = new Map();
    this._syncPieces();
    /** Build mode's ghost (see ui/build_mode.js). */
    this.ghost = new PieceGhost();
    this.root.add(this.ghost);
    this.bursts = new Bursts(this.root);
    this.hazards = new HazardViews(this.root);
    ClientState.onTick(() => {
      for (const event of ClientState.world.events) {
        if (event.type === 'attack' || event.type === 'mech_powerup') {
          const view = this.entities.get(event.entity);
          if (view && view.walker) {
            if (event.type === 'attack') view.walker.fire();
            else {
              view.walker.powerUp();
              this.bursts.spawn(view.position.clone().setY(view.position.y + 3.5), 'confetti');
            }
          }
          continue;
        }
        if (event.type === 'shield_down' || event.type === 'hazard_resolve' && event.data.kind === 'soak') {
          const view = this.entities.get(event.entity);
          if (view) this.bursts.spawn(view.position.clone().setY(view.position.y + 2), 'paint', [1, 0.3, 0.65]);
          continue;
        }
        if (event.type === 'fun_hit') {
          const target = this.entities.get(event.data.target);
          if (target) this.bursts.spawn(target.position.clone().setY(target.position.y + target.headHeight * 0.6), event.data.effect, event.data.color);
          continue;
        }
        if (event.type !== 'chat' && event.type !== 'say') continue;
        const view = this.entities.get(event.entity);
        if (!view) continue;
        if (!view.chatLabel) view.chatLabel = new WorldLabel('chat-label');
        view.chatLabel.text = event.data.text;
        view.chatSeconds = CHAT_SECONDS;
      }
    });
  }

  /** The local player's view. */
  get playerView() {
    return this.entities.get(ClientState.localPlayerId);
  }

  update(delta) {
    const world = ClientState.world;
    this.bursts.update(delta);
    this.hazards.update();
    for (const state of world.entities.values()) if (!this.entities.has(state.id)) this._addEntity(state);
    // Players who logged out (online only: NPCs never leave the world).
    for (const [id, view] of this.entities) {
      if (world.entities.get(id) === view.state) continue;
      view.dispose();
      if (view.nameLabel) view.nameLabel.dispose();
      if (view.chatLabel) view.chatLabel.dispose();
      this.root.remove(view);
      this.entities.delete(id);
    }
    for (const view of this.entities.values()) {
      view.update(delta);
      // Mechs are 2 × 2: their tile is the top-left one.
      if (view.state.size > 1) {
        view.position.x += (view.state.size - 1) / 2;
        view.position.z += (view.state.size - 1) / 2;
      }
      if (view.walker) view.walker.update(delta, view.position);
      // Crew are inside their mech.
      if (view.state.riding) view.visible = false;
      // A boss's shield: a bubble round it.
      if (view.state.shield !== undefined) {
        if (!view.shieldBubble) {
          view.shieldBubble = new THREE.Mesh(new THREE.SphereGeometry(1.6, 20, 14), new THREE.MeshStandardMaterial({ color: color([0.5, 0.85, 1]), emissive: color([0.3, 0.6, 1]), emissiveIntensity: 0.8, transparent: true, opacity: 0.25, depthWrite: false }));
          view.shieldBubble.position.y = 1.4;
          view.add(view.shieldBubble);
        }
        view.shieldBubble.visible = view.state.shield && !view.state.isDead();
        if (view.shieldBubble.visible) view.shieldBubble.rotation.y += delta;
      }
      // Other players' names float over them.
      if (!view.nameLabel && !view.state.isNpc() && view.state.id !== ClientState.localPlayerId) view.nameLabel = new WorldLabel('player-label');
      if (view.nameLabel) {
        view.nameLabel.visible = view.visible;
        view.nameLabel.text = `${view.state.display_name}  (level-${Combat.level(view.state)})`;
        view.nameLabel.point.copy(view.position).y += view.headHeight + 0.2;
        view.nameLabel.update();
      }
      if (view.chatLabel) {
        view.chatSeconds -= delta;
        if (view.chatSeconds <= 0) {
          view.chatLabel.dispose();
          view.chatLabel = null;
        } else {
          view.chatLabel.visible = view.visible;
          view.chatLabel.point.copy(view.position).y += view.headHeight + (view.nameLabel ? 0.55 : 0.3);
          view.chatLabel.update();
        }
      }
    }
    this._syncMechBuild();
    this._syncPieces();
    // A puzzle in the Quiet Reach opened some terrain: redraw it.
    const opened = JSON.stringify(world.opened || []);
    if (opened !== this._openedKey) {
      this._openedKey = opened;
      rebuildTerrain(this._terrain, world);
    }
    this._syncNodes();
    for (const view of this._nodes.values()) view.update(delta);
    this._syncGround();
    this._syncWrecks();
  }

  /** The mech taking shape on the gantry pad, part by part, until it stands up as an NPC. */
  _syncMechBuild() {
    const world = ClientState.world;
    const def = Mechs.defaultDef();
    const build = def && world.mech_builds && world.mech_builds[def.id];
    const standing = build && build.mech_id >= 0 && world.entities.has(build.mech_id);
    const any = build && Object.values(build.installed).some((n) => n > 0);
    if (!this._mechBuild) {
      if (!any || standing) return;
      const pad = Mechs.spot(world, def.pad);
      if (!pad) return;
      this._mechBuild = buildWalker();
      tileToWorld(pad, 0, this._mechBuild.root.position);
      this._mechBuild.root.position.x += 0.5;
      this._mechBuild.root.position.z += 0.5;
      this.root.add(this._mechBuild.root);
      this._mechBuildKey = '';
    }
    this._mechBuild.root.visible = !!any && !standing;
    const key = JSON.stringify(build ? build.installed : {});
    if (key !== this._mechBuildKey) {
      this._mechBuildKey = key;
      showInstalled(this._mechBuild, build ? build.installed : {});
    }
  }

  /** Hab pieces come, go, move, turn and change colour. */
  _syncPieces() {
    const pieces = ClientState.world.pieces;
    if (!pieces) return;
    for (const [id, view] of this._pieces) {
      if (pieces.get(id) === view.piece) continue;
      view.dispose();
      this.root.remove(view);
      this._pieces.delete(id);
    }
    for (const [id, piece] of pieces) {
      let view = this._pieces.get(id);
      if (!view) {
        view = new PieceView(piece);
        this.root.add(view);
        this._pieces.set(id, view);
      }
      view.update();
    }
  }

  // --- Entities -------------------------------------------------------------

  _addEntity(state) {
    const view = state.isNpc() ? makeNpcView(state) : makePlayerView(state);
    this.root.add(view);
    this.entities.set(state.id, view);
  }

  // --- Gather nodes -----------------------------------------------------------

  /** Adds views for nodes that appeared (husks) and drops views for nodes that went away. */
  _syncNodes() {
    const world = ClientState.world;
    for (const [id, node] of world.nodes) {
      if (this._nodes.has(id)) continue;
      const view = new GatherNodeView(node);
      this.root.add(view);
      this._nodes.set(id, view);
    }
    for (const [id, view] of this._nodes) {
      if (world.nodes.has(id)) continue;
      view.dispose();
      this.root.remove(view);
      this._nodes.delete(id);
    }
  }

  // --- Ground items ---------------------------------------------------------

  /**
   * Items lying on the ground: a small block in the item's colour, one per
   * item, fanned out when several share a tile, with one floating label per
   * tile (the top item, and how many more are under it). Each has a hitbox,
   * so it can be hovered, taken and inspected.
   */
  _syncGround() {
    const world = ClientState.world;
    for (const [id, entry] of this._ground) {
      if (world.ground_items.has(id)) continue;
      entry.view.traverse((node) => {
        if (node instanceof Hitbox) node.dispose();
      });
      this.root.remove(entry.view);
      entry.label.dispose();
      this._ground.delete(id);
    }
    for (const [id, ground] of world.ground_items) {
      let entry = this._ground.get(id);
      if (!entry) {
        entry = makeGroundView(ground);
        this.root.add(entry.view);
        this._ground.set(id, entry);
      }
      // Fan out items sharing a tile so each can be clicked.
      const pile = world.groundItemsAt(ground.tile);
      const index = pile.indexOf(ground);
      const angle = index * 2.4;
      const radius = pile.length === 1 ? 0 : 0.24;
      tileToWorld(ground.tile, 0, entry.view.position);
      entry.view.position.x += Math.cos(angle) * radius;
      entry.view.position.z += Math.sin(angle) * radius;
      // One label per tile, on the top item, so piles stay readable.
      entry.label.visible = index === 0;
      if (index === 0) {
        let text = ground.item.abbreviation + (ground.count > 1 ? ` ×${ground.count}` : '');
        if (pile.length > 1) text += `  +${pile.length - 1}`;
        entry.label.text = text;
      }
      entry.label.point.copy(entry.view.position).y += 0.42;
      entry.label.update();
    }
  }

  // --- Wrecks ---------------------------------------------------------------

  /**
   * The local player's wrecks (where they died, holding their gear), as a
   * heap of dark scrap with a label. Other players' wrecks aren't drawn: only
   * the owner can salvage one, and in the alpha the server won't send them.
   */
  _syncWrecks() {
    const world = ClientState.world;
    for (const [id, entry] of this._wrecks) {
      if (world.wrecks.has(id)) continue;
      entry.view.traverse((node) => {
        if (node instanceof Hitbox) node.dispose();
      });
      this.root.remove(entry.view);
      entry.label.dispose();
      this._wrecks.delete(id);
    }
    for (const [id, wreck] of world.wrecks) {
      if (wreck.owner_id !== ClientState.localPlayerId) continue;
      let entry = this._wrecks.get(id);
      if (!entry) {
        entry = makeWreckView(wreck);
        this.root.add(entry.view);
        this._wrecks.set(id, entry);
      }
      const seconds = Math.max(wreck.expire_tick - world.tick, 0) * TICK_SECONDS;
      entry.label.text = `Your wreck  ·  ${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, '0')}`;
      entry.label.point.copy(entry.view.position).y += 0.75;
      entry.label.update();
    }
  }
}

/**
 * A player: the android pilot, animated from their state (with swings
 * finishing on the upper body while walking), dressed in their colour and gear.
 */
function makePlayerView(state) {
  const view = new EntityView(state);
  const { model, animations } = Models.instance(PLAYER_MODEL, 1);
  view.add(model);
  const animator = ModelAnimator.attach(model, animations, state, 1);
  if (animator) {
    animator.walkCycleDistance = PLAYER_WALK_CYCLE;
    animator.runCycleDistance = PLAYER_RUN_CYCLE;
    animator.enableUpperBody('spine');
    view.animator = animator;
    view.lunges = false;
  }
  view.appearance = new PlayerAppearance(model, state);
  const box = Models.bounds(model);
  view.headHeight = box.max.y + 0.15;
  // Other players can be clicked (trade); your own model never is.
  if (state.id !== ClientState.localPlayerId) {
    view.add(new Hitbox(HitboxKind.PLAYER, state.id, box.getSize(new THREE.Vector3()).multiply(new THREE.Vector3(0.8, 1, 0.8)), box.getCenter(new THREE.Vector3())));
  }
  return view;
}

/** A mech: the procedural walker, animated by how it moves and fires. */
function makeMechView(state) {
  const view = new EntityView(state);
  const walker = buildWalker();
  view.add(walker.root);
  view.walker = new WalkerAnimator(walker);
  view.lunges = false;
  view.headHeight = 4.5;
  view.add(new Hitbox(HitboxKind.NPC, state.id, new THREE.Vector3(2, 4.2, 2), new THREE.Vector3(0, 2.1, 0)));
  return view;
}

/**
 * A person drawn as a pilot (the foreman, the surveyor...): the player model
 * dressed in their def's look and cosmetics, so each has their own parts and colours.
 */
function makePilotNpcView(state) {
  const def = state.def;
  const view = new EntityView(state);
  const { model, animations } = Models.instance(PLAYER_MODEL, def.model_scale);
  view.add(model);
  const animator = ModelAnimator.attach(model, animations, state, def.model_scale);
  if (animator) {
    animator.walkCycleDistance = PLAYER_WALK_CYCLE;
    animator.runCycleDistance = PLAYER_RUN_CYCLE;
    view.animator = animator;
    view.lunges = false;
  }
  const cosmetics = {};
  for (const [part, id] of Object.entries(def.cosmetics || {})) {
    const item = Content.item(id);
    if (item) cosmetics[part] = item;
  }
  const dressing = { look: def.look, cosmetics, armor: {}, weapon: null, get paint() { return state.paint; } };
  view.appearance = new PlayerAppearance(model, dressing);
  const box = Models.bounds(model);
  view.headHeight = box.max.y + 0.15;
  view.add(new Hitbox(HitboxKind.NPC, state.id, box.getSize(new THREE.Vector3()).multiply(new THREE.Vector3(0.8, 1, 0.8)), box.getCenter(new THREE.Vector3())));
  return view;
}

/** An NPC: its imported model when its def has one, otherwise a gray box with one red eye. */
function makeNpcView(state) {
  const def = state.def;
  if (def.shape === 'walker') return makeMechView(state);
  if (def.look && Models.has(PLAYER_MODEL)) return makePilotNpcView(state);
  const view = new EntityView(state);
  if (def.model && Models.has(def.model)) {
    const { model, animations } = Models.instance(def.model, def.model_scale);
    view.add(model);
    const animator = ModelAnimator.attach(model, animations, state, def.model_scale);
    if (animator) {
      animator.walkCycleDistance = def.walk_cycle_distance;
      animator.attackWindupFrames = def.attack_windup_frames;
      view.animator = animator;
      view.lunges = false;
      view.collapseSeconds = animator.collapseSeconds();
    }
    const box = Models.bounds(model);
    view.headHeight = box.max.y + 0.15;
    view.add(new Hitbox(HitboxKind.NPC, state.id, box.getSize(new THREE.Vector3()), box.getCenter(new THREE.Vector3())));
    const paint = new PaintTint(model);
    view.appearance = { update: () => paint.update(state.paint) };
    return view;
  }
  const s = def.size;
  view.headHeight = 1.85 * s;
  const hull = new THREE.MeshStandardMaterial({ color: color(def.color), metalness: 0.4, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: color(darkened(def.color, 0.45)) });
  const eye = new THREE.MeshStandardMaterial({ color: color([1, 0.15, 0.1]), emissive: color([1, 0.15, 0.1]), emissiveIntensity: 2.5 });
  const parts = [
    [[0.62, 0.55, 0.5], [0, 0.95, 0], hull],
    [[0.16, 0.65, 0.2], [-0.18, 0.33, 0], dark],
    [[0.16, 0.65, 0.2], [0.18, 0.33, 0], dark],
    [[0.36, 0.28, 0.34], [0, 1.37, 0.02], hull],
    [[0.14, 0.08, 0.04], [0, 1.39, 0.2], eye],
    [[0.12, 0.12, 0.42], [0.38, 1.0, 0.12], dark],
  ];
  for (const [size, at, material] of parts) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size.map((v) => v * s)), material);
    mesh.position.set(...at.map((v) => v * s));
    mesh.castShadow = true;
    view.add(mesh);
  }
  view.add(new Hitbox(HitboxKind.NPC, state.id, new THREE.Vector3(0.8, 1.55, 0.7).multiplyScalar(s), new THREE.Vector3(0.05, 0.78, 0.05).multiplyScalar(s)));
  return view;
}

function makeGroundView(ground) {
  const view = new THREE.Group();
  const block = new THREE.Mesh(
    new THREE.BoxGeometry(...GROUND_BLOCK),
    new THREE.MeshStandardMaterial({ color: color(ground.item.color), roughness: 0.6 }),
  );
  block.position.y = GROUND_BLOCK[1] / 2;
  block.rotation.y = Math.random() * Math.PI * 2;
  block.castShadow = true;
  view.add(block);
  view.add(new Hitbox(HitboxKind.ITEM, ground.id, new THREE.Vector3(0.42, 0.3, 0.42), new THREE.Vector3(0, 0.15, 0)));
  return { view, label: new WorldLabel('ground-label') };
}

function makeWreckView(wreck) {
  const view = new THREE.Group();
  tileToWorld(wreck.tile, 0, view.position);
  const metal = new THREE.MeshStandardMaterial({ color: color([0.32, 0.3, 0.3]), metalness: 0.5, roughness: 0.7 });
  const glow = new THREE.MeshStandardMaterial({ color: color([0.3, 0.8, 1]), emissive: color([0.3, 0.8, 1]), emissiveIntensity: 1.5 });
  const parts = [
    [[0.6, 0.18, 0.4], [0, 0.09, 0], [0, 0.3, 0], metal],
    [[0.3, 0.22, 0.26], [0.2, 0.2, 0.08], [0.2, -0.4, 0.3], metal],
    [[0.12, 0.42, 0.12], [-0.22, 0.06, -0.12], [1.4, 0.2, 0], metal],
    [[0.1, 0.06, 0.04], [0.2, 0.33, 0.2], [0, 0, 0], glow],
  ];
  for (const [size, at, rotation, material] of parts) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at);
    mesh.rotation.set(...rotation, 'YXZ');
    mesh.castShadow = true;
    view.add(mesh);
  }
  view.add(new Hitbox(HitboxKind.OBJECT, wreck.id, new THREE.Vector3(0.8, 0.5, 0.7), new THREE.Vector3(0, 0.25, 0)));
  return { view, label: new WorldLabel('wreck-label') };
}
