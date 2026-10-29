import { Room, type Client } from '@colyseus/core';
import { chooseAction } from '../shared/ai';
import { DECKS, prebuiltList, validateDeck, type DeckList } from '../shared/decks';
import { Game, eventsFor, viewFor } from '../shared/engine';
import type { Action, GameEvent } from '../shared/types';
import { GameLog } from './gamelog';

/** Seconds a player gets per action before they automatically pass. */
const ACTION_TIME = 75;
const MULLIGAN_TIME = 45;
const EMOTES = ['Well played!', 'Good luck!', 'Hmm...', 'Oops!', 'Wow!', 'Thanks!', 'Not today!', 'Behold!'];

interface Seat { sessionId: string | null; name: string; deck: DeckList; isAI: boolean; connected: boolean; rematch: boolean }

export interface JoinOptions { name?: string; deckId?: string; customDeck?: DeckList; vsAI?: boolean; aiDeckId?: string; private?: boolean }

/** Pick the player's deck: a legal custom list, else the named prebuilt deck. */
function pickDeck(opts: { deckId?: string; customDeck?: DeckList } | undefined): DeckList {
  const c = opts?.customDeck;
  if (c && typeof c.name === 'string' && !validateDeck(c.cards)) return { id: 'custom', name: c.name.slice(0, 30) || 'Custom Deck', cards: c.cards };
  return prebuiltList(opts?.deckId ?? '');
}

export class DuelRoom extends Room {
  maxClients = 2;
  seats: Seat[] = [];
  game: Game | null = null;
  log: GameLog | null = null;
  deadline = 0;
  timer: ReturnType<typeof setTimeout> | null = null;
  aiTimer: ReturnType<typeof setTimeout> | null = null;
  vsAI = false;
  aiDeckChoice: string | undefined;

  onCreate(options: JoinOptions) {
    this.autoDispose = true;
    this.vsAI = !!options.vsAI;
    if (this.vsAI) {
      this.maxClients = 1;
      this.aiDeckChoice = DECKS.some((d) => d.id === options.aiDeckId) ? options.aiDeckId : undefined;
      const deck = DECKS.find((d) => d.id === options.aiDeckId) ?? DECKS[Math.floor(Math.random() * DECKS.length)];
      this.seats[1] = { sessionId: null, name: `${deck.name} AI`, deck: prebuiltList(deck.id), isAI: true, connected: true, rematch: true };
    }
    if (options.private || this.vsAI) this.setPrivate(true);
    this.setMetadata({ host: options.name ?? 'Wizard' });

    this.onMessage('action', (client, action: Action) => this.handleAction(client, action));
    this.onMessage('emote', (client, idx: number) => {
      const seat = this.seatOf(client);
      if (seat < 0 || !EMOTES[idx]) return;
      this.broadcast('emote', { seat, text: EMOTES[idx] });
    });
    this.onMessage('rematch', (client, opts: { deckId?: string; customDeck?: DeckList }) => {
      const seat = this.seatOf(client);
      if (seat < 0 || this.game?.s.phase !== 'over') return;
      this.seats[seat].rematch = true;
      if (opts?.deckId || opts?.customDeck) this.seats[seat].deck = pickDeck(opts);
      if (this.vsAI) {
        const deck = DECKS.find((d) => d.id === this.aiDeckChoice) ?? DECKS[Math.floor(Math.random() * DECKS.length)];
        this.seats[1].deck = prebuiltList(deck.id); this.seats[1].name = `${deck.name} AI`;
      }
      this.broadcast('rematchStatus', this.seats.map((s) => s?.rematch ?? false));
      if (this.seats.every((s) => s && s.rematch)) this.startGame();
    });
  }

  onJoin(client: Client, options: JoinOptions) {
    const name = (options.name ?? 'Wizard').toString().slice(0, 20) || 'Wizard';
    const seatIdx = this.seats[0] && this.seats[0].sessionId !== null ? 1 : 0;
    this.seats[seatIdx] = { sessionId: client.sessionId, name, deck: pickDeck(options), isAI: false, connected: true, rematch: false };
    client.send('seat', { seat: seatIdx, roomId: this.roomId, vsAI: this.vsAI, emotes: EMOTES });
    if (this.seats[0] && this.seats[1]) {
      this.lock();
      this.startGame();
    } else {
      client.send('waiting', { roomId: this.roomId });
    }
  }

  async onLeave(client: Client, consented: boolean) {
    const seat = this.seatOf(client);
    if (seat < 0) return;
    const game = this.game;
    if (!game || game.s.phase === 'over') {
      this.seats[seat].sessionId = null;
      this.broadcast('opponentLeft', { seat });
      return;
    }
    this.seats[seat].connected = false;
    this.broadcast('opponentStatus', { seat, connected: false });
    try {
      if (consented) throw new Error('left');
      await this.allowReconnection(client, 60);
      this.seats[seat].connected = true;
      this.broadcast('opponentStatus', { seat, connected: true });
      this.sendState([]);
    } catch {
      if (this.game && this.game.s.phase !== 'over') {
        this.log?.note(`${this.seats[seat].name} disconnected and did not come back`);
        this.act(seat, { type: 'concede' });
        this.sendState(this.game.events);
      }
      this.seats[seat].sessionId = null;
    }
  }

