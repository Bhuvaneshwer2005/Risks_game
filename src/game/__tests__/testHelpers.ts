import { ALL_TERRITORY_IDS, territoriesInContinent, type TerritoryId, type ContinentId } from "../mapData";
import type { GameState, PlayerId, PlayerState } from "../types";

// Builds a minimal, otherwise-empty GameState for unit tests: every
// territory unowned with 0 armies, two players by default. Individual tests
// override `territories` ownership as needed via `withOwner`.
export function makeState(overrides: Partial<GameState> = {}): GameState {
  const territories = {} as GameState["territories"];
  for (const id of ALL_TERRITORY_IDS) territories[id] = { owner: null, armies: 0 };

  const players: PlayerState[] = overrides.players ?? [
    { id: "p1", name: "Player 1", color: "red", eliminated: false },
    { id: "p2", name: "Player 2", color: "blue", eliminated: false },
  ];

  return {
    players,
    turnOrder: players.map((p) => p.id),
    currentPlayerIndex: 0,
    phase: "reinforce",
    territories,
    reinforcementsRemaining: 0,
    conqueredThisTurn: false,
    hasFortifiedThisTurn: false,
    hands: Object.fromEntries(players.map((p) => [p.id, []])),
    cardSetsTraded: 0,
    winnerId: null,
    ...overrides,
  };
}

export function withOwner(state: GameState, owner: PlayerId, ids: TerritoryId[], armies = 1): GameState {
  const territories = { ...state.territories };
  for (const id of ids) territories[id] = { owner, armies };
  return { ...state, territories };
}

export function withContinent(state: GameState, owner: PlayerId, continent: ContinentId, armies = 1): GameState {
  return withOwner(state, owner, territoriesInContinent(continent), armies);
}
