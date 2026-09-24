import { CONTINENTS, territoriesInContinent, type ContinentId } from "./mapData.ts";
import type { CoreState, PlayerId } from "./types.ts";

type Board = Pick<CoreState, "territories">;

export function continentsControlledBy(state: Board, playerId: PlayerId): ContinentId[] {
  return (Object.keys(CONTINENTS) as ContinentId[]).filter((continentId) =>
    territoriesInContinent(continentId).every((t) => state.territories[t].owner === playerId),
  );
}

export function territoryCount(state: Board, playerId: PlayerId): number {
  return Object.values(state.territories).filter((t) => t.owner === playerId).length;
}

export interface ReinforcementBreakdown {
  territories: number;
  /** floor(territories / 3), minimum 3. */
  base: number;
  continents: ContinentId[];
  continentBonus: number;
  total: number;
}

// Start-of-turn reinforcements: floor(territories/3), minimum 3, plus
// continent bonuses. Card trade-ins are added when a set is actually traded.
export function reinforcementBreakdown(state: Board, playerId: PlayerId): ReinforcementBreakdown {
  const territories = territoryCount(state, playerId);
  const base = Math.max(3, Math.floor(territories / 3));
  const continents = continentsControlledBy(state, playerId);
  const continentBonus = continents.reduce((sum, id) => sum + CONTINENTS[id].bonusArmies, 0);
  return { territories, base, continents, continentBonus, total: base + continentBonus };
}

export function calculateReinforcements(state: Board, playerId: PlayerId): number {
  return reinforcementBreakdown(state, playerId).total;
}
