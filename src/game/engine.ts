import { ALL_TERRITORY_IDS, areAdjacent, type TerritoryId } from "./mapData";
import {
  maxAttackerDice,
  maxDefenderDice,
  moveInBounds,
  resolveAttackRoll,
  type AttackRollResult,
  type RollDie,
} from "./combat";
import { calculateReinforcements, territoryCount } from "./reinforcements";
import type { Card, GameState, PlayerId, PlayerState } from "./types";
import { currentPlayerId } from "./types";

export type Shuffle = <T>(arr: T[]) => T[];
export type Random = () => number; // uniform [0, 1)

function defaultShuffle<T>(arr: T[], random: Random): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Classic Risk's starting-army table for 3-6 players; 2-player games use the
// common house-rule value of 40 each (the official 2-player variant swaps in
// a neutral third "hand" instead, which is out of scope for v1).
export function startingArmies(playerCount: number): number {
  if (playerCount < 2 || playerCount > 6) {
    throw new Error(`Risk supports 2-6 players, got ${playerCount}`);
  }
  return 50 - 5 * playerCount;
}

export interface CreateGameOptions {
  players: { id: PlayerId; name: string; color: string }[];
  shuffle?: Shuffle;
  random?: Random;
}

// Auto-distributes all 42 territories round-robin among players (shuffled),
// placing 1 army on each as it's claimed, then drops the rest of each
// player's starting army pool one at a time onto random territories they
// own - the "auto initial placement" simplification called out in scope.
export function createGame(options: CreateGameOptions): GameState {
  const random = options.random ?? Math.random;
  const shuffle = options.shuffle ?? (<T,>(arr: T[]) => defaultShuffle(arr, random));

  const turnOrder = shuffle(options.players.map((p) => p.id));
  const players: PlayerState[] = options.players.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    eliminated: false,
  }));

  const shuffledTerritories = shuffle(ALL_TERRITORY_IDS);
  const territories: GameState["territories"] = {} as GameState["territories"];
  const armiesRemaining: Record<PlayerId, number> = {};
  for (const p of players) armiesRemaining[p.id] = startingArmies(players.length);

  shuffledTerritories.forEach((territoryId, index) => {
    const owner = turnOrder[index % turnOrder.length];
    territories[territoryId] = { owner, armies: 1 };
    armiesRemaining[owner] -= 1;
  });

  // Drop remaining armies one at a time onto a random territory each player
  // already owns, round-robin across players so no one's pool is emptied
  // all at once onto a single territory.
  let anyRemaining = true;
  while (anyRemaining) {
    anyRemaining = false;
    for (const p of players) {
      if (armiesRemaining[p.id] <= 0) continue;
      anyRemaining = true;
      const owned = (Object.entries(territories) as [TerritoryId, GameState["territories"][TerritoryId]][]).filter(
        ([, t]) => t.owner === p.id,
      );
      const [pickId] = owned[Math.floor(random() * owned.length)];
      territories[pickId].armies += 1;
      armiesRemaining[p.id] -= 1;
    }
  }

  const hands: Record<PlayerId, Card[]> = {};
  for (const p of players) hands[p.id] = [];

  const state: GameState = {
    players,
    turnOrder,
    currentPlayerIndex: 0,
    phase: "reinforce",
    territories,
    reinforcementsRemaining: 0,
    conqueredThisTurn: false,
    hasFortifiedThisTurn: false,
    hands,
    cardSetsTraded: 0,
    winnerId: null,
  };
  state.reinforcementsRemaining = calculateReinforcements(state, currentPlayerId(state));
  return state;
}

export function placeReinforcement(state: GameState, territoryId: TerritoryId, count: number): GameState {
  if (state.phase !== "reinforce") throw new Error("Not in reinforce phase");
  if (count < 1) throw new Error("Must place at least 1 army");
  if (count > state.reinforcementsRemaining) throw new Error("Not enough reinforcements remaining");
  const player = currentPlayerId(state);
  if (state.territories[territoryId].owner !== player) throw new Error("You don't own that territory");

  const territories = { ...state.territories };
  territories[territoryId] = { ...territories[territoryId], armies: territories[territoryId].armies + count };
  return { ...state, territories, reinforcementsRemaining: state.reinforcementsRemaining - count };
}

export function finishReinforcing(state: GameState): GameState {
  if (state.phase !== "reinforce") throw new Error("Not in reinforce phase");
  if (state.reinforcementsRemaining > 0) throw new Error("Reinforcements remaining must be placed first");
  return { ...state, phase: "attack" };
}

export function finishAttacking(state: GameState): GameState {
  if (state.phase !== "attack") throw new Error("Not in attack phase");
  return { ...state, phase: "fortify" };
}

