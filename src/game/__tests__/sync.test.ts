import { describe, expect, it } from "vitest";
// @ts-expect-error - plain Node script without type declarations
import { staleFiles } from "../../../scripts/sync-engine.mjs";

describe("server engine copy", () => {
  it("matches src/game byte for byte (run `npm run sync:engine` after engine changes)", () => {
    expect(staleFiles()).toEqual([]);
  });
});
