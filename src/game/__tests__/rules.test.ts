import { describe, expect, it } from "vitest";
import { RuleError } from "../engine.ts";
import { NEUTRAL_ID, type GameAction, type GameState } from "../types.ts";
import { act, fillRest, fixedDice, makeState, player, withHand, withOwner } from "./testHelpers.ts";

// Card ids follow buildDeck(): id i pictures ALL_TERRITORY_IDS[i] and has type
// ["infantry", "cavalry", "artillery"][i % 3]. So 0 = Alaska (infantry),
// 3 = Alberta (infantry), 6 = Western US (infantry), 1/4/7 are cavalry,
// 2/5/8 artillery.

function board(overrides: Partial<GameState> = {}): GameState {
  let s = makeState(overrides);
  s = withOwner(s, "p1", ["alaska"], 5);
  s = withOwner(s, "p1", ["alberta"], 3);
  s = withOwner(s, "p2", ["kamchatka"], 2);
  return fillRest(s, "p2");
}

const battle = (events: { type: string }[]) => events.find((e) => e.type === "battle") as Extract<
  import("../types.ts").GameEvent,
  { type: "battle" }
>;

describe("reinforcing", () => {
  it("places a batch, and moves to attack once every army is placed", () => {
    let s = board({ reinforcements: 5 });
    s = act(s, "p1", { type: "reinforce", placements: { alaska: 3 } }).state;
    expect(s.territories.alaska.armies).toBe(8);
    expect(s.reinforcements).toBe(2);
    expect(s.phase).toBe("reinforce");
    s = act(s, "p1", { type: "reinforce", placements: { alaska: 1, alberta: 1 } }).state;
    expect(s.phase).toBe("attack");
  });

  it("rejects over-placing, foreign territories, fractions and other players", () => {
    const s = board({ reinforcements: 5 });
    expect(() => act(s, "p1", { type: "reinforce", placements: { alaska: 6 } })).toThrow(/only have 5/);
    expect(() => act(s, "p1", { type: "reinforce", placements: { kamchatka: 1 } })).toThrow(/don't hold/);
    expect(() => act(s, "p1", { type: "reinforce", placements: { alaska: 2.5 } })).toThrow(/whole number/);
    expect(() => act(s, "p1", { type: "reinforce", placements: { atlantis: 1 } as never })).toThrow(/Unknown territory/);
    expect(() => act(s, "p2", { type: "reinforce", placements: { kamchatka: 1 } })).toThrow(/not your turn/);
  });

  it("forces a trade before placing when holding 5 or more cards", () => {
    let s = withHand(board({ reinforcements: 3 }), "p1", [0, 3, 6, 1, 4]);
    expect(() => act(s, "p1", { type: "reinforce", placements: { alaska: 3 } })).toThrow(/trade in a set/);
    s = act(s, "p1", { type: "trade", cardIds: [0, 3, 6] }).state;
    expect(s.hands.p1).toHaveLength(2);
    s = act(s, "p1", { type: "reinforce", placements: { alaska: s.reinforcements } }).state;
    expect(s.phase).toBe("attack");
  });
});

describe("trading cards", () => {
  it("pays the progressive schedule and puts the +2 bonus on the pictured territory, once per turn", () => {
    let s = withHand(board({ reinforcements: 3 }), "p1", [0, 3, 6, 1, 4, 7]);
    s = withOwner(s, "p1", ["ontario"], 1); // card 4 pictures Ontario
    const first = act(s, "p1", { type: "trade", cardIds: [0, 3, 6] });
    s = first.state;
    expect(s.reinforcements).toBe(3 + 4);
    expect(s.territories.alaska.armies).toBe(5 + 2);
    expect(first.events).toContainEqual({ type: "traded", player: "p1", armies: 4, bonusTerritory: "alaska" });

    const second = act(s, "p1", { type: "trade", cardIds: [1, 4, 7] });
    s = second.state;
    expect(s.reinforcements).toBe(3 + 4 + 6);
    expect(s.territories.ontario.armies).toBe(1); // bonus already used this turn
    expect(s.setsTraded).toBe(2);
    expect(s.discard.map((c) => c.id).sort()).toEqual([0, 1, 3, 4, 6, 7]);
  });

  it("pays fixed values in fixed mode", () => {
    let s = board({ reinforcements: 3 });
    s = withHand({ ...s, settings: { ...s.settings, cardMode: "fixed" } }, "p1", [2, 5, 8]);
    s = act(s, "p1", { type: "trade", cardIds: [2, 5, 8] }).state;
    expect(s.reinforcements).toBe(3 + 8);
  });

  it("rejects invalid sets, cards you don't hold, and trading outside the reinforce phase", () => {
    const s = withHand(board({ reinforcements: 3 }), "p1", [0, 1, 3, 6]);
    expect(() => act(s, "p1", { type: "trade", cardIds: [0, 1, 3] })).toThrow(/not a valid set/);
    expect(() => act(s, "p1", { type: "trade", cardIds: [0, 3, 9] })).toThrow(/isn't in your hand/);
    expect(() => act(s, "p1", { type: "trade", cardIds: [0, 3, 3] })).toThrow(/3 different cards/);
    expect(() => act({ ...s, phase: "attack", reinforcements: 0 }, "p1", { type: "trade", cardIds: [0, 3, 6] })).toThrow(
      /start of your turn/,
    );
  });
});

describe("attacking", () => {
  it("always rolls the defender's maximum dice", () => {
    const s = board({ phase: "attack" });
    const r = act(s, "p1", { type: "attack", from: "alaska", to: "kamchatka", dice: 3 }, { rng: fixedDice([6, 6, 6, 1, 1]) });
    const b = battle(r.events);
    expect(b.rolls[0].attacker).toHaveLength(3);
    expect(b.rolls[0].defender).toHaveLength(2);
    expect(b.defenderLosses).toBe(2);
  });

  it("validates the attack", () => {
    const s = board({ phase: "attack" });
    expect(() => act(s, "p1", { type: "attack", from: "alberta", to: "kamchatka" })).toThrow(/doesn't border/);
    expect(() => act(s, "p1", { type: "attack", from: "alaska", to: "alberta" })).toThrow(/your own/);
    expect(() => act(s, "p1", { type: "attack", from: "kamchatka", to: "alaska" })).toThrow(/don't hold/);
    expect(() => act(s, "p1", { type: "attack", from: "alberta", to: "ontario", dice: 3 })).toThrow(/from 1 to 2/);
    const weak = withOwner(s, "p1", ["alberta"], 1);
    expect(() => act(weak, "p1", { type: "attack", from: "alberta", to: "ontario" })).toThrow(/at least 2/);
  });

  it("moves the minimum in on capture, then allows moving more", () => {
    let s = withOwner(board({ phase: "attack" }), "p2", ["kamchatka"], 1);
    const r = act(s, "p1", { type: "attack", from: "alaska", to: "kamchatka", dice: 3 }, { rng: fixedDice([6, 5, 4, 1]) });
    s = r.state;
    expect(battle(r.events)).toMatchObject({ captured: true, movedIn: 3 });
    expect(s.territories.kamchatka).toEqual({ owner: "p1", armies: 3 });
    expect(s.territories.alaska.armies).toBe(2);
    expect(s.pendingCapture).toEqual({ from: "alaska", to: "kamchatka", maxExtra: 1 });
    expect(s.conqueredThisTurn).toBe(true);
    expect(() => act(s, "p1", { type: "moveMore", count: 2 })).toThrow(/from 1 to 1|exactly 1/);
    s = act(s, "p1", { type: "moveMore", count: 1 }).state;
    expect(s.territories.kamchatka.armies).toBe(4);
    expect(s.pendingCapture).toBeNull();
  });

  it("attacking again accepts the pending move-in as it stands", () => {
    let s = withOwner(board({ phase: "attack" }), "p2", ["kamchatka"], 1);
    s = withOwner(s, "p1", ["alaska"], 8);
    s = act(s, "p1", { type: "attack", from: "alaska", to: "kamchatka" }, { rng: fixedDice([6, 6, 6, 1]) }).state;
    expect(s.pendingCapture).not.toBeNull();
    s = act(s, "p1", { type: "attack", from: "alberta", to: "ontario", dice: 1 }, { rng: fixedDice([1, 6, 6]) }).state;
    expect(s.pendingCapture).toBeNull();
  });

  it("blitz keeps rolling until capture or the attacker can't continue", () => {
    const s = withOwner(board({ phase: "attack" }), "p1", ["alaska"], 10);
    const won = act(s, "p1", { type: "blitz", from: "alaska", to: "kamchatka" }, { rng: fixedDice([1, 1, 1, 6, 6, 6, 6, 6, 1, 1]) });
    expect(battle(won.events).rolls).toHaveLength(2);
    expect(won.state.territories.kamchatka.owner).toBe("p1");

    const losing = withOwner(withOwner(board({ phase: "attack" }), "p1", ["alaska"], 3), "p2", ["kamchatka"], 10);
    const lost = act(losing, "p1", { type: "blitz", from: "alaska", to: "kamchatka" }, { rng: fixedDice([1, 1, 6, 6]) });
    expect(lost.state.territories.alaska.armies).toBe(1);
    expect(battle(lost.events).rolls).toHaveLength(1);
  });
});

describe("eliminating a player", () => {
  function threePlayer(): GameState {
    let s = makeState({ phase: "attack", players: [player("p1"), player("p2"), player("p3")] });
    s = withOwner(s, "p1", ["alaska"], 6);
    s = withOwner(s, "p2", ["kamchatka"], 1);
    s = fillRest(s, "p3");
    s = withHand(s, "p1", [0, 3, 6]);
    return withHand(s, "p2", [1, 4, 7]);
  }

  it("hands over the cards, then forces a trade down to 4 and placement before attacking again", () => {
    const r = act(threePlayer(), "p1", { type: "attack", from: "alaska", to: "kamchatka" }, { rng: fixedDice([6, 6, 6, 1]) });
    let s = r.state;
    expect(r.events).toContainEqual({ type: "eliminated", player: "p2", by: "p1", cardsTaken: 3 });
    expect(s.players.find((p) => p.id === "p2")!.status).toBe("eliminated");
    expect(s.hands.p1).toHaveLength(6);
    expect(s.eliminationTrade).toBe(true);

    expect(() => act(s, "p1", { type: "attack", from: "kamchatka", to: "japan" })).toThrow(/Trade in cards/);
    expect(() => act(s, "p1", { type: "endTurn" })).toThrow(/Trade in cards/);

    s = act(s, "p1", { type: "trade", cardIds: [0, 3, 6] }).state;
    expect(s.eliminationTrade).toBe(false);
    expect(s.reinforcements).toBe(4);
    expect(() => act(s, "p1", { type: "trade", cardIds: [1, 4, 7] })).toThrow(/start of your turn/);
    expect(() => act(s, "p1", { type: "attack", from: "kamchatka", to: "japan" })).toThrow(/Place your remaining 4/);
    s = act(s, "p1", { type: "reinforce", placements: { kamchatka: 4 } }).state;
    expect(s.phase).toBe("attack");
    expect(() => act(s, "p1", { type: "attack", from: "kamchatka", to: "japan" }, { rng: fixedDice([1, 1, 1, 6]) })).not.toThrow();
  });

  it("ends the game when the last opponent falls", () => {
    let s = fillRest(withOwner(makeState({ phase: "attack" }), "p1", ["alaska"], 5), "p1");
    s = withOwner(s, "p2", ["kamchatka"], 1);
    const r = act(s, "p1", { type: "attack", from: "alaska", to: "kamchatka" }, { rng: fixedDice([6, 6, 6, 1]) });
    expect(r.state.status).toBe("finished");
    expect(r.state.winner).toBe("p1");
    expect(r.events.at(-1)).toEqual({ type: "gameOver", winner: "p1" });
    expect(() => act(r.state, "p1", { type: "endTurn" })).toThrow(/game is over/);
  });

  it("in a 2-player game, wins without having to beat the neutral army", () => {
    let s = makeState({ phase: "attack", players: [player("p1"), player("p2"), player(NEUTRAL_ID, { neutral: true })] });
    s = withOwner(s, "p1", ["alaska"], 5);
    s = withOwner(s, "p2", ["kamchatka"], 1);
    s = fillRest(s, NEUTRAL_ID);
    expect(s.turnOrder).toEqual(["p1", "p2"]);
    const r = act(s, "p1", { type: "attack", from: "alaska", to: "kamchatka" }, { rng: fixedDice([6, 6, 6, 1]) });
    expect(r.state.winner).toBe("p1");
  });
});

describe("fortifying and ending the turn", () => {
  function fortifyBoard(rule: "adjacent" | "connected") {
    let s = makeState({ phase: "fortify" });
    s = { ...s, settings: { ...s.settings, fortifyRule: rule } };
    s = withOwner(s, "p1", ["alberta"], 5);
    s = withOwner(s, "p1", ["ontario", "quebec"], 1);
    return fillRest(s, "p2");
  }

  it("classic rule moves to an adjacent territory only, and ends the turn", () => {
    const s = fortifyBoard("adjacent");
    expect(() => act(s, "p1", { type: "fortify", from: "alberta", to: "quebec", count: 1 })).toThrow(/doesn't border/);
    expect(() => act(s, "p1", { type: "fortify", from: "alberta", to: "ontario", count: 5 })).toThrow(/from 1 to 4/);
    const next = act(s, "p1", { type: "fortify", from: "alberta", to: "ontario", count: 4 }).state;
    expect(next.territories.ontario.armies).toBe(5);
    expect(next.currentPlayer).toBe("p2");
    expect(next.phase).toBe("reinforce");
  });

  it("connected rule moves along a chain of your territories", () => {
    const next = act(fortifyBoard("connected"), "p1", { type: "fortify", from: "alberta", to: "quebec", count: 2 }).state;
    expect(next.territories.quebec.armies).toBe(3);
  });

  it("can't fortify during the attack phase (the old soft-lock)", () => {
    const s = { ...fortifyBoard("adjacent"), phase: "attack" as const };
    expect(() => act(s, "p1", { type: "fortify", from: "alberta", to: "ontario", count: 1 })).toThrow(/attack phase/);
  });

  it("draws exactly one card only after conquering, and gives the next player their reinforcements", () => {
    const s = board({ phase: "fortify", conqueredThisTurn: true });
    const r = act(s, "p1", { type: "endTurn" });
    expect(r.state.hands.p1).toHaveLength(1);
    expect(r.state.deck).toHaveLength(43);
    expect(r.events.map((e) => e.type)).toEqual(["cardDrawn", "turnStarted"]);
    // p2 holds 40 territories (13) plus South America, Europe, Africa, Asia and Australia (2+5+3+7+2).
    expect(r.state.reinforcements).toBe(13 + 19);
  });

  it("reshuffles the discard pile when the deck runs out", () => {
    const base = board({ phase: "fortify", conqueredThisTurn: true });
    const s = { ...base, deck: [], discard: base.deck.slice(0, 3) };
    const next = act(s, "p1", { type: "endTurn" }).state;
    expect(next.hands.p1).toHaveLength(1);
    expect(next.deck.length + next.discard.length).toBe(2);
  });

  it("won't end the turn with armies still to place", () => {
    const s = board({ phase: "attack", reinforcements: 2 });
    expect(() => act(s, "p1", { type: "endTurn" })).toThrow(/Place your remaining 2/);
  });
});

describe("resigning", () => {
  const three = () => fillRest(withOwner(makeState({ players: [player("p1"), player("p2"), player("p3")], reinforcements: 3 }), "p1", ["alaska"], 3), "p3");

  it("passes the turn on and leaves the resigned armies on the board", () => {
    let s = withOwner(three(), "p2", ["kamchatka"], 2);
    s = withHand(s, "p1", [0, 1]);
    const next = act(s, "p1", { type: "resign" }).state;
    expect(next.players.find((p) => p.id === "p1")!.status).toBe("resigned");
    expect(next.territories.alaska).toEqual({ owner: "p1", armies: 3 });
    expect(next.hands.p1).toHaveLength(0);
    expect(next.discard).toHaveLength(2);
    expect(next.currentPlayer).toBe("p2");
  });

  it("lets a player resign out of turn, and declares the last player standing the winner", () => {
    let s = withOwner(three(), "p2", ["kamchatka"], 2);
    s = act(s, "p3", { type: "resign" }).state;
    expect(s.currentPlayer).toBe("p1");
    s = act(s, "p2", { type: "resign" }).state;
    expect(s.status).toBe("finished");
    expect(s.winner).toBe("p1");
  });
});

describe("turn timer", () => {
  const timed = () => ({ ...board({ reinforcements: 4, turnDeadline: 10_000 }), settings: { ...makeState().settings, turnSeconds: 60 } });

  it("can only be claimed once the deadline passes", () => {
    expect(() => act(timed(), "p2", { type: "claimTimeout" }, { now: 9_999 })).toThrow(/hasn't run out/);
    expect(() => act(board(), "p2", { type: "claimTimeout" }, { now: 99_999 })).toThrow(/no turn timer/);
  });

  it("places the idle player's armies, makes forced trades, ends their turn and adds a strike", () => {
    const s = withHand(timed(), "p1", [0, 3, 6, 1, 4]);
    const r = act(s, "p2", { type: "claimTimeout" }, { now: 10_000 });
    const p1 = r.state.players.find((p) => p.id === "p1")!;
    expect(r.state.hands.p1).toHaveLength(2);
    expect(r.state.territories.alaska.armies + r.state.territories.alberta.armies).toBeGreaterThan(5 + 3 + 4);
    expect(p1.timeoutStrikes).toBe(1);
    expect(r.state.currentPlayer).toBe("p2");
    expect(r.state.turnDeadline).toBe(10_000 + 60_000);
  });

  it("resigns a player after 3 timeouts in a row", () => {
    let s = timed();
    s = { ...s, players: s.players.map((p) => (p.id === "p1" ? { ...p, timeoutStrikes: 2 } : p)) };
    const r = act(s, "p2", { type: "claimTimeout" }, { now: 10_000 });
    expect(r.state.status).toBe("finished");
    expect(r.state.winner).toBe("p2");
  });

  it("auto-places everyone still placing when setup times out", () => {
    let s = board({ status: "setup", phase: "setup", currentPlayer: null, turnDeadline: 5_000, setupPools: { p1: 4, p2: 0 } });
    s = { ...s, settings: { ...s.settings, turnSeconds: 60 } };
    const next = act(s, "p2", { type: "claimTimeout" }, { now: 5_000 }).state;
    expect(next.status).toBe("playing");
    expect(next.setupPools.p1).toBe(0);
  });
});

describe("phase checks", () => {
  const all: GameAction[] = [
    { type: "setupPlace", placements: { alaska: 1 } },
    { type: "autoSetup" },
    { type: "reinforce", placements: { alaska: 1 } },
    { type: "trade", cardIds: [0, 3, 6] },
    { type: "attack", from: "alaska", to: "kamchatka" },
    { type: "blitz", from: "alaska", to: "kamchatka" },
    { type: "moveMore", count: 1 },
    { type: "endAttack" },
    { type: "fortify", from: "alaska", to: "alberta", count: 1 },
    { type: "endTurn" },
  ];
  const cases: [string, Partial<GameState>, GameAction["type"][]][] = [
    ["reinforce", { phase: "reinforce", reinforcements: 3 }, ["setupPlace", "autoSetup", "attack", "blitz", "moveMore", "endAttack", "fortify", "endTurn"]],
    ["attack", { phase: "attack" }, ["setupPlace", "autoSetup", "reinforce", "trade", "moveMore", "fortify"]],
    ["fortify", { phase: "fortify" }, ["setupPlace", "autoSetup", "reinforce", "trade", "attack", "blitz", "moveMore", "endAttack"]],
  ];

  for (const [phase, overrides, forbidden] of cases) {
    it(`rejects out-of-phase actions during ${phase}`, () => {
      const s = withHand(board(overrides), "p1", [0, 3, 6]);
      for (const action of all.filter((a) => forbidden.includes(a.type))) {
        expect(() => act(s, "p1", action), action.type).toThrow(RuleError);
      }
    });

    it(`rejects every turn action from the wrong player during ${phase}`, () => {
      const s = board(overrides);
      for (const action of all.filter((a) => a.type !== "setupPlace" && a.type !== "autoSetup")) {
        expect(() => act(s, "p2", action), action.type).toThrow(/not your turn/);
      }
    });
  }
});
