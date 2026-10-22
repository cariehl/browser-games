// The minimap in the top-right corner, OSRS-style: a round map of the area
// around you that turns with the camera, with dots for what's nearby
// (yellow NPCs, white players, red items on the ground, blue stations) and
// a white square for you. Click it to walk there; scroll on it to zoom; click
// the compass to face north.
//
// Read-only: it draws the client's World (the map is the same for everyone,
// and the snapshot only sends things in your own area) and walks through the
// player controller, so it works the same online and offline.

import { ClientState } from '../client/client_state.js';
import { TILE_SIZE, cssColor, lightened, darkened } from '../view/tile_math.js';
import { el } from './screen.js';

/** The map's diameter in CSS pixels. */
const SIZE = 172;
const ZOOMS = [3, 4, 5, 6, 8];
const DEFAULT_ZOOM = 1;
const VOID = 'rgb(10, 12, 14)';
const DEFAULT_GROUND = [0.36, 0.40, 0.33];
/** Each ground level up is this much lighter, so hills read on the map. */
const HEIGHT_LIGHTEN = 0.07;
const DOT = {
  npc: 'rgb(255, 230, 40)',
  player: 'rgb(255, 255, 255)',
  item: 'rgb(235, 40, 30)',
  station: 'rgb(90, 200, 255)',
};

