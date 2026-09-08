import { describe, expect, it } from "vitest";
import { maxAttackerDice, maxDefenderDice, moveInBounds, resolveAttackRoll } from "../combat";

function queueDie(values: number[]) {
  let i = 0;
  return () => values[i++];
}

describe("maxAttackerDice / maxDefenderDice", () => {
  it("caps attacker at 3 and requires 1 army left behind", () => {
    expect(maxAttackerDice(1)).toBe(0);
    expect(maxAttackerDice(2)).toBe(1);
    expect(maxAttackerDice(4)).toBe(3);
    expect(maxAttackerDice(10)).toBe(3);
  });

  it("caps defender at 2", () => {
    expect(maxDefenderDice(1)).toBe(1);
    expect(maxDefenderDice(2)).toBe(2);
    expect(maxDefenderDice(5)).toBe(2);
  });
});

describe("resolveAttackRoll", () => {
  it("gives the higher roll the kill, one loss per pair", () => {
    const rollDie = queueDie([6, 1]); // attacker 6, defender 1
    const result = resolveAttackRoll(5, 5, 1, 1, rollDie);
    expect(result.attackerLosses).toBe(0);
    expect(result.defenderLosses).toBe(1);
  });

  it("ties go to the defender", () => {
    const rollDie = queueDie([4, 4]);
    const result = resolveAttackRoll(5, 5, 1, 1, rollDie);
    expect(result.attackerLosses).toBe(1);
    expect(result.defenderLosses).toBe(0);
  });

  it("compares sorted-descending pairs across multiple dice", () => {
    // attacker rolls 6,5,2 ; defender rolls 5,3
    // sorted attacker: 6,5,2 ; sorted defender: 5,3
    // pair 1: 6 vs 5 -> defender loses; pair 2: 5 vs 3 -> defender loses
    const rollDie = queueDie([6, 5, 2, 5, 3]);
    const result = resolveAttackRoll(4, 4, 3, 2, rollDie);
    expect(result.attackerLosses).toBe(0);
    expect(result.defenderLosses).toBe(2);
  });

  it("throws on an invalid attacker dice count", () => {
    expect(() => resolveAttackRoll(2, 5, 3, 1, queueDie([1, 1, 1, 1]))).toThrow();
  });

  it("throws on an invalid defender dice count", () => {
    expect(() => resolveAttackRoll(5, 1, 1, 2, queueDie([1, 1, 1]))).toThrow();
  });
});

describe("moveInBounds", () => {
  it("requires at least the dice used, and leaves at least 1 behind", () => {
    expect(moveInBounds(5, 3)).toEqual({ min: 3, max: 4 });
  });

  it("clamps the minimum down when dice-used would exceed the max", () => {
    // only 2 armies remain in origin -> max move is 1, even if 3 dice were used
    expect(moveInBounds(2, 3)).toEqual({ min: 1, max: 1 });
  });
});
