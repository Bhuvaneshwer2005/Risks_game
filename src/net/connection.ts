import type { Card, GameAction, GameEvent, GameSettings, PlayerId, PublicState } from "../game/types.ts";

export interface FeedEvent {
  seq: number;
  event: GameEvent;
}

export interface LobbySeat {
  userId: string;
  name: string;
  color: string;
  seat: number;
}

export interface LobbyInfo {
  roomId: string;
  code: string;
  hostId: string;
  settings: GameSettings;
  seats: LobbySeat[];
  status: "lobby" | "in_progress" | "finished";
}

/** Everything the UI needs, as one immutable snapshot (for useSyncExternalStore). */
export interface ConnectionSnapshot {
  mode: "local" | "online";
  /** "lobby" only happens online, before the host starts the game. */
  view: "connecting" | "lobby" | "game";
  lobby: LobbyInfo | null;
  game: PublicState | null;
  /** The hand of `me`. */
  hand: Card[];
  /** The player the UI acts as: online, the signed-in player; locally, whoever is due to act. */
  me: PlayerId | null;
  /** Recent game events, oldest first; `seq` only ever increases. */
  feed: FeedEvent[];
  /** Server clock minus local clock, in ms, for the turn timer. */
  clockOffset: number;
  error: string | null;
}

export interface GameConnection {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ConnectionSnapshot;
  /** Sends an action; rejects with the rule-breaking message if it's illegal. */
  act(action: GameAction): Promise<void>;
  /** Leaves the room (online) or abandons the saved game (local). */
  leave(): Promise<void>;
  /** Online host only: reset a finished room to its lobby with the same players. */
  rematch?(): Promise<void>;
  dispose(): void;
}

export const FEED_LIMIT = 80;

/** Small base class: listener bookkeeping and immutable snapshot updates. */
export abstract class ConnectionBase {
  protected snapshot: ConnectionSnapshot;
  private listeners = new Set<() => void>();

  constructor(initial: ConnectionSnapshot) {
    this.snapshot = initial;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  protected update(patch: Partial<ConnectionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  protected appendFeed(events: GameEvent[], feed = this.snapshot.feed): FeedEvent[] {
    if (events.length === 0) return feed;
    let seq = feed.at(-1)?.seq ?? 0;
    return [...feed, ...events.map((event) => ({ seq: ++seq, event }))].slice(-FEED_LIMIT);
  }
}
