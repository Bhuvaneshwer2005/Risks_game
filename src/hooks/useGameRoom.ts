import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Tables } from "../lib/database.types";

export type RoomRow = Tables<"rooms">;
export type PlayerRow = Tables<"players">;
export type TerritoryRow = Tables<"territory_state">;
export type MoveRow = Tables<"moves_log">;
export type CardRow = Tables<"cards">;

export interface RoomData {
  room: RoomRow | null;
  players: PlayerRow[];
  territories: TerritoryRow[];
  moves: MoveRow[];
  myCards: CardRow[];
  myPlayerId: string | null;
  loading: boolean;
}

function upsertById<T extends { id: string }>(rows: T[], incoming: T): T[] {
  const idx = rows.findIndex((r) => r.id === incoming.id);
  if (idx === -1) return [...rows, incoming];
  const copy = [...rows];
  copy[idx] = incoming;
  return copy;
}

function upsertTerritory(rows: TerritoryRow[], incoming: TerritoryRow): TerritoryRow[] {
  const idx = rows.findIndex((r) => r.territory_id === incoming.territory_id);
  if (idx === -1) return [...rows, incoming];
  const copy = [...rows];
  copy[idx] = incoming;
  return copy;
}

// Keeps one room's live state in sync via Supabase Realtime (Postgres
// Changes) - every Edge Function write lands here automatically, across
// every connected player, with no polling. `cards` isn't in the realtime
// publication (broadcasting it would leak the deck/other hands), so the
// player's own hand is instead refetched whenever their own
// players.card_count changes.
export function useGameRoom(roomId: string | null, myUserId: string | null): RoomData {
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [territories, setTerritories] = useState<TerritoryRow[]>([]);
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [myCards, setMyCards] = useState<CardRow[]>([]);
  const [loading, setLoading] = useState(true);

  const myPlayerId = useMemo(() => players.find((p) => p.user_id === myUserId)?.id ?? null, [players, myUserId]);
  const myCardCount = players.find((p) => p.user_id === myUserId)?.card_count ?? 0;

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const [{ data: roomRow }, { data: playerRows }, { data: territoryRows }, { data: moveRows }] = await Promise.all([
        supabase.from("rooms").select("*").eq("id", roomId).single(),
        supabase.from("players").select("*").eq("room_id", roomId),
        supabase.from("territory_state").select("*").eq("room_id", roomId),
        supabase.from("moves_log").select("*").eq("room_id", roomId).order("created_at", { ascending: false }).limit(50),
      ]);
      if (cancelled) return;
      setRoom(roomRow ?? null);
      setPlayers(playerRows ?? []);
      setTerritories(territoryRows ?? []);
      setMoves(moveRows ?? []);
      setLoading(false);
    })();

    // A unique-per-mount channel name, not just `room:${roomId}` - in dev,
    // React StrictMode fires this effect, its cleanup, then the effect
    // again in the same tick, and supabase-js can hand back the same
    // already-subscribed channel object for a reused topic name before its
    // async removal finishes, which throws on the second round of `.on()`
    // calls. A fresh name every mount sidesteps that race entirely.
    const channel = supabase
      .channel(`room:${roomId}:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, (payload) => {
        if (payload.eventType !== "DELETE") setRoom(payload.new as RoomRow);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` }, (payload) => {
        if (payload.eventType === "DELETE") {
          setPlayers((prev) => prev.filter((p) => p.id !== (payload.old as PlayerRow).id));
        } else {
          setPlayers((prev) => upsertById(prev, payload.new as PlayerRow));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "territory_state", filter: `room_id=eq.${roomId}` }, (payload) => {
        if (payload.eventType !== "DELETE") setTerritories((prev) => upsertTerritory(prev, payload.new as TerritoryRow));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "moves_log", filter: `room_id=eq.${roomId}` }, (payload) => {
        setMoves((prev) => [payload.new as MoveRow, ...prev].slice(0, 50));
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  useEffect(() => {
    if (!myPlayerId) {
      setMyCards([]);
      return;
    }
    let cancelled = false;
    supabase
      .from("cards")
      .select("*")
      .eq("owner_player_id", myPlayerId)
      .then(({ data }) => {
        if (!cancelled) setMyCards(data ?? []);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPlayerId, myCardCount]);

  return { room, players, territories, moves, myCards, myPlayerId, loading };
}
