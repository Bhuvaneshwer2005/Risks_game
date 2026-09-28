import { describe, expect, it } from "vitest";
import { createGame, startingArmies } from "../engine.ts";
import { ADJACENCY, ALL_TERRITORY_IDS, type TerritoryId } from "../mapData.ts";
import { mulberry32 } from "../rng.ts";
import {
  CLAIM_SECONDS,
  DEFAULT_SETTINGS,
  NEUTRAL_ID,
  NEUTRAL_WORLD_MAX_ARMIES,
  NEUTRAL_WORLD_START,
  TIME_BONUS_SECONDS,
  type GameState,
} from "../types.ts";
import { act, fillRest, fixedDice, makeState, player, withOwner } from "./testHelpers.ts";

const SECOND = 1000;

function board(overrides: Partial<GameState> = {}): GameState {
  let s = makeState(overrides);
  s = withOwner(s, "p1", ["alaska"], 10);
  s = withOwner(s, "p1", ["alberta"], 3);
  s = withOwner(s, "p2", ["kamchatka"], 2);
  return fillRest(s, "p2");
}

describe("turn time bonus", () => {
  const timed = (deadline: number) =>
    board({ settings: { ...DEFAULT_SETTINGS, turnSeconds: 120 }, phase: "attack", turnDeadline: deadline });

  it("adds time after each move, so a last-second decision still counts", () => {
    const now = 100 * SECOND;
    const s = act(timed(now + 5 * SECOND), "p1", { type: "attack", from: "alaska", to: "kamchatka", dice: 1 }, { rng: fixedDice([6, 1, 1]), now }).state;
    expect(s.turnDeadline).toBe(now + 5 * SECOND + TIME_BONUS_SECONDS * SECOND);
  });

  it("never pushes the clock above a full turn", () => {
    const now = 100 * SECOND;
    const s = act(timed(now + 115 * SECOND), "p1", { type: "endAttack" }, { now }).state;
    expect(s.turnDeadline).toBe(now + 120 * SECOND);
  });

  it("counts from now when the deadline has already passed but nobody claimed it", () => {
    const now = 100 * SECOND;
    const s = act(timed(now - 3 * SECOND), "p1", { type: "endAttack" }, { now }).state;
    expect(s.turnDeadline).toBe(now + TIME_BONUS_SECONDS * SECOND);
  });

  it("gives a fresh full turn, not a bonus, when the turn passes", () => {
    const now = 100 * SECOND;
    const s = act(timed(now + 5 * SECOND), "p1", { type: "endTurn" }, { now }).state;
    expect(s.currentPlayer).toBe("p2");
    expect(s.turnDeadline).toBe(now + 120 * SECOND);
  });

  it("does nothing without a timer", () => {
    const s = act(board({ phase: "attack" }), "p1", { type: "endAttack" }).state;
    expect(s.turnDeadline).toBeNull();
  });
});

