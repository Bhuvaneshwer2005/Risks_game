// Online play: every move goes to the `game` Edge Function; everyone's view
// is kept current by Supabase Realtime (one row update per move, plus the
// event feed and your own hand, which RLS keeps private).

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Card, GameAction, GameEvent, GameSettings, PublicState } from "../game/types.ts";
import { ConnectionBase, FEED_LIMIT, type FeedEvent, type GameConnection, type LobbyInfo, type LobbySeat } from "./connection.ts";
import { getSavedRoom, setSavedRoom as saveRoom } from "./savedRoom.ts";
import { callGame, ensureSignedIn, supabase } from "./supabase.ts";

interface RoomRow {
  id: string;
  code: string;
  host_user_id: string;
  status: LobbyInfo["status"];
  settings: GameSettings;
  public_state: PublicState | null;
  version: number;
}

interface SeatRow {
  user_id: string;
  seat: number;
  name: string;
  color: string;
}

interface ActResponse {
  version: number;
  state: PublicState;
  hand: Card[];
  events: FeedEvent[];
}

export class OnlineConnection extends ConnectionBase implements GameConnection {
  readonly roomId: string;
  readonly userId: string;
  private channel: RealtimeChannel | null = null;
  private version = -1;
  private room: RoomRow | null = null;
  private seats: LobbySeat[] = [];
  private disposed = false;
  private refreshing: Promise<void> | null = null;

  private constructor(roomId: string, userId: string) {
    super({ mode: "online", view: "connecting", lobby: null, game: null, hand: [], me: userId, feed: [], clockOffset: 0, error: null });
    this.roomId = roomId;
    this.userId = userId;
    saveRoom(roomId);
    this.listen();
    document.addEventListener("visibilitychange", this.onVisible);
  }

  static async create(name: string, color: string): Promise<OnlineConnection> {
    const userId = await ensureSignedIn();
    const res = await callGame<{ roomId: string }>("create-room", { name, color });
    return new OnlineConnection(res.roomId, userId);
  }

  static async join(code: string, name: string, color: string): Promise<OnlineConnection> {
    const userId = await ensureSignedIn();
    const res = await callGame<{ roomId: string }>("join-room", { code, name, color });
    return new OnlineConnection(res.roomId, userId);
  }

  static async resume(): Promise<OnlineConnection | null> {
    const roomId = getSavedRoom();
    if (!roomId) return null;
    const userId = await ensureSignedIn();
    return new OnlineConnection(roomId, userId);
  }

  // ---------- realtime ----------

