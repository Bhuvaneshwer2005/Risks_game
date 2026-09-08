import { CONTINENTS, territoriesInContinent, type ContinentId } from "./mapData";
import type { GameState, PlayerId } from "./types";

// A player who owns every territory in a continent gets that continent's
// bonus. Iterating CONTINENTS (only 6 entries) per call is cheap enough not
// to need caching.
export function continentsControlledBy(state: GameState, playerId: PlayerId): ContinentId[] {
  return (Object.keys(CONTINENTS) as ContinentId[]).filter((continentId) =>
    territoriesInContinent(continentId).every((t) => state.territories[t].owner === playerId),
  );
}

export function territoryCount(state: GameState, playerId: PlayerId): number {
  return Object.values(state.territories).filter((t) => t.owner === playerId).length;
}

// Base reinforcement calculation for the start of a player's turn: floor(territories/3),
// minimum 3, plus continent bonuses. Card trade-in bonuses are added
// separately when a set is actually traded in (see cards.ts) since that's a
// player choice, not an automatic turn-start grant.
export function calculateReinforcements(state: GameState, playerId: PlayerId): number {
  const territoryBonus = Math.max(3, Math.floor(territoryCount(state, playerId) / 3));
  const continentBonus = continentsControlledBy(state, playerId).reduce(
    (sum, id) => sum + CONTINENTS[id].bonusArmies,
    0,
  );
  return territoryBonus + continentBonus;
}
