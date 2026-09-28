// End-of-game summaries: final standings and awards, from the engine's stats.

import { MAX_TIMEOUT_STRIKES } from "../../game/engine.ts";
import { playerSummaries } from "../../game/selectors.ts";
import type { PlayerState, PlayerStats, PublicState } from "../../game/types.ts";
import type { IconName } from "../../ui/index.tsx";

export interface Standing {
  player: PlayerState;
  place: number;
  /** "Victor", "Eliminated by Ana on turn 12", … */
  outcome: string;
  territories: number;
  armies: number;
}

const onTurn = (turn: number | null | undefined) => (turn ? `on turn ${turn}` : turn === 0 ? "during setup" : "");

/** Human players, best first: the winner, then whoever lasted longest. */
export function standings(game: PublicState, opts: { showKicker?: boolean } = {}): Standing[] {
  const summaries = playerSummaries(game);
  const stats = game.stats ?? {};
  const name = (id: string | null | undefined) => game.players.find((p) => p.id === id)?.name ?? "someone";
  const lasted = (p: PlayerState) => (p.id === game.winner ? Infinity : (stats[p.id]?.outOnTurn ?? (p.status === "active" ? Infinity : -1)));
  // Places are exact when the engine recorded them; older games fall back to when each player went out.
  const place = (p: PlayerState) => stats[p.id]?.place ?? (p.id === game.winner ? 1 : Infinity);

  return game.players
    .filter((p) => !p.neutral)
    .sort(
      (a, b) =>
        place(a) - place(b) ||
        lasted(b) - lasted(a) ||
        (stats[b.id]?.peakTerritories ?? 0) - (stats[a.id]?.peakTerritories ?? 0) ||
        summaries[b.id].territories - summaries[a.id].territories,
    )
    .map((p, i) => {
      const st = stats[p.id];
      const when = onTurn(st?.outOnTurn);
      let outcome: string;
      if (p.id === game.winner) outcome = "Victor";
      else if (p.status === "eliminated") outcome = st?.outBy ? `Eliminated by ${name(st.outBy)} ${when}` : `Eliminated ${when}`;
      else if (p.status === "kicked") outcome = opts.showKicker && st?.outBy ? `Removed by ${name(st.outBy)} ${when}` : `Removed ${when}`;
      else if (p.status === "resigned") outcome = p.timeoutStrikes >= MAX_TIMEOUT_STRIKES ? `Timed out ${when}` : `Left ${when}`;
      else outcome = "Still standing";
      return { player: p, place: i + 1, outcome: outcome.trim(), territories: summaries[p.id].territories, armies: summaries[p.id].armies };
    });
}

export interface Award {
  id: string;
  title: string;
  icon: IconName;
  player: PlayerState;
  detail: string;
}

interface AwardRule {
  id: string;
  title: string;
  icon: IconName;
  score: (s: PlayerStats) => number;
  /** Players who don't qualify score -1. */
  qualifies?: (s: PlayerStats) => boolean;
  detail: (s: PlayerStats) => string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const average = (pips: number, dice: number) => (dice > 0 ? pips / dice : 0);

const AWARDS: AwardRule[] = [
  { id: "warlord", title: "Warlord", icon: "flag", score: (s) => s.conquests, detail: (s) => `${plural(s.conquests, "territory", "territories")} conquered` },
  { id: "destroyer", title: "Destroyer", icon: "sword", score: (s) => s.armiesDestroyed, detail: (s) => `${plural(s.armiesDestroyed, "enemy army", "enemy armies")} destroyed` },
  { id: "wall", title: "Iron wall", icon: "shield", score: (s) => s.defensiveKills, detail: (s) => `${plural(s.defensiveKills, "attacker")} stopped while defending` },
  {
    id: "lucky",
    title: "Lucky dice",
    icon: "dice",
    score: (s) => average(s.attackPips, s.attackDice),
    qualifies: (s) => s.attackDice >= 10,
    detail: (s) => `averaged ${average(s.attackPips, s.attackDice).toFixed(2)} per attack die`,
  },
  { id: "cards", title: "Card shark", icon: "cards", score: (s) => s.cardArmies, detail: (s) => `+${s.cardArmies} armies from ${plural(s.setsTraded, "card set")}` },
  { id: "kingslayer", title: "Kingslayer", icon: "crown", score: (s) => s.eliminations, detail: (s) => `knocked out ${plural(s.eliminations, "player")}` },
];

/** Who led each category; categories nobody scored in are left out. */
export function awards(game: PublicState): Award[] {
  const stats = game.stats;
  if (!stats) return [];
  const humans = game.players.filter((p) => !p.neutral && stats[p.id]);
  const result: Award[] = [];
  for (const rule of AWARDS) {
    let best: PlayerState | null = null;
    let bestScore = 0;
    for (const p of humans) {
      const s = stats[p.id];
      if (rule.qualifies && !rule.qualifies(s)) continue;
      const score = rule.score(s);
      if (score > bestScore) {
        best = p;
        bestScore = score;
      }
    }
    if (best) result.push({ id: rule.id, title: rule.title, icon: rule.icon, player: best, detail: rule.detail(stats[best.id]) });
  }
  return result;
}
