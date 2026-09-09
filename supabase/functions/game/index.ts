// Single Edge Function acting as the whole game API, routed by an `action`
// field in the request body instead of one function per action - Supabase
// Edge Functions don't share code between separate function deployments
// without re-uploading it every time, so this keeps the rules engine (and
// its Deno-side copy under _shared/) defined exactly once.
//
// Every handler below follows the same shape: load the room's current state
// from Postgres, rebuild it into the same GameState shape the pure engine
// in _shared/engine.ts already operates on and is unit-tested against,
// call the engine function that actually enforces the rule, then persist
// whatever it returns. The engine never trusts the client for anything - a
// request can't act out of turn, attack past what its armies allow, or
// fabricate a dice roll, because every check the engine makes runs here,
// server-side, before a single row is written.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ALL_TERRITORY_IDS, type TerritoryId } from "./_shared/mapData.ts";
import * as engine from "./_shared/engine.ts";
import { CARD_TYPES, cardSetBonusArmies, isValidCardSet, territoryBonusForSet } from "./_shared/cards.ts";
import { applyFortify, validateFortify } from "./_shared/fortify.ts";
import type { Card, GameState, PlayerId } from "./_shared/types.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

function secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

function rollDie(): number {
  return 1 + Math.floor(secureRandom() * 6);
}

function shuffleWith<T>(arr: T[], random: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I - easy to read aloud
function randomRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(secureRandom() * CODE_ALPHABET.length)];
  return code;
}

type Db = SupabaseClient<any, "public", any>;

interface RoomRow {
  id: string;
  code: string;
  status: string;
  host_user_id: string;
  current_player_id: string | null;
  phase: string | null;
  reinforcements_remaining: number;
  conquered_this_turn: boolean;
  has_fortified_this_turn: boolean;
  card_sets_traded: number;
  winner_player_id: string | null;
  pending_capture: { from: TerritoryId; to: TerritoryId; diceUsed: number } | null;
}

interface PlayerRow {
  id: string;
  room_id: string;
  user_id: string;
  name: string;
  color: string;
  turn_order: number | null;
  eliminated: boolean;
  card_count: number;
}

interface TerritoryRow {
  room_id: string;
  territory_id: string;
  owner_player_id: string | null;
  armies: number;
}

async function loadRoom(db: Db, roomId: string) {
  const { data: room, error } = await db.from("rooms").select("*").eq("id", roomId).single();
  if (error || !room) throw new Error("Room not found");
  const { data: players } = await db.from("players").select("*").eq("room_id", roomId);
  const { data: territoryRows } = await db.from("territory_state").select("*").eq("room_id", roomId);
  return { room: room as RoomRow, players: (players ?? []) as PlayerRow[], territoryRows: (territoryRows ?? []) as TerritoryRow[] };
}

function findPlayerId(players: PlayerRow[], userId: string): PlayerId {
  const p = players.find((p) => p.user_id === userId);
  if (!p) throw new Error("You're not seated in this room");
  return p.id;
}

function buildGameState(room: RoomRow, players: PlayerRow[], territoryRows: TerritoryRow[]): GameState {
  const turnOrder = players
    .filter((p) => p.turn_order !== null)
    .sort((a, b) => (a.turn_order as number) - (b.turn_order as number))
    .map((p) => p.id);

  const territories = {} as GameState["territories"];
  for (const row of territoryRows) {
    territories[row.territory_id as TerritoryId] = { owner: row.owner_player_id, armies: row.armies };
  }

  const hands = Object.fromEntries(players.map((p) => [p.id, [] as Card[]]));

  return {
    players: players.map((p) => ({ id: p.id, name: p.name, color: p.color, eliminated: p.eliminated })),
    turnOrder,
    currentPlayerIndex: room.current_player_id ? Math.max(0, turnOrder.indexOf(room.current_player_id)) : 0,
    phase: (room.phase ?? "reinforce") as GameState["phase"],
    territories,
    reinforcementsRemaining: room.reinforcements_remaining,
    conqueredThisTurn: room.conquered_this_turn,
    hasFortifiedThisTurn: room.has_fortified_this_turn,
    hands,
    cardSetsTraded: room.card_sets_traded,
    winnerId: room.winner_player_id,
  };
}

