import { useMemo, useState } from "react";
import { ALL_TERRITORY_IDS, TERRITORIES } from "../../game/mapData.ts";
import { isValidCardSet, setValue, suggestSet } from "../../game/cards.ts";
import type { Card, PlayerId, PublicState } from "../../game/types.ts";
import { Button, CardFace, Modal } from "../../ui/index.tsx";
import styles from "./game.module.css";

export function TradeModal(props: {
  game: PublicState;
  me: PlayerId;
  hand: Card[];
  /** When the rules force a trade, the modal can't be dismissed. */
  forced: boolean;
  reason: string;
  onTrade: (cardIds: number[]) => Promise<void>;
  onClose: () => void;
}) {
  const { game, me, hand } = props;
  const owned = useMemo(() => new Set<string>(ALL_TERRITORY_IDS.filter((t) => game.territories[t].owner === me)), [game, me]);
  const [picked, setPicked] = useState<number[]>(() => suggestSet(hand, owned, game.settings.cardMode, game.setsTraded + 1)?.map((c) => c.id) ?? []);
  const [busy, setBusy] = useState(false);

  const cards = hand.filter((c) => picked.includes(c.id));
  const valid = cards.length === 3 && isValidCardSet(cards);
  const value = valid ? setValue(cards, game.settings.cardMode, game.setsTraded + 1) : 0;
  const bonusCard = valid && !game.territoryBonusUsed ? cards.find((c) => c.territory && owned.has(c.territory)) : undefined;

  const toggle = (id: number) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 3 ? [...prev, id] : [...prev.slice(1), id]));

  const trade = async () => {
    setBusy(true);
    try {
      await props.onTrade(picked);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Trade cards" subtitle={props.reason} onClose={props.forced ? undefined : props.onClose} wide>
      <div className={styles.tradeHand}>
        {hand.map((card) => (
          <CardFace
            key={card.id}
            card={card}
            selected={picked.includes(card.id)}
            ownedBonus={!!card.territory && owned.has(card.territory)}
            onClick={() => toggle(card.id)}
          />
        ))}
      </div>
      <div className={styles.tradeFooter}>
        <div className={styles.tradeValue}>
          {valid ? (
            <>
              <strong>+{value} armies</strong>
              {bonusCard?.territory && <span> and +2 on {TERRITORIES[bonusCard.territory].name}</span>}
            </>
          ) : cards.length === 3 ? (
            <span className={styles.warn}>Not a set: pick 3 of a kind or one of each.</span>
          ) : (
            <span className={styles.muted}>Pick 3 cards: 3 of a kind, or one of each (wilds count as anything).</span>
          )}
          <div className={styles.muted}>
            {game.settings.cardMode === "progressive" ? `Set #${game.setsTraded + 1} at this table.` : "Fixed values: 4 / 6 / 8, or 10 for one of each."}
          </div>
        </div>
        <div className={styles.tradeActions}>
          {!props.forced && (
            <Button variant="ghost" onClick={props.onClose}>
              Not now
            </Button>
          )}
          <Button variant="primary" icon="check" disabled={!valid || busy} onClick={trade}>
            Trade set
          </Button>
        </div>
      </div>
    </Modal>
  );
}
