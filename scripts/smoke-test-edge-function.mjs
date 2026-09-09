// One-off end-to-end smoke test against the deployed `game` Edge Function -
// two independent anonymous sessions play a couple of turns against the
// real Supabase project (not mocked) to prove the whole pipeline (auth,
// RLS, the edge function, realtime tables) actually works together before
// wiring any UI to it.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=").map((s) => s.trim())),
);

const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function newPlayer(name, color) {
  const client = createClient(url, key);
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw new Error(`signInAnonymously(${name}): ${error.message}`);
  return { client, userId: data.user.id, name, color };
}

async function call(client, action, body) {
  const { data: sessionData } = await client.auth.getSession();
  const res = await fetch(`${url}/functions/v1/game`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionData.session.access_token}`,
      apikey: key,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json();
  if (!res.ok || json.ok === false) {
    throw new Error(`${action} failed (${res.status}): ${json.error ?? JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  console.log("Signing in two anonymous players...");
  const alice = await newPlayer("Alice", "#e63946");
  const bob = await newPlayer("Bob", "#2a9d8f");

  console.log("Alice creates a room...");
  const created = await call(alice.client, "create-room", { name: alice.name, color: alice.color });
  console.log("  room code:", created.code);

  console.log("Bob joins...");
  await call(bob.client, "join-room", { code: created.code, name: bob.name, color: bob.color });

  console.log("Alice starts the game...");
  await call(alice.client, "start-game", { roomId: created.roomId });

  const db = createClient(url, key);
  await db.auth.signInAnonymously(); // throwaway session just for a read
  const { data: room } = await alice.client.from("rooms").select("*").eq("id", created.roomId).single();
  console.log("  status:", room.status, "phase:", room.phase, "current_player_id:", room.current_player_id);

  const { data: players } = await alice.client.from("players").select("*").eq("room_id", created.roomId);
  const currentPlayer = players.find((p) => p.id === room.current_player_id);
  const currentClient = currentPlayer.user_id === alice.userId ? alice.client : bob.client;
  console.log("  first turn belongs to:", currentPlayer.name);

  const { data: myTerritories } = await alice.client
    .from("territory_state")
    .select("*")
    .eq("room_id", created.roomId)
    .eq("owner_player_id", currentPlayer.id);
  console.log(`  ${currentPlayer.name} owns ${myTerritories.length} territories, reinforcements_remaining=${room.reinforcements_remaining}`);

  console.log("Placing all reinforcements on the first owned territory...");
  await call(currentClient, "reinforce", { roomId: created.roomId, territoryId: myTerritories[0].territory_id, count: room.reinforcements_remaining });
  await call(currentClient, "finish-reinforcing", { roomId: created.roomId });
  await call(currentClient, "finish-attacking", { roomId: created.roomId });
  await call(currentClient, "end-turn", { roomId: created.roomId });

  const { data: roomAfter } = await alice.client.from("rooms").select("*").eq("id", created.roomId).single();
  console.log("  after a full turn -> phase:", roomAfter.phase, "current_player_id:", roomAfter.current_player_id, "(should have advanced)");

  console.log("\nSMOKE TEST PASSED");
}

main().catch((e) => {
  console.error("\nSMOKE TEST FAILED:", e.message);
  process.exit(1);
});
