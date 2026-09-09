import type { TerritoryId } from "../game/mapData";
import type { GameState } from "../game/types";
import type { TerritoryRow } from "../hooks/useGameRoom";

// Client-side reads flatten territory_state into rows; the pure engine
// functions (reused here purely for read-only UX hints like "which
// territories can I fortify into") expect the same Record shape the server
// builds. This is the client-side half of that conversion.
export function toTerritoryRecord(rows: TerritoryRow[]): GameState["territories"] {
  const record = {} as GameState["territories"];
  for (const row of rows) {
    record[row.territory_id as TerritoryId] = { owner: row.owner_player_id, armies: row.armies };
  }
  return record;
}
