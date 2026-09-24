// Combat resolution. Dice rolling is injected via `rollDie` so tests get
// deterministic outcomes and the server can wire in a cryptographically
// secure die - this module only decides what the rules do with the results.

export type RollDie = () => number; // must return an integer in [1, 6]

export interface AttackRollResult {
  attackerDice: number[];
  defenderDice: number[];
  attackerLosses: number;
  defenderLosses: number;
}

export function maxAttackerDice(attackerArmies: number): number {
  // One army must always stay behind to hold the territory.
  return Math.max(0, Math.min(3, attackerArmies - 1));
}

export function maxDefenderDice(defenderArmies: number): number {
  return Math.max(0, Math.min(2, defenderArmies));
}

function rollN(n: number, rollDie: RollDie): number[] {
  return Array.from({ length: n }, () => rollDie()).sort((a, b) => b - a);
}

export function resolveAttackRoll(
  attackerArmies: number,
  defenderArmies: number,
  attackerDiceCount: number,
  defenderDiceCount: number,
  rollDie: RollDie,
): AttackRollResult {
  if (attackerDiceCount < 1 || attackerDiceCount > maxAttackerDice(attackerArmies)) {
    throw new Error(`Invalid attacker dice count ${attackerDiceCount} for ${attackerArmies} armies`);
  }
  if (defenderDiceCount < 1 || defenderDiceCount > maxDefenderDice(defenderArmies)) {
    throw new Error(`Invalid defender dice count ${defenderDiceCount} for ${defenderArmies} armies`);
  }

  const attackerDice = rollN(attackerDiceCount, rollDie);
  const defenderDice = rollN(defenderDiceCount, rollDie);
  const pairs = Math.min(attackerDice.length, defenderDice.length);

  let attackerLosses = 0;
  let defenderLosses = 0;
  for (let i = 0; i < pairs; i++) {
    // Ties are won by the defender.
    if (attackerDice[i] > defenderDice[i]) {
      defenderLosses++;
    } else {
      attackerLosses++;
    }
  }

  return { attackerDice, defenderDice, attackerLosses, defenderLosses };
}
