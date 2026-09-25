import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ActionResult } from "./_engine/engine.ts";
import { mergeState, splitState } from "./_engine/state.ts";
import type { Card, GameEvent, GameState, PublicState } from "./_engine/types.ts";

// deno-lint-ignore no-explicit-any
export type Db = SupabaseClient<any, "public", any>;

export class Conflict extends Error {}

export interface RoomRow {
  id: string;
  code: string;
  host_user_id: string;
  status: "lobby" | "in_progress" | "finished";
  settings: unknown;
  public_state: PublicState | null;
  version: number;
}

export interface SeatRow {
  room_id: string;
  user_id: string;
  seat: number;
  name: string;
  color: string;
}

export async function loadRoom(db: Db, roomId: string): Promise<RoomRow> {
  const { data, error } = await db.from("rooms").select("*").eq("id", roomId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("That game no longer exists");
  return data as RoomRow;
}

export async function loadSeats(db: Db, roomId: string): Promise<SeatRow[]> {
  const { data, error } = await db.from("room_players").select("*").eq("room_id", roomId).order("seat");
  if (error) throw error;
  return (data ?? []) as SeatRow[];
}

/** The full game state (public document plus hidden deck and hands). */
export async function loadGame(db: Db, room: RoomRow): Promise<GameState> {
  if (!room.public_state) throw new Error("The game hasn't started");
  const [{ data: secret, error: e1 }, { data: hands, error: e2 }] = await Promise.all([
    db.from("room_private").select("deck, discard").eq("room_id", room.id).maybeSingle(),
    db.from("player_hands").select("user_id, cards").eq("room_id", room.id),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const handMap: Record<string, Card[]> = {};
  for (const p of room.public_state.players) handMap[p.id] = [];
  for (const h of hands ?? []) handMap[h.user_id as string] = h.cards as Card[];
  return mergeState(room.public_state, { deck: (secret?.deck ?? []) as Card[], discard: (secret?.discard ?? []) as Card[], hands: handMap });
}

export interface Committed {
  version: number;
  /** seq of the first event written (events get consecutive seqs). */
  firstSeq: number;
}

/** Writes a new state in one transaction; throws Conflict if the room changed since it was loaded. */
export async function commit(db: Db, roomId: string, expectedVersion: number, state: GameState, events: GameEvent[]): Promise<Committed> {
  const stored = splitState(state);
  const { data, error } = await db.rpc("commit_game", {
    p_room: roomId,
    p_expected_version: expectedVersion,
    p_status: state.status === "finished" ? "finished" : "in_progress",
    p_public: stored.publicState,
    p_deck: stored.deck,
    p_discard: stored.discard,
    p_hands: stored.hands,
    p_events: events,
  });
  if (error) {
    if (error.message.includes("version_conflict")) throw new Conflict("The game changed, retrying");
    throw error;
  }
  const row = (data as { new_version: number; first_seq: number }[])[0];
  return { version: row.new_version, firstSeq: row.first_seq };
}

/** Load, apply, commit - retried on concurrent updates (each retry re-runs the action on fresh state). */
export async function transact(
  db: Db,
  roomId: string,
  run: (state: GameState, room: RoomRow) => ActionResult,
): Promise<{ room: RoomRow; result: ActionResult } & Committed> {
  for (let attempt = 0; ; attempt++) {
    const room = await loadRoom(db, roomId);
    const state = await loadGame(db, room);
    const result = run(state, room);
    try {
      const committed = await commit(db, roomId, room.version, result.state, result.events);
      return { room, result, ...committed };
    } catch (e) {
      if (!(e instanceof Conflict) || attempt >= 4) throw e;
    }
  }
}