async function saveState(db: Db, roomId: string, state: GameState) {
  const territoryRows = ALL_TERRITORY_IDS.map((id) => ({
    room_id: roomId,
    territory_id: id,
    owner_player_id: state.territories[id].owner,
    armies: state.territories[id].armies,
  }));
  const { error: tErr } = await db.from("territory_state").upsert(territoryRows, { onConflict: "room_id,territory_id" });
  if (tErr) throw tErr;

  await Promise.all(state.players.map((p) => db.from("players").update({ eliminated: p.eliminated }).eq("id", p.id)));

  const { error: rErr } = await db
    .from("rooms")
    .update({
      phase: state.phase,
      current_player_id: state.turnOrder[state.currentPlayerIndex] ?? null,
      reinforcements_remaining: state.reinforcementsRemaining,
      conquered_this_turn: state.conqueredThisTurn,
      has_fortified_this_turn: state.hasFortifiedThisTurn,
      card_sets_traded: state.cardSetsTraded,
      winner_player_id: state.winnerId,
      status: state.winnerId ? "finished" : "in_progress",
    })
    .eq("id", roomId);
  if (rErr) throw rErr;
}

// players.card_count is denormalized for cheap realtime reads (no client
// ever needs to see the cards table to know "opponent has 3 cards"), so
// recompute it from the actual cards table after anything that could have
// moved a card - simpler and less bug-prone than incrementing/decrementing
// it inline at every call site.
async function syncCardCounts(db: Db, roomId: string) {
  const { data: players } = await db.from("players").select("id").eq("room_id", roomId);
  const { data: cards } = await db.from("cards").select("owner_player_id").eq("room_id", roomId).not("owner_player_id", "is", null);
  const counts = new Map<string, number>();
  for (const c of cards ?? []) counts.set(c.owner_player_id as string, (counts.get(c.owner_player_id as string) ?? 0) + 1);
  await Promise.all((players ?? []).map((p) => db.from("players").update({ card_count: counts.get(p.id) ?? 0 }).eq("id", p.id)));
}

async function logMove(db: Db, roomId: string, playerId: string | null, type: string, payload: unknown) {
  await db.from("moves_log").insert({ room_id: roomId, player_id: playerId, type, payload: payload ?? {} });
}

// ---- action handlers ----

async function createRoom(db: Db, userId: string, body: any) {
  const name = String(body.name ?? "").trim().slice(0, 24);
  const color = String(body.color ?? "#888888");
  if (!name) throw new Error("Name is required");

  let roomId = "";
  let code = "";
  for (let attempt = 0; attempt < 5 && !roomId; attempt++) {
    code = randomRoomCode();
    const { data, error } = await db.from("rooms").insert({ code, host_user_id: userId }).select("id").single();
    if (!error && data) roomId = data.id;
    else if (error && (error as any).code !== "23505") throw error;
  }
  if (!roomId) throw new Error("Could not allocate a room code - try again");

  const { data: player, error: playerErr } = await db
    .from("players")
    .insert({ room_id: roomId, user_id: userId, name, color })
    .select("id")
    .single();
  if (playerErr) throw playerErr;

  return json({ ok: true, roomId, code, playerId: player.id });
}

async function joinRoom(db: Db, userId: string, body: any) {
  const code = String(body.code ?? "").trim().toUpperCase();
  const name = String(body.name ?? "").trim().slice(0, 24);
  const color = String(body.color ?? "#888888");
  if (!name) throw new Error("Name is required");

  const { data: room, error } = await db.from("rooms").select("*").eq("code", code).single();
  if (error || !room) throw new Error("Room not found");
  if (room.status !== "lobby") throw new Error("That game has already started");

  const { data: existingPlayers } = await db.from("players").select("id,user_id,color").eq("room_id", room.id);
  const already = existingPlayers?.find((p) => p.user_id === userId);
  if (already) return json({ ok: true, roomId: room.id, playerId: already.id, code: room.code });

  if ((existingPlayers?.length ?? 0) >= 6) throw new Error("Room is full");
  if (existingPlayers?.some((p) => p.color === color)) throw new Error("That color is already taken in this room");

  const { data: player, error: playerErr } = await db
    .from("players")
    .insert({ room_id: room.id, user_id: userId, name, color })
    .select("id")
    .single();
  if (playerErr) throw playerErr;

  return json({ ok: true, roomId: room.id, playerId: player.id, code: room.code });
}

