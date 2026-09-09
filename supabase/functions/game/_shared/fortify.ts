import { ADJACENCY, type TerritoryId } from "./mapData.ts";
import type { GameState, PlayerId } from "./types.ts";

export function isFortifyPathConnected(
  state: GameState,
  playerId: PlayerId,
  from: TerritoryId,
  to: TerritoryId,
): boolean {
  if (from === to) return false;
  if (state.territories[from].owner !== playerId || state.territories[to].owner !== playerId) {
    return false;
  }

  const visited = new Set<TerritoryId>([from]);
  const queue: TerritoryId[] = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) return true;
    for (const neighbor of ADJACENCY[current]) {
      if (visited.has(neighbor)) continue;
      if (state.territories[neighbor].owner !== playerId) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  return false;
}

export interface FortifyMove {
  from: TerritoryId;
  to: TerritoryId;
  armies: number;
}

export function validateFortify(state: GameState, playerId: PlayerId, move: FortifyMove): string | null {
  if (state.hasFortifiedThisTurn) return "Already fortified this turn";
  if (move.armies < 1) return "Must move at least 1 army";
  const fromArmies = state.territories[move.from]?.armies ?? 0;
  if (fromArmies - move.armies < 1) return "Must leave at least 1 army behind";
  if (!isFortifyPathConnected(state, playerId, move.from, move.to)) {
    return "No unbroken chain of owned territories connects these two";
  }
  return null;
}

export function applyFortify(state: GameState, move: FortifyMove): GameState {
  const territories = { ...state.territories };
  territories[move.from] = { ...territories[move.from], armies: territories[move.from].armies - move.armies };
  territories[move.to] = { ...territories[move.to], armies: territories[move.to].armies + move.armies };
  return { ...state, territories, hasFortifiedThisTurn: true };
}
