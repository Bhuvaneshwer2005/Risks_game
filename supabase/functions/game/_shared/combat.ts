export type RollDie = () => number;

export interface AttackRollResult {
  attackerDice: number[];
  defenderDice: number[];
  attackerLosses: number;
  defenderLosses: number;
}

export function maxAttackerDice(attackerArmies: number): number {
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
    if (attackerDice[i] > defenderDice[i]) {
      defenderLosses++;
    } else {
      attackerLosses++;
    }
  }

  return { attackerDice, defenderDice, attackerLosses, defenderLosses };
}

export function moveInBounds(
  attackerArmiesRemainingInOrigin: number,
  diceUsedInFinalRoll: number,
): { min: number; max: number } {
  const max = attackerArmiesRemainingInOrigin - 1;
  const min = Math.min(diceUsedInFinalRoll, max);
  return { min, max };
}
