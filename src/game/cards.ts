import type { Card, CardType } from "./types";

// Classic Risk trade-in schedule: 4, 6, 8, 10, 12, 15, then +5 per set after
// that (20, 25, 30, ...). setNumber is 1-indexed (the 1st set ever traded in
// by anyone at the table, tracked globally across all players).
export function cardSetBonusArmies(setNumber: number): number {
  const fixed = [4, 6, 8, 10, 12, 15];
  if (setNumber <= fixed.length) return fixed[setNumber - 1];
  return 15 + (setNumber - fixed.length) * 5;
}

// A valid set is three of the same type, or one of each type (infantry,
// cavalry, artillery) - wild cards substitute for any type in either case.
export function isValidCardSet(cards: [Card, Card, Card]): boolean {
  const types = cards.map((c) => c.type);
  const wilds = types.filter((t) => t === "wild").length;
  const real = types.filter((t) => t !== "wild");
  const uniqueReal = new Set(real);

  if (uniqueReal.size <= 1) return true; // all-same (plus wilds) always works
  if (uniqueReal.size === real.length) {
    // all distinct real types - valid as a "one of each" set once wilds
    // fill in for any missing slot, i.e. at most 3 distinct kinds total
    return uniqueReal.size + wilds <= 3 && real.length + wilds === 3;
  }
  return false;
}

export function territoryBonusForSet(
  cards: [Card, Card, Card],
  ownedTerritories: Set<string>,
): number {
  const owned = cards.some((c) => c.territory && ownedTerritories.has(c.territory));
  return owned ? 2 : 0;
}

export const CARD_TYPES: CardType[] = ["infantry", "cavalry", "artillery"];
