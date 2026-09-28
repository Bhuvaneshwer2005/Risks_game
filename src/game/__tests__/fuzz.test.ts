// Plays many complete seeded games with a random-but-aggressive bot, checking
// the game's invariants after every accepted action. Alongside each real
// move it also fires a random (usually illegal) action at the engine, which
// must either be rejected with a RuleError or leave a valid state.

import { describe, expect, it } from "vitest";
import { ADJACENCY, ALL_TERRITORY_IDS, type TerritoryId } from "../mapData.ts";
import { TOTAL_CARDS, suggestSet } from "../cards.ts";
import { RuleError, applyAction, createGame } from "../engine.ts";
import { fortifyTargets, nextSetupPlayer } from "../selectors.ts";
import { mulberry32, randomInt, type Rng } from "../rng.ts";
import { activePlayers, type GameAction, type GameState, type PlayerId } from "../types.ts";

// FUZZ_GAMES=200 npm test runs a deeper pass.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const GAMES = Number(env.FUZZ_GAMES ?? 30);
const MAX_ACTIONS = 20_000;

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[randomInt(rng, items.length)];
}

function checkInvariants(s: GameState): void {
  const ids = new Set(s.players.map((p) => p.id));
  for (const t of ALL_TERRITORY_IDS) {
    const terr = s.territories[t];
    if (s.phase === "claim" && terr.owner === null) {
      if (terr.armies !== 0) throw new Error(`unclaimed ${t} has ${terr.armies} armies`);
      continue;
    }
    if (!terr.owner || !ids.has(terr.owner)) throw new Error(`${t} has a bad owner ${terr.owner}`);
    if (!Number.isInteger(terr.armies) || terr.armies < 1) throw new Error(`${t} has ${terr.armies} armies`);
  }
  const cards = [...s.deck, ...s.discard, ...Object.values(s.hands).flat()];
  if (cards.length !== TOTAL_CARDS || new Set(cards.map((c) => c.id)).size !== TOTAL_CARDS) {
    throw new Error(`card count broken: ${cards.length}`);
  }
  for (const p of s.players) {
    if (p.status === "eliminated" && ALL_TERRITORY_IDS.some((t) => s.territories[t].owner === p.id)) {
      throw new Error(`eliminated ${p.id} still owns territory`);
    }
    if (p.status !== "active" && (s.hands[p.id]?.length ?? 0) > 0) throw new Error(`${p.id} is out but holds cards`);
  }
  if (s.reinforcements < 0) throw new Error("negative reinforcements");
  if (s.status === "playing") {
    const current = s.players.find((p) => p.id === s.currentPlayer);
    if (!current || current.status !== "active" || current.neutral) throw new Error("bad current player");
  }
  if ((s.status === "finished") !== (s.phase === "over")) throw new Error("finished/over mismatch");
  if (s.status === "finished" && activePlayers(s).length > 1) throw new Error("finished with 2+ players left");
}

// A plausible move for whoever should act next.
function botMove(s: GameState, rng: Rng): { actor: PlayerId; action: GameAction } {
  if (s.status === "setup" && s.phase === "claim") {
    const actor = s.currentPlayer!;
    if (rng() < 0.01) return { actor, action: { type: "resign" } };
    const empty = ALL_TERRITORY_IDS.filter((t) => s.territories[t].owner === null);
    return { actor, action: { type: "claim", territory: pick(rng, empty) } };
  }
  if (s.status === "setup") {
    const actor = nextSetupPlayer(s)!;
    if (rng() < 0.5) return { actor, action: { type: "autoSetup" } };
    const mine = ALL_TERRITORY_IDS.filter((t) => s.territories[t].owner === actor);
    const a = pick(rng, mine);
    const b = pick(rng, mine);
    const pool = s.setupPools[actor];
    const first = randomInt(rng, pool + 1);
    const placements = a === b ? { [a]: pool } : { [a]: first, [b]: pool - first };
    for (const [k, v] of Object.entries(placements)) if (v === 0) delete (placements as Record<string, number>)[k];
    return { actor, action: { type: "setupPlace", placements } };
  }

  const actor = s.currentPlayer!;
  const hand = s.hands[actor];
  const mine = ALL_TERRITORY_IDS.filter((t) => s.territories[t].owner === actor);
  const owned = new Set<string>(mine);

  if (rng() < 0.001) return { actor, action: { type: "resign" } };
  if (rng() < 0.001) {
    const others = activePlayers(s).filter((p) => p.id !== actor);
    if (others.length) return { actor, action: { type: "kick", player: pick(rng, others).id } };
  }

  const mustTrade = s.eliminationTrade || (s.phase === "reinforce" && hand.length >= 5);
  if (mustTrade || (s.phase === "reinforce" && hand.length >= 3 && rng() < 0.3)) {
    const set = suggestSet(hand, owned, s.settings.cardMode, s.setsTraded + 1);
    if (set) return { actor, action: { type: "trade", cardIds: set.map((c) => c.id) } };
  }

  if (s.reinforcements > 0) {
    const borders = mine.filter((t) => ADJACENCY[t].some((n) => s.territories[n].owner !== actor));
    const target = pick(rng, borders.length ? borders : mine);
    return { actor, action: { type: "reinforce", placements: { [target]: s.reinforcements } } };
  }

  if (s.pendingCapture && rng() < 0.5) {
    const max = s.territories[s.pendingCapture.from].armies - 1;
    return { actor, action: { type: "moveMore", count: 1 + randomInt(rng, max) } };
  }

  if (s.phase === "attack") {
    const options: [TerritoryId, TerritoryId][] = [];
    for (const from of mine) {
      if (s.territories[from].armies < 2) continue;
      for (const to of ADJACENCY[from]) {
        if (s.territories[to].owner !== actor && s.territories[from].armies > s.territories[to].armies) options.push([from, to]);
      }
    }
    if (options.length > 0 && rng() < 0.92) {
      const [from, to] = pick(rng, options);
      return rng() < 0.6
        ? { actor, action: { type: "blitz", from, to } }
        : { actor, action: { type: "attack", from, to, dice: 1 + randomInt(rng, Math.min(3, s.territories[from].armies - 1)) } };
    }
    return { actor, action: rng() < 0.5 ? { type: "endAttack" } : { type: "endTurn" } };
  }

  if (s.phase === "fortify" && rng() < 0.6) {
    const sources = mine.filter((t) => s.territories[t].armies > 1);
    if (sources.length > 0) {
      const from = pick(rng, sources);
      const targets = fortifyTargets(s, s.settings.fortifyRule, actor, from);
      if (targets.length > 0) {
        return {
          actor,
          action: { type: "fortify", from, to: pick(rng, targets), count: 1 + randomInt(rng, s.territories[from].armies - 1) },
        };
      }
    }
  }
  return { actor, action: { type: "endTurn" } };
}

