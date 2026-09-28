import { useMemo, useState, type CSSProperties } from "react";
import { mulberry32 } from "../../game/rng.ts";
import type { PlayerState, PlayerStats, PublicState } from "../../game/types.ts";
import { Button, Dot, Icon, Modal, Segmented } from "../../ui/index.tsx";
import { average, awards, standings, type Award } from "./results.ts";
import styles from "./victory.module.css";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

export interface VictoryProps {
  game: PublicState;
  /** Name who removed a kicked player (online only). */
  showKicker: boolean;
  onShowStats: () => void;
  onViewBoard: () => void;
  onHome: () => void;
  /** Online host only. */
  onRematch?: () => void;
}

export function VictoryScreen({ game, showKicker, onShowStats, onViewBoard, onHome, onRematch }: VictoryProps) {
  const winner = game.players.find((p) => p.id === game.winner) ?? null;
  const table = useMemo(() => standings(game, { showKicker }), [game, showKicker]);
  const prizes = useMemo(() => awards(game), [game]);
  const st = winner ? game.stats?.[winner.id] : undefined;
  const others = game.players.filter((p) => !p.neutral && p.id !== game.winner);
  const byConquest = others.some((p) => p.status === "eliminated");

  return (
    <div className={styles.overlay} style={{ ["--win" as string]: winner?.color ?? "var(--gold)" } as CSSProperties}>
      <Confetti color={winner?.color ?? "#f2cf78"} />
      <div className={styles.card} role="dialog" aria-modal="true" aria-labelledby="victory-title">
        <div className={styles.crown}>
          <Icon name="crown" size={56} strokeWidth={1.5} />
        </div>
        <p className={styles.eyebrow}>Victory</p>
        <h2 id="victory-title" className={styles.title}>
          {winner ? (
            <>
              <span className={styles.winnerName}>{winner.name}</span> conquers the world
            </>
          ) : (
            "The war is over"
          )}
        </h2>
        <p className={styles.subtitle}>
          {winner && !byConquest && others.length > 0 ? "The last commander standing" : "World domination"} after {game.turnNumber}{" "}
          {game.turnNumber === 1 ? "turn" : "turns"}
        </p>

        {st && (
          <div className={styles.tiles}>
            <Tile value={st.conquests} label="Territories conquered" />
            <Tile value={st.armiesDestroyed} label="Enemy armies destroyed" />
            <Tile value={st.eliminations} label={st.eliminations === 1 ? "Player knocked out" : "Players knocked out"} />
            <Tile value={st.peakArmies} label="Largest army" />
          </div>
        )}

        <ol className={styles.standings}>
          {table.map((row) => (
            <li key={row.player.id} className={cx(row.place === 1 && styles.first)}>
              <span className={styles.place}>{row.place}</span>
              <Dot color={row.player.color} size={12} />
              <span className={styles.standingName}>{row.player.name}</span>
              <span className={styles.outcome}>{row.outcome}</span>
            </li>
          ))}
        </ol>

        {prizes.length > 0 && <Awards list={prizes} />}

        <div className={styles.actions}>
          <Button variant="ghost" icon="map" onClick={onViewBoard}>
            View the board
          </Button>
          {game.stats && (
            <Button variant="secondary" icon="log" onClick={onShowStats}>
              Full stats
            </Button>
          )}
          {onRematch && (
            <Button variant="secondary" icon="undo" onClick={onRematch}>
              Rematch
            </Button>
          )}
          <Button variant="primary" icon="home" onClick={onHome}>
            Back to home
          </Button>
        </div>
      </div>
    </div>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileValue}>{value}</span>
      <span className={styles.tileLabel}>{label}</span>
    </div>
  );
}

