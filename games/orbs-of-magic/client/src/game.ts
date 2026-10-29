import type { Room } from 'colyseus.js';
import { COLOR_INFO, cardDef } from '../../shared/cards';
import { DECKS } from '../../shared/decks';
import { Game, MAX_SPELL_MANA } from '../../shared/engine';
import { inEnemyTerritory, key, same, type Hex } from '../../shared/hex';
import type { Action, GameEvent, GameState, Target, Unit } from '../../shared/types';
import { isMuted, sfx, toggleMute } from './audio';
import { cardBackHTML, cardHTML, esc, keywordHelp } from './cardview';
import type { BoardScene, HL } from './scene';

type Mode =
  | { kind: 'idle' }
  | { kind: 'card'; iid: number; targets: Target[] }
  | { kind: 'unit'; uid: number; moveTo?: Hex };

interface StateMsg { view: GameState; events: GameEvent[]; seat: number; deadline: number; names: string[]; connected: boolean[] }

const $ = <T extends HTMLElement = HTMLElement>(root: HTMLElement, sel: string) => root.querySelector(sel) as T;

export class GameController {
  root: HTMLElement;
  seat = 0;
  view: GameState | null = null;
  queue: StateMsg[] = [];
  animating = false;
  mode: Mode = { kind: 'idle' };
  deadline = 0;
  connected = [true, true];
  emotes: string[] = [];
  vsAI = false;
  roomId = '';
  hoverHex: Hex | null = null;
  hoverSanctum: number | null = null;
  mulliganPick = new Set<number>();
  timerInt: ReturnType<typeof setInterval>;
  disposed = false;
  rematchSent = false;

  constructor(public room: Room, public scene: BoardScene, ui: HTMLElement, public onExit: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'game';
    ui.innerHTML = '';
    ui.appendChild(this.root);
    this.root.innerHTML = `
      <div class="pinfo opp"></div>
      <div class="opp-hand"></div>
      <div class="round-info"></div>
      <div class="corner-btns">
        <button class="icon-btn btn-log" title="Battle log">📜</button>
        <button class="icon-btn btn-mute" title="Sound">${isMuted() ? '🔇' : '🔊'}</button>
        <button class="icon-btn btn-help" title="How to play">❔</button>
        <button class="icon-btn btn-menu" title="Concede / leave">🏳️</button>
      </div>
      <div class="prompt hidden"><span class="prompt-text"></span><button class="btn small btn-skip hidden">Skip</button><button class="btn small ghost btn-cancel">Cancel</button></div>
      <div class="banner"></div>
      <div class="cast-show"></div>
      <div class="pass-wrap"><svg class="timer" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"></circle></svg><button class="pass-btn"></button><div class="timer-num"></div></div>
      <div class="pinfo me"></div>
      <div class="hand"></div>
      <div class="hover-card"></div>
      <div class="forecast hidden"></div>
      <div class="log hidden"></div>
      <div class="emote-wrap"><button class="icon-btn btn-emote" title="Emotes">💬</button><div class="emote-list hidden"></div></div>
      <div class="bubble opp-bubble hidden"></div>
      <div class="bubble me-bubble hidden"></div>
      <div class="toast"></div>
      <div class="overlay hidden"></div>
      <div class="help-modal hidden"></div>`;
    this.bindDOM();
    this.bindRoom();
    this.bindScene();
    this.timerInt = setInterval(() => this.renderTimer(), 250);
    this.showOverlay(`<div class="panel waiting"><h2>Connecting…</h2></div>`);
  }