export interface AttackOutcome {
  roll: AttackRollResult;
  captured: boolean;
  defenderEliminated: boolean;
  state: GameState;
}

export function applyAttack(
  state: GameState,
  from: TerritoryId,
  to: TerritoryId,
  attackerDiceCount: number,
  defenderDiceCount: number,
  rollDie: RollDie,
): AttackOutcome {
  if (state.phase !== "attack") throw new Error("Not in attack phase");
  const attacker = currentPlayerId(state);
  const fromT = state.territories[from];
  const toT = state.territories[to];
  if (fromT.owner !== attacker) throw new Error("You don't own the attacking territory");
  if (toT.owner === attacker) throw new Error("Can't attack your own territory");
  if (!areAdjacent(from, to)) throw new Error("Territories aren't adjacent");
  if (attackerDiceCount > maxAttackerDice(fromT.armies)) throw new Error("Too many attacker dice for army count");
  if (defenderDiceCount > maxDefenderDice(toT.armies)) throw new Error("Too many defender dice for army count");

  const roll = resolveAttackRoll(fromT.armies, toT.armies, attackerDiceCount, defenderDiceCount, rollDie);
  const territories = { ...state.territories };
  const attackerArmiesAfter = fromT.armies - roll.attackerLosses;
  const defenderArmiesAfter = toT.armies - roll.defenderLosses;
  const defenderId = toT.owner;

  let captured = false;
  let defenderEliminated = false;
  let conqueredThisTurn = state.conqueredThisTurn;

  if (defenderArmiesAfter <= 0) {
    captured = true;
    conqueredThisTurn = true;
    territories[from] = { ...fromT, armies: attackerArmiesAfter };
    territories[to] = { owner: attacker, armies: 0 }; // move-in happens via moveInAfterCapture
    if (defenderId) {
      const stillOwnsAny = ALL_TERRITORY_IDS.some((t) => t !== to && territories[t].owner === defenderId);
      defenderEliminated = !stillOwnsAny;
    }
  } else {
    territories[from] = { ...fromT, armies: attackerArmiesAfter };
    territories[to] = { ...toT, armies: defenderArmiesAfter };
  }

  let players = state.players;
  let hands = state.hands;
  if (defenderEliminated && defenderId) {
    players = state.players.map((p) => (p.id === defenderId ? { ...p, eliminated: true } : p));
    // Conquering a player hands you their whole hand of cards.
    hands = { ...state.hands, [attacker]: [...state.hands[attacker], ...state.hands[defenderId]], [defenderId]: [] };
  }

  const newState: GameState = {
    ...state,
    territories,
    players,
    hands,
    conqueredThisTurn,
  };

  return { roll, captured, defenderEliminated, state: checkWinner(newState) };
}

export function moveInAfterCapture(
  state: GameState,
  from: TerritoryId,
  to: TerritoryId,
  diceUsedInFinalRoll: number,
  count: number,
): GameState {
  const fromT = state.territories[from];
  const toT = state.territories[to];
  const attacker = currentPlayerId(state);
  if (fromT.owner !== attacker || toT.owner !== attacker) throw new Error("Move-in must be between your own territories");
  if (toT.armies !== 0) throw new Error("Territory wasn't just captured (already has armies)");

  const { min, max } = moveInBounds(fromT.armies, diceUsedInFinalRoll);
  if (count < min || count > max) throw new Error(`Move-in count must be between ${min} and ${max}`);

  const territories = { ...state.territories };
  territories[from] = { ...fromT, armies: fromT.armies - count };
  territories[to] = { ...toT, armies: count };
  return { ...state, territories };
}

export function endTurn(state: GameState, drawCard?: () => Card): GameState {
  if (state.phase !== "fortify") throw new Error("Not in fortify phase");

  let hands = state.hands;
  const player = currentPlayerId(state);
  if (state.conqueredThisTurn && drawCard) {
    hands = { ...state.hands, [player]: [...state.hands[player], drawCard()] };
  }

  const active = state.turnOrder.filter((id) => !state.players.find((p) => p.id === id)?.eliminated);
  const currentPos = active.indexOf(player);
  const nextPlayer = active[(currentPos + 1) % active.length];
  const nextIndex = state.turnOrder.indexOf(nextPlayer);

  const nextState: GameState = {
    ...state,
    hands,
    phase: "reinforce",
    currentPlayerIndex: nextIndex,
    conqueredThisTurn: false,
    hasFortifiedThisTurn: false,
    reinforcementsRemaining: 0,
  };
  nextState.reinforcementsRemaining = calculateReinforcements(nextState, nextPlayer);
  return nextState;
}

export function checkWinner(state: GameState): GameState {
  const active = state.players.filter((p) => !p.eliminated);
  if (active.length === 1) {
    return { ...state, winnerId: active[0].id };
  }
  return state;
}

export { territoryCount };
