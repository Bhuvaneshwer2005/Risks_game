import { CONTINENTS, territoriesInContinent, type ContinentId } from "./mapData.ts";
import type { GameState, PlayerId } from "./types.ts";

export function continentsControlledBy(state: GameState, playerId: PlayerId): ContinentId[] {
  return (Object.keys(CONTINENTS) as ContinentId[]).filter((continentId) =>
    territoriesInContinent(continentId).every((t) => state.territories[t].owner === playerId),
  );
}

export function territoryCount(state: GameState, playerId: PlayerId): number {
  return Object.values(state.territories).filter((t) => t.owner === playerId).length;
}

export function calculateReinforcements(state: GameState, playerId: PlayerId): number {
  const territoryBonus = Math.max(3, Math.floor(territoryCount(state, playerId) / 3));
  const continentBonus = continentsControlledBy(state, playerId).reduce(
    (sum, id) => sum + CONTINENTS[id].bonusArmies,
    0,
  );
  return territoryBonus + continentBonus;
}
