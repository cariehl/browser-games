// A game against the AI that runs entirely in the browser, for builds with no server (GitHub Pages).
// It speaks the same messages as server/DuelRoom.ts, so GameController can't tell the difference.
import { chooseAction } from '../../shared/ai';
import { prebuiltList, type DeckList } from '../../shared/decks';
import { Game, eventsFor, viewFor } from '../../shared/engine';
import { EMOTES, aiDeck, aiDelay, pickDeck } from '../../shared/room';
import type { Action, GameEvent } from '../../shared/types';

/** The parts of a Colyseus room that GameController uses. */
export interface RoomLike {
  readonly roomId: string;
  readonly reconnectionToken: string;
  send(type: string, msg?: unknown): void;
  onMessage(type: string, cb: (msg: any) => void): void;
  onLeave(cb: () => void): void;
  leave(consented?: boolean): Promise<unknown>;
}

export interface LocalOptions { name: string; deckId?: string; customDeck?: DeckList; aiDeckId?: string }

const SEAT = 0, AI = 1;

export class LocalRoom implements RoomLike {
  readonly roomId = 'local';
  readonly reconnectionToken = '';
  private handlers = new Map<string, ((msg: any) => void)[]>();
  private game!: Game;
  private decks: DeckList[];
  private names: string[];
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private opts: LocalOptions) {
    const ai = aiDeck(opts.aiDeckId);
    this.decks = [pickDeck(opts), prebuiltList(ai.id)];
    this.names = [opts.name, `${ai.name} AI`];
    // Like a network round trip: let the caller register its handlers first.
    setTimeout(() => {
      this.emit('seat', { seat: SEAT, roomId: this.roomId, vsAI: true, emotes: EMOTES });
      this.start();
    }, 0);
  }

  onMessage(type: string, cb: (msg: any) => void) {
    const list = this.handlers.get(type) ?? [];
    list.push(cb);
    this.handlers.set(type, list);
  }

  onLeave(_cb: () => void) { /* a local game never disconnects */ }

  leave() {
    this.closed = true;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    return Promise.resolve();
  }

  send(type: string, msg?: unknown) {
    if (this.closed) return;
    if (type === 'action') this.act(SEAT, msg as Action, true);
    else if (type === 'emote') { const text = EMOTES[msg as number]; if (text) this.emit('emote', { seat: SEAT, text }); }
    else if (type === 'rematch') {
      if (this.game.s.phase !== 'over') return;
      const o = msg as { deckId?: string; customDeck?: DeckList } | undefined;
      if (o?.deckId || o?.customDeck) this.decks[SEAT] = pickDeck(o);
      const ai = aiDeck(this.opts.aiDeckId);
      this.decks[AI] = prebuiltList(ai.id); this.names[AI] = `${ai.name} AI`;
      this.start();
    }
  }

  private emit(type: string, msg: unknown) {
    // Copy, so nothing the UI holds shares objects with the live game state.
    const copy = msg === undefined ? msg : structuredClone(msg);
    for (const cb of this.handlers.get(type) ?? []) cb(copy);
  }

  private start() {
    this.game = Game.create(
      { name: this.names[SEAT], deck: this.decks[SEAT], isAI: false },
      { name: this.names[AI], deck: this.decks[AI], isAI: true },
    );
    this.sendState([{ t: 'fx', kind: 'start', at: null }]);
    this.maybeAI();
  }

  private act(seat: number, action: Action, fromPlayer = false) {
    const res = this.game.act(seat, action);
    if (!res.ok) { if (fromPlayer) this.emit('error', res.error); return res; }
    this.sendState(res.events);
    this.maybeAI(res.events.length);
    return res;
  }

  private sendState(events: GameEvent[]) {
    this.emit('state', {
      view: viewFor(this.game.s, SEAT), events: eventsFor(events, SEAT), seat: SEAT, deadline: 0,
      names: this.names, connected: [true, true],
    });
  }

  private maybeAI(eventCount = 0) {
    const g = this.game;
    if (this.closed || g.s.phase === 'over') return;
    if (g.s.phase === 'mulligan') {
      if (!g.s.players[AI].mulliganDone) {
        g.act(AI, chooseAction(g, AI));
        // Only tell the player if this finished the mulligan for both.
        if ((g.s.phase as string) === 'action') this.sendState(g.events);
      }
      return;
    }
    if (g.s.turn !== AI) return;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.aiTimer = setTimeout(() => {
      if (this.closed || this.game !== g || g.s.turn !== AI || g.s.phase !== 'action') return;
      const res = this.act(AI, chooseAction(g, AI));
      if (!res.ok) this.act(AI, { type: 'pass' });
    }, aiDelay(eventCount));
  }
}