async function startGame(db: Db, userId: string, body: any) {
  const roomId = String(body.roomId);
  const { room, players } = await loadRoom(db, roomId);
  if (room.host_user_id !== userId) throw new Error("Only the host can start the game");
  if (room.status !== "lobby") throw new Error("Game already started");
  if (players.length < 2) throw new Error("Need at least 2 players");
  if (players.length > 6) throw new Error("Risk supports at most 6 players");

  const state = engine.createGame({
    players: players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    random: secureRandom,
  });

  await Promise.all(state.turnOrder.map((pid, idx) => db.from("players").update({ turn_order: idx }).eq("id", pid)));

  const territoryRows = ALL_TERRITORY_IDS.map((id) => ({
    room_id: roomId,
    territory_id: id,
    owner_player_id: state.territories[id].owner,
    armies: state.territories[id].armies,
  }));
  const { error: tErr } = await db.from("territory_state").upsert(territoryRows, { onConflict: "room_id,territory_id" });
  if (tErr) throw tErr;

  // 42 territory cards (cycled evenly across the 3 unit types) + 2 wilds,
  // shuffled into a deck_position order.
  const deck: { territory_id: string | null; card_type: string }[] = ALL_TERRITORY_IDS.map((id, i) => ({
    territory_id: id,
    card_type: CARD_TYPES[i % 3],
  }));
  deck.push({ territory_id: null, card_type: "wild" }, { territory_id: null, card_type: "wild" });
  const shuffledDeck = shuffleWith(deck, secureRandom);
  const cardRows = shuffledDeck.map((c, i) => ({ room_id: roomId, territory_id: c.territory_id, card_type: c.card_type, deck_position: i }));
  const { error: cErr } = await db.from("cards").insert(cardRows);
  if (cErr) throw cErr;

  const { error: rErr } = await db
    .from("rooms")
    .update({ status: "in_progress", phase: "reinforce", current_player_id: state.turnOrder[0], reinforcements_remaining: state.reinforcementsRemaining })
    .eq("id", roomId);
  if (rErr) throw rErr;

  await logMove(db, roomId, null, "game_started", { playerCount: players.length });
  return json({ ok: true });
}

async function reinforce(db: Db, userId: string, body: any) {
  const roomId = String(body.roomId);
  const territoryId = body.territoryId as TerritoryId;
  const count = Number(body.count);
  const { room, players, territoryRows } = await loadRoom(db, roomId);
  const playerId = findPlayerId(players, userId);
  if (room.current_player_id !== playerId) throw new Error("Not your turn");

  const state = engine.placeReinforcement(buildGameState(room, players, territoryRows), territoryId, count);
  await saveState(db, roomId, state);
  await logMove(db, roomId, playerId, "reinforce", { territoryId, count });
  return json({ ok: true });
}

async function finishReinforcingAction(db: Db, userId: string, body: any) {
  const roomId = String(body.roomId);
  const { room, players, territoryRows } = await loadRoom(db, roomId);
  const playerId = findPlayerId(players, userId);
  if (room.current_player_id !== playerId) throw new Error("Not your turn");

  const state = engine.finishReinforcing(buildGameState(room, players, territoryRows));
  await saveState(db, roomId, state);
  return json({ ok: true });
}

