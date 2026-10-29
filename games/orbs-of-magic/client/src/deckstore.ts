import { cardDef } from '../../shared/cards';
import { DECKS, deckColors, deckIcon, type DeckList } from '../../shared/decks';
import type { Color } from '../../shared/types';

export interface DeckEntry {
  id: string;
  name: string;
  archetype: string;
  colors: Color[];
  icon: string;
  cards: [string, number][];
  custom: boolean;
  blurb: string;
  howToPlay: string;
}

const KEY = 'oom-custom-decks';

export function loadCustom(): DeckList[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((d) => d && d.id && Array.isArray(d.cards)) : [];
  } catch { return []; }
}

export function saveCustom(list: DeckList[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export function upsertCustom(d: DeckList) {
  const list = loadCustom().filter((x) => x.id !== d.id);
  list.push(d);
  saveCustom(list);
}

export function deleteCustom(id: string) {
  saveCustom(loadCustom().filter((x) => x.id !== id));
}

export function allDecks(): DeckEntry[] {
  const pre: DeckEntry[] = DECKS.map((d) => ({
    id: d.id, name: d.name, archetype: d.archetype, colors: d.colors, icon: cardDef(d.signature).icon,
    cards: d.cards, custom: false, blurb: d.blurb, howToPlay: d.howToPlay,
  }));
  const custom: DeckEntry[] = loadCustom().map((d) => ({
    id: d.id, name: d.name, archetype: 'Custom', colors: deckColors(d.cards), icon: deckIcon(d.cards),
    cards: d.cards, custom: true, blurb: 'Your own creation.', howToPlay: 'Build it, battle with it, tweak it, repeat.',
  }));
  return [...pre, ...custom];
}

export function findDeck(id: string): DeckEntry {
  const all = allDecks();
  return all.find((d) => d.id === id) ?? all[0];
}

/** The join/rematch options that select this deck on the server. */
export function deckOptions(id: string): { deckId?: string; customDeck?: DeckList } {
  const d = findDeck(id);
  return d.custom ? { customDeck: { id: d.id, name: d.name, cards: d.cards } } : { deckId: d.id };
}
