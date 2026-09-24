import { ALL_TERRITORY_IDS } from "./mapData.ts";
import type { Card, CardMode, UnitType } from "./types.ts";

export const UNIT_TYPES: readonly UnitType[] = ["infantry", "cavalry", "artillery"];
export const TOTAL_CARDS = 44;

/** 42 territory cards (14 of each unit type) plus 2 wilds, unshuffled. */
export function buildDeck(): Card[] {
  const cards: Card[] = ALL_TERRITORY_IDS.map((territory, i) => ({ id: i, territory, type: UNIT_TYPES[i % 3] }));
  cards.push({ id: 42, territory: null, type: "wild" }, { id: 43, territory: null, type: "wild" });
  return cards;
}

// Classic Risk trade-in schedule: 4, 6, 8, 10, 12, 15, then +5 per set after
// that (20, 25, 30, ...). setNumber is 1-indexed and counted across all players.
export function cardSetBonusArmies(setNumber: number): number {
  const fixed = [4, 6, 8, 10, 12, 15];
  if (setNumber <= fixed.length) return fixed[setNumber - 1];
  return 15 + (setNumber - fixed.length) * 5;
}

const FIXED_VALUES: Record<UnitType, number> = { infantry: 4, cavalry: 6, artillery: 8 };
const FIXED_MIXED_VALUE = 10;

// A valid set is three of the same type, or one of each type (infantry,
// cavalry, artillery) - wild cards substitute for any type in either case.
export function isValidCardSet(cards: readonly Card[]): boolean {
  if (cards.length !== 3) return false;
  const real = cards.filter((c) => c.type !== "wild").map((c) => c.type);
  const unique = new Set(real);
  return unique.size <= 1 || unique.size === real.length;
}

/** Fixed-mode value of a valid set; wilds count as whatever makes the set worth most. */
export function fixedSetValue(cards: readonly Card[]): number {
  const real = cards.filter((c) => c.type !== "wild").map((c) => c.type as UnitType);
  const unique = new Set(real);
  let best = 0;
  if (unique.size === 1) best = FIXED_VALUES[real[0]];
  if (unique.size === real.length) best = Math.max(best, FIXED_MIXED_VALUE);
  return best;
}

export function setValue(cards: readonly Card[], mode: CardMode, setNumber: number): number {
  return mode === "fixed" ? fixedSetValue(cards) : cardSetBonusArmies(setNumber);
}

/** Every valid 3-card set in a hand. */
export function allValidSets(hand: readonly Card[]): Card[][] {
  const sets: Card[][] = [];
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      for (let k = j + 1; k < hand.length; k++) {
        const set = [hand[i], hand[j], hand[k]];
        if (isValidCardSet(set)) sets.push(set);
      }
    }
  }
  return sets;
}

/**
 * The set a player would usually want to trade: highest value, then one that
 * earns the +2 territory bonus, then the one that spends the fewest wilds.
 */
export function suggestSet(
  hand: readonly Card[],
  ownedTerritories: ReadonlySet<string>,
  mode: CardMode,
  setNumber: number,
): Card[] | null {
  let best: Card[] | null = null;
  let bestScore = -Infinity;
  for (const set of allValidSets(hand)) {
    const bonus = set.some((c) => c.territory && ownedTerritories.has(c.territory)) ? 2 : 0;
    const wilds = set.filter((c) => c.type === "wild").length;
    const score = (setValue(set, mode, setNumber) + bonus) * 10 - wilds;
    if (score > bestScore) {
      best = set;
      bestScore = score;
    }
  }
  return best;
}
