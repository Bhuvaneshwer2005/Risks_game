import { useState, type ReactNode } from "react";
import { CONTINENTS, TERRITORIES, type TerritoryId } from "../../game/mapData.ts";
import { maxAttackerDice } from "../../game/combat.ts";
import { reinforcementBreakdown } from "../../game/selectors.ts";
import type { PendingCapture, PlayerId, PlayerState, PublicState } from "../../game/types.ts";
import { Button, Dot, RangeField, Segmented } from "../../ui/index.tsx";
import styles from "./game.module.css";

export type DockMode =
  | { kind: "over" }
  | { kind: "setup-place"; pool: number }
  | { kind: "setup-wait"; ready: number; total: number }
  | { kind: "wait"; player: PlayerState }
  | { kind: "trade"; forced: boolean; reason: string }
  | { kind: "place"; pool: number }
  | { kind: "attack" }
  | { kind: "fortify" };

export interface DockProps {
  mode: DockMode;
  /** Pass & play: who is holding the device right now. */
  actor?: PlayerState | null;
  game: PublicState;
  me: PlayerId;
  handSize: number;
  canTrade: boolean;
  busy: boolean;
  draftTotal: number;
  from: TerritoryId | null;
  to: TerritoryId | null;
  captureDismissed: boolean;
  onConfirmPlacement: () => void;
  onAutoPlace: () => void;
  onClearDraft: () => void;
  onOpenTrade: () => void;
  onAttack: (dice: number) => void;
  onBlitz: () => void;
  onMoveMore: (count: number) => void;
  onDismissCapture: () => void;
  onEndAttack: () => void;
  onFortify: (count: number) => void;
  onEndTurn: () => void;
  onClearSelection: () => void;
}

const name = (id: TerritoryId) => TERRITORIES[id].name;
const TOUCH = typeof matchMedia === "function" && matchMedia("(hover: none)").matches;

function Title({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className={styles.dockTitle}>
      <h3>{children}</h3>
      {hint && <p>{hint}</p>}
    </div>
  );
}

export function ActionDock(p: DockProps) {
  const body = <DockBody {...p} />;
  if (!p.actor || p.mode.kind === "over" || p.mode.kind === "wait" || p.mode.kind === "setup-wait") return body;
  return (
    <div className={styles.dockStack}>
      <div className={styles.actorChip} style={{ borderColor: p.actor.color }}>
        <Dot color={p.actor.color} /> {p.actor.name}, you're up
      </div>
      {body}
    </div>
  );
}

function DockBody(p: DockProps) {
  const { mode, game } = p;

  switch (mode.kind) {
    case "over":
      return null;

    case "setup-wait":
      return (
        <div className={styles.dock}>
          <Title hint="Everyone places their starting armies at the same time.">
            Waiting for commanders · {mode.ready}/{mode.total} ready
          </Title>
        </div>
      );

    case "wait":
      return (
        <div className={styles.dock}>
          <Title hint="Watch the board: every move plays out live.">
            <Dot color={mode.player.color} /> {mode.player.name} is taking their turn · {game.phase}
          </Title>
        </div>
      );

    case "trade":
      return (
        <div className={styles.dock}>
          <Title hint={mode.reason}>Trade in cards</Title>
          <div className={styles.dockRow}>
            <Button variant="primary" icon="cards" onClick={p.onOpenTrade}>
              Choose a set
            </Button>
          </div>
        </div>
      );

    case "setup-place":
    case "place":
      return <PlaceDock {...p} pool={mode.pool} setup={mode.kind === "setup-place"} />;

    case "attack":
      return game.pendingCapture && !p.captureDismissed && game.territories[game.pendingCapture.from].armies > 1 ? (
        <CaptureDock key={`${game.pendingCapture.from}-${game.pendingCapture.to}`} {...p} pending={game.pendingCapture} />
      ) : (
        <AttackDock {...p} />
      );

    case "fortify":
      return <FortifyDock key={`${p.from}-${p.to}`} {...p} />;
  }
}

function PlaceDock(p: DockProps & { pool: number; setup: boolean }) {
  const { game, pool, setup } = p;
  const left = pool - p.draftTotal;
  const breakdown = !setup && game.phase === "reinforce" ? reinforcementBreakdown(game, p.me) : null;
  return (
    <div className={styles.dock}>
      <Title
        hint={
          TOUCH
            ? "Tap your territories to add armies one at a time. Reset to start over."
            : setup
              ? "Click your territories to place armies. Shift-click adds 5, right-click takes one back."
              : "Click to add, shift-click for +5, right-click to take one back."
        }
      >
        {setup ? "Deploy your starting armies" : "Reinforce"} ·{" "}
        <span className={styles.gold}>
          {left} of {pool} left
        </span>
      </Title>
      {breakdown && (
        <div className={styles.breakdown}>
          <span>
            {breakdown.territories} territories → <b>{breakdown.base}</b>
          </span>
          {breakdown.continents.map((c) => (
            <span key={c}>
              {CONTINENTS[c].name} <b>+{CONTINENTS[c].bonusArmies}</b>
            </span>
          ))}
          {pool > breakdown.total && (
            <span>
              Cards <b>+{pool - breakdown.total}</b>
            </span>
          )}
        </div>
      )}
      <div className={styles.dockRow}>
        {p.canTrade && (
          <Button variant="secondary" icon="cards" onClick={p.onOpenTrade}>
            Trade cards ({p.handSize})
          </Button>
        )}
        <Button variant="ghost" icon="undo" onClick={p.onClearDraft} disabled={p.draftTotal === 0 || p.busy}>
          Reset
        </Button>
        <Button variant="secondary" icon="bolt" onClick={p.onAutoPlace} disabled={left === 0 || p.busy}>
          Auto-place
        </Button>
        <Button variant="primary" icon="check" onClick={p.onConfirmPlacement} disabled={p.busy || (setup ? left !== 0 : p.draftTotal === 0)}>
          {setup ? "Confirm deployment" : left === 0 ? "Confirm" : `Place ${p.draftTotal}`}
        </Button>
      </div>
    </div>
  );
}