describe("kicking a player", () => {
  const three = () => {
    let s = makeState({ players: [player("p1"), player("p2"), player("p3")] });
    s = withOwner(s, "p1", ["alaska"], 5);
    s = withOwner(s, "p3", ["iceland"], 4);
    return fillRest(s, "p2");
  };

  it("takes them out, keeps their armies on the board, and discards their cards", () => {
    let s = three();
    s = { ...s, hands: { ...s.hands, p3: s.deck.slice(0, 2) }, deck: s.deck.slice(2) };
    const r = act(s, "p1", { type: "kick", player: "p3" });
    expect(r.state.players.find((p) => p.id === "p3")?.status).toBe("kicked");
    expect(r.state.territories.iceland).toEqual({ owner: "p3", armies: 4 });
    expect(r.state.hands.p3).toEqual([]);
    expect(r.state.discard).toHaveLength(2);
    expect(r.events).toContainEqual({ type: "kicked", player: "p3", by: "p1" });
    expect(r.state.status).toBe("playing");
  });

  it("passes the turn when the current player is removed", () => {
    const s = act(three(), "p2", { type: "kick", player: "p1" }).state;
    expect(s.currentPlayer).toBe("p2");
    expect(s.players.find((p) => p.id === "p1")?.status).toBe("kicked");
  });

  it("ends the game when only one player is left", () => {
    const s = act(board(), "p1", { type: "kick", player: "p2" }).state;
    expect(s.status).toBe("finished");
    expect(s.winner).toBe("p1");
  });

  it("rejects kicking yourself, a player who is already out, or nobody", () => {
    const s = three();
    expect(() => act(s, "p1", { type: "kick", player: "p1" })).toThrow(/resign instead/);
    expect(() => act(s, "p1", { type: "kick", player: "ghost" })).toThrow(/isn't in this game/);
    const out = act(s, "p1", { type: "kick", player: "p3" }).state;
    expect(() => act(out, "p1", { type: "kick", player: "p3" })).toThrow(/already out/);
  });

  it("works during setup, placing the removed player's starting armies for them", () => {
    const g = createGame({
      players: ["a", "b", "c"].map((id) => ({ id, name: id, color: "#fff" })),
      settings: { setupMode: "deal" },
      rng: mulberry32(3),
      now: 0,
    });
    const s = act(g, "a", { type: "kick", player: "c" }).state;
    expect(s.setupPools.c).toBe(0);
    expect(s.players.find((p) => p.id === "c")?.status).toBe("kicked");
  });
});

describe("stats", () => {
  it("records battles for both sides", () => {
    const s = act(board({ phase: "attack" }), "p1", { type: "attack", from: "alaska", to: "kamchatka", dice: 3 }, {
      rng: fixedDice([6, 6, 6, 1, 1]),
    }).state;
    const a = s.stats!.p1;
    const d = s.stats!.p2;
    expect(a).toMatchObject({ attacks: 1, rolls: 1, attackDice: 3, attackPips: 18, armiesDestroyed: 2, armiesLost: 0, conquests: 1 });
    expect(d).toMatchObject({ defendDice: 2, defendPips: 2, armiesLost: 2, territoriesLost: 1, defensiveKills: 0 });
  });

  it("works on games saved before stats existed", () => {
    const s = board({ phase: "attack" });
    delete s.stats;
    const next = act(s, "p1", { type: "endTurn" }).state;
    expect(next.stats!.p2.turns).toBe(1);
    expect(next.history).toHaveLength(1);
  });

  it("snapshots the board at the start, every turn, and the end", () => {
    let s = createGame({ players: [{ id: "a", name: "A", color: "#fff" }, { id: "b", name: "B", color: "#000" }, { id: "c", name: "C", color: "#f00" }], settings: { setupMode: "deal" }, rng: mulberry32(9), now: 0 });
    for (const id of ["a", "b", "c"]) s = act(s, id, { type: "autoSetup" }).state;
    // gameStarted + first turnStarted
    expect(s.history).toHaveLength(2);
    expect(s.history![0].territories.reduce((x, y) => x + y, 0)).toBe(42);
    const first = s.currentPlayer!;
    expect(s.stats![first].turns).toBe(1);
    expect(s.stats![first].reinforcements).toBe(s.reinforcements);
    const others = s.turnOrder.filter((id) => id !== first);
    for (const id of others) s = act(s, first, { type: "kick", player: id }).state;
    expect(s.status).toBe("finished");
    expect(s.history!.at(-1)!.territories.reduce((x, y) => x + y, 0)).toBe(42);
    expect(s.stats![others[0]].outOnTurn).toBe(1);
  });
});

describe("who knocked whom out", () => {
  const three = () => {
    let s = makeState({ players: [player("p1"), player("p2"), player("p3")], phase: "attack" });
    s = withOwner(s, "p1", ["greenland"], 10);
    s = withOwner(s, "p3", ["iceland"], 1);
    return fillRest(s, "p2");
  };

  it("records the conqueror, the remover, and nobody for resigning", () => {
    const conquered = act(three(), "p1", { type: "attack", from: "greenland", to: "iceland", dice: 3 }, { rng: fixedDice([6, 6, 6, 1]) }).state;
    expect(conquered.stats!.p3).toMatchObject({ outBy: "p1", outOnTurn: 1, place: 3 });

    const kicked = act(three(), "p1", { type: "kick", player: "p3" }).state;
    expect(kicked.stats!.p3.outBy).toBe("p1");

    const resigned = act(three(), "p3", { type: "resign" }).state;
    expect(resigned.stats!.p3.outBy).toBeNull();
  });

  it("records final places in the order players went out, even within one turn", () => {
    let s = act(three(), "p1", { type: "kick", player: "p3" }).state;
    s = act(s, "p1", { type: "kick", player: "p2" }).state;
    expect(s.status).toBe("finished");
    expect([s.stats!.p1.place, s.stats!.p2.place, s.stats!.p3.place]).toEqual([1, 2, 3]);
  });
});

describe("claiming territories (the default setup)", () => {
  const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: "#fff" }));

  it("starts on an empty map with the first player picking", () => {
    const g = createGame({ players: seats(3), rng: mulberry32(1), now: 0 });
    expect(g.phase).toBe("claim");
    expect(Object.values(g.territories).every((t) => t.owner === null && t.armies === 0)).toBe(true);
    expect(g.currentPlayer).toBe(g.turnOrder[0]);
    expect(g.setupPools[g.turnOrder[0]]).toBe(35);
  });

  it("takes turns claiming one territory at a time", () => {
    let g = createGame({ players: seats(3), rng: mulberry32(1), now: 0 });
    const [a, b] = g.turnOrder;
    expect(() => act(g, b, { type: "claim", territory: "alaska" })).toThrow(/not your pick/);
    g = act(g, a, { type: "claim", territory: "alaska" }).state;
    expect(g.territories.alaska).toEqual({ owner: a, armies: 1 });
    expect(g.setupPools[a]).toBe(34);
    expect(g.currentPlayer).toBe(b);
    expect(() => act(g, b, { type: "claim", territory: "alaska" })).toThrow(/already taken/);
    expect(() => act(g, b, { type: "setupPlace", placements: {} })).toThrow(/Claim territories first/);
  });

  it("moves to placing once all 42 are claimed, with pools reduced by the claims", () => {
    let g = createGame({ players: seats(3), rng: mulberry32(1), now: 0 });
    while (g.phase === "claim") {
      const empty = Object.keys(g.territories).find((t) => g.territories[t as keyof typeof g.territories].owner === null)!;
      g = act(g, g.currentPlayer!, { type: "claim", territory: empty as never }).state;
    }
    expect(g.phase).toBe("setup");
    expect(g.currentPlayer).toBeNull();
    for (const id of g.turnOrder) expect(g.setupPools[id]).toBe(35 - 14);
  });

  it("lets the neutral army claim after each round in a 2-player game", () => {
    let g = createGame({ players: seats(2), rng: mulberry32(1), now: 0 });
    const [a, b] = g.turnOrder;
    g = act(g, a, { type: "claim", territory: "alaska" }).state;
    g = act(g, b, { type: "claim", territory: "brazil" }).state;
    expect(Object.values(g.territories).filter((t) => t.owner === NEUTRAL_ID)).toHaveLength(1);
    expect(g.currentPlayer).toBe(a);
  });

  it("picks for a player whose pick timer runs out", () => {
    let g = createGame({ players: seats(3), settings: { turnSeconds: 60 }, rng: mulberry32(1), now: 0 });
    expect(g.turnDeadline).toBe(CLAIM_SECONDS * SECOND);
    const [a, b] = g.turnOrder;
    g = act(g, b, { type: "claimTimeout" }, { now: CLAIM_SECONDS * SECOND }).state;
    expect(Object.values(g.territories).filter((t) => t.owner === a)).toHaveLength(1);
    expect(g.currentPlayer).toBe(b);
  });

  it("passes the pick on when the picker leaves", () => {
    let g = createGame({ players: seats(3), rng: mulberry32(1), now: 0 });
    const [a, b] = g.turnOrder;
    g = act(g, a, { type: "resign" }).state;
    expect(g.currentPlayer).toBe(b);
    expect(g.phase).toBe("claim");
  });
});