  // ───────────── setup ─────────────
  private bindDOM() {
    const r = this.root;
    $(r, '.pass-btn').onclick = () => this.pass();
    $(r, '.btn-cancel').onclick = () => { this.setMode({ kind: 'idle' }); sfx.click(); };
    $(r, '.btn-skip').onclick = () => this.pickTarget(null);
    $(r, '.btn-log').onclick = () => $(r, '.log').classList.toggle('hidden');
    $(r, '.btn-mute').onclick = (e) => { (e.target as HTMLElement).textContent = toggleMute() ? '🔇' : '🔊'; };
    $(r, '.btn-help').onclick = () => this.toggleHelp();
    $(r, '.btn-menu').onclick = () => this.confirmLeave();
    $(r, '.btn-emote').onclick = () => $(r, '.emote-list').classList.toggle('hidden');
    this.keyHandler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); this.pass(); }
      if (e.code === 'Escape') this.setMode({ kind: 'idle' });
    };
    window.addEventListener('keydown', this.keyHandler);
  }
  private keyHandler: (e: KeyboardEvent) => void = () => {};

  private bindRoom() {
    const room = this.room;
    room.onMessage('seat', (m: { seat: number; roomId: string; vsAI: boolean; emotes: string[] }) => {
      this.seat = m.seat; this.vsAI = m.vsAI; this.roomId = m.roomId; this.emotes = m.emotes;
      this.scene.setSeat(m.seat);
      $(this.root, '.emote-list').innerHTML = m.emotes.map((t, i) => `<button data-i="${i}">${esc(t)}</button>`).join('');
      $(this.root, '.emote-list').querySelectorAll('button').forEach((b) => (b.onclick = () => {
        room.send('emote', Number(b.dataset.i)); $(this.root, '.emote-list').classList.add('hidden');
      }));
    });
    room.onMessage('waiting', (m: { roomId: string }) => {
      this.showOverlay(`<div class="panel waiting">
        <div class="spinner"></div>
        <h2>Waiting for an opponent…</h2>
        <p>Share this match code with a friend:</p>
        <div class="code" title="Click to copy">${esc(m.roomId)}</div>
        <p class="dim">Or keep waiting for someone to join from Quick Match.</p>
        <button class="btn ghost btn-leave">Cancel</button></div>`);
      const code = this.root.querySelector('.code') as HTMLElement;
      code.onclick = () => { navigator.clipboard?.writeText(m.roomId); this.toast('Code copied!'); };
      (this.root.querySelector('.btn-leave') as HTMLElement).onclick = () => this.exit();
    });
    room.onMessage('state', (m: StateMsg) => { this.queue.push(m); this.pump(); });
    room.onMessage('deadline', (d: number) => { this.deadline = d; });
    room.onMessage('error', (e: string) => { sfx.error(); this.toast(e); });
    room.onMessage('emote', (m: { seat: number; text: string }) => this.showEmote(m.seat, m.text));
    room.onMessage('opponentStatus', (m: { seat: number; connected: boolean }) => {
      if (m.seat !== this.seat) this.toast(m.connected ? 'Opponent reconnected.' : 'Opponent disconnected… waiting up to 60s.');
    });
    room.onMessage('opponentLeft', () => this.toast('Your opponent left the room.'));
    room.onMessage('rematchStatus', (r: boolean[]) => {
      const el = this.root.querySelector('.rematch-status');
      if (el) el.textContent = r[1 - this.seat] ? 'Opponent wants a rematch!' : r[this.seat] ? 'Waiting for opponent…' : '';
    });
    room.onLeave(() => { if (!this.disposed) { this.toast('Disconnected from server.'); } });
  }

  private bindScene() {
    const s = this.scene;
    s.setMenuMode(false);
    s.onHexClick = (h) => this.hexClick(h);
    s.onHexHover = (h) => { this.hoverHex = h; this.updateHover(); this.updateHighlights(); };
    s.onSanctumClick = (p) => this.sanctumClick(p);
    s.onSanctumHover = (p) => { this.hoverSanctum = p; this.updateHover(); };
    s.onRightClick = () => { if (this.mode.kind !== 'idle') { this.setMode({ kind: 'idle' }); sfx.click(); } };
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.timerInt);
    window.removeEventListener('keydown', this.keyHandler);
    this.scene.onHexClick = () => {}; this.scene.onHexHover = () => {};
    this.scene.onSanctumClick = () => {}; this.scene.onSanctumHover = () => {};
    this.scene.setMenuMode(true);
  }

  exit() {
    this.dispose();
    try { sessionStorage.removeItem('oom-reconnect'); } catch { /* ignore */ }
    this.room.leave(true).catch(() => {});
    this.onExit();
  }

  // ───────────── helpers ─────────────
  get g(): Game { return new Game(this.view!); }
  get me() { return this.view!.players[this.seat]; }
  get opp() { return this.view!.players[1 - this.seat]; }
  get myTurn() { return !!this.view && this.view.phase === 'action' && this.view.turn === this.seat && !this.animating; }

  private canActUnit = (u: Unit) => !!this.view && u.owner === this.seat && this.g.canAct(u);

  // ───────────── state flow ─────────────
  private async pump() {
    if (this.animating) return;
    while (this.queue.length) {
      const msg = this.queue.shift()!;
      const first = !this.view;
      this.seat = msg.seat;
      this.deadline = msg.deadline;
      this.connected = msg.connected;
      if (first) { this.scene.setSeat(msg.seat); this.hideOverlay(); }
      const prevTurn = this.view?.turn;
      const prevPhase = this.view?.phase;
      if (this.view && msg.events.length && !first) {
        this.animating = true;
        this.setMode({ kind: 'idle' }, false);
        this.render();
        for (const e of msg.events) {
          if (this.disposed) return;
          await this.beforeEvent(e, msg.view);
          await this.scene.play(e, msg.view, this.seat);
        }
        this.animating = false;
      }
      if (msg.events.some((e) => e.t === 'fx' && e.kind === 'start')) {
        this.rematchSent = false;
        this.hideOverlay();
        this.scene.setMenuMode(true); this.scene.setMenuMode(false);
      }
      this.view = msg.view;
      this.scene.sync(this.view, this.seat, this.myTurn, this.canActUnit);
      if (this.mode.kind !== 'idle') this.setMode({ kind: 'idle' }, false);
      this.render();
      if (this.view.phase === 'action' && this.view.turn === this.seat && (prevTurn !== this.seat || prevPhase !== 'action') && !first) sfx.yourTurn();
      if (first && this.view.phase === 'action') this.banner(`Round ${this.view.round}`, this.view.initiative === this.seat ? 'You have the initiative' : 'Opponent has the initiative');
      try { sessionStorage.setItem('oom-reconnect', this.room.reconnectionToken); } catch { /* ignore */ }
    }
  }

  private async beforeEvent(e: GameEvent, next: GameState) {
    switch (e.t) {
      case 'round':
        sfx.round();
        this.banner(`Round ${e.round}`, e.initiative === this.seat ? 'You have the initiative' : 'Opponent has the initiative');
        await this.scene.wait(900);
        break;
      case 'play': {
        sfx.play();
        const d = cardDef(e.cardId);
        if (e.p !== this.seat) {
          this.castShow(e.cardId, 'Opponent played');
          await this.scene.wait(d.type === 'unit' ? 900 : 1300);
        } else if (d.type !== 'unit') {
          this.castShow(e.cardId, 'You cast');
          await this.scene.wait(450);
        }
        break;
      }
      case 'pass':
        sfx.pass();
        if (e.p !== this.seat) this.toast(next.phase === 'action' && next.round === this.view!.round ? 'Opponent passed. Your move: act, or pass to end the round.' : 'Opponent passed.');
        break;
      case 'draw':
        if (e.burned) this.toast(`${e.p === this.seat ? 'Your' : "Opponent's"} hand is full! ${cardDef(e.burned).name} was burned.`);
        break;
      case 'gameOver':
        await this.scene.wait(500);
        break;
      default:
    }
  }

  // ───────────── input ─────────────
  private pass() {
    if (!this.myTurn) return;
    this.send({ type: 'pass' });
  }

  private send(a: Action) {
    this.setMode({ kind: 'idle' }, false);
    this.room.send('action', a);
    sfx.click();
  }

  private setMode(m: Mode, render = true) {
    this.mode = m;
    if (render) { this.render(); }
    this.updateHighlights();
    this.updatePrompt();
  }

  private clickCard(iid: number) {
    if (!this.view) return;
    if (this.view.phase === 'mulligan') return;
    if (this.mode.kind === 'card' && this.mode.iid === iid) {
      // second click on a no-target card casts it
      const ci = this.me.hand.find((c) => c.iid === iid)!;
      if (this.g.specs(cardDef(ci.cardId)).length === 0) { this.send({ type: 'play', iid, targets: [] }); return; }
      this.setMode({ kind: 'idle' });
      return;
    }
    if (!this.myTurn) { this.toast("Wait for your action."); sfx.error(); return; }
    const ci = this.me.hand.find((c) => c.iid === iid);
    if (!ci) return;
    if (!this.g.playable(this.seat, ci)) {
      sfx.error();
      this.toast(!this.g.canAfford(this.seat, ci) ? 'Not enough mana.' : 'No valid targets.');
      return;
    }
    sfx.select();
    this.setMode({ kind: 'card', iid, targets: [] });
  }

  private currentSpec() {
    if (this.mode.kind !== 'card') return null;
    const ci = this.me.hand.find((c) => c.iid === (this.mode as { iid: number }).iid);
    if (!ci) return null;
    const d = cardDef(ci.cardId);
    const specs = this.g.specs(d);
    const i = this.mode.targets.length;
    return { d, specs, i, spec: specs[i], cands: i < specs.length ? this.g.candidates(this.seat, d, this.mode.targets, i) : [] };
  }

  private pickTarget(t: Target) {
    if (this.mode.kind !== 'card') return;
    const cs = this.currentSpec();
    if (!cs) return;
    const targets = [...this.mode.targets, t];
    sfx.select();
    if (targets.length >= cs.specs.length) { this.send({ type: 'play', iid: this.mode.iid, targets }); return; }
    // auto-skip optional targets with no candidates
    const nextCands = this.g.candidates(this.seat, cs.d, targets, targets.length);
    if (nextCands.length === 0 && cs.specs[targets.length].optional) {
      const rest = [...targets];
      while (rest.length < cs.specs.length && cs.specs[rest.length].optional && this.g.candidates(this.seat, cs.d, rest, rest.length).length === 0) rest.push(null);
      if (rest.length >= cs.specs.length) { this.send({ type: 'play', iid: this.mode.iid, targets: rest }); return; }
      this.setMode({ kind: 'card', iid: this.mode.iid, targets: rest });
      return;
    }
    this.setMode({ kind: 'card', iid: this.mode.iid, targets });
  }

  private hexClick(h: Hex) {
    if (!this.view || this.view.phase !== 'action') return;
    const g = this.g;
    const at = g.unitAt(h);
    if (this.mode.kind === 'card') {
      const cs = this.currentSpec();
      if (!cs) return;
      const match = cs.cands.find((c) => (c && 'uid' in c ? at && c.uid === at.uid : c && 'c' in c && same(c, h)));
      if (match) this.pickTarget(match);
      else { sfx.error(); }
      return;
    }
    if (!this.myTurn) return;
    if (this.mode.kind === 'unit') {
      const u = g.unit(this.mode.uid);
      if (!u) { this.setMode({ kind: 'idle' }); return; }
      const from = this.mode.moveTo ?? { c: u.c, r: u.r };
      const reach = g.reachable(u);
      if (at && at.owner !== this.seat) {
        if (g.attackTargets(u, from).some((t) => 'uid' in t && t.uid === at.uid)) {
          this.send({ type: 'order', uid: u.uid, to: this.mode.moveTo, attack: { uid: at.uid } });
          return;
        }
        // Move somewhere we can attack from, preferring the shortest walk.
        let best: Hex | null = null; let bestLen = 99;
        for (const [, path] of reach) {
          const dst = path[path.length - 1];
          if (g.attackTargets(u, dst).some((t) => 'uid' in t && t.uid === at.uid) && path.length < bestLen) { best = dst; bestLen = path.length; }
        }
        if (best) { this.send({ type: 'order', uid: u.uid, to: best, attack: { uid: at.uid } }); return; }
        sfx.error(); this.toast("Can't reach that unit this action.");
        return;
      }
      if (at && at.uid === u.uid) {
        if (this.mode.moveTo) this.setMode({ kind: 'unit', uid: u.uid });
        else this.setMode({ kind: 'idle' });
        return;
      }
      if (at && at.owner === this.seat) {
        if (g.canAct(at)) { sfx.select(); this.setMode({ kind: 'unit', uid: at.uid }); } else this.setMode({ kind: 'idle' });
        return;
      }
      if (reach.has(key(h))) {
        if (this.mode.moveTo && same(this.mode.moveTo, h)) { this.send({ type: 'order', uid: u.uid, to: h }); return; }
        if (g.attackTargets(u, h).length === 0) { this.send({ type: 'order', uid: u.uid, to: h }); return; }
        sfx.select();
        this.setMode({ kind: 'unit', uid: u.uid, moveTo: h });
        return;
      }
      this.setMode({ kind: 'idle' });
      return;
    }
    // idle
    if (at && at.owner === this.seat) {
      if (g.canAct(at)) { sfx.select(); this.setMode({ kind: 'unit', uid: at.uid }); }
      else {
        sfx.error();
        this.toast(at.frozen ? 'That unit is frozen.' : at.exhausted ? 'That unit has already acted this round.' : 'Units can\'t act the round they are summoned (unless Swift).');
      }
    }
  }

  private sanctumClick(p: number) {
    if (!this.myTurn || this.mode.kind !== 'unit' || p === this.seat) return;
    const g = this.g;
    const u = g.unit(this.mode.uid);
    if (!u) return;
    const from = this.mode.moveTo ?? { c: u.c, r: u.r };
    if (g.attackTargets(u, from).some((t) => 'sanctum' in t)) { this.send({ type: 'order', uid: u.uid, to: this.mode.moveTo, attack: { sanctum: p } }); return; }
    for (const [, path] of g.reachable(u)) {
      const dst = path[path.length - 1];
      if (inEnemyTerritory(this.seat, dst)) { this.send({ type: 'order', uid: u.uid, to: dst, attack: { sanctum: p } }); return; }
    }
    sfx.error();
    this.toast('Units must stand in enemy territory (their two red back rows) to attack their Sanctum.');
  }

  // ───────────── highlights / hover ─────────────
  private updateHighlights() {
    if (!this.view) return;
    const map = new Map<string, HL>();
    let sanctum: number | null = null;
    const g = this.g;
    if (this.mode.kind === 'card') {
      const cs = this.currentSpec();
      if (cs) for (const c of cs.cands) {
        if (c && 'uid' in c) { const u = g.unit(c.uid)!; map.set(key(u), u.owner === this.seat ? 'friendly' : 'enemy'); }
        else if (c && 'c' in c) map.set(key(c), 'deploy');
      }
    } else if (this.mode.kind === 'unit') {
      const u = g.unit(this.mode.uid);
      if (u) {
        const reach = g.reachable(u);
        for (const k of reach.keys()) map.set(k, 'move');
        if (!this.mode.moveTo) {
          for (const [, path] of reach) for (const t of g.attackTargets(u, path[path.length - 1])) {
            if ('uid' in t) { const e = g.unit(t.uid)!; map.set(key(e), 'attackFar'); } else sanctum = t.sanctum;
          }
        }
        const from = this.mode.moveTo ?? { c: u.c, r: u.r };
        for (const t of g.attackTargets(u, from)) {
          if ('uid' in t) map.set(key(g.unit(t.uid)!), 'attack'); else sanctum = t.sanctum;
        }
        map.set(key(u), 'selected');
        if (this.mode.moveTo) map.set(key(this.mode.moveTo), 'dest');
      }
    }
    this.scene.setHighlights(map, sanctum);
  }

  private updateHover() {
    const hc = $(this.root, '.hover-card');
    const fc = $(this.root, '.forecast');
    fc.classList.add('hidden');
    if (!this.view) return;
    const g = this.g;
    if (this.hoverSanctum !== null) {
      const p = this.view.players[this.hoverSanctum];
      hc.innerHTML = `<div class="sanctum-card ${this.hoverSanctum === this.seat ? 'mine' : 'theirs'}"><h3>${esc(p.name)}'s Sanctum</h3><div class="big">${p.sanctum} / 20</div><p>If it reaches 0, ${this.hoverSanctum === this.seat ? 'you lose' : 'you win'}. Units standing in ${this.hoverSanctum === this.seat ? 'your' : 'the enemy'} territory (the two back rows) can attack it.</p></div>`;
      hc.classList.add('show');
      this.showForecast(null);
      return;
    }
    const u = this.hoverHex ? g.unitAt(this.hoverHex) : undefined;
    if (u) {
      const d = cardDef(u.cardId);
      const status: string[] = [];
      if (u.frozen) status.push('❄️ Frozen: skips its next order');
      if (g.isRooted(u)) status.push("🕸️ Rooted: can't move");
      if (u.exhausted) status.push('💤 Already acted this round');
      else if (u.summonedRound === this.view.round && !u.kw.includes('swift')) status.push('🌀 Summoned this round');
      if (u.tempAtk) status.push(`🔥 +${u.tempAtk} power this round`);
      hc.innerHTML = cardHTML(d, { unit: u, extraClass: 'big' }) + `<div class="unit-status">${u.owner === this.seat ? '<b class="mine">Your unit</b>' : '<b class="theirs">Enemy unit</b>'}${status.map((s) => `<div>${s}</div>`).join('')}</div>${keywordHelp(u.kw)}`;
      hc.classList.add('show');
    } else if (this.hoverHex && this.view && [1, 4, 7].includes(this.hoverHex.c) && this.hoverHex.r === 3) {
      hc.innerHTML = `<div class="sanctum-card"><h3>🔮 Ley Orb</h3><p>At the start of each round, a unit standing here gives its owner <b>+1 mana</b> for that round and deals <b>1 damage</b> to the enemy Sanctum.</p></div>`;
      hc.classList.add('show');
    } else hc.classList.remove('show');
    this.showForecast(u ?? null);
  }

  /** Predict what an attack would do by simulating it. */
  private showForecast(target: Unit | null) {
    const fc = $(this.root, '.forecast');
    if (this.mode.kind !== 'unit' || !this.myTurn) return;
    const g = this.g;
    const u = g.unit(this.mode.uid);
    if (!u) return;
    let action: Action | null = null;
    const from = this.mode.moveTo ?? { c: u.c, r: u.r };
    if (target && target.owner !== this.seat) {
      if (g.attackTargets(u, from).some((t) => 'uid' in t && t.uid === target.uid)) action = { type: 'order', uid: u.uid, to: this.mode.moveTo, attack: { uid: target.uid } };
      else for (const [, path] of g.reachable(u)) {
        const dst = path[path.length - 1];
        if (g.attackTargets(u, dst).some((t) => 'uid' in t && t.uid === target.uid)) { action = { type: 'order', uid: u.uid, to: dst, attack: { uid: target.uid } }; break; }
      }
    } else if (this.hoverSanctum !== null && this.hoverSanctum !== this.seat) {
      if (g.attackTargets(u, from).some((t) => 'sanctum' in t)) action = { type: 'order', uid: u.uid, to: this.mode.moveTo, attack: { sanctum: 1 - this.seat } };
    }
    if (!action) return;
    const sim = g.clone();
    const res = sim.act(this.seat, action);
    if (!res.ok) return;
    const a2 = sim.unit(u.uid);
    let html = '';
    if (target && action.type === 'order' && action.attack && 'uid' in action.attack) {
      const t2 = sim.unit(target.uid);
      html = `<div>⚔️ ${esc(cardDef(u.cardId).name)} ${a2 ? `<b>${a2.hp}</b> hp left` : '<b class="dies">dies</b>'}</div>
              <div>🎯 ${esc(cardDef(target.cardId).name)} ${t2 ? `<b>${t2.hp}</b> hp left` : '<b class="dies">dies</b>'}</div>`;
    } else {
      html = `<div>🏰 Sanctum takes <b>${this.opp.sanctum - sim.s.players[1 - this.seat].sanctum}</b> damage</div>`;
    }
    fc.innerHTML = html;
    fc.classList.remove('hidden');
  }

  // ───────────── rendering ─────────────
  private render() {
    if (!this.view) return;
    const v = this.view;
    this.renderPlayer($(this.root, '.pinfo.me'), this.seat);
    this.renderPlayer($(this.root, '.pinfo.opp'), 1 - this.seat);
    $(this.root, '.opp-hand').innerHTML = this.opp.hand.map(() => cardBackHTML()).join('');
    const ri = $(this.root, '.round-info');
    ri.innerHTML = v.phase === 'mulligan' ? '<b>Mulligan</b>' : `<b>Round ${v.round}</b><span class="init ${v.initiative === this.seat ? 'mine' : 'theirs'}" title="The player with the initiative acts first this round">⚜ ${v.initiative === this.seat ? 'Your' : "Opponent's"} initiative</span>`;
    this.renderHand();
    this.renderPass();
    this.renderLog();
    this.updatePrompt();
    if (v.phase === 'mulligan') this.renderMulligan();
    else if (v.phase === 'over') this.renderGameOver();
    else if (this.root.querySelector('.overlay .mulligan')) this.hideOverlay();
    this.scene.myTurn = this.myTurn;
    for (const u of v.units) { const vis = this.scene.units.get(u.uid); if (vis) vis.canActNow = this.canActUnit(u); }
  }

  private renderPlayer(el: HTMLElement, p: number) {
    const pl = this.view!.players[p];
    const deck = DECKS.find((d) => d.id === pl.deckId)!;
    const mine = p === this.seat;
    const extra = Math.max(0, pl.mana - pl.maxMana);
    let gems = '';
    for (let i = 0; i < pl.maxMana; i++) gems += `<i class="gem ${i < pl.mana ? 'full' : ''}"></i>`;
    for (let i = 0; i < extra; i++) gems += `<i class="gem full bonus" title="Ley Orb bonus mana"></i>`;
    let spell = '';
    for (let i = 0; i < MAX_SPELL_MANA; i++) spell += `<i class="sgem ${i < pl.spellMana ? 'full' : ''}"></i>`;
    const active = this.view!.phase === 'action' && this.view!.turn === p;
    const hpPct = Math.max(0, pl.sanctum) / 20 * 100;
    el.classList.toggle('active', active);
    el.innerHTML = `
      <div class="avatar" style="background:${deck.colors.map((c, i) => `radial-gradient(circle at ${i ? '70% 70%' : '30% 30%'}, ${COLOR_INFO[c].hex}, transparent 70%)`).join(',')}">${cardDef(deck.signature).icon}</div>
      <div class="pdata">
        <div class="pname">${esc(pl.name)} ${!this.connected[p] ? '<span class="dc">disconnected</span>' : ''}${this.view!.passes === 1 && this.view!.turn !== p && this.view!.phase === 'action' ? '<span class="passed">passed</span>' : ''}</div>
        <div class="hpbar"><div class="fill ${mine ? 'mine' : 'theirs'}" style="width:${hpPct}%"></div><span>🔮 ${pl.sanctum}</span></div>
        <div class="mana" title="Mana ${pl.mana}/${pl.maxMana}">${gems}<span class="mana-num">${pl.mana}/${pl.maxMana}</span></div>
        <div class="spellmana" title="Spell mana: unspent mana carried over (spells and orders only)">${spell}</div>
        <div class="counts"><span title="Cards in hand">🂠 ${pl.hand.length}</span><span title="Cards in deck">📚 ${pl.deck.length}</span><span title="Deck">${esc(deck.name)}</span></div>
      </div>`;
  }

  private renderHand() {
    const el = $(this.root, '.hand');
    const hand = this.me.hand;
    const g = this.g;
    const n = hand.length;
    el.innerHTML = hand.map((ci, i) => {
      const d = cardDef(ci.cardId);
      const playable = this.myTurn && g.playable(this.seat, ci);
      const selected = this.mode.kind === 'card' && this.mode.iid === ci.iid;
      const mid = (n - 1) / 2;
      const rot = (i - mid) * Math.min(5, 30 / n);
      const lift = Math.abs(i - mid) * Math.abs(i - mid) * 3;
      return `<div class="hand-slot ${playable ? 'playable' : ''} ${selected ? 'selected' : ''}" style="--rot:${rot}deg; --lift:${lift}px; --i:${i}" data-iid="${ci.iid}">
        ${cardHTML(d, { cost: g.cost(this.seat, ci) })}</div>`;
    }).join('');
    el.querySelectorAll<HTMLElement>('.hand-slot').forEach((s) => {
      s.onclick = (e) => { e.stopPropagation(); this.clickCard(Number(s.dataset.iid)); };
      s.onmouseenter = () => sfx.hover();
    });
  }

  private renderPass() {
    const b = $<HTMLButtonElement>(this.root, '.pass-btn');
    const v = this.view!;
    const wrap = $(this.root, '.pass-wrap');
    wrap.classList.toggle('hidden', v.phase !== 'action');
    if (v.turn === this.seat && v.phase === 'action') {
      const endsRound = v.passes === 1;
      b.innerHTML = endsRound ? 'End<br>Round' : 'Pass';
      b.className = `pass-btn ready ${endsRound ? 'end' : ''}`;
      b.disabled = this.animating;
    } else {
      b.innerHTML = '<span class="small">Opponent\'s<br>action</span>';
      b.className = 'pass-btn waiting';
      b.disabled = true;
    }
  }

  private renderTimer() {
    if (!this.view || this.view.phase === 'over' || !this.deadline) { $(this.root, '.timer-num').textContent = ''; return; }
    const left = Math.max(0, (this.deadline - Date.now()) / 1000);
    const total = this.view.phase === 'mulligan' ? 45 : 75;
    const c = this.root.querySelector('.timer circle') as SVGCircleElement;
    const len = 2 * Math.PI * 46;
    c.style.strokeDasharray = `${len}`;
    c.style.strokeDashoffset = `${len * (1 - left / total)}`;
    c.classList.toggle('urgent', left < 15);
    $(this.root, '.timer-num').textContent = left < 20 && this.view.phase === 'action' ? `${Math.ceil(left)}` : '';
    if (this.view.phase === 'mulligan') { const t = this.root.querySelector('.mull-timer'); if (t) t.textContent = `${Math.ceil(left)}s`; }
  }

  private renderLog() {
    const el = $(this.root, '.log');
    el.innerHTML = `<h4>Battle Log</h4>` + this.view!.log.slice(-40).reverse().map((l) =>
      `<div class="${l.p === this.seat ? 'mine' : l.p === -1 ? 'sys' : 'theirs'}">${esc(l.text)}</div>`).join('');
  }

  private updatePrompt() {
    const el = $(this.root, '.prompt');
    const skip = $(this.root, '.btn-skip');
    if (!this.view) return;
    if (this.mode.kind === 'card') {
      const cs = this.currentSpec();
      if (!cs) { el.classList.add('hidden'); return; }
      const text = cs.specs.length === 0 ? `Click <b>${esc(cs.d.name)}</b> again to cast it` : `<b>${esc(cs.d.name)}</b>: ${esc(cs.spec.prompt)}`;
      $(el, '.prompt-text').innerHTML = text;
      skip.classList.toggle('hidden', !(cs.spec && cs.spec.optional));
      el.classList.remove('hidden');
    } else if (this.mode.kind === 'unit') {
      const u = this.g.unit(this.mode.uid);
      $(el, '.prompt-text').innerHTML = u ? `<b>${esc(cardDef(u.cardId).name)}</b>: ${this.mode.moveTo ? 'Click a red target to attack, or the glowing hex again to just move' : 'Click a blue hex to move, or a red target to attack'}` : '';
      skip.classList.add('hidden');
      el.classList.remove('hidden');
    } else el.classList.add('hidden');
  }

  private renderMulligan() {
    if (this.me.mulliganDone) {
      this.showOverlay(`<div class="panel mulligan"><div class="spinner"></div><h2>Waiting for your opponent…</h2></div>`);
      return;
    }
    const cards = this.me.hand.map((ci) => `<div class="mull-card ${this.mulliganPick.has(ci.iid) ? 'replace' : ''}" data-iid="${ci.iid}">${cardHTML(cardDef(ci.cardId))}<div class="x">↻ Replace</div></div>`).join('');
    const firstPlayer = this.view!.initiative === this.seat;
    this.showOverlay(`<div class="panel mulligan wide">
      <h2>Your Opening Hand</h2>
      <p>Click any cards you want to replace, then confirm. ${firstPlayer ? '<b>You</b> will have the initiative in round 1.' : 'Your <b>opponent</b> will have the initiative in round 1.'}</p>
      <div class="mull-cards">${cards}</div>
      <button class="btn big btn-keep">${this.mulliganPick.size ? `Replace ${this.mulliganPick.size} card${this.mulliganPick.size > 1 ? 's' : ''}` : 'Keep all'}</button>
      <div class="mull-timer dim"></div></div>`);
    this.root.querySelectorAll<HTMLElement>('.mull-card').forEach((c) => (c.onclick = () => {
      const iid = Number(c.dataset.iid);
      this.mulliganPick.has(iid) ? this.mulliganPick.delete(iid) : this.mulliganPick.add(iid);
      sfx.click();
      this.renderMulligan();
    }));
    (this.root.querySelector('.btn-keep') as HTMLElement).onclick = () => {
      this.room.send('action', { type: 'mulligan', iids: [...this.mulliganPick] });
      this.mulliganPick.clear();
      sfx.select();
    };
  }

  private renderGameOver() {
    const v = this.view!;
    if (this.root.querySelector('.overlay .gameover')) return;
    const win = v.winner === this.seat, draw = v.winner === -1;
    win ? sfx.victory() : draw ? sfx.pass() : sfx.defeat();
    const deckOpts = DECKS.map((d) => `<option value="${d.id}" ${d.id === this.me.deckId ? 'selected' : ''}>${esc(d.name)} (${d.archetype})</option>`).join('');
    this.showOverlay(`<div class="panel gameover ${win ? 'win' : draw ? 'draw' : 'lose'}">
      <div class="go-orb"></div>
      <h1>${win ? 'Victory!' : draw ? 'Draw' : 'Defeat'}</h1>
      <p>${win ? 'The enemy Sanctum shatters into a thousand stars.' : draw ? 'Both Sanctums fall together.' : 'Your Sanctum has fallen.'} The battle lasted ${v.round} round${v.round === 1 ? '' : 's'}.</p>
      <div class="row"><label>Deck for the rematch: <select class="rematch-deck">${deckOpts}</select></label></div>
      <div class="row">
        <button class="btn big btn-rematch">⚔️ Rematch</button>
        <button class="btn ghost btn-home">Main Menu</button>
      </div>
      <div class="rematch-status dim"></div></div>`);
    (this.root.querySelector('.btn-rematch') as HTMLButtonElement).onclick = (e) => {
      const deckId = (this.root.querySelector('.rematch-deck') as HTMLSelectElement).value;
      this.room.send('rematch', { deckId });
      (e.target as HTMLButtonElement).disabled = true;
      (this.root.querySelector('.rematch-status') as HTMLElement).textContent = this.vsAI ? 'Shuffling…' : 'Waiting for opponent…';
    };
    (this.root.querySelector('.btn-home') as HTMLElement).onclick = () => this.exit();
  }

  // ───────────── little UI bits ─────────────
  private showOverlay(html: string) {
    const o = $(this.root, '.overlay');
    o.innerHTML = html;
    o.classList.remove('hidden');
  }
  private hideOverlay() { $(this.root, '.overlay').classList.add('hidden'); $(this.root, '.overlay').innerHTML = ''; }

  toast(text: string) {
    const t = $(this.root, '.toast');
    const el = document.createElement('div');
    el.className = 'toast-item';
    el.textContent = text;
    t.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3200);
  }

  private banner(title: string, sub: string) {
    const b = $(this.root, '.banner');
    b.innerHTML = `<div class="b-title">${esc(title)}</div><div class="b-sub">${esc(sub)}</div>`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }

  private castShow(cardId: string, label: string) {
    const el = $(this.root, '.cast-show');
    el.innerHTML = `<div class="cast-label">${esc(label)}</div>${cardHTML(cardDef(cardId), { extraClass: 'big' })}`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  private showEmote(seat: number, text: string) {
    sfx.emote();
    const el = $(this.root, seat === this.seat ? '.me-bubble' : '.opp-bubble');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout((el as unknown as { _t: number })._t);
    (el as unknown as { _t: number })._t = window.setTimeout(() => el.classList.add('hidden'), 2600);
  }

  private confirmLeave() {
    if (!this.view || this.view.phase === 'over') { this.exit(); return; }
    this.showOverlay(`<div class="panel"><h2>Concede the match?</h2><p>Your opponent will be awarded the victory.</p>
      <div class="row"><button class="btn danger btn-yes">Concede</button><button class="btn ghost btn-no">Keep fighting</button></div></div>`);
    (this.root.querySelector('.btn-yes') as HTMLElement).onclick = () => { this.room.send('action', { type: 'concede' }); this.hideOverlay(); };
    (this.root.querySelector('.btn-no') as HTMLElement).onclick = () => { this.hideOverlay(); this.render(); };
  }

  private toggleHelp() {
    const h = $(this.root, '.help-modal');
    if (!h.classList.contains('hidden')) { h.classList.add('hidden'); return; }
    h.innerHTML = `<div class="panel help">${HELP_HTML}<button class="btn btn-close-help">Got it</button></div>`;
    h.classList.remove('hidden');
    (h.querySelector('.btn-close-help') as HTMLElement).onclick = () => h.classList.add('hidden');
  }
}