function CaptureDock(p: DockProps & { pending: PendingCapture }) {
  const max = p.game.territories[p.pending.from].armies - 1;
  const [extra, setExtra] = useState(max);
  return (
    <div className={styles.dock}>
      <Title hint={`${name(p.pending.to)} is yours. Move more armies in from ${name(p.pending.from)}?`}>
        <span className={styles.gold}>Territory captured</span>
      </Title>
      <RangeField label="Extra armies to move" min={0} max={max} value={extra} onChange={setExtra} />
      <div className={styles.dockRow}>
        <Button variant="ghost" onClick={p.onDismissCapture}>
          Keep as is
        </Button>
        <Button variant="primary" icon="move" disabled={p.busy || extra === 0} onClick={() => p.onMoveMore(extra)}>
          Move {extra} more
        </Button>
      </div>
    </div>
  );
}

function AttackDock(p: DockProps) {
  const { game, from, to } = p;
  const fromArmies = from ? game.territories[from].armies : 0;
  const maxDice = maxAttackerDice(fromArmies);
  const [dice, setDice] = useState(3);
  const useDice = Math.max(1, Math.min(dice, maxDice));

  return (
    <div className={styles.dock}>
      {from && to ? (
        <>
          <Title hint="Ties go to the defender. Blitz keeps rolling until you win or can't continue.">
            {name(from)} <span className={styles.muted}>({fromArmies})</span> → {name(to)}{" "}
            <span className={styles.muted}>({game.territories[to].armies})</span>
          </Title>
          <div className={styles.dockRow}>
            <Segmented
              label="Attack dice"
              value={useDice}
              onChange={setDice}
              options={[1, 2, 3].map((n) => ({ value: n, label: `${n} ${n === 1 ? "die" : "dice"}`, disabled: n > maxDice }))}
            />
            <Button variant="danger" icon="sword" disabled={p.busy || maxDice === 0} onClick={() => p.onAttack(useDice)}>
              Attack
            </Button>
            <Button variant="primary" icon="bolt" disabled={p.busy || maxDice === 0} onClick={p.onBlitz}>
              Blitz
            </Button>
          </div>
        </>
      ) : (
        <Title hint={from ? "Now pick a glowing enemy territory next to it." : "Pick one of your territories with 2 or more armies."}>
          Attack
        </Title>
      )}
      <div className={styles.dockRow}>
        {(from || to) && (
          <Button variant="ghost" onClick={p.onClearSelection}>
            Clear
          </Button>
        )}
        <Button variant="secondary" onClick={p.onEndAttack} disabled={p.busy}>
          Done attacking
        </Button>
        <Button variant="ghost" onClick={p.onEndTurn} disabled={p.busy}>
          End turn
        </Button>
      </div>
    </div>
  );
}

function FortifyDock(p: DockProps) {
  const { game, from, to } = p;
  const max = from ? game.territories[from].armies - 1 : 0;
  const [count, setCount] = useState(Math.max(1, max));
  const rule = game.settings.fortifyRule === "adjacent" ? "a neighbouring territory" : "any territory connected through yours";

  return (
    <div className={styles.dock}>
      {from && to ? (
        <>
          <Title hint="One fortify move per turn. It ends your turn.">
            Move from {name(from)} → {name(to)}
          </Title>
          <RangeField label="Armies to move" min={1} max={Math.max(1, max)} value={count} onChange={setCount} />
        </>
      ) : (
        <Title hint={from ? "Pick where to move them." : `Move armies once, into ${rule}, or end your turn.`}>Fortify</Title>
      )}
      <div className={styles.dockRow}>
        {(from || to) && (
          <Button variant="ghost" onClick={p.onClearSelection}>
            Clear
          </Button>
        )}
        {from && to && (
          <Button variant="primary" icon="move" disabled={p.busy || max < 1} onClick={() => p.onFortify(Math.min(count, max))}>
            Move {Math.min(count, max)} & end turn
          </Button>
        )}
        <Button variant="secondary" onClick={p.onEndTurn} disabled={p.busy}>
          End turn
        </Button>
      </div>
    </div>
  );
}
