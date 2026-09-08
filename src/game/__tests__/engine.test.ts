import { describe, expect, it } from "vitest";
import { ALL_TERRITORY_IDS } from "../mapData";
import {
  applyAttack,
  checkWinner,
  createGame,
  endTurn,
  finishAttacking,
  finishReinforcing,
  moveInAfterCapture,
  placeReinforcement,
  startingArmies,
} from "../engine";
import { currentPlayerId } from "../types";
import { makeState, withOwner } from "./testHelpers";

function queueDie(values: number[]) {
  let i = 0;
  return () => values[i++];
}

describe("startingArmies", () => {
  it("matches the classic table for 3-6 players", () => {
    expect(startingArmies(3)).toBe(35);
    expect(startingArmies(4)).toBe(30);
    expect(startingArmies(5)).toBe(25);
    expect(startingArmies(6)).toBe(20);
  });

  it("uses the common 2-player house value", () => {
    expect(startingArmies(2)).toBe(40);
  });

  it("rejects out-of-range player counts", () => {
    expect(() => startingArmies(1)).toThrow();
    expect(() => startingArmies(7)).toThrow();
  });
});

describe("createGame", () => {
  const players = [
    { id: "p1", name: "A", color: "red" },
    { id: "p2", name: "B", color: "blue" },
    { id: "p3", name: "C", color: "green" },
  ];
  // Deterministic shuffle (identity) and random (always 0) so the test can
  // assert exact outcomes instead of just shapes.
  const identityShuffle = <T,>(arr: T[]) => [...arr];
  const zeroRandom = () => 0;

  it("distributes all 42 territories with no gaps or overlaps", () => {
    const state = createGame({ players, shuffle: identityShuffle, random: zeroRandom });
    const owners = ALL_TERRITORY_IDS.map((id) => state.territories[id].owner);
    expect(owners.every((o) => o !== null)).toBe(true);
    expect(new Set(owners).size).toBe(3);
  });

  it("places exactly one player's full starting-army pool across the board, split by owner", () => {
    const state = createGame({ players, shuffle: identityShuffle, random: zeroRandom });
    const totalArmies = ALL_TERRITORY_IDS.reduce((sum, id) => sum + state.territories[id].armies, 0);
    expect(totalArmies).toBe(startingArmies(3) * 3);

    for (const p of players) {
      const ownedArmies = ALL_TERRITORY_IDS.filter((id) => state.territories[id].owner === p.id).reduce(
        (sum, id) => sum + state.territories[id].armies,
        0,
      );
      expect(ownedArmies).toBe(startingArmies(3));
    }
  });

  it("seeds reinforcementsRemaining for the first player and starts in the reinforce phase", () => {
    const state = createGame({ players, shuffle: identityShuffle, random: zeroRandom });
    expect(state.phase).toBe("reinforce");
    expect(state.reinforcementsRemaining).toBeGreaterThan(0);
  });
});

describe("reinforce -> attack -> fortify -> end turn cycle", () => {
  it("walks through every phase and advances to the next player", () => {
    let state = makeState({ reinforcementsRemaining: 3 });
    state = withOwner(state, "p1", ["alberta"], 5);
    state = withOwner(state, "p2", ["ontario"], 1);

    state = placeReinforcement(state, "alberta", 3);
    expect(state.reinforcementsRemaining).toBe(0);

    state = finishReinforcing(state);
    expect(state.phase).toBe("attack");

    state = finishAttacking(state);
    expect(state.phase).toBe("fortify");

    state = endTurn(state);
    expect(state.phase).toBe("reinforce");
    expect(currentPlayerId(state)).toBe("p2");
    expect(state.hasFortifiedThisTurn).toBe(false);
  });

  it("refuses to leave reinforce phase with armies unplaced", () => {
    const state = makeState({ reinforcementsRemaining: 2 });
    expect(() => finishReinforcing(state)).toThrow();
  });
});

