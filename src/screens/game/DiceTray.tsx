import { TERRITORIES } from "../../game/mapData.ts";
import type { GameEvent, PublicState } from "../../game/types.ts";
import { DiceRow } from "../../ui/index.tsx";
import { playerName } from "./describe.ts";
import styles from "./game.module.css";

type Battle = Extract<GameEvent, { type: "battle" }>;

// Shows the final roll of a battle (a blitz shows its last roll plus totals).
export function DiceTray({ battle, game }: { battle: Battle; game: PublicState }) {
  const roll = battle.rolls.at(-1)!;
  const pairs = Math.min(roll.attacker.length, roll.defender.length);
  const attackerLost = roll.attacker.map((v, i) => i < pairs && v <= roll.defender[i]);
  const defenderLost = roll.defender.map((v, i) => i < pairs && roll.attacker[i] > v);
  const attacker = game.players.find((p) => p.id === battle.player);
  const defender = game.players.find((p) => p.id === battle.defender);

  return (
    <div className={styles.diceTray} role="status">
      <div className={styles.diceSide}>
        <span className={styles.diceWho} style={{ color: attacker?.color }}>
          {playerName(game, battle.player)}
        </span>
        <span className={styles.diceWhere}>{TERRITORIES[battle.from].name}</span>
        <DiceRow values={roll.attacker} side="attack" lostFlags={attackerLost} />
      </div>
      <div className={styles.diceVs}>
        {battle.captured ? <span className={styles.captured}>Captured!</span> : <span>vs</span>}
        {battle.rolls.length > 1 && <span className={styles.diceRolls}>{battle.rolls.length} rolls</span>}
        <span className={styles.diceLosses}>
          −{battle.attackerLosses} / −{battle.defenderLosses}
        </span>
      </div>
      <div className={styles.diceSide}>
        <span className={styles.diceWho} style={{ color: defender?.color }}>
          {playerName(game, battle.defender)}
        </span>
        <span className={styles.diceWhere}>{TERRITORIES[battle.to].name}</span>
        <DiceRow values={roll.defender} side="defend" lostFlags={defenderLost} />
      </div>
    </div>
  );
}
