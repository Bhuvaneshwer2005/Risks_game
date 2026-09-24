// The rules engine: one pure reducer, `applyAction`, that every client of the
// game goes through - the online Edge Function, the local hot-seat store and
// the tests. Every legality check lives here, so no caller can skip one.

import { ADJACENCY, ALL_TERRITORY_IDS, TERRITORIES, areAdjacent, type TerritoryId } from "./mapData.ts";
import { buildDeck, isValidCardSet, setValue, suggestSet } from "./cards.ts";
import { maxAttackerDice, maxDefenderDice, resolveAttackRoll } from "./combat.ts";
import { canFortifyBetween } from "./fortify.ts";
import { calculateReinforcements } from "./reinforcements.ts";
import { randomInt, rollDie, shuffle, type Rng } from "./rng.ts";
import {
  DEFAULT_SETTINGS,
  NEUTRAL_ID,
  activePlayers,
  type BattleRoll,
  type Card,
  type GameAction,
  type GameEvent,
  type GameSettings,
  type GameState,
  type Phase,
  type Placements,
  type PlayerId,
  type PlayerState,
  type TerritoryState,
} from "./types.ts";

/** An illegal action. The message is written for the player who tried it. */
export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

function fail(message: string): never {
  throw new RuleError(message);
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const MAX_TIMEOUT_STRIKES = 3;
export const NEUTRAL_COLOR = "#8b93a1";
/** Setup gets twice the normal turn time: everyone places their whole starting pool. */
const SETUP_TIME_MULTIPLIER = 2;

// Classic starting-army table: 35/30/25/20 for 3-6 players, and 40 each in
// the official 2-player game (which also gives the neutral army 40).
export function startingArmies(playerCount: number): number {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new RuleError(`Risk needs ${MIN_PLAYERS}-${MAX_PLAYERS} players, got ${playerCount}`);
  }
  return 50 - 5 * playerCount;
}

export interface NewPlayer {
  id: PlayerId;
  name: string;
  color: string;
}

export interface CreateGameOptions {
  players: NewPlayer[];
  settings?: Partial<GameSettings>;
  rng: Rng;
  now: number;
}

// Official quick setup: deal the territories out at random with one army on
// each, then every player places the rest of their starting armies (the
// setup phase). In a 2-player game the neutral army's pool is placed at random.
export function createGame(options: CreateGameOptions): GameState {
  const { rng, now } = options;
  const seats = options.players;
  const armiesEach = startingArmies(seats.length);
  if (new Set(seats.map((p) => p.id)).size !== seats.length) throw new RuleError("Player ids must be unique");
  if (seats.some((p) => p.id === NEUTRAL_ID)) throw new RuleError(`"${NEUTRAL_ID}" is reserved`);

  const settings: GameSettings = { ...DEFAULT_SETTINGS, ...options.settings };
  const withNeutral = seats.length === 2;

  const players: PlayerState[] = seats.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    neutral: false,
    status: "active",
    timeoutStrikes: 0,
  }));
  if (withNeutral) {
    players.push({ id: NEUTRAL_ID, name: "Neutral", color: NEUTRAL_COLOR, neutral: true, status: "active", timeoutStrikes: 0 });
  }

  const turnOrder = shuffle(
    seats.map((p) => p.id),
    rng,
  );
  const holders = withNeutral ? [...turnOrder, NEUTRAL_ID] : turnOrder;

  const territories = {} as Record<TerritoryId, TerritoryState>;
  shuffle(ALL_TERRITORY_IDS, rng).forEach((id, i) => {
    territories[id] = { owner: holders[i % holders.length], armies: 1 };
  });

  const setupPools: Record<PlayerId, number> = {};
  for (const id of turnOrder) setupPools[id] = armiesEach - ownedBy(territories, id).length;
  if (withNeutral) {
    distributeArmies(territories, NEUTRAL_ID, armiesEach - ownedBy(territories, NEUTRAL_ID).length, rng, false);
  }

  const hands: Record<PlayerId, Card[]> = {};
  for (const p of players) hands[p.id] = [];

  return {
    settings,
    status: "setup",
    players,
    turnOrder,
    currentPlayer: null,
    phase: "setup",
    territories,
    setupPools,
    reinforcements: 0,
    pendingCapture: null,
    eliminationTrade: false,
    conqueredThisTurn: false,
    territoryBonusUsed: false,
    setsTraded: 0,
    turnNumber: 0,
    turnDeadline: settings.turnSeconds ? now + settings.turnSeconds * SETUP_TIME_MULTIPLIER * 1000 : null,
    winner: null,
    deck: shuffle(buildDeck(), rng),
    discard: [],
    hands,
  };
}

