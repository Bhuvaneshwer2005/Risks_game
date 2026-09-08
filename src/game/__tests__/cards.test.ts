import { describe, expect, it } from "vitest";
import { cardSetBonusArmies, isValidCardSet, territoryBonusForSet } from "../cards";
import type { Card } from "../types";

const infantry = (territory: string | null = null): Card => ({ type: "infantry", territory: territory as any });
const cavalry = (territory: string | null = null): Card => ({ type: "cavalry", territory: territory as any });
const artillery = (territory: string | null = null): Card => ({ type: "artillery", territory: territory as any });
const wild = (): Card => ({ type: "wild", territory: null });

describe("cardSetBonusArmies", () => {
  it("follows the classic escalating schedule", () => {
    expect(cardSetBonusArmies(1)).toBe(4);
    expect(cardSetBonusArmies(2)).toBe(6);
    expect(cardSetBonusArmies(3)).toBe(8);
    expect(cardSetBonusArmies(4)).toBe(10);
    expect(cardSetBonusArmies(5)).toBe(12);
    expect(cardSetBonusArmies(6)).toBe(15);
  });

  it("adds 5 per set after the 6th", () => {
    expect(cardSetBonusArmies(7)).toBe(20);
    expect(cardSetBonusArmies(8)).toBe(25);
    expect(cardSetBonusArmies(10)).toBe(35);
  });
});

describe("isValidCardSet", () => {
  it("accepts three of the same type", () => {
    expect(isValidCardSet([infantry(), infantry(), infantry()])).toBe(true);
  });

  it("accepts one of each type", () => {
    expect(isValidCardSet([infantry(), cavalry(), artillery()])).toBe(true);
  });

  it("rejects exactly two of one type and one of another", () => {
    expect(isValidCardSet([infantry(), infantry(), cavalry()])).toBe(false);
  });

  it("accepts wilds substituting into a same-type set", () => {
    expect(isValidCardSet([infantry(), infantry(), wild()])).toBe(true);
  });

  it("accepts wilds substituting into a one-of-each set", () => {
    expect(isValidCardSet([infantry(), cavalry(), wild()])).toBe(true);
  });

  it("accepts two wilds plus any single card", () => {
    expect(isValidCardSet([infantry(), wild(), wild()])).toBe(true);
  });
});

describe("territoryBonusForSet", () => {
  it("grants +2 when a traded card depicts a territory the player owns", () => {
    const cards: [Card, Card, Card] = [infantry("alaska"), cavalry(), artillery()];
    expect(territoryBonusForSet(cards, new Set(["alaska"]))).toBe(2);
  });

  it("grants 0 when no traded card depicts an owned territory", () => {
    const cards: [Card, Card, Card] = [infantry("alaska"), cavalry("brazil"), artillery("japan")];
    expect(territoryBonusForSet(cards, new Set(["egypt"]))).toBe(0);
  });
});
