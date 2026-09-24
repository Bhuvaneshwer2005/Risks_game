import { describe, expect, it } from "vitest";
import { ALL_TERRITORY_IDS } from "../mapData.ts";
import { RuleError, applyAction, createGame, startingArmies } from "../engine.ts";
import { mulberry32 } from "../rng.ts";
import { NEUTRAL_ID, type GameState } from "../types.ts";
import { act } from "./testHelpers.ts";

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, color: `#${i}${i}${i}` }));
const newGame = (n: number, turnSeconds: number | null = null) =>
  createGame({ players: seats(n), settings: { turnSeconds }, rng: mulberry32(42), now: 1_000 });

const owned = (s: GameState, id: string) => ALL_TERRITORY_IDS.filter((t) => s.territories[t].owner === id);
const armiesOf = (s: GameState, id: string) => owned(s, id).reduce((sum, t) => sum + s.territories[t].armies, 0);

describe("startingArmies", () => {
  it("matches the classic table", () => {
    expect([2, 3, 4, 5, 6].map(startingArmies)).toEqual([40, 35, 30, 25, 20]);
  });

  it("rejects out-of-range player counts", () => {
    expect(() => startingArmies(1)).toThrow(RuleError);
    expect(() => startingArmies(7)).toThrow(RuleError);
  });
});

describe("createGame", () => {
  it("deals all 42 territories evenly with 1 army each and a shuffled 44-card deck", () => {
    const s = newGame(3);
    expect(s.status).toBe("setup");
    expect(s.phase).toBe("setup");
    for (const p of ["p1", "p2", "p3"]) {
      expect(owned(s, p)).toHaveLength(14);
      expect(s.setupPools[p]).toBe(35 - 14);
    }
    expect(ALL_TERRITORY_IDS.every((t) => s.territories[t].armies === 1)).toBe(true);
    expect(s.deck).toHaveLength(44);
    expect(s.players.some((p) => p.neutral)).toBe(false);
  });

  it("adds a neutral army with 14 territories and 40 armies in a 2-player game", () => {
    const s = newGame(2);
    const neutral = s.players.find((p) => p.id === NEUTRAL_ID)!;
    expect(neutral.neutral).toBe(true);
    expect(s.turnOrder).not.toContain(NEUTRAL_ID);
    expect(owned(s, NEUTRAL_ID)).toHaveLength(14);
    expect(armiesOf(s, NEUTRAL_ID)).toBe(40);
    expect(s.setupPools.p1).toBe(40 - 14);
  });

  it("gives uneven deals to the first players in turn order", () => {
    const s = newGame(4);
    const counts = s.turnOrder.map((p) => owned(s, p).length);
    expect(counts).toEqual([11, 11, 10, 10]);
  });

  it("sets a setup deadline of twice the turn time", () => {
    expect(newGame(3, 60).turnDeadline).toBe(1_000 + 120_000);
    expect(newGame(3, null).turnDeadline).toBeNull();
  });
});

describe("setup placement", () => {
  it("requires placing exactly the whole pool on your own territories", () => {
    const s = newGame(3);
    const mine = owned(s, "p1");
    const theirs = owned(s, "p2");
    expect(() => act(s, "p1", { type: "setupPlace", placements: { [mine[0]]: 5 } })).toThrow(/exactly 21/);
    expect(() => act(s, "p1", { type: "setupPlace", placements: { [theirs[0]]: 21 } })).toThrow(/don't hold/);
    const next = act(s, "p1", { type: "setupPlace", placements: { [mine[0]]: 20, [mine[1]]: 1 } }).state;
    expect(next.setupPools.p1).toBe(0);
    expect(next.territories[mine[0]].armies).toBe(21);
    expect(() => act(next, "p1", { type: "autoSetup" })).toThrow(/already placed/);
  });

  it("starts the first turn once everyone is ready", () => {
    let s = newGame(3, 90);
    s = act(s, "p1", { type: "autoSetup" }).state;
    s = act(s, "p2", { type: "autoSetup" }).state;
    expect(s.status).toBe("setup");
    const result = act(s, "p3", { type: "autoSetup" }, { now: 5_000 });
    s = result.state;
    expect(s.status).toBe("playing");
    expect(s.currentPlayer).toBe(s.turnOrder[0]);
    expect(s.phase).toBe("reinforce");
    expect(s.reinforcements).toBeGreaterThanOrEqual(3);
    expect(s.turnDeadline).toBe(5_000 + 90_000);
    expect(result.events.map((e) => e.type)).toEqual(["setupReady", "gameStarted", "turnStarted"]);
    for (const p of ["p1", "p2", "p3"]) expect(armiesOf(s, p)).toBe(35);
  });

  it("refuses turn actions before setup ends", () => {
    const s = newGame(3);
    expect(() => act(s, "p1", { type: "endTurn" })).toThrow(/hasn't started/);
  });
});

describe("full turn cycle", () => {
  it("reinforce -> attack -> fortify ends the turn and passes play on", () => {
    let s = newGame(3);
    for (const p of ["p1", "p2", "p3"]) s = act(s, p, { type: "autoSetup" }).state;
    const me = s.currentPlayer!;
    const mine = owned(s, me);
    s = act(s, me, { type: "reinforce", placements: { [mine[0]]: s.reinforcements } }).state;
    expect(s.phase).toBe("attack");
    s = act(s, me, { type: "endAttack" }).state;
    expect(s.phase).toBe("fortify");
    s = act(s, me, { type: "endTurn" }).state;
    expect(s.currentPlayer).toBe(s.turnOrder[1]);
    expect(s.phase).toBe("reinforce");
    expect(s.turnNumber).toBe(2);
  });

  it("never mutates the input state", () => {
    const s = newGame(3);
    const before = JSON.stringify(s);
    applyAction(s, { type: "autoSetup" }, { actor: "p1", rng: mulberry32(1), now: 0 });
    expect(JSON.stringify(s)).toBe(before);
  });

  it("rejects unknown actions and actors", () => {
    const s = newGame(3);
    expect(() => act(s, "p1", { type: "nope" } as never)).toThrow(/Unknown action/);
    expect(() => act(s, "stranger", { type: "autoSetup" })).toThrow(/not a player/);
    expect(() => act(s, NEUTRAL_ID, { type: "autoSetup" })).toThrow(/not a player/);
  });
});
