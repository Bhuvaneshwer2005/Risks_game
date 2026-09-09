import type { Card, CardType } from "./types.ts";

export function cardSetBonusArmies(setNumber: number): number {
  const fixed = [4, 6, 8, 10, 12, 15];
  if (setNumber <= fixed.length) return fixed[setNumber - 1];
  return 15 + (setNumber - fixed.length) * 5;
}

export function isValidCardSet(cards: [Card, Card, Card]): boolean {
  const types = cards.map((c) => c.type);
  const wilds = types.filter((t) => t === "wild").length;
  const real = types.filter((t) => t !== "wild");
  const uniqueReal = new Set(real);

  if (uniqueReal.size <= 1) return true;
  if (uniqueReal.size === real.length) {
    return uniqueReal.size + wilds <= 3 && real.length + wilds === 3;
  }
  return false;
}

export function territoryBonusForSet(cards: [Card, Card, Card], ownedTerritories: Set<string>): number {
  const owned = cards.some((c) => c.territory && ownedTerritories.has(c.territory));
  return owned ? 2 : 0;
}

export const CARD_TYPES: CardType[] = ["infantry", "cavalry", "artillery"];