  private listen() {
    const filter = `room_id=eq.${this.roomId}`;
    this.channel = supabase
      .channel(`room:${this.roomId}:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${this.roomId}` }, (p) => {
        if (p.eventType === "DELETE") this.gone("The host closed this game.");
        else this.applyRoom(p.new as RoomRow);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "room_players", filter }, () => {
        void this.refreshSeats();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "player_hands", filter }, (p) => {
        const row = p.new as { user_id?: string; cards?: Card[] };
        if (row.user_id === this.userId) this.update({ hand: row.cards ?? [] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "game_events", filter }, (p) => {
        const row = p.new as { seq: number; payload: GameEvent };
        this.applyEvents([{ seq: row.seq, event: row.payload }]);
      })
      .subscribe((status) => {
        // (Re)subscribed: anything could have happened meanwhile, so reload.
        if (status === "SUBSCRIBED") void this.refresh();
      });
  }

  private onVisible = () => {
    if (document.visibilityState === "visible") void this.refresh();
  };

  /** Reloads everything from the database (on connect, reconnect and tab focus). */
  refresh(): Promise<void> {
    this.refreshing ??= this.load().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async load() {
    const [room, seats, hand, events] = await Promise.all([
      supabase.from("rooms").select("*").eq("id", this.roomId).maybeSingle(),
      supabase.from("room_players").select("user_id, seat, name, color").eq("room_id", this.roomId).order("seat"),
      supabase.from("player_hands").select("cards").eq("room_id", this.roomId).eq("user_id", this.userId).maybeSingle(),
      supabase.from("game_events").select("seq, payload").eq("room_id", this.roomId).order("seq", { ascending: false }).limit(FEED_LIMIT),
    ]);
    if (this.disposed) return;
    if (room.error || seats.error) {
      this.update({ error: "Lost connection to the game. Retrying…" });
      return;
    }
    if (!room.data || !(seats.data ?? []).some((s) => s.user_id === this.userId)) {
      this.gone("That game is no longer available.");
      return;
    }
    this.seats = (seats.data as SeatRow[]).map((s) => ({ userId: s.user_id, seat: s.seat, name: s.name, color: s.color }));
    this.version = -1; // accept the fresh row whatever its version
    this.applyRoom(room.data as RoomRow);
    this.update({ hand: (hand.data?.cards as Card[] | undefined) ?? [], error: null });
    const feed = ((events.data ?? []) as { seq: number; payload: GameEvent }[]).map((e) => ({ seq: e.seq, event: e.payload })).reverse();
    this.applyEvents(feed);
  }

  private async refreshSeats() {
    const { data } = await supabase.from("room_players").select("user_id, seat, name, color").eq("room_id", this.roomId).order("seat");
    if (!data || this.disposed) return;
    this.seats = (data as SeatRow[]).map((s) => ({ userId: s.user_id, seat: s.seat, name: s.name, color: s.color }));
    if (!this.seats.some((s) => s.userId === this.userId) && this.room?.status === "lobby") {
      this.gone("You were removed from the lobby.");
      return;
    }
    this.publishLobby();
  }

  private applyRoom(row: RoomRow) {
    if (row.version < this.version) return;
    const wasLobby = this.room?.status === "lobby";
    this.version = row.version;
    this.room = row;
    const view = row.status === "lobby" ? "lobby" : row.public_state ? "game" : "connecting";
    // A rematch resets the room to the lobby: forget the old game's feed.
    const feed = row.status === "lobby" && !wasLobby ? [] : this.snapshot.feed;
    this.update({ view, game: row.status === "lobby" ? null : row.public_state, feed, hand: row.status === "lobby" ? [] : this.snapshot.hand });
    this.publishLobby();
  }

  private publishLobby() {
    if (!this.room) return;
    this.update({
      lobby: {
        roomId: this.room.id,
        code: this.room.code,
        hostId: this.room.host_user_id,
        settings: this.room.settings,
        status: this.room.status,
        seats: this.seats,
      },
    });
  }

  private applyEvents(incoming: FeedEvent[]) {
    const last = this.snapshot.feed.at(-1)?.seq ?? 0;
    const fresh = incoming.filter((e) => e.seq > last).sort((a, b) => a.seq - b.seq);
    if (fresh.length === 0) return;
    this.update({ feed: [...this.snapshot.feed, ...fresh].slice(-FEED_LIMIT) });
  }

  private gone(message: string) {
    saveRoom(null);
    this.update({ error: message, view: "connecting" });
  }

  // ---------- commands ----------

  async act(action: GameAction): Promise<void> {
    this.applyResponse(await callGame<ActResponse>("act", { roomId: this.roomId, action }));
  }

  async kickPlayer(playerId: string): Promise<void> {
    this.applyResponse(await callGame<ActResponse>("kick-player", { roomId: this.roomId, userId: playerId }));
  }

  private applyResponse(res: Awaited<ReturnType<typeof callGame<ActResponse>>>) {
    this.syncClock(res.serverTime, res.latency);
    if (res.version > this.version && this.room) {
      this.version = res.version;
      this.room = { ...this.room, public_state: res.state, version: res.version, status: res.state.status === "finished" ? "finished" : "in_progress" };
      this.update({ game: res.state, hand: res.hand, view: "game" });
    }
    this.applyEvents(res.events);
  }

  private syncClock(serverTime: number, latency: number) {
    // Server time at the midpoint of the request, compared with ours.
    const offset = serverTime - (Date.now() - latency / 2);
    this.update({ clockOffset: Math.round(this.snapshot.clockOffset * 0.5 + offset * 0.5) });
  }

  async updateSeat(patch: { name?: string; color?: string }) {
    await callGame("update-seat", { roomId: this.roomId, ...patch });
  }

  async updateSettings(settings: GameSettings) {
    await callGame("update-settings", { roomId: this.roomId, settings });
  }

  async kick(userId: string) {
    await callGame("kick", { roomId: this.roomId, userId });
  }

  async start() {
    await callGame("start-game", { roomId: this.roomId });
  }

  async rematch() {
    await callGame("rematch", { roomId: this.roomId });
  }

  async leave(): Promise<void> {
    saveRoom(null);
    if (this.room?.status === "lobby") await callGame("leave-room", { roomId: this.roomId }).catch(() => {});
  }

  dispose(): void {
    this.disposed = true;
    document.removeEventListener("visibilitychange", this.onVisible);
    if (this.channel) void supabase.removeChannel(this.channel);
    this.channel = null;
  }
}
