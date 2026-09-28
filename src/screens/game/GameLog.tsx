import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TERRITORIES, type TerritoryId } from "../../game/mapData.ts";
import type { BattleRoll, GameEvent, PlayerId, PlayerState, PublicState } from "../../game/types.ts";
import type { FeedEvent } from "../../net/connection.ts";
import { Icon, Segmented, type IconName } from "../../ui/index.tsx";
import styles from "./log.module.css";

type Claim = { player: PlayerId; territory: TerritoryId };

type Entry = { kind: "event"; seq: number; event: GameEvent } | { kind: "claims"; seq: number; claims: Claim[] };

interface Group {
  key: string;
  /** Null for setup (or for the tail of a turn whose start scrolled out of the feed). */
  turn: number | null;
  player: PlayerId | null;
  reinforcements: number;
  entries: Entry[];
}

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

// Turns become groups under a sticky header; a run of claims becomes one entry.
function buildGroups(feed: FeedEvent[]): Group[] {
  const groups: Group[] = [];
  let group: Group | null = null;
  for (const { seq, event } of feed) {
    if (event.type === "turnStarted") {
      group = { key: `turn-${seq}`, turn: event.turn, player: event.player, reinforcements: event.reinforcements, entries: [] };
      groups.push(group);
      continue;
    }
    if (!group) {
      group = { key: `pre-${seq}`, turn: null, player: null, reinforcements: 0, entries: [] };
      groups.push(group);
    }
    const last = group.entries.at(-1);
    if (event.type === "claimed") {
      const claim = { player: event.player, territory: event.territory };
      if (last?.kind === "claims") last.claims.push(claim);
      else group.entries.push({ kind: "claims", seq, claims: [claim] });
      continue;
    }
    group.entries.push({ kind: "event", seq, event });
  }
  return groups;
}

const BATTLE_TYPES = new Set<GameEvent["type"]>(["battle", "eliminated", "gameOver"]);
const isBattle = (e: Entry) => e.kind === "event" && BATTLE_TYPES.has(e.event.type);

/** `showKicker`: name who removed a player (online, the host; locally it's whoever held the device). */
export function GameLog({ feed, game, showKicker }: { feed: FeedEvent[]; game: PublicState; showKicker: boolean }) {
  const [filter, setFilter] = useState<"all" | "battles">("all");
  const groups = useMemo(() => buildGroups(feed), [feed]);
  const shown = useMemo(
    () => (filter === "all" ? groups : groups.map((g) => ({ ...g, entries: g.entries.filter(isBattle) })).filter((g) => g.entries.length > 0)),
    [groups, filter],
  );
  const players = useMemo(() => new Map(game.players.map((p) => [p.id, p])), [game.players]);

  // Reads like a chat: new entries appear at the bottom, and the list follows
  // them unless the reader has scrolled up to look at something older.
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [shown]);

  return (
    <div className={styles.log}>
      <div className={styles.filter}>
        <Segmented
          label="Show"
          value={filter}
          onChange={(f) => {
            following.current = true;
            setFilter(f);
          }}
          options={[
            { value: "all", label: "Everything" },
            { value: "battles", label: "Battles" },
          ]}
        />
      </div>
      <div
        ref={scroller}
        className={styles.scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {shown.length === 0 ? (
          <p className={styles.empty}>{filter === "battles" ? "No battles yet." : "Nothing has happened yet."}</p>
        ) : (
          shown.map((g) => <TurnGroup key={g.key} group={g} players={players} showKicker={showKicker} />)
        )}
      </div>
    </div>
  );
}

type Players = Map<PlayerId, PlayerState>;

