// The whole online game API as one Edge Function, routed by `op`.
//
// Every game move runs the same rules engine the client and tests use
// (_engine/, a byte-for-byte copy of src/game made by scripts/sync-engine.mjs)
// and is committed atomically with a version check, so concurrent requests
// can't overwrite each other. Clients can only read; all writes happen here.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { MAX_PLAYERS, MIN_PLAYERS, RuleError, applyAction, createGame } from "./_engine/engine.ts";
import { toPublicState } from "./_engine/state.ts";
import { DEFAULT_SETTINGS, type GameAction } from "./_engine/types.ts";
import { commit, loadRoom, loadSeats, transact, type Db, type RoomRow } from "./db.ts";
import { BadRequest, parseAction, parseCode, parseColor, parseName, parseSettings, parseUuid } from "./validate.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ ...body, serverTime: Date.now() }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I - easy to read aloud
function randomRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(secureRandom() * CODE_ALPHABET.length)];
  return code;
}

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;

async function requireSeat(db: Db, roomId: string, userId: string) {
  const { data, error } = await db.from("room_players").select("*").eq("room_id", roomId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new BadRequest("You're not in this game");
  return data;
}

function requireHost(room: RoomRow, userId: string) {
  if (room.host_user_id !== userId) throw new BadRequest("Only the host can do that");
}

function requireLobby(room: RoomRow) {
  if (room.status !== "lobby") throw new BadRequest("The game has already started");
}

// ---------- lobby ----------

async function createRoom(db: Db, userId: string, body: Body) {
  const name = parseName(body.name);
  const color = parseColor(body.color);
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomRoomCode();
    const { data: room, error } = await db
      .from("rooms")
      .insert({ code, host_user_id: userId, settings: DEFAULT_SETTINGS })
      .select("id, code")
      .single();
    if (error?.code === "23505") continue; // code collision, try another
    if (error) throw error;
    const { error: seatError } = await db.from("room_players").insert({ room_id: room.id, user_id: userId, seat: 0, name, color });
    if (seatError) throw seatError;
    return json({ ok: true, roomId: room.id, code: room.code });
  }
  throw new Error("Couldn't find a free room code, try again");
}

async function joinRoom(db: Db, userId: string, body: Body) {
  const { data, error } = await db.rpc("join_room", {
    p_code: parseCode(body.code),
    p_user: userId,
    p_name: parseName(body.name),
    p_color: parseColor(body.color),
  });
  if (error) throw new BadRequest(error.message);
  const joined = (data as { joined_room: string }[])[0];
  const room = await loadRoom(db, joined.joined_room);
  return json({ ok: true, roomId: room.id, code: room.code });
}

async function leaveRoom(db: Db, userId: string, body: Body) {
  const roomId = parseUuid(body.roomId, "roomId");
  const room = await loadRoom(db, roomId);
  // In a game you resign (an engine action) and simply stop watching; your
  // seat stays so the board keeps your name on your old armies.
  if (room.status !== "lobby") return json({ ok: true });

  await db.from("room_players").delete().eq("room_id", roomId).eq("user_id", userId);
  const seats = await loadSeats(db, roomId);
  if (seats.length === 0) {
    await db.from("rooms").delete().eq("id", roomId);
  } else if (room.host_user_id === userId) {
    await db.from("rooms").update({ host_user_id: seats[0].user_id }).eq("id", roomId);
  }
  return json({ ok: true });
}

async function updateSeat(db: Db, userId: string, body: Body) {
  const roomId = parseUuid(body.roomId, "roomId");
  requireLobby(await loadRoom(db, roomId));
  await requireSeat(db, roomId, userId);
  const patch: Record<string, string> = {};
  if (body.name !== undefined) patch.name = parseName(body.name);
  if (body.color !== undefined) patch.color = parseColor(body.color);
  const { error } = await db.from("room_players").update(patch).eq("room_id", roomId).eq("user_id", userId);
  if (error?.code === "23505") throw new BadRequest("That color is taken, pick another");
  if (error) throw error;
  return json({ ok: true });
}

async function updateSettings(db: Db, userId: string, body: Body) {
  const roomId = parseUuid(body.roomId, "roomId");
  const room = await loadRoom(db, roomId);
  requireHost(room, userId);
  requireLobby(room);
  const { error } = await db.from("rooms").update({ settings: parseSettings(body.settings) }).eq("id", roomId).eq("status", "lobby");
  if (error) throw error;
  return json({ ok: true });
}

