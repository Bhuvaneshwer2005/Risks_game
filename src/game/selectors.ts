// Read-only questions the UI asks about a (public) game state.

import { ADJACENCY, ALL_TERRITORY_IDS, type ContinentId, type TerritoryId } from "./mapData.ts";
import { continentsControlledBy } from "./reinforcements.ts";
import type { CoreState, PlayerId } from "./types.ts";

export { reinforcementBreakdown } from "./reinforcements.ts";
export { fortifyTargets } from "./fortify.ts";

export function territoriesOf(state: Pick<CoreState, "territories">, playerId: PlayerId): TerritoryId[] {
  return ALL_TERRITORY_IDS.filter((t) => state.territories[t].owner === playerId);
}

export function attackTargets(state: Pick<CoreState, "territories">, from: TerritoryId): TerritoryId[] {
  const owner = state.territories[from].owner;
  return ADJACENCY[from].filter((t) => state.territories[t].owner !== owner);
}

export function canAttackFrom(state: Pick<CoreState, "territories">, playerId: PlayerId, from: TerritoryId): boolean {
  const t = state.territories[from];
  return t.owner === playerId && t.armies >= 2 && attackTargets(state, from).length > 0;
}

export interface PlayerSummary {
  territories: number;
  armies: number;
  continents: ContinentId[];
}

export function playerSummaries(state: CoreState): Record<PlayerId, PlayerSummary> {
  const result: Record<PlayerId, PlayerSummary> = {};
  for (const p of state.players) result[p.id] = { territories: 0, armies: 0, continents: [] };
  for (const id of ALL_TERRITORY_IDS) {
    const t = state.territories[id];
    const summary = t.owner ? result[t.owner] : undefined;
    if (summary) {
      summary.territories += 1;
      summary.armies += t.armies;
    }
  }
  for (const p of state.players) result[p.id].continents = continentsControlledBy(state, p.id);
  return result;
}

/** In a local hot-seat game, whose setup placement is next. */
export function nextSetupPlayer(state: CoreState): PlayerId | null {
  if (state.status !== "setup") return null;
  if (state.phase === "claim") return state.currentPlayer;
  return state.turnOrder.find((id) => (state.setupPools[id] ?? 0) > 0) ?? null;
}
