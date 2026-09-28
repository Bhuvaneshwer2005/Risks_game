import { describe, expect, it } from "vitest";
import { emptyStats } from "../../../game/engine.ts";
import { toPublicState } from "../../../game/state.ts";
import { fillRest, makeState, player } from "../../../game/__tests__/testHelpers.ts";
import { awards, standings } from "../results.ts";

function finished(withStats = true) {
  const s = fillRest(
    makeState({
      players: [
        player("p1"),
        player("p2", { status: "eliminated" }),
        player("p3", { status: "kicked" }),
        player("p4", { status: "resigned", timeoutStrikes: 3 }),
      ],
      status: "finished",
      phase: "over",
      winner: "p1",
      currentPlayer: null,
      turnNumber: 20,
    }),
    "p1",
  );
  if (withStats) {
    s.stats = {
      p1: { ...emptyStats(), conquests: 30, armiesDestroyed: 80, eliminations: 1, attackDice: 100, attackPips: 350, cardArmies: 12, setsTraded: 2 },
      p2: { ...emptyStats(), outOnTurn: 18, outBy: "p1", place: 2, defensiveKills: 25, attackDice: 12, attackPips: 50 },
      // Out on the same turn: the recorded places decide who ranks higher.
      p3: { ...emptyStats(), outOnTurn: 4, outBy: "p1", place: 4 },
      p4: { ...emptyStats(), outOnTurn: 4, place: 3 },
    };
  }
  return toPublicState(s);
}

describe("end-of-game results", () => {
  it("ranks the winner first, then whoever lasted longest, saying how each went out", () => {
    expect(standings(finished()).map((r) => [r.place, r.player.id, r.outcome])).toEqual([
      [1, "p1", "Victor"],
      [2, "p2", "Eliminated by P1 on turn 18"],
      [3, "p4", "Timed out on turn 4"],
      [4, "p3", "Removed on turn 4"],
    ]);
    // Online, the host did the removing; locally it could have been anyone at the table.
    expect(standings(finished(), { showKicker: true })[3].outcome).toBe("Removed by P1 on turn 4");
  });

  it("still ranks games saved before stats existed", () => {
    const rows = standings(finished(false));
    expect(rows[0]).toMatchObject({ place: 1, outcome: "Victor" });
    expect(rows.map((r) => r.outcome).slice(1).sort()).toEqual(["Eliminated", "Removed", "Timed out"]);
    expect(awards(finished(false))).toEqual([]);
  });

  it("gives each award to the category leader and skips categories nobody scored in", () => {
    const winners = Object.fromEntries(awards(finished()).map((a) => [a.id, a.player.id]));
    // p2's dice averaged 4.17 over 12 dice, beating p1's 3.5.
    expect(winners).toEqual({ warlord: "p1", destroyer: "p1", wall: "p2", lucky: "p2", cards: "p1", kingslayer: "p1" });

    const quiet = finished();
    quiet.stats!.p1 = emptyStats();
    quiet.stats!.p2 = emptyStats();
    expect(awards(quiet)).toEqual([]);
  });
});