async function kick(db: Db, userId: string, body: Body) {
  const roomId = parseUuid(body.roomId, "roomId");
  const target = parseUuid(body.userId, "userId");
  const room = await loadRoom(db, roomId);
  requireHost(room, userId);
  requireLobby(room);
  if (target === userId) throw new BadRequest("You can't remove yourself; leave instead");
  await db.from("room_players").delete().eq("room_id", roomId).eq("user_id", target);
  return json({ ok: true });
}

async function startGame(db: Db, userId: string, body: Body) {
  const roomId = parseUuid(body.roomId, "roomId");
  const room = await loadRoom(db, roomId);
  requireHost(room, userId);
  requireLobby(room);
  const seats = await loadSeats(db, roomId);
  if (seats.length < MIN_PLAYERS) throw new BadRequest(`You need at least ${MIN_PLAYERS} players`);
  if (seats.length > MAX_PLAYERS) throw new BadRequest(`At most ${MAX_PLAYERS} players can play`);

  const state = createGame({
    players: seats.map((s) => ({ id: s.user_id, name: s.name, color: s.color })),
    settings: parseSettings(room.settings),
    rng: secureRandom,
    now: Date.now(),
  });
  // The version check makes a double-click on Start harmless.
  const { version } = await commit(db, roomId, room.version, state, []);
  return json({ ok: true, version });
}

async function rematch(db: Db, userId: string, body: Body) {
  const roomId = parseUuid(body.roomId, "roomId");
  const room = await loadRoom(db, roomId);
  requireHost(room, userId);
  if (room.status !== "finished") throw new BadRequest("The game isn't over yet");
  await Promise.all([
    db.from("room_private").delete().eq("room_id", roomId),
    db.from("player_hands").delete().eq("room_id", roomId),
    db.from("game_events").delete().eq("room_id", roomId),
  ]);
  const { error } = await db
    .from("rooms")
    .update({ status: "lobby", public_state: null, version: room.version + 1 })
    .eq("id", roomId)
    .eq("version", room.version);
  if (error) throw error;
  return json({ ok: true });
}

// ---------- game moves ----------

async function act(db: Db, userId: string, body: Body) {
  const roomId = parseUuid(body.roomId, "roomId");
  const action = parseAction(body.action);
  await requireSeat(db, roomId, userId);
  return runAction(db, roomId, userId, action);
}

// Only the host can remove a player from a game in progress; parseAction never
// accepts "kick", so it can't arrive through `act`.
async function kickPlayer(db: Db, userId: string, body: Body) {
  const roomId = parseUuid(body.roomId, "roomId");
  const target = parseUuid(body.userId, "userId");
  const room = await loadRoom(db, roomId);
  requireHost(room, userId);
  if (room.status !== "in_progress") throw new BadRequest("There's no game in progress");
  return runAction(db, roomId, userId, { type: "kick", player: target });
}

async function runAction(db: Db, roomId: string, userId: string, action: GameAction) {
  const { result, version, firstSeq } = await transact(db, roomId, (state) =>
    applyAction(state, action, { actor: userId, rng: secureRandom, now: Date.now() }),
  );
  return json({
    ok: true,
    version,
    state: toPublicState(result.state),
    hand: result.state.hands[userId] ?? [],
    events: result.events.map((event, i) => ({ seq: firstSeq + i, event })),
  });
}

const HANDLERS: Record<string, (db: Db, userId: string, body: Body) => Promise<Response>> = {
  "create-room": createRoom,
  "join-room": joinRoom,
  "leave-room": leaveRoom,
  "update-seat": updateSeat,
  "update-settings": updateSettings,
  kick,
  "start-game": startGame,
  rematch,
  act,
  "kick-player": kickPlayer,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

  try {
    const body = (await req.json()) as Body;
    const handler = HANDLERS[String(body.op ?? "")];
    if (!handler) return json({ ok: false, error: "Unknown operation" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const auth = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data, error } = await auth.auth.getUser();
    if (error || !data.user) return json({ ok: false, error: "Please sign in again" }, 401);

    const db = createClient(url, serviceKey, { auth: { persistSession: false } });
    return await handler(db, data.user.id, body);
  } catch (e) {
    if (e instanceof RuleError || e instanceof BadRequest) return json({ ok: false, error: e.message }, 400);
    console.error(e);
    const message = e instanceof Error && e.message === "That game no longer exists" ? e.message : "Something went wrong on the server";
    return json({ ok: false, error: message }, 500);
  }
});