export interface ActionContext {
  /** The player sending the action (from auth on the server). */
  actor: PlayerId;
  rng: Rng;
  /** Epoch ms, used for the turn timer. */
  now: number;
}

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

export function applyAction(state: GameState, action: GameAction, ctx: ActionContext): ActionResult {
  if (state.status === "finished") fail("The game is over");
  const turn = new ActionRunner(structuredClone(state), ctx);
  turn.dispatch(action);
  return { state: turn.s, events: turn.events };
}

function ownedBy(territories: Record<TerritoryId, TerritoryState>, playerId: PlayerId): TerritoryId[] {
  return ALL_TERRITORY_IDS.filter((t) => territories[t].owner === playerId);
}

// Drops `count` armies one at a time onto the player's territories. With
// `preferBorders`, only territories next to an enemy are used (when there are
// any), which is where a player would actually want them.
function distributeArmies(
  territories: Record<TerritoryId, TerritoryState>,
  playerId: PlayerId,
  count: number,
  rng: Rng,
  preferBorders: boolean,
): Placements {
  const owned = ownedBy(territories, playerId);
  const borders = owned.filter((t) => ADJACENCY[t].some((n) => territories[n].owner !== playerId));
  const pool = preferBorders && borders.length > 0 ? borders : owned;
  const placements: Placements = {};
  if (pool.length === 0) return placements;
  for (let i = 0; i < count; i++) {
    const t = pool[randomInt(rng, pool.length)];
    territories[t].armies += 1;
    placements[t] = (placements[t] ?? 0) + 1;
  }
  return placements;
}

function territoryName(id: TerritoryId): string {
  return TERRITORIES[id].name;
}

const PHASE_LABEL: Record<Phase, string> = {
  setup: "setup",
  reinforce: "reinforce",
  attack: "attack",
  fortify: "fortify",
  over: "game over",
};

class ActionRunner {
  s: GameState;
  ctx: ActionContext;
  events: GameEvent[] = [];

  constructor(s: GameState, ctx: ActionContext) {
    this.s = s;
    this.ctx = ctx;
  }

  dispatch(action: GameAction): void {
    switch (action.type) {
      case "setupPlace":
        return this.setupPlace(action.placements);
      case "autoSetup":
        return this.autoSetup();
      case "reinforce":
        return this.reinforce(action.placements);
      case "trade":
        return this.trade(action.cardIds);
      case "attack":
        return this.attack(action.from, action.to, action.dice, false);
      case "blitz":
        return this.attack(action.from, action.to, undefined, true);
      case "moveMore":
        return this.moveMore(action.count);
      case "endAttack":
        return this.endAttack();
      case "fortify":
        return this.fortify(action.from, action.to, action.count);
      case "endTurn":
        return this.endTurn();
      case "resign":
        return this.resign();
      case "claimTimeout":
        return this.claimTimeout();
      default:
        fail(`Unknown action "${String((action as { type?: unknown }).type)}"`);
    }
  }

  // ---- lookups and guards ----

  get actor(): PlayerId {
    return this.ctx.actor;
  }

  player(id: PlayerId): PlayerState | undefined {
    return this.s.players.find((p) => p.id === id);
  }

  hand(id: PlayerId): Card[] {
    return (this.s.hands[id] ??= []);
  }

  requireActiveHuman(): PlayerState {
    const p = this.player(this.actor);
    if (!p || p.neutral) fail("You're not a player in this game");
    if (p.status !== "active") fail("You're no longer in this game");
    return p;
  }

  requirePlaying(): void {
    if (this.s.status !== "playing") fail("The game hasn't started yet");
  }

  requireTurn(): void {
    this.requirePlaying();
    this.requireActiveHuman();
    if (this.s.currentPlayer !== this.actor) fail("It's not your turn");
  }