const ACTION_TYPES = [
  "setupPlace",
  "autoSetup",
  "reinforce",
  "trade",
  "attack",
  "blitz",
  "moveMore",
  "endAttack",
  "fortify",
  "endTurn",
  "resign",
  "claimTimeout",
] as const;
const JUNK_NUMBERS = [-1, 0, 1, 2, 3, 4, 2.5, NaN, 1e9];

// A random, usually-illegal action from a random player (or a stranger).
function junkMove(s: GameState, rng: Rng): { actor: PlayerId; action: GameAction } {
  const actor = rng() < 0.1 ? "stranger" : pick(rng, s.players).id;
  const t = () => (rng() < 0.05 ? "atlantis" : pick(rng, ALL_TERRITORY_IDS)) as TerritoryId;
  const n = () => pick(rng, JUNK_NUMBERS);
  const type = pick(rng, ACTION_TYPES);
  const action = {
    type,
    placements: { [t()]: n() },
    cardIds: [randomInt(rng, 46), randomInt(rng, 46), randomInt(rng, 46)],
    from: t(),
    to: t(),
    dice: n(),
    count: n(),
  } as unknown as GameAction;
  return { actor, action };
}

describe("fuzz: random full games", () => {
  it(`plays ${GAMES} complete games without breaking an invariant`, () => {
    let totalActions = 0;
    for (let game = 0; game < GAMES; game++) {
      const rng = mulberry32(1000 + game);
      const playerCount = 2 + (game % 5);
      const settings = {
        setupMode: game % 2 === 0 ? ("claim" as const) : ("deal" as const),
        fortifyRule: game % 2 === 0 ? ("adjacent" as const) : ("connected" as const),
        cardMode: game % 3 === 0 ? ("fixed" as const) : ("progressive" as const),
        turnSeconds: game % 4 === 0 ? 60 : null,
      };
      let now = 0;
      let s = createGame({
        players: Array.from({ length: playerCount }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: "#fff" })),
        settings,
        rng,
        now,
      });
      checkInvariants(s);

      let actions = 0;
      while (s.status !== "finished") {
        if (++actions > MAX_ACTIONS) throw new Error(`game ${game} did not finish`);
        now += 1_000;

        const junk = junkMove(s, rng);
        if (actions % 3 === 0) try {
          checkInvariants(applyAction(s, junk.action, { ...junk, rng, now }).state);
        } catch (e) {
          if (!(e instanceof RuleError)) throw new Error(`game ${game}: junk ${JSON.stringify(junk)} crashed: ${e}`);
        }

        // Occasionally let the clock run out on whoever is due to act.
        const timedOut = s.turnDeadline !== null && rng() < 0.01;
        if (timedOut) now = s.turnDeadline!;
        const { actor, action } = timedOut
          ? { actor: pick(rng, s.players).id, action: { type: "claimTimeout" } as GameAction }
          : botMove(s, rng);
        try {
          s = applyAction(s, action, { actor, rng, now }).state;
        } catch (e) {
          throw new Error(`game ${game}: bot move ${JSON.stringify({ actor, action })} rejected: ${(e as Error).message}`);
        }
        checkInvariants(s);
      }
      expect(s.winner).not.toBeNull();
      totalActions += actions;
    }
    console.log(`fuzz: ${GAMES} games, ${totalActions} actions`);
    expect(totalActions).toBeGreaterThan(GAMES);
  }, 600_000);
});