export const HELP_HTML = `
<h2>How to Play</h2>
<div class="help-grid">
  <div><h4>🎯 Goal</h4><p>Reduce the enemy <b>Sanctum</b> (the big orb behind their side) from 20 to 0.</p></div>
  <div><h4>🔁 Rounds</h4><p>Each round you gain a mana crystal (up to 10) and draw a card. Players take turns doing <b>one action at a time</b>. The player with the <b>initiative</b> goes first; it swaps every round. The round ends when both players <b>pass in a row</b>, so passing just to see what your opponent does is a real tactic.</p></div>
  <div><h4>🃏 Actions</h4><p><b>Play a card</b>: Units are summoned onto your two back rows. Spells and Orders take effect immediately.<br><b>Order a unit</b>: Move it up to its speed (usually 2 hexes) and/or attack something in range. Each unit can be ordered once per round, starting the round after it is summoned.<br><b>Pass</b>.</p></div>
  <div><h4>⚔️ Combat</h4><p>Attacker and defender damage each other at the same time, unless the defender can't reach back (ranged attacks). Damage stays on units between rounds. Reach <b>enemy territory</b> (their two back rows) to attack their Sanctum directly.</p></div>
  <div><h4>🔮 Ley Orbs</h4><p>Three orbs float over the center row. Each one you stand on at the start of a round gives you <b>+1 mana</b> for that round and deals <b>1 damage</b> to the enemy Sanctum.</p></div>
  <div><h4>💧 Spell mana</h4><p>Up to 3 unspent mana carries over as <b>spell mana</b>, which can only pay for Spells and Orders.</p></div>
</div>
<h4>Keywords</h4>
<div class="kw-grid">
  <div><b>💨 Swift</b> acts the round it's summoned</div><div><b>🛡️ Guardian</b> enemies moving next to it must stop</div>
  <div><b>🪽 Flying</b> moves over units, ignores Guardians</div><div><b>🗡️ First Strike</b> hits first in combat</div>
  <div><b>🩸 Drain</b> damage dealt heals your Sanctum</div><div><b>♻️ Regenerate</b> fully heals each round end</div>
  <div><b>🔰 Barrier</b> blocks the next damage</div><div><b>🏰 Siege</b> double damage to Sanctums</div>
  <div><b>☠️ Deadly</b> destroys any unit it damages</div><div><b>👁️ Infiltrate</b> summon anywhere in your half</div>
  <div><b>❄️ Freeze</b> the unit loses its next order</div><div><b>🕸️ Root</b> the unit can't move</div>
</div>
<h4>Controls</h4>
<p>Click a card, then a highlighted target. Click your unit, then a blue hex to move or a red target to attack (it will walk into range automatically). <b>Space</b> passes, <b>Esc</b> or right-click cancels, mouse wheel zooms. Hover anything for details.</p>`;