  requirePhase(...phases: Phase[]): void {
    if (!phases.includes(this.s.phase)) fail(`You can't do that during the ${PHASE_LABEL[this.s.phase]} phase`);
  }

  requireNoTradeDue(): void {
    if (this.s.eliminationTrade) fail("Trade in cards until you hold 4 or fewer first");
  }

  requireNoArmiesToPlace(): void {
    if (this.s.reinforcements > 0) fail(`Place your remaining ${this.s.reinforcements} armies first`);
  }

  territory(id: unknown): TerritoryId {
    if (typeof id !== "string" || !Object.hasOwn(TERRITORIES, id)) fail("Unknown territory");
    return id as TerritoryId;
  }

  int(value: unknown, min: number, max: number, what: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      fail(min === max ? `${what} must be exactly ${min}` : `${what} must be a whole number from ${min} to ${max}`);
    }
    return value;
  }

  placementList(placements: unknown): [TerritoryId, number][] {
    if (!placements || typeof placements !== "object" || Array.isArray(placements)) fail("Placements are missing");
    const list = Object.entries(placements).map(([id, n]): [TerritoryId, number] => {
      const t = this.territory(id);
      if (this.s.territories[t].owner !== this.actor) fail(`You don't hold ${territoryName(t)}`);
      return [t, this.int(n, 1, 1_000_000, "Armies per territory")];
    });
    if (list.length === 0) fail("Place at least one army");
    return list;
  }

  deadline(seconds: number | null): number | null {
    return seconds ? this.ctx.now + seconds * 1000 : null;
  }

  // ---- setup ----

  setupPlace(placements: unknown): void {
    if (this.s.status !== "setup") fail("Setup is already over");
    this.requireActiveHuman();
    const pool = this.s.setupPools[this.actor] ?? 0;
    if (pool === 0) fail("You've already placed your starting armies");
    const list = this.placementList(placements);
    const sum = list.reduce((total, [, n]) => total + n, 0);
    if (sum !== pool) fail(`Place exactly ${pool} armies (you placed ${sum})`);
    for (const [t, n] of list) this.s.territories[t].armies += n;
    this.s.setupPools[this.actor] = 0;
    this.events.push({ type: "setupReady", player: this.actor });
    this.maybeFinishSetup();
  }

  autoSetup(): void {
    if (this.s.status !== "setup") fail("Setup is already over");
    this.requireActiveHuman();
    if ((this.s.setupPools[this.actor] ?? 0) === 0) fail("You've already placed your starting armies");
    this.autoPlaceSetup(this.actor);
    this.maybeFinishSetup();
  }

  autoPlaceSetup(playerId: PlayerId): void {
    distributeArmies(this.s.territories, playerId, this.s.setupPools[playerId] ?? 0, this.ctx.rng, false);
    this.s.setupPools[playerId] = 0;
    this.events.push({ type: "setupReady", player: playerId });
  }

  maybeFinishSetup(): void {
    if (activePlayers(this.s).some((p) => (this.s.setupPools[p.id] ?? 0) > 0)) return;
    this.s.status = "playing";
    this.events.push({ type: "gameStarted" });
    if (this.checkWinner()) return;
    const first = this.s.turnOrder.find((id) => this.player(id)?.status === "active");
    if (first) this.startTurn(first);
  }

  // ---- turn flow ----

  startTurn(playerId: PlayerId): void {
    const s = this.s;
    s.currentPlayer = playerId;
    s.phase = "reinforce";
    s.reinforcements = calculateReinforcements(s, playerId);
    s.pendingCapture = null;
    s.eliminationTrade = false;
    s.conqueredThisTurn = false;
    s.territoryBonusUsed = false;
    s.turnNumber += 1;
    s.turnDeadline = this.deadline(s.settings.turnSeconds);
    this.events.push({ type: "turnStarted", player: playerId, turn: s.turnNumber, reinforcements: s.reinforcements });
  }

  /** Ends the current player's turn: draw a card if they conquered, then pass to the next active player. */
  finishTurn(byPlayer: boolean): void {
    const playerId = this.s.currentPlayer;
    if (!playerId) return;
    const p = this.player(playerId);
    if (byPlayer && p) p.timeoutStrikes = 0;
    this.s.pendingCapture = null;
    this.s.eliminationTrade = false;
    this.s.reinforcements = 0;
    if (this.s.conqueredThisTurn && p?.status === "active") this.drawCard(playerId);
    this.advanceTurn(playerId);
  }

  advanceTurn(fromPlayer: PlayerId): void {
    if (this.checkWinner()) return;
    const order = this.s.turnOrder;
    const start = order.indexOf(fromPlayer);
    for (let step = 1; step <= order.length; step++) {
      const next = order[(start + step) % order.length];
      if (this.player(next)?.status === "active") {
        this.startTurn(next);
        return;
      }
    }
  }

  drawCard(playerId: PlayerId): void {
    const s = this.s;
    if (s.deck.length === 0 && s.discard.length > 0) {
      s.deck = shuffle(s.discard, this.ctx.rng);
      s.discard = [];
    }
    const card = s.deck.shift();
    if (!card) return;
    this.hand(playerId).push(card);
    this.events.push({ type: "cardDrawn", player: playerId });
  }

  checkWinner(): boolean {
    const alive = activePlayers(this.s);
    if (alive.length > 1) return false;
    const s = this.s;
    s.status = "finished";
    s.phase = "over";
    s.winner = alive[0]?.id ?? null;
    s.currentPlayer = null;
    s.turnDeadline = null;
    s.pendingCapture = null;
    s.reinforcements = 0;
    s.eliminationTrade = false;
    this.events.push({ type: "gameOver", winner: s.winner });
    return true;
  }

  // ---- reinforce and cards ----

  reinforce(placements: unknown): void {
    this.requireTurn();
    this.requirePhase("reinforce", "attack");
    this.requireNoTradeDue();
    if (this.s.phase === "reinforce" && this.hand(this.actor).length >= 5) {
      fail("You hold 5 or more cards, so you must trade in a set first");
    }
    if (this.s.reinforcements === 0) fail("You have no armies to place");
    const list = this.placementList(placements);
    const sum = list.reduce((total, [, n]) => total + n, 0);
    if (sum > this.s.reinforcements) fail(`You only have ${this.s.reinforcements} armies to place`);
    for (const [t, n] of list) this.s.territories[t].armies += n;
    this.s.reinforcements -= sum;
    this.events.push({ type: "reinforced", player: this.actor, placements: Object.fromEntries(list) });
    if (this.s.phase === "reinforce" && this.s.reinforcements === 0) this.s.phase = "attack";
  }

  trade(cardIds: unknown): void {
    this.requireTurn();
    if (this.s.phase !== "reinforce" && !this.s.eliminationTrade) {
      fail("You can only trade cards at the start of your turn");
    }
    if (!Array.isArray(cardIds) || cardIds.length !== 3 || new Set(cardIds).size !== 3) {
      fail("Pick exactly 3 different cards");
    }
    this.tradeSet(this.actor, cardIds);
  }

  tradeSet(playerId: PlayerId, cardIds: unknown[]): void {
    const s = this.s;
    const hand = this.hand(playerId);
    const cards = cardIds.map((id) => hand.find((c) => c.id === id) ?? fail("That card isn't in your hand"));
    if (!isValidCardSet(cards)) fail("That's not a valid set: pick 3 of a kind or one of each");

    s.setsTraded += 1;
    const armies = setValue(cards, s.settings.cardMode, s.setsTraded);
    s.reinforcements += armies;

    // +2 on a pictured territory the player holds, placed there, once per turn.
    let bonusTerritory: TerritoryId | null = null;
    if (!s.territoryBonusUsed) {
      const match = cards.find((c) => c.territory && s.territories[c.territory].owner === playerId);
      if (match?.territory) {
        s.territories[match.territory].armies += 2;
        s.territoryBonusUsed = true;
        bonusTerritory = match.territory;
      }
    }

    s.hands[playerId] = hand.filter((c) => !cards.includes(c));
    s.discard.push(...cards);
    if (s.eliminationTrade && s.hands[playerId].length <= 4) s.eliminationTrade = false;
    this.events.push({ type: "traded", player: playerId, armies, bonusTerritory });
  }

  // ---- attack ----

  attack(fromId: unknown, toId: unknown, dice: unknown, blitz: boolean): void {
    this.requireTurn();
    this.requirePhase("attack");
    this.requireNoTradeDue();
    this.requireNoArmiesToPlace();
    const s = this.s;
    // Attacking again accepts the last capture's move-in as it stands.
    s.pendingCapture = null;

    const from = this.territory(fromId);
    const to = this.territory(toId);
    const src = s.territories[from];
    const dst = s.territories[to];
    if (src.owner !== this.actor) fail(`You don't hold ${territoryName(from)}`);
    if (dst.owner === this.actor) fail("You can't attack your own territory");
    if (!areAdjacent(from, to)) fail(`${territoryName(from)} doesn't border ${territoryName(to)}`);
    if (src.armies < 2) fail(`${territoryName(from)} needs at least 2 armies to attack`);
    const chosenDice =
      !blitz && dice !== undefined && dice !== null ? this.int(dice, 1, maxAttackerDice(src.armies), "Attack dice") : null;

    const defender = dst.owner;
    const rolls: BattleRoll[] = [];
    let attackerLosses = 0;
    let defenderLosses = 0;
    let lastDice = 0;
    const die = () => rollDie(this.ctx.rng);
    do {
      // The defender always rolls the most dice allowed (auto-defend).
      const attackerDice = Math.min(chosenDice ?? 3, maxAttackerDice(src.armies));
      const roll = resolveAttackRoll(src.armies, dst.armies, attackerDice, maxDefenderDice(dst.armies), die);
      src.armies -= roll.attackerLosses;
      dst.armies -= roll.defenderLosses;
      attackerLosses += roll.attackerLosses;
      defenderLosses += roll.defenderLosses;
      rolls.push({ attacker: roll.attackerDice, defender: roll.defenderDice });
      lastDice = attackerDice;
    } while (blitz && dst.armies > 0 && src.armies >= 2);

    const captured = dst.armies === 0;
    let movedIn = 0;
    if (captured) {
      // The attacker never loses armies on the capturing roll, so at least
      // lastDice + 1 armies remain: the minimum move-in always fits.
      movedIn = lastDice;
      dst.owner = this.actor;
      dst.armies = movedIn;
      src.armies -= movedIn;
      s.conqueredThisTurn = true;
      s.pendingCapture = src.armies > 1 ? { from, to, maxExtra: src.armies - 1 } : null;
    }

    this.events.push({
      type: "battle",
      player: this.actor,
      defender,
      from,
      to,
      rolls,
      attackerLosses,
      defenderLosses,
      captured,
      movedIn,
    });

    if (captured && defender) this.afterCapture(defender);
  }

  afterCapture(defenderId: PlayerId): void {
    const s = this.s;
    const defender = this.player(defenderId);
    if (!defender || defender.neutral) return;
    if (ALL_TERRITORY_IDS.some((t) => s.territories[t].owner === defenderId)) return;

    // Knocking a player out hands you their cards.
    const taken = this.hand(defenderId);
    defender.status = "eliminated";
    s.hands[defenderId] = [];
    s.hands[this.actor] = [...this.hand(this.actor), ...taken];
    this.events.push({ type: "eliminated", player: defenderId, by: this.actor, cardsTaken: taken.length });
    if (this.checkWinner()) return;
    if (taken.length > 0 && s.hands[this.actor].length >= 6) s.eliminationTrade = true;
  }

  moveMore(count: unknown): void {
    this.requireTurn();
    const pending = this.s.pendingCapture;
    if (!pending) fail("There's no capture to move armies into");
    const n = this.int(count, 1, this.s.territories[pending.from].armies - 1, "Armies to move");
    this.s.territories[pending.from].armies -= n;
    this.s.territories[pending.to].armies += n;
    this.s.pendingCapture = null;
    this.events.push({ type: "movedIn", player: this.actor, from: pending.from, to: pending.to, count: n });
  }

  endAttack(): void {
    this.requireTurn();
    this.requirePhase("attack");
    this.requireNoTradeDue();
    this.requireNoArmiesToPlace();
    this.s.pendingCapture = null;
    this.s.phase = "fortify";
  }

  // ---- fortify and end of turn ----

  fortify(fromId: unknown, toId: unknown, count: unknown): void {
    this.requireTurn();
    this.requirePhase("fortify");
    const s = this.s;
    const from = this.territory(fromId);
    const to = this.territory(toId);
    if (from === to) fail("Pick two different territories");
    if (s.territories[from].owner !== this.actor || s.territories[to].owner !== this.actor) {
      fail("You can only move armies between your own territories");
    }
    if (!canFortifyBetween(s, s.settings.fortifyRule, this.actor, from, to)) {
      fail(
        s.settings.fortifyRule === "adjacent"
          ? `${territoryName(from)} doesn't border ${territoryName(to)}`
          : `None of your territories connect ${territoryName(from)} to ${territoryName(to)}`,
      );
    }
    if (s.territories[from].armies < 2) fail(`${territoryName(from)} has no spare armies to move`);
    const n = this.int(count, 1, s.territories[from].armies - 1, "Armies to move");
    s.territories[from].armies -= n;
    s.territories[to].armies += n;
    this.events.push({ type: "fortified", player: this.actor, from, to, count: n });
    // One fortify per turn, and it ends the turn.
    this.finishTurn(true);
  }

  endTurn(): void {
    this.requireTurn();
    this.requirePhase("attack", "fortify");
    this.requireNoTradeDue();
    this.requireNoArmiesToPlace();
    this.finishTurn(true);
  }

  // ---- leaving and timeouts ----

  resign(): void {
    const s = this.s;
    const p = this.requireActiveHuman();

    if (s.status === "setup") {
      if ((s.setupPools[p.id] ?? 0) > 0) this.autoPlaceSetup(p.id);
      this.markResigned(p);
      if (this.checkWinner()) return;
      this.maybeFinishSetup();
      return;
    }

    this.requirePlaying();
    this.markResigned(p);
    if (s.currentPlayer === p.id) {
      s.conqueredThisTurn = false;
      this.finishTurn(false);
    } else {
      this.checkWinner();
    }
  }

  // A resigned player's armies stay on the board and defend, but never act.
  markResigned(p: PlayerState): void {
    p.status = "resigned";
    this.s.discard.push(...this.hand(p.id));
    this.s.hands[p.id] = [];
    this.events.push({ type: "resigned", player: p.id });
  }

  claimTimeout(): void {
    const s = this.s;
    if (s.turnDeadline === null) fail("This game has no turn timer");
    if (this.ctx.now < s.turnDeadline) fail("The turn timer hasn't run out yet");

    if (s.status === "setup") {
      for (const p of activePlayers(s)) {
        if ((s.setupPools[p.id] ?? 0) > 0) this.autoPlaceSetup(p.id);
      }
      this.maybeFinishSetup();
      return;
    }

    this.requirePlaying();
    const playerId = s.currentPlayer;
    const p = playerId ? this.player(playerId) : undefined;
    if (!playerId || !p) fail("Nobody is taking a turn");

    this.autoCompleteTurn(playerId);
    p.timeoutStrikes += 1;
    this.events.push({ type: "timedOut", player: playerId, strikes: p.timeoutStrikes });
    if (p.timeoutStrikes >= MAX_TIMEOUT_STRIKES) {
      this.markResigned(p);
      s.conqueredThisTurn = false;
    }
    this.finishTurn(false);
  }

  // Does the minimum a timed-out player owes: forced trades, then armies onto
  // border territories. No attacks.
  autoCompleteTurn(playerId: PlayerId): void {
    const s = this.s;
    s.pendingCapture = null;
    while (s.eliminationTrade || (s.phase === "reinforce" && this.hand(playerId).length >= 5)) {
      const owned = new Set<string>(ownedBy(s.territories, playerId));
      const set = suggestSet(this.hand(playerId), owned, s.settings.cardMode, s.setsTraded + 1);
      if (!set) break;
      this.tradeSet(
        playerId,
        set.map((c) => c.id),
      );
    }
    s.eliminationTrade = false;
    if (s.reinforcements > 0) {
      const placements = distributeArmies(s.territories, playerId, s.reinforcements, this.ctx.rng, true);
      s.reinforcements = 0;
      this.events.push({ type: "reinforced", player: playerId, placements });
    }
  }
}
