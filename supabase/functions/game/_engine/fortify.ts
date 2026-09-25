import { ADJACENCY, ALL_TERRITORY_IDS, areAdjacent, type TerritoryId } from "./mapData.ts";
import type { CoreState, FortifyRule, PlayerId } from "./types.ts";

type Board = Pick<CoreState, "territories">;

// BFS over the territories owned by `playerId`, starting from `from`: is `to`
// reachable through an unbroken chain of that player's territories?
export function isFortifyPathConnected(state: Board, playerId: PlayerId, from: TerritoryId, to: TerritoryId): boolean {
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

/** Whether `playerId` may fortify from one territory to another under the given rule (army counts aside). */
export function canFortifyBetween(
  state: Board,
  rule: FortifyRule,
  playerId: PlayerId,
  from: TerritoryId,
  to: TerritoryId,
): boolean {
  if (from === to) return false;
  if (state.territories[from].owner !== playerId || state.territories[to].owner !== playerId) return false;
  return rule === "adjacent" ? areAdjacent(from, to) : isFortifyPathConnected(state, playerId, from, to);
}

export function fortifyTargets(state: Board, rule: FortifyRule, playerId: PlayerId, from: TerritoryId): TerritoryId[] {
  return ALL_TERRITORY_IDS.filter((to) => canFortifyBetween(state, rule, playerId, from, to));
}
