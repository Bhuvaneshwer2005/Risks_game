// Splitting the full game state into what everyone may see and what stays
// secret (the deck, the discard pile and each player's hand).

import type { Card, GameState, PlayerId, PrivateState, PublicState } from "./types.ts";

export function toPublicState(state: GameState): PublicState {
  const { deck, discard: _discard, hands, ...core } = state;
  const cardCounts: Record<PlayerId, number> = {};
  for (const p of state.players) cardCounts[p.id] = hands[p.id]?.length ?? 0;
  return { ...core, cardCounts, deckCount: deck.length };
}

export interface StoredGame {
  publicState: PublicState;
  deck: Card[];
  discard: Card[];
  hands: Record<PlayerId, Card[]>;
}

export function splitState(state: GameState): StoredGame {
  return { publicState: toPublicState(state), deck: state.deck, discard: state.discard, hands: state.hands };
}

export function mergeState(publicState: PublicState, secret: PrivateState): GameState {
  const { cardCounts: _cardCounts, deckCount: _deckCount, ...core } = publicState;
  return { ...core, deck: secret.deck, discard: secret.discard, hands: secret.hands };
}
