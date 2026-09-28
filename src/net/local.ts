// Hot-seat play on one device: the engine runs in the browser and the game is
// saved to localStorage after every move, so a reload resumes it.

import { applyAction, createGame, type NewPlayer } from "../game/engine.ts";
import { nextSetupPlayer } from "../game/selectors.ts";
import { toPublicState } from "../game/state.ts";
import type { GameAction, GameSettings, GameState, PlayerId } from "../game/types.ts";
import { ConnectionBase, FEED_LIMIT, type FeedEvent, type GameConnection } from "./connection.ts";
import { cryptoRng } from "./random.ts";

const STORAGE_KEY = "risk.localGame.v2";

interface Saved {
  state: GameState;
  feed: FeedEvent[];
}

function actorFor(state: GameState): PlayerId | null {
  return state.status === "setup" ? nextSetupPlayer(state) : state.currentPlayer;
}

export class LocalConnection extends ConnectionBase implements GameConnection {
  private state: GameState;

  private constructor(state: GameState, feed: FeedEvent[]) {
    super({
      mode: "local",
      view: "game",
      lobby: null,
      game: null,
      hand: [],
      me: null,
      feed,
      clockOffset: 0,
      error: null,
    });
    this.state = state;
    this.publish(feed);
  }

  static create(players: NewPlayer[], settings: Partial<GameSettings>): LocalConnection {
    const state = createGame({ players, settings, rng: cryptoRng, now: Date.now() });
    const connection = new LocalConnection(state, []);
    connection.save();
    return connection;
  }

  static hasSaved(): boolean {
    return LocalConnection.load() !== null;
  }

  static restore(): LocalConnection | null {
    const saved = LocalConnection.load();
    return saved ? new LocalConnection(saved.state, saved.feed) : null;
  }

  private static load(): Saved | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw) as Saved;
      return saved.state?.status && saved.state.status !== "finished" ? saved : null;
    } catch {
      return null;
    }
  }

  async act(action: GameAction): Promise<void> {
    const actor = action.type === "claimTimeout" ? (this.state.turnOrder[0] ?? "") : actorFor(this.state);
    if (!actor) throw new Error("Nobody can act right now");
    const { state, events } = applyAction(this.state, action, { actor, rng: cryptoRng, now: Date.now() });
    this.state = state;
    this.publish(this.appendFeed(events));
    this.save();
  }

  // Around one device, whoever is holding it can remove a player who left the table.
  async kickPlayer(playerId: PlayerId): Promise<void> {
    const actor = this.state.players.find((p) => !p.neutral && p.status === "active" && p.id !== playerId)?.id;
    if (!actor) throw new Error("There's nobody left to remove them");
    const { state, events } = applyAction(this.state, { type: "kick", player: playerId }, { actor, rng: cryptoRng, now: Date.now() });
    this.state = state;
    this.publish(this.appendFeed(events));
    this.save();
  }

  async leave(): Promise<void> {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable: nothing was saved anyway.
    }
  }

  dispose(): void {}

  private publish(feed: FeedEvent[]): void {
    const me = actorFor(this.state);
    this.update({
      game: toPublicState(this.state),
      hand: me ? (this.state.hands[me] ?? []) : [],
      me,
      feed,
    });
  }

  private save(): void {
    try {
      if (this.state.status === "finished") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: this.state, feed: this.snapshot.feed.slice(-FEED_LIMIT) }));
    } catch {
      // Private mode or full storage: the game still works, it just won't survive a reload.
    }
  }
}
