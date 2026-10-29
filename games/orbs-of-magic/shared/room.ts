// Things both the Colyseus room and the in-browser room need to agree on.
import { DECKS, prebuiltList, validateDeck, type DeckList } from './decks';

export const EMOTES = ['Well played!', 'Good luck!', 'Hmm...', 'Oops!', 'Wow!', 'Thanks!', 'Not today!', 'Behold!'];

/** Pick the player's deck: a legal custom list, else the named prebuilt deck. */
export function pickDeck(opts: { deckId?: string; customDeck?: DeckList } | undefined): DeckList {
  const c = opts?.customDeck;
  if (c && typeof c.name === 'string' && !validateDeck(c.cards)) return { id: 'custom', name: c.name.slice(0, 30) || 'Custom Deck', cards: c.cards };
  return prebuiltList(opts?.deckId ?? '');
}

/** The AI's deck: the one asked for, or a random prebuilt deck. */
export function aiDeck(id: string | undefined) {
  return DECKS.find((d) => d.id === id) ?? DECKS[Math.floor(Math.random() * DECKS.length)];
}

/** How long the AI waits before acting, so the player can watch the last action play out. */
export const aiDelay = (eventCount: number) => 700 + Math.min(eventCount, 12) * 220;
