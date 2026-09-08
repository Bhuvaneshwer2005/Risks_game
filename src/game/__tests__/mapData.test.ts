import { describe, expect, it } from "vitest";
import { ADJACENCY, ALL_TERRITORY_IDS, CONTINENTS, TERRITORIES, territoriesInContinent } from "../mapData";

describe("mapData", () => {
  it("has exactly 42 territories", () => {
    expect(ALL_TERRITORY_IDS.length).toBe(42);
  });

  it("has exactly 6 continents", () => {
    expect(Object.keys(CONTINENTS).length).toBe(6);
  });

  it("matches the classic per-continent territory counts", () => {
    expect(territoriesInContinent("north-america").length).toBe(9);
    expect(territoriesInContinent("south-america").length).toBe(4);
    expect(territoriesInContinent("europe").length).toBe(7);
    expect(territoriesInContinent("africa").length).toBe(6);
    expect(territoriesInContinent("asia").length).toBe(12);
    expect(territoriesInContinent("australia").length).toBe(4);
  });

  it("assigns every territory to exactly one continent, covering all territories", () => {
    const covered = (Object.keys(CONTINENTS) as (keyof typeof CONTINENTS)[]).flatMap((c) =>
      territoriesInContinent(c),
    );
    expect(new Set(covered).size).toBe(42);
    expect(covered.length).toBe(42);
  });

  it("has a symmetric adjacency graph with no self-loops or duplicates", () => {
    for (const id of ALL_TERRITORY_IDS) {
      const neighbors = ADJACENCY[id];
      expect(neighbors).not.toContain(id);
      expect(new Set(neighbors).size).toBe(neighbors.length);
      for (const n of neighbors) {
        expect(ADJACENCY[n]).toContain(id);
      }
    }
  });

  it("every territory has at least one neighbor", () => {
    for (const id of ALL_TERRITORY_IDS) {
      expect(ADJACENCY[id].length).toBeGreaterThan(0);
    }
  });

  it("has the well-known sea connections", () => {
    expect(ADJACENCY.alaska).toContain("kamchatka");
    expect(ADJACENCY.greenland).toContain("iceland");
    expect(ADJACENCY.brazil).toContain("north-africa");
    expect(ADJACENCY["western-europe"]).toContain("north-africa");
  });

  it("territory names are unique", () => {
    const names = Object.values(TERRITORIES).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