describe("neutral world", () => {
  const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: "#fff" }));
  const connected = (ids: TerritoryId[]) => {
    const seen = new Set([ids[0]]);
    const queue = [ids[0]];
    while (queue.length) {
      for (const n of ADJACENCY[queue.shift()!]) {
        if (!ids.includes(n) || seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    return seen.size === ids.length;
  };

  it("fills the world with neutral armies around a small connected foothold per player", () => {
    for (let n = 2; n <= 6; n++) {
      for (let seed = 1; seed <= 40; seed++) {
        const g = createGame({ players: seats(n), settings: { setupMode: "neutral" }, rng: mulberry32(seed), now: 0 });
        expect(g.phase).toBe("setup");
        expect(g.players.filter((p) => p.neutral)).toHaveLength(1);
        for (const t of ALL_TERRITORY_IDS) {
          const { owner, armies } = g.territories[t];
          const [min, max] = owner === NEUTRAL_ID ? [1, NEUTRAL_WORLD_MAX_ARMIES] : [1, 1];
          expect(armies).toBeGreaterThanOrEqual(min);
          expect(armies).toBeLessThanOrEqual(max);
        }
        for (const id of g.turnOrder) {
          const mine = ALL_TERRITORY_IDS.filter((t) => g.territories[t].owner === id);
          expect(mine).toHaveLength(NEUTRAL_WORLD_START);
          expect(connected(mine)).toBe(true);
          // Nobody starts next to a rival.
          expect(mine.every((t) => ADJACENCY[t].every((nb) => [id, NEUTRAL_ID].includes(g.territories[nb].owner!)))).toBe(true);
          expect(g.setupPools[id]).toBe(startingArmies(n) - NEUTRAL_WORLD_START);
        }
      }
    }
  });

  it("then plays as usual: the neutral army never takes a turn", () => {
    let g = createGame({ players: seats(3), settings: { setupMode: "neutral" }, rng: mulberry32(5), now: 0 });
    for (const id of g.turnOrder) g = act(g, id, { type: "autoSetup" }).state;
    expect(g.status).toBe("playing");
    expect(g.currentPlayer).toBe(g.turnOrder[0]);
    expect(g.reinforcements).toBe(3);
    expect(g.turnOrder).not.toContain(NEUTRAL_ID);
  });
});