async function attack(db: Db, userId: string, body: any) {
  const roomId = String(body.roomId);
  const from = body.from as TerritoryId;
  const to = body.to as TerritoryId;
  const attackerDice = Number(body.attackerDice);
  const defenderDice = Number(body.defenderDice);
  const { room, players, territoryRows } = await loadRoom(db, roomId);
  const playerId = findPlayerId(players, userId);
  if (room.current_player_id !== playerId) throw new Error("Not your turn");
  if (room.pending_capture) throw new Error("Resolve the pending move-in first");

  const defenderIdBeforeAttack = territoryRows.find((t) => t.territory_id === to)?.owner_player_id ?? null;

  const outcome = engine.applyAttack(buildGameState(room, players, territoryRows), from, to, attackerDice, defenderDice, rollDie);
  await saveState(db, roomId, outcome.state);

  const pendingCapture = outcome.captured ? { from, to, diceUsed: attackerDice } : null;
  const { error: pErr } = await db.from("rooms").update({ pending_capture: pendingCapture }).eq("id", roomId);
  if (pErr) throw pErr;

  if (outcome.defenderEliminated && defenderIdBeforeAttack) {
    const { error: xferErr } = await db
      .from("cards")
      .update({ owner_player_id: playerId })
      .eq("room_id", roomId)
      .eq("owner_player_id", defenderIdBeforeAttack);
    if (xferErr) throw xferErr;
  }
  await syncCardCounts(db, roomId);

  await logMove(db, roomId, playerId, "attack", { from, to, roll: outcome.roll, captured: outcome.captured, defenderEliminated: outcome.defenderEliminated });
  return json({ ok: true, roll: outcome.roll, captured: outcome.captured, defenderEliminated: outcome.defenderEliminated, winnerId: outcome.state.winnerId });
}

async function moveIn(db: Db, userId: string, body: any) {
  const roomId = String(body.roomId);
  const count = Number(body.count);
  const { room, players, territoryRows } = await loadRoom(db, roomId);
  const playerId = findPlayerId(players, userId);
  if (room.current_player_id !== playerId) throw new Error("Not your turn");
  const pending = room.pending_capture;
  if (!pending) throw new Error("No pending capture to move into");

  const state = engine.moveInAfterCapture(buildGameState(room, players, territoryRows), pending.from, pending.to, pending.diceUsed, count);
  await saveState(db, roomId, state);
  const { error } = await db.from("rooms").update({ pending_capture: null }).eq("id", roomId);
  if (error) throw error;
  return json({ ok: true });
}

async function finishAttackingAction(db: Db, userId: string, body: any) {
  const roomId = String(body.roomId);
  const { room, players, territoryRows } = await loadRoom(db, roomId);
  const playerId = findPlayerId(players, userId);
  if (room.current_player_id !== playerId) throw new Error("Not your turn");
  if (room.pending_capture) throw new Error("Resolve the pending move-in first");

  const state = engine.finishAttacking(buildGameState(room, players, territoryRows));
  await saveState(db, roomId, state);
  return json({ ok: true });
}

async function fortify(db: Db, userId: string, body: any) {
  const roomId = String(body.roomId);
  const from = body.from as TerritoryId;
  const to = body.to as TerritoryId;
  const armies = Number(body.armies);
  const { room, players, territoryRows } = await loadRoom(db, roomId);
  const playerId = findPlayerId(players, userId);
  if (room.current_player_id !== playerId) throw new Error("Not your turn");

  const state0 = buildGameState(room, players, territoryRows);
  const validationError = validateFortify(state0, playerId, { from, to, armies });
  if (validationError) throw new Error(validationError);

  const state = applyFortify(state0, { from, to, armies });
  await saveState(db, roomId, state);
  await logMove(db, roomId, playerId, "fortify", { from, to, armies });
  return json({ ok: true });
}

