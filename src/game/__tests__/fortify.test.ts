import { describe, expect, it } from "vitest";
import { canFortifyBetween, fortifyTargets, isFortifyPathConnected } from "../fortify.ts";
import { makeState, withOwner } from "./testHelpers.ts";

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

describe("canFortifyBetween", () => {
  it("classic rule: only directly adjacent territories", () => {
    const state = withOwner(makeState(), "p1", ["alberta", "ontario", "quebec"]);
    expect(canFortifyBetween(state, "adjacent", "p1", "alberta", "ontario")).toBe(true);
    expect(canFortifyBetween(state, "adjacent", "p1", "alberta", "quebec")).toBe(false);
  });

  it("connected rule: any chain of your own territories", () => {
    const state = withOwner(makeState(), "p1", ["alberta", "ontario", "quebec"]);
    expect(canFortifyBetween(state, "connected", "p1", "alberta", "quebec")).toBe(true);
  });

  it("never into someone else's territory", () => {
    let state = withOwner(makeState(), "p1", ["alberta"]);
    state = withOwner(state, "p2", ["ontario"]);
    expect(canFortifyBetween(state, "adjacent", "p1", "alberta", "ontario")).toBe(false);
  });
});

describe("fortifyTargets", () => {
  it("lists every legal destination for the rule", () => {
    const state = withOwner(makeState(), "p1", ["alberta", "ontario", "quebec"]);
    expect(fortifyTargets(state, "adjacent", "p1", "alberta")).toEqual(["ontario"]);
    expect(fortifyTargets(state, "connected", "p1", "alberta").sort()).toEqual(["ontario", "quebec"]);
  });
});