function Awards({ list }: { list: Award[] }) {
  return (
    <div className={styles.awards}>
      {list.map((a) => (
        <div key={a.id} className={styles.award} style={{ ["--who" as string]: a.player.color } as CSSProperties}>
          <span className={styles.awardIcon}>
            <Icon name={a.icon} size={18} />
          </span>
          <div className={styles.awardText}>
            <span className={styles.awardTitle}>{a.title}</span>
            <span className={styles.awardWho}>{a.player.name}</span>
            <span className={styles.awardDetail}>{a.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Paper confetti in the winner's colour, gold and white. Positions come from a
// fixed seed so re-renders don't reshuffle it.
function Confetti({ color }: { color: string }) {
  const pieces = useMemo(() => {
    const rng = mulberry32(7);
    const colors = [color, color, "#f2cf78", "#ffffff"];
    return Array.from({ length: 70 }, (_, i) => ({
      left: rng() * 100,
      delay: rng() * 2.4,
      duration: 3.2 + rng() * 2.6,
      drift: (rng() - 0.5) * 160,
      spin: 360 + rng() * 720,
      size: 6 + rng() * 7,
      color: colors[i % colors.length],
      round: rng() < 0.3,
    }));
  }, [color]);
  return (
    <div className={styles.confetti} aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className={cx(styles.piece, p.round && styles.pieceRound)}
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.round ? p.size : p.size * 0.45,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              "--drift": `${p.drift}px`,
              "--spin": `${p.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

// ---------- full stats ----------

type Metric = "territories" | "armies";

interface StatRow {
  label: string;
  value: (s: PlayerStats) => number;
  format?: (s: PlayerStats) => string;
  /** Which end of the row is best (highlighted), if either. */
  best?: "high" | "low";
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : a > 0 ? Infinity : 0);

const ROWS: StatRow[] = [
  { label: "Turns played", value: (s) => s.turns },
  { label: "Armies from reinforcements", value: (s) => s.reinforcements, best: "high" },
  { label: "Card sets traded", value: (s) => s.cardArmies, format: (s) => (s.setsTraded ? `${s.setsTraded} (+${s.cardArmies})` : "0"), best: "high" },
  { label: "Attacks launched", value: (s) => s.attacks, best: "high" },
  { label: "Territories conquered", value: (s) => s.conquests, best: "high" },
  { label: "Territories lost", value: (s) => s.territoriesLost, best: "low" },
  { label: "Enemy armies destroyed", value: (s) => s.armiesDestroyed, best: "high" },
  { label: "Armies lost", value: (s) => s.armiesLost, best: "low" },
  {
    label: "Kill ratio",
    value: (s) => ratio(s.armiesDestroyed, s.armiesLost),
    format: (s) => {
      const r = ratio(s.armiesDestroyed, s.armiesLost);
      return r === Infinity ? "∞" : r.toFixed(2);
    },
    best: "high",
  },
  { label: "Attackers stopped on defence", value: (s) => s.defensiveKills, best: "high" },
  {
    label: "Average attack die",
    value: (s) => average(s.attackPips, s.attackDice),
    format: (s) => (s.attackDice ? average(s.attackPips, s.attackDice).toFixed(2) : "–"),
    best: "high",
  },
  {
    label: "Average defence die",
    value: (s) => average(s.defendPips, s.defendDice),
    format: (s) => (s.defendDice ? average(s.defendPips, s.defendDice).toFixed(2) : "–"),
    best: "high",
  },
  { label: "Players knocked out", value: (s) => s.eliminations, best: "high" },
  { label: "Fortify moves", value: (s) => s.fortifies },
  { label: "Most territories held", value: (s) => s.peakTerritories, best: "high" },
  { label: "Largest army", value: (s) => s.peakArmies, best: "high" },
];

export function StatsView({ game, onClose }: { game: PublicState; onClose: () => void }) {
  const [metric, setMetric] = useState<Metric>("territories");
  const stats = game.stats ?? {};
  const humans = game.players.filter((p) => !p.neutral && stats[p.id]);
  const prizes = useMemo(() => awards(game), [game]);

  return (
    <Modal title="War report" subtitle={`${game.turnNumber} turns, ${humans.length} commanders`} onClose={onClose} wide>
      <div className={styles.report}>
        {game.history && game.history.length > 1 && (
          <section>
            <div className={styles.sectionHead}>
              <h3>Over time</h3>
              <Segmented
                label="Chart"
                value={metric}
                onChange={setMetric}
                options={[
                  { value: "territories", label: "Territories" },
                  { value: "armies", label: "Armies" },
                ]}
              />
            </div>
            <HistoryChart game={game} metric={metric} />
          </section>
        )}

        {prizes.length > 0 && (
          <section>
            <h3>Awards</h3>
            <Awards list={prizes} />
          </section>
        )}

        <section>
          <h3>Numbers</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th />
                  {humans.map((p) => (
                    <th key={p.id} scope="col">
                      <Dot color={p.color} /> {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => {
                  const values = humans.map((p) => row.value(stats[p.id]));
                  const target = row.best === "high" ? Math.max(...values) : row.best === "low" ? Math.min(...values) : null;
                  const highlight = target !== null && values.some((v) => v !== target);
                  return (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      {humans.map((p, i) => (
                        <td key={p.id} className={highlight && values[i] === target ? styles.best : undefined}>
                          {row.format ? row.format(stats[p.id]) : values[i]}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Modal>
  );
}

// Round-ish tick step for an axis from 0 to max.
function tickStep(max: number): number {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

function HistoryChart({ game, metric }: { game: PublicState; metric: Metric }) {
  const history = game.history ?? [];
  const W = 680;
  const H = 250;
  const pad = { left: 38, right: 14, top: 12, bottom: 28 };
  const series = game.players.map((p, i) => ({ p, values: history.map((h) => h[metric][i] ?? 0) }));
  let max = 1;
  for (const s of series) for (const v of s.values) max = Math.max(max, v);
  const step = tickStep(max);
  const top = Math.ceil(max / step) * step;
  const n = history.length;
  const x = (i: number) => pad.left + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.left - pad.right));
  const y = (v: number) => H - pad.bottom - (v / top) * (H - pad.top - pad.bottom);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.max(1, Math.ceil(n / 8));

  return (
    <div className={styles.chart}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${metric === "territories" ? "Territories" : "Armies"} held by each player over time`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className={styles.gridLine} />
            <text x={pad.left - 8} y={y(t)} dy="0.35em" textAnchor="end" className={styles.axisText}>
              {t}
            </text>
          </g>
        ))}
        {history.map((h, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className={styles.axisText}>
              {h.turn === 0 ? "Start" : h.turn}
            </text>
          ) : null,
        )}
        {series.map(({ p, values }) => (
          <g key={p.id}>
            <polyline
              points={values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
              fill="none"
              stroke={p.color}
              strokeWidth={p.neutral ? 1.5 : 2.5}
              strokeDasharray={p.neutral ? "4 4" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={p.status === "active" || p.neutral ? 1 : 0.75}
            />
            <circle cx={x(n - 1)} cy={y(values[n - 1] ?? 0)} r={3.5} fill={p.color} />
          </g>
        ))}
      </svg>
      <div className={styles.legend}>
        {game.players.map((p: PlayerState) => (
          <span key={p.id}>
            <Dot color={p.color} /> {p.name}
          </span>
        ))}
      </div>
    </div>
  );
}
