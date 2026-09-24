import { describe, expect, it } from "vitest";
import { ADJACENCY, ALL_TERRITORY_IDS, CONTINENTS } from "../../game/mapData.ts";
import { BOARD } from "../geometry.ts";

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

describe("board geometry", () => {
  it("has a shape and a label point inside the board for every territory", () => {
    for (const id of ALL_TERRITORY_IDS) {
      const t = BOARD.territories[id];
      expect(t.path, id).toMatch(/^M[\d.]+ [\d.]+L/);
      const [x, y] = t.label;
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(BOARD.width);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(BOARD.height);
      expect(t.clearance, id).toBeGreaterThanOrEqual(7);
    }
  });

  it("connects exactly the 83 canonical borders by land or sea", () => {
    const canonical = new Set<string>();
    for (const a of ALL_TERRITORY_IDS) for (const b of ADJACENCY[a]) canonical.add(key(a, b));
    const drawn = [...BOARD.landBorders, ...BOARD.seaLanes.map((l) => key(l.a, l.b))];
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(new Set(drawn)).toEqual(canonical);
  });

  it("wraps only the Alaska-Kamchatka lane around the board edge", () => {
    expect(BOARD.seaLanes.filter((l) => l.wrap).map((l) => key(l.a, l.b))).toEqual(["alaska|kamchatka"]);
  });

  it("places a label for every continent", () => {
    expect(Object.keys(BOARD.continentLabels).sort()).toEqual(Object.keys(CONTINENTS).sort());
  });
});
