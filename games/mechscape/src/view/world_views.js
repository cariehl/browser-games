// Builds and keeps in step everything drawn for the World: the map, gather
// nodes (husks come and go), stations, players and NPCs, items on the
// ground, and the local player's wrecks.

import * as THREE from 'three';
import { ClientState } from '../client/client_state.js';
import { tileToWorld, color, darkened } from './tile_math.js';
import { Models } from './models.js';
import { Hitbox, HitboxKind } from './hitbox.js';
import { EntityView } from './entity_view.js';
import { ModelAnimator } from './model_animator.js';
import { PlayerAppearance } from './player_appearance.js';
import { GatherNodeView } from './gather_node_view.js';
import { StationView } from './station_view.js';
import { buildGrid } from './grid_view.js';
import { WorldLabel } from '../ui/screen.js';

export const PLAYER_MODEL = 'player.glb';
/** Ground one Walk and one Run cycle of the player model cover, in metres. */
const PLAYER_WALK_CYCLE = 1.5;
const PLAYER_RUN_CYCLE = 2.3;
const GROUND_BLOCK = [0.26, 0.14, 0.26];
const TICK_SECONDS = 0.6;
/** Each player's own colour, by id, so friends can tell each other apart. Player 1 keeps the original orange. */
export const PLAYER_COLOURS = [
  [0.85, 0.55, 0.25], [0.25, 0.55, 0.85], [0.35, 0.75, 0.35], [0.8, 0.3, 0.35],
  [0.65, 0.4, 0.8], [0.9, 0.8, 0.3], [0.3, 0.75, 0.75], [0.85, 0.45, 0.65],
];

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
    this.root.add(buildGrid(world));
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
      const view = new StationView(station);
      this.root.add(view);
      this._stations.push(view);
    }
    for (const state of world.entities.values()) this._addEntity(state);
    this._syncNodes();
  }

  /** The local player's view. */
  get playerView() {
    return this.entities.get(ClientState.localPlayerId);
  }

  update(delta) {
    const world = ClientState.world;
    for (const state of world.entities.values()) if (!this.entities.has(state.id)) this._addEntity(state);
    // Players who logged out (online only: NPCs never leave the world).
    for (const [id, view] of this.entities) {
      if (world.entities.get(id) === view.state) continue;
      view.dispose();
      if (view.nameLabel) view.nameLabel.dispose();
      this.root.remove(view);
      this.entities.delete(id);
    }
    for (const view of this.entities.values()) {
      view.update(delta);
      // Other players' names float over them.
      if (!view.nameLabel && !view.state.isNpc() && view.state.id !== ClientState.localPlayerId) view.nameLabel = new WorldLabel('player-label');
      if (view.nameLabel) {
        view.nameLabel.text = view.state.display_name;
        view.nameLabel.point.copy(view.position).y += view.headHeight + 0.2;
        view.nameLabel.update();
      }
    }
    this._syncNodes();
    for (const view of this._nodes.values()) view.update(delta);
    this._syncGround();
    this._syncWrecks();
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
  view.appearance.primary = PLAYER_COLOURS[(Math.max(state.id, 1) - 1) % PLAYER_COLOURS.length];
  view.headHeight = Models.bounds(model).max.y + 0.15;
  return view;
}

/** An NPC: its imported model when its def has one, otherwise a gray box with one red eye. */
function makeNpcView(state) {
  const view = new EntityView(state);
  const def = state.def;
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
