import type { TerritoryId } from "./mapData";

export type PlayerId = string;

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: string;
  eliminated: boolean;
}

export type CardType = "infantry" | "cavalry" | "artillery" | "wild";

export interface Card {
  // A card is tied to the territory it depicts (classic Risk pairs every
  // territory with an infantry/cavalry/artillery icon); wild cards have no
  // territory. Trading in a set that includes a card for a territory the
  // trading player owns grants +2 bonus armies there - callers can look
  // that up via `territory`.
  territory: TerritoryId | null;
  type: CardType;
}

export type Phase = "reinforce" | "attack" | "fortify";

export interface TerritoryState {
  owner: PlayerId | null;
  armies: number;
}

export interface GameState {
  players: PlayerState[];
  /** Player ids in turn order. */
  turnOrder: PlayerId[];
  currentPlayerIndex: number;
  phase: Phase;
  territories: Record<TerritoryId, TerritoryState>;
  /** Reinforcement armies the current player still has to place this turn. */
  reinforcementsRemaining: number;
  /** Whether the current player has conquered >=1 territory this turn (earns a card at end of turn). */
  conqueredThisTurn: boolean;
  /** Whether the current player has already fortified this turn (only one fortify move allowed). */
  hasFortifiedThisTurn: boolean;
  hands: Record<PlayerId, Card[]>;
  /** How many card sets have been traded in globally - drives the escalating bonus table. */
  cardSetsTraded: number;
  winnerId: PlayerId | null;
}

export function currentPlayerId(state: GameState): PlayerId {
  return state.turnOrder[state.currentPlayerIndex];
}

export function activePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.eliminated);
}