function TurnGroup({ group, players, showKicker }: { group: Group; players: Players; showKicker: boolean }) {
  const p = group.player ? players.get(group.player) : undefined;
  const setup = group.entries.some((e) => e.kind === "claims" || (e.kind === "event" && (e.event.type === "gameStarted" || e.event.type === "setupReady")));
  return (
    <section className={styles.group} style={p ? { ["--who" as string]: p.color } : undefined}>
      <header className={cx(styles.head, p && styles.headTurn)}>
        {group.turn !== null ? (
          <>
            <span className={styles.turnNo}>Turn {group.turn}</span>
            <Who id={group.player} players={players} />
            <span className={styles.gain}>+{group.reinforcements} armies</span>
          </>
        ) : (
          <span className={styles.turnNo}>{setup ? "Setup" : "Earlier"}</span>
        )}
      </header>
      <ol className={styles.entries}>
        {group.entries.map((e) =>
          e.kind === "claims" ? (
            <ClaimsRow key={e.seq} claims={e.claims} players={players} />
          ) : (
            <EventRow key={e.seq} event={e.event} players={players} showKicker={showKicker} />
          ),
        )}
      </ol>
    </section>
  );
}

function Who({ id, players }: { id: PlayerId | null; players: Players }) {
  const p = id ? players.get(id) : undefined;
  return (
    <b className={styles.who} style={{ color: p?.color }}>
      {p?.name ?? "Someone"}
    </b>
  );
}

const Place = ({ id }: { id: TerritoryId }) => <span className={styles.place}>{TERRITORIES[id].name}</span>;