describe("applyAttack", () => {
  it("resolves a non-capturing round and leaves both territories owned as before", () => {
    let state = makeState({ phase: "attack" });
    state = withOwner(state, "p1", ["alberta"], 3);
    state = withOwner(state, "p2", ["ontario"], 3);

    const rollDie = queueDie([4, 4]); // tie -> defender wins the exchange
    const outcome = applyAttack(state, "alberta", "ontario", 1, 1, rollDie);

    expect(outcome.captured).toBe(false);
    expect(outcome.state.territories.alberta.armies).toBe(2);
    expect(outcome.state.territories.ontario.owner).toBe("p2");
    expect(outcome.state.territories.ontario.armies).toBe(3);
  });

  it("captures the territory when the defender is wiped out, pending move-in", () => {
    let state = makeState({ phase: "attack" });
    state = withOwner(state, "p1", ["alberta"], 3);
    state = withOwner(state, "p2", ["ontario"], 1);

    const rollDie = queueDie([6, 1]); // attacker wins
    const outcome = applyAttack(state, "alberta", "ontario", 1, 1, rollDie);

    expect(outcome.captured).toBe(true);
    expect(outcome.state.territories.ontario.owner).toBe("p1");
    expect(outcome.state.territories.ontario.armies).toBe(0);
    expect(outcome.state.conqueredThisTurn).toBe(true);
  });

  it("rejects attacking a territory you already own", () => {
    let state = makeState({ phase: "attack" });
    state = withOwner(state, "p1", ["alberta", "ontario"], 3);
    expect(() => applyAttack(state, "alberta", "ontario", 1, 1, queueDie([1, 1]))).toThrow();
  });

  it("rejects attacking a non-adjacent territory", () => {
    let state = makeState({ phase: "attack" });
    state = withOwner(state, "p1", ["alberta"], 3);
    state = withOwner(state, "p2", ["japan"], 3);
    expect(() => applyAttack(state, "alberta", "japan", 1, 1, queueDie([1, 1]))).toThrow();
  });

  it("eliminates a player who loses their last territory and transfers their cards", () => {
    let state = makeState({ phase: "attack" });
    state = withOwner(state, "p1", ["alberta"], 3);
    state = withOwner(state, "p2", ["ontario"], 1); // p2's only territory
    state = { ...state, hands: { ...state.hands, p2: [{ type: "wild", territory: null }] } };

    const rollDie = queueDie([6, 1]);
    const outcome = applyAttack(state, "alberta", "ontario", 1, 1, rollDie);

    expect(outcome.defenderEliminated).toBe(true);
    expect(outcome.state.players.find((p) => p.id === "p2")?.eliminated).toBe(true);
    expect(outcome.state.hands.p1).toHaveLength(1);
    expect(outcome.state.hands.p2).toHaveLength(0);
  });

  it("declares a winner once only one player remains active", () => {
    let state = makeState({ phase: "attack" });
    state = withOwner(state, "p1", ["alberta"], 3);
    state = withOwner(state, "p2", ["ontario"], 1);

    const outcome = applyAttack(state, "alberta", "ontario", 1, 1, queueDie([6, 1]));
    expect(outcome.state.winnerId).toBe("p1");
  });
});

describe("moveInAfterCapture", () => {
  it("moves armies within the required bounds", () => {
    let state = makeState({ phase: "attack" });
    state = withOwner(state, "p1", ["alberta"], 4);
    state = withOwner(state, "p2", ["ontario"], 1);
    const outcome = applyAttack(state, "alberta", "ontario", 1, 1, queueDie([6, 1]));

    const moved = moveInAfterCapture(outcome.state, "alberta", "ontario", 1, 2);
    expect(moved.territories.ontario.armies).toBe(2);
    expect(moved.territories.alberta.armies).toBe(2);
  });

  it("rejects a move-in count outside the allowed range", () => {
    let state = makeState({ phase: "attack" });
    state = withOwner(state, "p1", ["alberta"], 4);
    state = withOwner(state, "p2", ["ontario"], 1);
    const outcome = applyAttack(state, "alberta", "ontario", 1, 1, queueDie([6, 1]));

    // alberta has 4 armies after the battle -> max move-in is 3 (1 must stay behind)
    expect(() => moveInAfterCapture(outcome.state, "alberta", "ontario", 1, 4)).toThrow();
  });
});

describe("checkWinner", () => {
  it("returns state unchanged when more than one player is active", () => {
    const state = makeState();
    expect(checkWinner(state).winnerId).toBeNull();
  });
});
