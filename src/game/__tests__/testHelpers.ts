import { ALL_TERRITORY_IDS, territoriesInContinent, type TerritoryId, type ContinentId } from "../mapData.ts";
import { buildDeck } from "../cards.ts";
import { applyAction, type ActionResult } from "../engine.ts";
import { mulberry32 } from "../rng.ts";
import { DEFAULT_SETTINGS, type Card, type GameAction, type GameState, type PlayerId, type PlayerState } from "../types.ts";

// Builds a minimal GameState for unit tests: a game in progress, p1's turn in
// the reinforce phase, every territory unowned with 0 armies. Tests set up
// ownership with `withOwner` / `withContinent`.
export function makeState(overrides: Partial<GameState> = {}): GameState {
  const territories = {} as GameState["territories"];
  for (const id of ALL_TERRITORY_IDS) territories[id] = { owner: null, armies: 0 };

  const players: PlayerState[] = overrides.players ?? [player("p1"), player("p2")];
  const humans = players.filter((p) => !p.neutral).map((p) => p.id);

  return {
    settings: { ...DEFAULT_SETTINGS, turnSeconds: null },
    status: "playing",
    players,
    turnOrder: humans,
    currentPlayer: humans[0],
    phase: "reinforce",
    territories,
    setupPools: Object.fromEntries(humans.map((id) => [id, 0])),
    reinforcements: 0,
    pendingCapture: null,
    eliminationTrade: false,
    conqueredThisTurn: false,
    territoryBonusUsed: false,
    setsTraded: 0,
    turnNumber: 1,
    turnDeadline: null,
    winner: null,
    deck: buildDeck(),
    discard: [],
    hands: Object.fromEntries(players.map((p) => [p.id, [] as Card[]])),
    ...overrides,
  };
}

export function player(id: PlayerId, extra: Partial<PlayerState> = {}): PlayerState {
  return { id, name: id.toUpperCase(), color: "#fff", neutral: false, status: "active", timeoutStrikes: 0, ...extra };
}

export function withOwner(state: GameState, owner: PlayerId, ids: TerritoryId[], armies = 1): GameState {
  const territories = { ...state.territories };
  for (const id of ids) territories[id] = { owner, armies };
  return { ...state, territories };
}

export function withContinent(state: GameState, owner: PlayerId, continent: ContinentId, armies = 1): GameState {
  return withOwner(state, owner, territoriesInContinent(continent), armies);
}

/** Gives every still-unowned territory to `owner`. */
export function fillRest(state: GameState, owner: PlayerId, armies = 1): GameState {
  const rest = ALL_TERRITORY_IDS.filter((id) => state.territories[id].owner === null);
  return withOwner(state, owner, rest, armies);
}

/** Moves specific cards (by id) out of the deck into a player's hand. */
export function withHand(state: GameState, playerId: PlayerId, cardIds: number[]): GameState {
  const cards = cardIds.map((id) => state.deck.find((c) => c.id === id) ?? state.discard.find((c) => c.id === id)!);
  return {
    ...state,
    deck: state.deck.filter((c) => !cardIds.includes(c.id)),
    discard: state.discard.filter((c) => !cardIds.includes(c.id)),
    hands: { ...state.hands, [playerId]: [...(state.hands[playerId] ?? []), ...cards] },
  };
}

/** A die that returns the given values in order (throws if it runs out). */
export function fixedDice(values: number[]): () => number {
  let i = 0;
  // rollDie maps rng() in [0,1) to 1 + floor(rng * 6); aim at the middle of each bucket.
  return () => {
    if (i >= values.length) throw new Error("fixedDice ran out of values");
    return (values[i++] - 1) / 6 + 1 / 12;
  };
}

export function act(
  state: GameState,
  actor: PlayerId,
  action: GameAction,
  opts: { rng?: () => number; now?: number } = {},
): ActionResult {
  return applyAction(state, action, { actor, rng: opts.rng ?? mulberry32(1), now: opts.now ?? 0 });
}

/** Card ids by type in the unshuffled deck (buildDeck assigns types by territory index). */
export function cardIdsOfType(type: Card["type"], count: number): number[] {
  return buildDeck()
    .filter((c) => c.type === type)
    .slice(0, count)
    .map((c) => c.id);
}
