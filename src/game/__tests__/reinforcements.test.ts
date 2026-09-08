import { describe, expect, it } from "vitest";
import { calculateReinforcements, continentsControlledBy, territoryCount } from "../reinforcements";
import { makeState, withContinent, withOwner } from "./testHelpers";

describe("territoryCount", () => {
  it("counts only territories owned by the given player", () => {
    const state = withOwner(makeState(), "p1", ["alaska", "brazil", "japan"]);
    expect(territoryCount(state, "p1")).toBe(3);
    expect(territoryCount(state, "p2")).toBe(0);
  });
});

describe("calculateReinforcements", () => {
  it("gives the 3-army minimum for a small holding", () => {
    const state = withOwner(makeState(), "p1", ["alaska", "brazil"]);
    expect(calculateReinforcements(state, "p1")).toBe(3);
  });

  it("gives floor(territories/3) once that exceeds the minimum", () => {
    const state = withOwner(makeState(), "p1", [
      "alaska",
      "alberta",
      "ontario",
      "brazil",
      "peru",
      "japan",
      "egypt",
      "india",
      "siam",
      "china",
      "ural",
      "iceland",
    ]); // 12 territories, no complete continent -> floor(12/3) = 4
    expect(calculateReinforcements(state, "p1")).toBe(4);
  });

  it("adds a continent bonus for owning every territory in it", () => {
    const state = withContinent(makeState(), "p1", "australia"); // 4 territories, +2 bonus
    // floor(4/3)=1 -> min 3, plus continent bonus 2
    expect(calculateReinforcements(state, "p1")).toBe(5);
  });

  it("stacks multiple continent bonuses", () => {
    let state = withContinent(makeState(), "p1", "australia"); // +2
    state = withContinent(state, "p1", "south-america"); // +2, 8 territories total
    // floor(8/3)=2 -> min 3, plus 2+2
    expect(calculateReinforcements(state, "p1")).toBe(7);
  });
});

describe("continentsControlledBy", () => {
  it("only counts a continent once every territory in it is owned", () => {
    const state = withContinent(makeState(), "p1", "south-america");
    expect(continentsControlledBy(state, "p1")).toEqual(["south-america"]);
  });

  it("returns nothing when a continent is only partially held", () => {
    const state = withOwner(makeState(), "p1", ["venezuela", "brazil", "peru"]); // missing argentina
    expect(continentsControlledBy(state, "p1")).toEqual([]);
  });
});