export class Minimap {
  /** [rig]: the CameraRig (its yaw, and facing north). [views]: WorldViews, for smooth positions. [controller]: walks. */
  constructor(parent, { rig, views, controller }) {
    this.rig = rig;
    this.views = views;
    this.controller = controller;
    this.el = el('div', 'minimap', '', parent);
    this.canvas = el('canvas', 'minimap-map', '', this.el);
    this.canvas.title = 'Click to walk there · scroll to zoom';
    this._compass = el('button', 'minimap-compass', '', this.el);
    this._compass.title = 'Face north';
    this._needle = el('div', 'needle', 'N', this._compass);
    this._compass.addEventListener('click', () => this.rig.faceNorth());
    this._caption = el('div', 'minimap-caption', '', this.el);
    this._zoom = DEFAULT_ZOOM;
    /** area index -> canvas with one pixel per tile. */
    this._areaImages = new Map();
    this._openedKey = '';
    this._dpr = 0;

    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const tile = this._tileAt(e.offsetX, e.offsetY);
      if (tile) this.controller.walkTo(tile);
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._zoom = Math.min(Math.max(this._zoom + (e.deltaY < 0 ? 1 : -1), 0), ZOOMS.length - 1);
    }, { passive: false });
  }

  get _scale() {
    return ZOOMS[this._zoom];
  }

  /** Where the map is centred, in tiles (smooth, from the player's view). */
  _centre() {
    const view = this.views.playerView;
    if (view) return { x: view.position.x / TILE_SIZE, y: view.position.z / TILE_SIZE };
    const me = ClientState.me();
    return me ? { x: me.tile.x + 0.5, y: me.tile.y + 0.5 } : { x: 0, y: 0 };
  }

  /** A point in tiles to pixels from the map's centre, turned so the camera's forward is up. */
  _toMap(x, y, centre) {
    const dx = (x - centre.x) * this._scale;
    const dy = (y - centre.y) * this._scale;
    const c = Math.cos(this.rig.yaw);
    const s = Math.sin(this.rig.yaw);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }

  /** The tile under a point on the map (CSS pixels from its top-left), or null outside the circle. */
  _tileAt(px, py) {
    const r = SIZE / 2;
    const mx = px - r;
    const my = py - r;
    if (mx * mx + my * my > r * r) return null;
    const c = Math.cos(this.rig.yaw);
    const s = Math.sin(this.rig.yaw);
    const centre = this._centre();
    const tile = {
      x: Math.floor(centre.x + (mx * c + my * s) / this._scale),
      y: Math.floor(centre.y + (-mx * s + my * c) / this._scale),
    };
    return ClientState.world.inBounds(tile) ? tile : null;
  }

  update() {
    const world = ClientState.world;
    const me = ClientState.me();
    if (!world || !me) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (dpr !== this._dpr) {
      this._dpr = dpr;
      this.canvas.width = this.canvas.height = Math.round(SIZE * dpr);
    }
    // A puzzle opened some terrain: draw the areas again.
    const opened = JSON.stringify(world.opened || []);
    if (opened !== this._openedKey) {
      this._openedKey = opened;
      this._areaImages.clear();
    }
    const area = world.areaAt(me.tile);
    const caption = area ? area.name : '';
    if (this._caption.textContent !== caption) this._caption.textContent = caption;
    this._needle.style.transform = `rotate(${this.rig.yaw}rad)`;

    const g = this.canvas.getContext('2d');
    const r = SIZE / 2;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, SIZE, SIZE);
    g.save();
    g.beginPath();
    g.arc(r, r, r, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = VOID;
    g.fillRect(0, 0, SIZE, SIZE);

    const centre = this._centre();
    if (area) {
      g.save();
      g.translate(r, r);
      g.rotate(this.rig.yaw);
      g.scale(this._scale, this._scale);
      g.translate(-centre.x, -centre.y);
      g.imageSmoothingEnabled = false;
      g.drawImage(this._areaImage(world, area), area.offset.x, area.offset.y);
      g.restore();
    }

    const dot = (x, y, colour, size = 3) => {
      const p = this._toMap(x, y, centre);
      if (p.x * p.x + p.y * p.y > (r + size) * (r + size)) return;
      g.fillStyle = colour;
      g.beginPath();
      g.arc(r + p.x, r + p.y, size, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      g.lineWidth = 1;
      g.stroke();
    };
    const here = (tile) => world.areaAt(tile) === area;
    for (const station of world.stations.values()) {
      if (here(station.tile)) dot(station.tile.x + 0.5, station.tile.y + 0.5, DOT.station, 2.5);
    }
    for (const ground of world.ground_items.values()) {
      if (here(ground.tile)) dot(ground.tile.x + 0.5, ground.tile.y + 0.5, DOT.item, 2);
    }
    for (const entity of world.entities.values()) {
      if (entity.id === me.id || entity.riding || (entity.isNpc() && entity.isDead()) || !here(entity.tile)) continue;
      const view = this.views.entities.get(entity.id);
      const x = view ? view.position.x / TILE_SIZE : entity.tile.x + entity.size / 2;
      const y = view ? view.position.z / TILE_SIZE : entity.tile.y + entity.size / 2;
      dot(x, y, entity.isNpc() ? DOT.npc : DOT.player, entity.size > 1 ? 3 + entity.size : 3);
    }
    // You: a white square in the middle.
    g.fillStyle = DOT.player;
    g.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    g.fillRect(r - 2.5, r - 2.5, 5, 5);
    g.strokeRect(r - 2.5, r - 2.5, 5, 5);
    g.restore();
  }

  /** The area's tiles, one pixel each: ground by colour and height, terrain and solid props over it. */
  _areaImage(world, area) {
    let image = this._areaImages.get(area.index);
    if (image) return image;
    image = document.createElement('canvas');
    image.width = area.size.x;
    image.height = area.size.y;
    const g = image.getContext('2d');
    const solidDecor = new Map();
    for (const d of world.decor) {
      if (d.def.blocks_movement) solidDecor.set(`${d.tile.x},${d.tile.y}`, d.def);
    }
    for (let y = 0; y < area.size.y; y++) {
      for (let x = 0; x < area.size.x; x++) {
        const tile = { x: area.offset.x + x, y: area.offset.y + y };
        g.fillStyle = tileColour(world, tile, solidDecor);
        g.fillRect(x, y, 1, 1);
      }
    }
    this._areaImages.set(area.index, image);
    return image;
  }
}

function tileColour(world, tile, solidDecor) {
  const terrain = world.terrainAt(tile);
  if (terrain) return cssColor(lightened(terrain.color, 0.25));
  const decor = solidDecor.get(`${tile.x},${tile.y}`);
  if (decor && decor.color) return cssColor(darkened(decor.color, 0.2));
  const ground = world.groundAt(tile);
  const height = world.heightAt(tile);
  let rgb = lightened(ground ? ground.color : DEFAULT_GROUND, Math.min(Math.max(height, 0) * HEIGHT_LIGHTEN, 0.5));
  // Cliffs: darken the top edge, so the drop shows.
  const cliff = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
    const n = { x: tile.x + dx, y: tile.y + dy };
    return world.areaAt(n) && height - world.heightAt(n) >= 1;
  });
  if (cliff) rgb = darkened(rgb, 0.35);
  return cssColor(rgb);
}
