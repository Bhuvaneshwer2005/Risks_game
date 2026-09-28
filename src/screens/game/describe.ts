import type { PlayerId, PublicState } from "../../game/types.ts";

export function playerName(state: PublicState | null, id: PlayerId | null): string {
  return state?.players.find((p) => p.id === id)?.name ?? "Someone";
}
