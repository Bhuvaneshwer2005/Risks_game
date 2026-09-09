import type { TerritoryId } from "./mapData.ts";

export type PlayerId = string;

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: string;
  eliminated: boolean;
}

export type CardType = "infantry" | "cavalry" | "artillery" | "wild";

export interface Card {
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
  turnOrder: PlayerId[];
  currentPlayerIndex: number;
  phase: Phase;
  territories: Record<TerritoryId, TerritoryState>;
  reinforcementsRemaining: number;
  conqueredThisTurn: boolean;
  hasFortifiedThisTurn: boolean;
  hands: Record<PlayerId, Card[]>;
  cardSetsTraded: number;
  winnerId: PlayerId | null;
}

export function currentPlayerId(state: GameState): PlayerId {
  return state.turnOrder[state.currentPlayerIndex];
}

export function activePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.eliminated);
}