async function endTurn(db: Db, userId: string, body: any) {
  const roomId = String(body.roomId);
  const { room, players, territoryRows } = await loadRoom(db, roomId);
  const playerId = findPlayerId(players, userId);
  if (room.current_player_id !== playerId) throw new Error("Not your turn");

  const state0 = buildGameState(room, players, territoryRows);
  let drewCard = false;
  const drawCard = state0.conqueredThisTurn
    ? () => {
        drewCard = true;
        return { type: "infantry", territory: null } as Card; // placeholder - the real card assignment happens against the `cards` table below
      }
    : undefined;

  const state = engine.endTurn(state0, drawCard);
  await saveState(db, roomId, state);

  if (drewCard) {
    const { data: topCard } = await db
      .from("cards")
      .select("id")
      .eq("room_id", roomId)
      .is("owner_player_id", null)
      .order("deck_position", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (topCard) {
      const { error } = await db.from("cards").update({ owner_player_id: playerId }).eq("id", topCard.id);
      if (error) throw error;
    }
  }
  await syncCardCounts(db, roomId);

  await logMove(db, roomId, playerId, "end_turn", {});
  return json({ ok: true });
}

async function tradeCards(db: Db, userId: string, body: any) {
  const roomId = String(body.roomId);
  const cardIds = body.cardIds as string[];
  if (!Array.isArray(cardIds) || cardIds.length !== 3) throw new Error("Must trade exactly 3 cards");

  const { room, players, territoryRows } = await loadRoom(db, roomId);
  const playerId = findPlayerId(players, userId);
  if (room.current_player_id !== playerId) throw new Error("Not your turn");
  if (room.phase !== "reinforce") throw new Error("Cards can only be traded during your reinforce phase");

  const { data: cardRows, error } = await db.from("cards").select("*").in("id", cardIds);
  if (error) throw error;
  if (!cardRows || cardRows.length !== 3 || cardRows.some((c) => c.owner_player_id !== playerId)) {
    throw new Error("Those cards aren't all in your hand");
  }
  const cards = cardRows.map((c) => ({ type: c.card_type, territory: c.territory_id })) as [Card, Card, Card];
  if (!isValidCardSet(cards)) throw new Error("Not a valid set (need 3 matching, or one of each type)");

  const state = buildGameState(room, players, territoryRows);
  const ownedTerritories = new Set(ALL_TERRITORY_IDS.filter((t) => state.territories[t].owner === playerId));
  const setNumber = room.card_sets_traded + 1;
  const bonus = cardSetBonusArmies(setNumber) + territoryBonusForSet(cards, ownedTerritories);

  const { data: maxPosRow } = await db
    .from("cards")
    .select("deck_position")
    .eq("room_id", roomId)
    .order("deck_position", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextPos = (maxPosRow?.deck_position ?? 0) + 1;
  for (const id of cardIds) {
    const { error: returnErr } = await db.from("cards").update({ owner_player_id: null, deck_position: nextPos }).eq("id", id);
    if (returnErr) throw returnErr;
    nextPos += 1;
  }

  const { error: rErr } = await db
    .from("rooms")
    .update({ reinforcements_remaining: room.reinforcements_remaining + bonus, card_sets_traded: setNumber })
    .eq("id", roomId);
  if (rErr) throw rErr;

  await syncCardCounts(db, roomId);
  await logMove(db, roomId, playerId, "trade_cards", { bonus });
  return json({ ok: true, bonus });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const body = await req.json();
    const action = String(body.action ?? "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) return json({ ok: false, error: "Not authenticated" }, 401);

    const db = createClient(supabaseUrl, serviceRoleKey);

    switch (action) {
      case "create-room":
        return await createRoom(db, user.id, body);
      case "join-room":
        return await joinRoom(db, user.id, body);
      case "start-game":
        return await startGame(db, user.id, body);
      case "reinforce":
        return await reinforce(db, user.id, body);
      case "finish-reinforcing":
        return await finishReinforcingAction(db, user.id, body);
      case "attack":
        return await attack(db, user.id, body);
      case "move-in":
        return await moveIn(db, user.id, body);
      case "finish-attacking":
        return await finishAttackingAction(db, user.id, body);
      case "fortify":
        return await fortify(db, user.id, body);
      case "end-turn":
        return await endTurn(db, user.id, body);
      case "trade-cards":
        return await tradeCards(db, user.id, body);
      default:
        return json({ ok: false, error: `Unknown action "${action}"` }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
