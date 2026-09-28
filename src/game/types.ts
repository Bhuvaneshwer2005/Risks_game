import type { TerritoryId } from "./mapData.ts";

export type PlayerId = string;

/** The official 2-player game adds a neutral army that holds territory and defends, but never takes a turn. */
export const NEUTRAL_ID: PlayerId = "neutral";

/** "kicked": removed by the host (or, locally, by the other players). Like "resigned", their armies stay and defend. */
export type PlayerStatus = "active" | "eliminated" | "resigned" | "kicked";

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: string;
  neutral: boolean;
  status: PlayerStatus;
  /** Consecutive turns ended by the turn timer; 3 in a row auto-resigns the player. */
  timeoutStrikes: number;
}

export type UnitType = "infantry" | "cavalry" | "artillery";
export type CardType = UnitType | "wild";

export interface Card {
  id: number;
  /** The territory pictured on the card; wild cards picture none. */
  territory: TerritoryId | null;
  type: CardType;
}

export type FortifyRule = "adjacent" | "connected";
/**
 * "claim": the map starts empty and players take turns claiming territories.
 * "deal": territories are dealt out at random.
 * "neutral": neutral armies hold the world; each player starts with a small foothold.
 */
export type SetupMode = "claim" | "deal" | "neutral";
export type CardMode = "progressive" | "fixed";

export interface GameSettings {
  setupMode: SetupMode;
  /** Classic rules move to one adjacent territory; many modern editions allow any connected chain. */
  fortifyRule: FortifyRule;
  /** Progressive: 4, 6, 8, 10, 12, 15, +5. Fixed (European editions): 4 / 6 / 8 / 10 by set type. */
  cardMode: CardMode;
  /** Seconds per turn, or null for no timer. */
  turnSeconds: number | null;
}

export const DEFAULT_SETTINGS: GameSettings = {
  setupMode: "claim",
  fortifyRule: "adjacent",
  cardMode: "progressive",
  turnSeconds: 120,
};

export const TURN_SECONDS_OPTIONS = [null, 60, 90, 120, 180] as const;

/** Every move during a turn adds this much time, up to the full turn length. */
export const TIME_BONUS_SECONDS = 15;

/** Time for each pick while claiming territories. */
export const CLAIM_SECONDS = 20;

/** Neutral world: connected territories each player starts with. */
export const NEUTRAL_WORLD_START = 3;
/** Neutral world: each neutral territory starts with 1 to this many armies. */
export const NEUTRAL_WORLD_MAX_ARMIES = 3;

export type GameStatus = "setup" | "playing" | "finished";
/** Setup runs "claim" (claim-mode games only), then "setup" (everyone places their remaining starting armies). */
export type Phase = "claim" | "setup" | "reinforce" | "attack" | "fortify" | "over";

/** Running totals for the end-of-game stats screen. */
export interface PlayerStats {
  turns: number;
  /** Armies received at the start of turns (territories and continents). */
  reinforcements: number;
  setsTraded: number;
  /** Armies received from card sets. */
  cardArmies: number;
  /** Attack or blitz commands. */
  attacks: number;
  /** Dice rounds rolled as the attacker. */
  rolls: number;
  attackDice: number;
  attackPips: number;
  defendDice: number;
  defendPips: number;
  /** Territories captured. */
  conquests: number;
  territoriesLost: number;
  /** Enemy armies destroyed, attacking or defending. */
  armiesDestroyed: number;
  armiesLost: number;
  /** Enemy armies destroyed while defending. */
  defensiveKills: number;
  /** Players this player knocked out. */
  eliminations: number;
  fortifies: number;
  peakTerritories: number;
  peakArmies: number;
  /** Turn number when the player was knocked out, resigned or was removed; null while still in. */
  outOnTurn: number | null;
  /** Who knocked them out or removed them (null for resigning or timing out). */
  outBy: PlayerId | null;
  /** Final placing, 1 for the winner: set when the player goes out (or wins). */
  place: number | null;
}

/** Board totals when a turn starts (and once at the end), indexed like `players`. */
export interface HistoryPoint {
  turn: number;
  territories: number[];
  armies: number[];
}

export interface TerritoryState {
  owner: PlayerId | null;
  armies: number;
}

/**
 * Set after a capture. The minimum armies already moved in; the attacker may
 * move up to `maxExtra` more before doing anything else.
 */
