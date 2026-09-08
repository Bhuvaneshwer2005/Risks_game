import { describe, expect, it } from "vitest";
import { applyFortify, isFortifyPathConnected, validateFortify } from "../fortify";
import { makeState, withOwner } from "./testHelpers";

describe("isFortifyPathConnected", () => {
  it("connects two directly adjacent owned territories", () => {
    const state = withOwner(makeState(), "p1", ["alberta", "ontario"]);
    expect(isFortifyPathConnected(state, "p1", "alberta", "ontario")).toBe(true);
  });

  it("connects through a chain of owned territories, not just direct neighbors", () => {
    // alberta -> ontario -> quebec, all owned by p1; alberta and quebec aren't
    // directly adjacent, but should still be fortify-connected through ontario.
    const state = withOwner(makeState(), "p1", ["alberta", "ontario", "quebec"]);
    expect(isFortifyPathConnected(state, "p1", "alberta", "quebec")).toBe(true);
  });

  it("refuses to path through a territory owned by someone else", () => {
    let state = withOwner(makeState(), "p1", ["alberta", "quebec"]);
    state = withOwner(state, "p2", ["ontario"]); // blocks the only path
    expect(isFortifyPathConnected(state, "p1", "alberta", "quebec")).toBe(false);
  });

  it("rejects a territory not owned by the player", () => {
    const state = withOwner(makeState(), "p1", ["alberta"]);
    expect(isFortifyPathConnected(state, "p1", "alberta", "ontario")).toBe(false);
  });
});

describe("validateFortify", () => {
  it("accepts a legal move", () => {
    const state = withOwner(makeState(), "p1", ["alberta", "ontario"], 3);
    expect(validateFortify(state, "p1", { from: "alberta", to: "ontario", armies: 2 })).toBeNull();
  });

  it("rejects moving all armies out (must leave 1 behind)", () => {
    const state = withOwner(makeState(), "p1", ["alberta", "ontario"], 3);
    expect(validateFortify(state, "p1", { from: "alberta", to: "ontario", armies: 3 })).toMatch(/at least 1/);
  });

  it("rejects a second fortify in the same turn", () => {
    const state = { ...withOwner(makeState(), "p1", ["alberta", "ontario"], 3), hasFortifiedThisTurn: true };
    expect(validateFortify(state, "p1", { from: "alberta", to: "ontario", armies: 1 })).toMatch(/Already/);
  });

  it("rejects a disconnected destination", () => {
    const state = withOwner(makeState(), "p1", ["alberta", "japan"], 3);
    expect(validateFortify(state, "p1", { from: "alberta", to: "japan", armies: 1 })).toMatch(/unbroken chain/);
  });
});

describe("applyFortify", () => {
  it("moves armies and marks the turn's fortify as used", () => {
    const state = withOwner(makeState(), "p1", ["alberta", "ontario"], 3);
    const next = applyFortify(state, { from: "alberta", to: "ontario", armies: 2 });
    expect(next.territories.alberta.armies).toBe(1);
    expect(next.territories.ontario.armies).toBe(5);
    expect(next.hasFortifiedThisTurn).toBe(true);
  });
});
