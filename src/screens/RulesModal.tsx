import { CONTINENTS } from "../game/mapData.ts";
import { Modal } from "../ui/index.tsx";
import styles from "./screens.module.css";

export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" subtitle="The classic rules, with a few online conveniences." onClose={onClose} wide>
      <div className={styles.rules}>
        <section>
          <h3>Goal</h3>
          <p>Eliminate every other player by conquering all 42 territories. In a 2-player game a neutral army also holds land; you only need to beat your opponent.</p>
        </section>
        <section>
          <h3>Setup</h3>
          <p>
            Territories are dealt out at random with one army each. Everyone then places the rest of their starting armies (35 / 30 / 25 / 20 for 3–6
            players, 40 in a 2-player game) at the same time.
          </p>
        </section>
        <section>
          <h3>Each turn</h3>
          <ol>
            <li>
              <b>Reinforce.</b> Get territories ÷ 3 (at least 3), plus a bonus for every whole continent you hold, plus any card sets you trade in.
            </li>
            <li>
              <b>Attack</b> (optional). Attack a bordering enemy from a territory with 2+ armies. You roll up to 3 dice (one fewer than your armies), the
              defender up to 2. Highest dice are compared in pairs; <b>ties go to the defender</b>. After a capture you move in at least as many armies
              as dice you rolled.
            </li>
            <li>
              <b>Fortify</b> (optional). Move armies once, then your turn ends. Classic rules allow a neighbouring territory; the lobby can allow any
              connected chain.
            </li>
          </ol>
        </section>
        <section>
          <h3>Continent bonuses</h3>
          <div className={styles.bonusGrid}>
            {Object.values(CONTINENTS).map((c) => (
              <span key={c.id}>
                {c.name} <b>+{c.bonusArmies}</b>
              </span>
            ))}
          </div>
        </section>
        <section>
          <h3>Cards</h3>
          <ul>
            <li>Conquer at least one territory in a turn to earn one card (never more than one per turn).</li>
            <li>A set is 3 of a kind, one of each, or any 2 plus a wild. Sets pay 4, 6, 8, 10, 12, 15, then 5 more each time (or fixed 4/6/8/10).</li>
            <li>If a traded card shows a territory you hold, you get 2 extra armies there (once per turn).</li>
            <li>With 5 or more cards at the start of your turn, you must trade.</li>
            <li>Knock a player out and you take their cards; with 6 or more you trade down to 4 right away.</li>
          </ul>
        </section>
        <section>
          <h3>Online</h3>
          <ul>
            <li>The defender always rolls the most dice allowed, so no one waits on anyone.</li>
            <li>Blitz keeps rolling until you capture the territory or can't attack any more.</li>
            <li>When the turn timer runs out, the turn is finished for you. Three timeouts in a row and you're out.</li>
          </ul>
        </section>
      </div>
    </Modal>
  );
}
