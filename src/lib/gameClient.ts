import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabaseClient";
import type { AttackRollResult } from "../game/combat";
import type { TerritoryId } from "../game/mapData";

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1/game`;

// Thin wrapper around the `game` Edge Function - every game action is a
// server-authoritative POST, never a direct table write from the client
// (RLS only grants SELECT to authenticated users; see supabase/functions/game).
async function call<T = { ok: true }>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const res = await fetch(FUNCTIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json();
  if (!res.ok || json.ok === false) {
    throw new Error(json.error ?? `${action} failed (${res.status})`);
  }
  return json as T;
}

export interface AttackResult {
  ok: true;
  roll: AttackRollResult;
  captured: boolean;
  defenderEliminated: boolean;
  winnerId: string | null;
}

export const gameClient = {
  createRoom: (name: string, color: string) => call<{ ok: true; roomId: string; code: string; playerId: string }>("create-room", { name, color }),
  joinRoom: (code: string, name: string, color: string) =>
    call<{ ok: true; roomId: string; playerId: string; code: string }>("join-room", { code, name, color }),
  startGame: (roomId: string) => call("start-game", { roomId }),
  reinforce: (roomId: string, territoryId: TerritoryId, count: number) => call("reinforce", { roomId, territoryId, count }),
  finishReinforcing: (roomId: string) => call("finish-reinforcing", { roomId }),
  attack: (roomId: string, from: TerritoryId, to: TerritoryId, attackerDice: number, defenderDice: number) =>
    call<AttackResult>("attack", { roomId, from, to, attackerDice, defenderDice }),
  moveIn: (roomId: string, count: number) => call("move-in", { roomId, count }),
  finishAttacking: (roomId: string) => call("finish-attacking", { roomId }),
  fortify: (roomId: string, from: TerritoryId, to: TerritoryId, armies: number) => call("fortify", { roomId, from, to, armies }),
  endTurn: (roomId: string) => call("end-turn", { roomId }),
  tradeCards: (roomId: string, cardIds: string[]) => call<{ ok: true; bonus: number }>("trade-cards", { roomId, cardIds }),
};
