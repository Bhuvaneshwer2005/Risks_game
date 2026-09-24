import { describe, expect, it } from "vitest";
import { allValidSets, buildDeck, cardSetBonusArmies, fixedSetValue, isValidCardSet, suggestSet } from "../cards.ts";
import type { Card } from "../types.ts";

let nextId = 100;
const card = (type: Card["type"], territory: string | null = null): Card => ({ id: nextId++, type, territory: territory as Card["territory"] });
const infantry = (territory: string | null = null) => card("infantry", territory);
const cavalry = (territory: string | null = null) => card("cavalry", territory);
const artillery = (territory: string | null = null) => card("artillery", territory);
const wild = () => card("wild");

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

describe("buildDeck", () => {
  it("has 42 territory cards (14 of each unit) and 2 wilds with unique ids", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(44);
    expect(new Set(deck.map((c) => c.id)).size).toBe(44);
    for (const type of ["infantry", "cavalry", "artillery"] as const) {
      expect(deck.filter((c) => c.type === type)).toHaveLength(14);
    }
    expect(deck.filter((c) => c.type === "wild" && c.territory === null)).toHaveLength(2);
  });
});

describe("fixedSetValue", () => {
  it("pays 4 / 6 / 8 for three of a kind and 10 for one of each", () => {
    expect(fixedSetValue([infantry(), infantry(), infantry()])).toBe(4);
    expect(fixedSetValue([cavalry(), cavalry(), cavalry()])).toBe(6);
    expect(fixedSetValue([artillery(), artillery(), artillery()])).toBe(8);
    expect(fixedSetValue([infantry(), cavalry(), artillery()])).toBe(10);
  });

  it("counts wilds as whatever makes the set worth most", () => {
    expect(fixedSetValue([artillery(), artillery(), wild()])).toBe(8);
    expect(fixedSetValue([infantry(), cavalry(), wild()])).toBe(10);
    expect(fixedSetValue([infantry(), wild(), wild()])).toBe(10);
  });
});

describe("allValidSets / suggestSet", () => {
  it("finds a set in any 5-card hand", () => {
    const hand = [infantry(), infantry(), cavalry(), cavalry(), artillery()];
    expect(allValidSets(hand).length).toBeGreaterThan(0);
  });

  it("prefers a set that earns the +2 territory bonus, then fewer wilds", () => {
    const owned = infantry("alaska");
    const hand = [infantry(), infantry(), owned, wild()];
    const set = suggestSet(hand, new Set(["alaska"]), "progressive", 1)!;
    expect(set).toContain(owned);
    expect(set.some((c) => c.type === "wild")).toBe(false);
  });

  it("returns null when there is no valid set", () => {
    expect(suggestSet([infantry(), infantry(), cavalry()], new Set(), "progressive", 1)).toBeNull();
  });
});