function Row(props: { icon: IconName; tone?: "gold" | "danger" | "muted" | "out"; children: ReactNode; sub?: ReactNode }) {
  return (
    <li className={cx(styles.row, props.tone && styles[props.tone])}>
      <span className={styles.icon}>
        <Icon name={props.icon} size={14} />
      </span>
      <div className={styles.text}>
        <div>{props.children}</div>
        {props.sub && <div className={styles.sub}>{props.sub}</div>}
      </div>
    </li>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function EventRow({ event: e, players, showKicker }: { event: GameEvent; players: Players; showKicker: boolean }) {
  const who = (id: PlayerId | null) => <Who id={id} players={players} />;
  switch (e.type) {
    case "gameStarted":
      return (
        <Row icon="globe" tone="gold">
          The war begins
        </Row>
      );
    case "claimsComplete":
      return (
        <Row icon="check" tone="gold">
          All 42 territories claimed. Everyone places the rest of their armies.
        </Row>
      );
    case "setupReady":
      return <Row icon="check">{who(e.player)} deployed their starting armies</Row>;
    case "reinforced": {
      const list = Object.entries(e.placements)
        .filter(([, n]) => (n ?? 0) > 0)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) as [TerritoryId, number][];
      const total = list.reduce((sum, [, n]) => sum + n, 0);
      return (
        <Row
          icon="plus"
          sub={
            <span className={styles.chips}>
              {list.slice(0, 5).map(([t, n]) => (
                <span key={t} className={styles.chip}>
                  {TERRITORIES[t].name} <b>+{n}</b>
                </span>
              ))}
              {list.length > 5 && <span className={styles.chip}>+{list.length - 5} more</span>}
            </span>
          }
        >
          {who(e.player)} placed {plural(total, "army", "armies")}
        </Row>
      );
    }
    case "traded":
      return (
        <Row icon="cards" tone="gold" sub={e.bonusTerritory ? <>+2 extra on {<Place id={e.bonusTerritory} />}</> : undefined}>
          {who(e.player)} traded a card set for <b className={styles.goldText}>+{e.armies}</b> armies
        </Row>
      );
    case "battle":
      return <BattleRow battle={e} players={players} />;
    case "movedIn":
      return (
        <Row icon="move">
          {who(e.player)} moved {e.count} more into <Place id={e.to} />
        </Row>
      );
    case "fortified":
      return (
        <Row icon="move" sub={`${plural(e.count, "army", "armies")} moved; turn over`}>
          {who(e.player)} fortified <Place id={e.from} /> → <Place id={e.to} />
        </Row>
      );
    case "cardDrawn":
      return (
        <Row icon="cards" tone="muted">
          {who(e.player)} earned a card
        </Row>
      );
    case "eliminated":
      return (
        <Row icon="crown" tone="danger" sub={e.cardsTaken ? `and took ${plural(e.cardsTaken, "card")}` : undefined}>
          {who(e.by)} eliminated {who(e.player)}
        </Row>
      );
    case "timedOut":
      return (
        <Row icon="clock" tone="out" sub={e.strikes >= 3 ? "Three in a row: out of the game" : `Strike ${e.strikes} of 3`}>
          {who(e.player)} ran out of time
        </Row>
      );
    case "resigned":
      return (
        <Row icon="flag" tone="out" sub="Their armies stay as neutral defenders">
          {who(e.player)} left the war
        </Row>
      );
    case "kicked":
      return (
        <Row
          icon="flag"
          tone="out"
          sub={showKicker ? <>Removed by {who(e.by)}; their armies stay as neutral defenders</> : "Their armies stay as neutral defenders"}
        >
          {who(e.player)} was removed from the game
        </Row>
      );
    case "gameOver":
      return (
        <Row icon="crown" tone="gold">
          {e.winner ? <>{who(e.winner)} conquered the world</> : "The war is over"}
        </Row>
      );
    case "claimed":
    case "turnStarted":
      return null;
  }
}

function BattleRow({ battle: e, players }: { battle: Extract<GameEvent, { type: "battle" }>; players: Players }) {
  const roll = e.rolls.at(-1);
  return (
    <li className={cx(styles.row, styles.battle, e.captured && styles.won)}>
      <span className={styles.icon}>
        <Icon name="sword" size={14} />
      </span>
      <div className={styles.text}>
        <div className={styles.battleHead}>
          <span>
            <Who id={e.player} players={players} /> <span className={styles.dim}>attacked</span> <Who id={e.defender} players={players} />
          </span>
          <span className={cx(styles.result, e.captured ? styles.resultWon : styles.resultHeld)}>{e.captured ? "Captured" : "Held"}</span>
        </div>
        <div className={styles.sub}>
          <Place id={e.from} /> → <Place id={e.to} />
        </div>
        {roll && (
          <div className={styles.battleDice}>
            <MiniDice roll={roll} side="attack" />
            <span className={styles.dim}>vs</span>
            <MiniDice roll={roll} side="defend" />
            <span className={styles.losses}>
              lost {e.attackerLosses} · killed {e.defenderLosses}
            </span>
          </div>
        )}
        {(e.rolls.length > 1 || e.captured) && (
          <div className={styles.sub}>
            {e.rolls.length > 1 && `Blitz: ${e.rolls.length} rolls, last one shown`}
            {e.rolls.length > 1 && e.captured && " · "}
            {e.captured && `moved in ${plural(e.movedIn, "army", "armies")}`}
          </div>
        )}
      </div>
    </li>
  );
}

// Dice are sorted high to low; each pair compares the attacker's die with the defender's.
function MiniDice({ roll, side }: { roll: BattleRoll; side: "attack" | "defend" }) {
  const pairs = Math.min(roll.attacker.length, roll.defender.length);
  const values = side === "attack" ? roll.attacker : roll.defender;
  return (
    <span className={styles.dice}>
      {values.map((v, i) => {
        const lost = i < pairs && (side === "attack" ? v <= roll.defender[i] : roll.attacker[i] > v);
        return (
          <span key={i} className={cx(styles.die, side === "attack" ? styles.dieAttack : styles.dieDefend, lost && styles.dieLost)}>
            {v}
          </span>
        );
      })}
    </span>
  );
}

function ClaimsRow({ claims, players }: { claims: Claim[]; players: Players }) {
  return (
    <Row
      icon="flag"
      sub={
        <span className={styles.chips}>
          {claims.map((c) => (
            <span key={c.territory} className={styles.claim} style={{ borderColor: players.get(c.player)?.color }}>
              {TERRITORIES[c.territory].name}
            </span>
          ))}
        </span>
      }
    >
      {plural(claims.length, "territory", "territories")} claimed
    </Row>
  );
}