export interface PendingCapture {
  from: TerritoryId;
  to: TerritoryId;
  maxExtra: number;
}

/** Everything every player may see. */
export interface CoreState {
  settings: GameSettings;
  status: GameStatus;
  players: PlayerState[];
  /** Human player ids in turn order (never contains the neutral army). */
  turnOrder: PlayerId[];
  currentPlayer: PlayerId | null;
  phase: Phase;
  territories: Record<TerritoryId, TerritoryState>;
  /** Setup phase: starting armies each player still has to place (0 = ready). */
  setupPools: Record<PlayerId, number>;
  /** Armies the current player still has to place. */
  reinforcements: number;
  pendingCapture: PendingCapture | null;
  /** Set when eliminating a player leaves the attacker with 6+ cards: trade down to 4 before continuing. */
  eliminationTrade: boolean;
  conqueredThisTurn: boolean;
  /** The +2 bonus for trading a card showing an owned territory is paid at most once per turn. */
  territoryBonusUsed: boolean;
  /** Sets traded by all players so far; drives the progressive value table. */
  setsTraded: number;
  turnNumber: number;
  /** Epoch ms when the current turn (or setup) times out, or null when there is no timer. */
  turnDeadline: number | null;
  winner: PlayerId | null;
  /** Missing on games saved before stats existed. */
  stats?: Record<PlayerId, PlayerStats>;
  history?: HistoryPoint[];
}

export interface PublicState extends CoreState {
  cardCounts: Record<PlayerId, number>;
  deckCount: number;
}

/** Hidden information: only the server (or the local hot-seat store) holds it. */
export interface PrivateState {
  deck: Card[];
  discard: Card[];
  hands: Record<PlayerId, Card[]>;
}

export interface GameState extends CoreState, PrivateState {}

export type Placements = Partial<Record<TerritoryId, number>>;

export type GameAction =
  | { type: "claim"; territory: TerritoryId }
  | { type: "setupPlace"; placements: Placements }
  | { type: "autoSetup" }
  | { type: "reinforce"; placements: Placements }
  | { type: "trade"; cardIds: number[] }
  | { type: "attack"; from: TerritoryId; to: TerritoryId; dice?: number }
  | { type: "blitz"; from: TerritoryId; to: TerritoryId }
  | { type: "moveMore"; count: number }
  | { type: "endAttack" }
  | { type: "fortify"; from: TerritoryId; to: TerritoryId; count: number }
  | { type: "endTurn" }
  | { type: "resign" }
  | { type: "claimTimeout" }
  /** Removes another player; online only the host may send it (checked by the server). */
  | { type: "kick"; player: PlayerId };

export type GameActionType = GameAction["type"];

export interface BattleRoll {
  attacker: number[];
  defender: number[];
}

export type GameEvent =
  | { type: "gameStarted" }
  | { type: "claimed"; player: PlayerId; territory: TerritoryId }
  | { type: "claimsComplete" }
  | { type: "setupReady"; player: PlayerId }
  | { type: "turnStarted"; player: PlayerId; turn: number; reinforcements: number }
  | { type: "reinforced"; player: PlayerId; placements: Placements }
  | { type: "traded"; player: PlayerId; armies: number; bonusTerritory: TerritoryId | null }
  | {
      type: "battle";
      player: PlayerId;
      defender: PlayerId | null;
      from: TerritoryId;
      to: TerritoryId;
      rolls: BattleRoll[];
      attackerLosses: number;
      defenderLosses: number;
      captured: boolean;
      movedIn: number;
    }
  | { type: "movedIn"; player: PlayerId; from: TerritoryId; to: TerritoryId; count: number }
  | { type: "eliminated"; player: PlayerId; by: PlayerId; cardsTaken: number }
  | { type: "fortified"; player: PlayerId; from: TerritoryId; to: TerritoryId; count: number }
  | { type: "cardDrawn"; player: PlayerId }
  | { type: "timedOut"; player: PlayerId; strikes: number }
  | { type: "resigned"; player: PlayerId }
  | { type: "kicked"; player: PlayerId; by: PlayerId }
  | { type: "gameOver"; winner: PlayerId | null };

export function playerById(state: CoreState, id: PlayerId | null): PlayerState | undefined {
  return id === null ? undefined : state.players.find((p) => p.id === id);
}

/** Human players still in the game. */
export function activePlayers(state: CoreState): PlayerState[] {
  return state.players.filter((p) => !p.neutral && p.status === "active");
}
