import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeckList } from '../shared/decks';
import type { Action } from '../shared/types';

/**
 * One JSON object per line in logs/games/<time>-<room>.jsonl: the seed and decks first, then every
 * action in order. The engine is deterministic, so `npm run replay -- <file>` rebuilds the game exactly.
 * OOM_LOG_DIR moves the folder; OOM_NO_LOGS=1 turns logging off.
 */
const DIR = process.env.OOM_LOG_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../logs/games');
const ENABLED = !process.env.OOM_NO_LOGS;
let warned = false;

export interface LogPlayer { name: string; deck: DeckList; isAI: boolean }

export class GameLog {
  readonly file: string;
  private n = 0;

  constructor(roomId: string, seed: number, players: LogPlayer[]) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.file = path.join(DIR, `${stamp}-${roomId}.jsonl`);
    if (ENABLED) {
      try { mkdirSync(DIR, { recursive: true }); } catch { /* reported by write() */ }
    }
    this.write({ type: 'start', time: new Date().toISOString(), roomId, seed, players });
  }

  action(seat: number, action: Action, round: number, result: { ok: boolean; error?: string }) {
    this.write({ type: 'action', i: this.n++, seat, round, action, ok: result.ok, ...(result.ok ? {} : { error: result.error }) });
  }

  /** Something the server did besides a player action: a timeout, a disconnect, a crash. */
  note(text: string, extra: Record<string, unknown> = {}) {
    this.write({ type: 'note', time: new Date().toISOString(), text, ...extra });
  }

  end(winner: number | null, round: number) {
    this.write({ type: 'end', time: new Date().toISOString(), winner, round });
  }

  private write(entry: Record<string, unknown>) {
    if (!ENABLED) return;
    try {
      appendFileSync(this.file, JSON.stringify(entry) + '\n');
    } catch (e) {
      if (!warned) { warned = true; console.warn(`Couldn't write game log ${this.file}:`, (e as Error).message); }
    }
  }
}