  onDispose() {
    if (this.timer) clearTimeout(this.timer);
    if (this.aiTimer) clearTimeout(this.aiTimer);
  }

  private seatOf(client: Client) {
    return this.seats.findIndex((s) => s && s.sessionId === client.sessionId);
  }

  private startGame() {
    const [a, b] = this.seats;
    for (const s of this.seats) s.rematch = s.isAI;
    const seed = (Math.random() * 2 ** 31) | 0;
    const players = [a, b].map((s) => ({ name: s.name, deck: s.deck, isAI: s.isAI }));
    this.log = new GameLog(this.roomId, seed, players);
    this.game = Game.create(players[0], players[1], seed);
    console.log(`Game started in room ${this.roomId}: ${a.name} (${a.deck.name}) vs ${b.name} (${b.deck.name}). Log: ${this.log.file}`);
    this.sendState([{ t: 'fx', kind: 'start', at: null }]);
    this.armTimer();
    this.maybeAI();
  }

  private handleAction(client: Client, action: Action) {
    const seat = this.seatOf(client);
    if (seat < 0 || !this.game) return;
    const res = this.act(seat, action);
    if (!res.ok) { client.send('error', res.error); return; }
    this.afterAction(res.events);
  }

  /** Every action goes through here so it is logged, and so a rules-engine crash can't take down the server. */
  private act(seat: number, action: Action) {
    const g = this.game!;
    const round = g.s.round;
    let res: ReturnType<Game['act']>;
    try {
      res = g.act(seat, action);
    } catch (e) {
      console.error(`Rules error in room ${this.roomId}:`, e);
      this.log?.note('rules error', { seat, action, error: String((e as Error)?.stack ?? e) });
      res = { ok: false, error: 'Something went wrong on the server. That action was not applied.' };
    }
    this.log?.action(seat, action, round, res);
    if (g.s.phase === 'over' && this.log) { this.log.end(g.s.winner, g.s.round); this.log = null; }
    return res;
  }

  private afterAction(events: GameEvent[]) {
    this.sendState(events);
    this.armTimer();
    this.maybeAI(events.length);
  }

  private sendState(events: GameEvent[]) {
    const g = this.game;
    if (!g) return;
    for (const client of this.clients) {
      const seat = this.seatOf(client);
      if (seat < 0) continue;
      client.send('state', {
        view: viewFor(g.s, seat), events: eventsFor(events, seat), seat, deadline: this.deadline,
        names: this.seats.map((s) => s.name),
        connected: this.seats.map((s) => s.connected),
      });
    }
  }

  private armTimer() {
    if (this.timer) clearTimeout(this.timer);
    const g = this.game;
    if (!g || g.s.phase === 'over') { this.deadline = 0; return; }
    const secs = g.s.phase === 'mulligan' ? MULLIGAN_TIME : ACTION_TIME;
    this.deadline = Date.now() + secs * 1000;
    this.timer = setTimeout(() => this.onTimeout(), secs * 1000 + 500);
    this.broadcast('deadline', this.deadline);
  }

  private onTimeout() {
    const g = this.game;
    if (!g || g.s.phase === 'over') return;
    if (g.s.phase === 'mulligan') {
      for (let p = 0; p < 2; p++) if (!g.s.players[p].mulliganDone) { this.log?.note(`seat ${p} ran out of mulligan time`); this.act(p, { type: 'mulligan', iids: [] }); }
      this.afterAction(g.events);
      return;
    }
    const p = g.s.turn;
    if (this.seats[p].isAI) return;
    this.log?.note(`seat ${p} ran out of time`);
    this.act(p, { type: 'pass' });
    this.afterAction(g.events);
  }

  /** Let the AI take its action after the client has had time to animate the previous one. */
  private maybeAI(eventCount = 0) {
    const g = this.game;
    if (!g || g.s.phase === 'over') return;
    const aiSeat = this.seats.findIndex((s) => s.isAI);
    if (aiSeat < 0) return;
    if (g.s.phase === 'mulligan') {
      if (!g.s.players[aiSeat].mulliganDone) {
        this.act(aiSeat, chooseAction(g, aiSeat));
        // Only broadcast if this finished the mulligan for both.
        if ((g.s.phase as string) === 'action') this.afterAction(g.events);
      }
      return;
    }
    if (g.s.turn !== aiSeat) return;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    const delay = 700 + Math.min(eventCount, 12) * 220;
    this.aiTimer = setTimeout(() => {
      if (!this.game || this.game.s.turn !== aiSeat || this.game.s.phase !== 'action') return;
      const action = chooseAction(this.game, aiSeat);
      const res = this.act(aiSeat, action);
      if (!res.ok) this.act(aiSeat, { type: 'pass' });
      this.afterAction(this.game.events);
    }, delay);
  }
}
