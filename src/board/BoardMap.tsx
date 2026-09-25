import { memo, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { CONTINENTS, TERRITORIES, ALL_TERRITORY_IDS, type ContinentId, type TerritoryId } from "../game/mapData.ts";
import type { PlayerState, TerritoryState } from "../game/types.ts";
import { BOARD } from "./geometry.ts";
import { CONTINENT_TINTS, mix, textOn, withAlpha } from "./colors.ts";
import { usePanZoom, type Insets } from "./usePanZoom.ts";
import styles from "./BoardMap.module.css";

export interface BoardArrow {
  from: TerritoryId;
  to: TerritoryId;
  tone: "attack" | "move";
}

export interface BoardMapProps {
  /** Omit for a purely decorative board (home screen background). */
  territories?: Record<TerritoryId, TerritoryState>;
  players?: PlayerState[];
  selected?: TerritoryId | null;
  /** Legal targets for the current selection, drawn with a pulsing outline. */
  targets?: ReadonlySet<TerritoryId>;
  /** When set, territories outside it (and not selected/targeted) are dimmed. */
  focusable?: ReadonlySet<TerritoryId> | null;
  /** Pending (unconfirmed) army placements, shown as "+n". */
  draft?: Partial<Record<TerritoryId, number>>;
  arrow?: BoardArrow | null;
  /** Bump `key` to replay the capture flash on a territory. */
  flash?: { id: TerritoryId; key: number } | null;
  interactive?: boolean;
  /** Floating UI covering the board's edges; the initial fit avoids it. */
  insets?: Insets;
  onTerritoryClick?: (id: TerritoryId, modifiers: { shift: boolean; alt: boolean }) => void;
  onTerritoryContextMenu?: (id: TerritoryId) => void;
  children?: ReactNode;
}

const CONTINENT_IDS = Object.keys(CONTINENTS) as ContinentId[];

function badgeRadius(id: TerritoryId): number {
  return Math.max(12, Math.min(16, BOARD.territories[id].clearance * 0.95));
}

export function BoardMap(props: BoardMapProps) {
  const { territories, players, selected, targets, focusable, draft, arrow, flash, interactive = true } = props;
  const { svgRef, zoomBy, fit, consumeDrag } = usePanZoom(BOARD.width, BOARD.height, interactive, props.insets);
  const [hover, setHover] = useState<{ id: TerritoryId; x: number; y: number } | null>(null);

  const playerById = useMemo(() => new Map((players ?? []).map((p) => [p.id, p])), [players]);

  const holders = useMemo(() => {
    const result = {} as Record<ContinentId, PlayerState | null>;
    for (const c of CONTINENT_IDS) {
      const owners = new Set(ALL_TERRITORY_IDS.filter((t) => TERRITORIES[t].continent === c).map((t) => territories?.[t]?.owner ?? null));
      const only = owners.size === 1 ? [...owners][0] : null;
      result[c] = only ? (playerById.get(only) ?? null) : null;
    }
    return result;
  }, [territories, playerById]);

  const click = (id: TerritoryId, e: ReactMouseEvent) => {
    if (consumeDrag()) return;
    props.onTerritoryClick?.(id, { shift: e.shiftKey, alt: e.altKey });
  };

  const hovered = hover ? territories?.[hover.id] : undefined;
  const hoverOwner = hovered?.owner ? playerById.get(hovered.owner) : undefined;

  return (
    <div className={styles.wrap} onMouseLeave={() => setHover(null)}>
      <svg
        ref={svgRef}
        className={`${styles.svg} ${interactive ? styles.interactive : ""}`}
        viewBox={`0 0 ${BOARD.width} ${BOARD.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="World map"
        onContextMenu={(e) => e.preventDefault()}
      >
        <BoardDefs />
        <rect x={-BOARD.width} y={-BOARD.height} width={BOARD.width * 3} height={BOARD.height * 3} fill="url(#ocean)" />
        <rect x={-BOARD.width} y={-BOARD.height} width={BOARD.width * 3} height={BOARD.height * 3} fill="url(#grid)" />
        <StaticLand />

        <g className={styles.territories}>
          {ALL_TERRITORY_IDS.map((id) => {
            const state = territories?.[id];
            const owner = state?.owner ? playerById.get(state.owner) : undefined;
            const isSelected = selected === id;
            const isTarget = targets?.has(id) ?? false;
            const dimmed = !!focusable && !focusable.has(id) && !isSelected && !isTarget;
            return (
              <Territory
                key={id}
                id={id}
                color={owner?.color ?? null}
                selected={isSelected}
                target={isTarget}
                dimmed={dimmed}
                clickable={!!props.onTerritoryClick}
                onClick={click}
                onContextMenu={props.onTerritoryContextMenu}
                onHover={setHover}
              />
            );
          })}
        </g>

        <rect
          x={0}
          y={0}
          width={BOARD.width}
          height={BOARD.height}
          fill="url(#sheen)"
          clipPath="url(#land-clip)"
          className={styles.sheen}
          pointerEvents="none"
        />
        <StaticOverlay />

        <g pointerEvents="none">
          {CONTINENT_IDS.map((c) => (
            <ContinentLabel key={c} id={c} holder={holders[c]} />
          ))}
        </g>

        {arrow && <Arrow {...arrow} />}

        {territories && (
          <g pointerEvents="none">
            {ALL_TERRITORY_IDS.map((id) => {
              const t = territories[id];
              const owner = t.owner ? playerById.get(t.owner) : undefined;
              return (
                <ArmyBadge
                  key={id}
                  id={id}
                  armies={t.armies}
                  color={owner?.color ?? "#6b7280"}
                  initial={owner ? owner.name.trim().charAt(0).toUpperCase() : ""}
                  draft={draft?.[id] ?? 0}
                  highlight={selected === id}
                />
              );
            })}
          </g>
        )}

        {flash && <Flash key={flash.key} id={flash.id} />}
        {props.children}
      </svg>

      {interactive && (
        <div className={styles.zoomControls}>
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.5)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.5)}>
            −
          </button>
          <button type="button" aria-label="Fit the whole map" onClick={fit} className={styles.fit}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </div>
      )}

      {hover && territories && (
        <div className={`${styles.tooltip} ${hover.x > window.innerWidth - 240 ? styles.tooltipLeft : ""}`} style={{ left: hover.x, top: hover.y }}>
          <div className={styles.tooltipName}>{TERRITORIES[hover.id].name}</div>
          <div className={styles.tooltipMeta}>{CONTINENTS[TERRITORIES[hover.id].continent].name}</div>
          {hovered && (
            <div className={styles.tooltipOwner}>
              <span className={styles.dot} style={{ background: hoverOwner?.color ?? "#6b7280" }} />
              {hoverOwner?.name ?? "Unclaimed"} · {hovered.armies} {hovered.armies === 1 ? "army" : "armies"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- static layers (never re-render) ----------

const BoardDefs = memo(function BoardDefs() {
  return (
    <defs>
      <radialGradient id="ocean" cx="50%" cy="42%" r="75%">
        <stop offset="0%" stopColor="#10213b" />
        <stop offset="55%" stopColor="#0a1528" />
        <stop offset="100%" stopColor="#050a14" />
      </radialGradient>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M40 0H0V40" fill="none" stroke="rgba(120,160,220,0.06)" strokeWidth="1" />
      </pattern>
      <linearGradient id="sheen" x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
        <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="100%" stopColor="#000000" stopOpacity="0.28" />
      </linearGradient>
      <clipPath id="land-clip">
        {BOARD.landmasses.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </clipPath>
      <filter id="coast-glow" x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="6" />
      </filter>
      <filter id="land-shadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#000" floodOpacity="0.55" />
      </filter>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <marker id="arrow-head-attack" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10Z" fill="#ff6b6b" />
      </marker>
      <marker id="arrow-head-move" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10Z" fill="#f2cf78" />
      </marker>
    </defs>
  );
});

const StaticLand = memo(function StaticLand() {
  return (
    <g pointerEvents="none">
      <g filter="url(#coast-glow)" opacity="0.55">
        {BOARD.landmasses.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#3b6fb6" strokeWidth="7" />
        ))}
      </g>
      <g filter="url(#land-shadow)">
        {BOARD.landmasses.map((d, i) => (
          <path key={i} d={d} fill="#101a2c" />
        ))}
      </g>
    </g>
  );
});

const StaticOverlay = memo(function StaticOverlay() {
  return (
    <g pointerEvents="none">
      {BOARD.landmasses.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="rgba(190,215,255,0.35)" strokeWidth="1" />
      ))}
      {BOARD.lakes.map((d, i) => (
        <path key={i} d={d} fill="#0b1830" stroke="rgba(190,215,255,0.25)" strokeWidth="0.8" />
      ))}
      {BOARD.seaLanes.map((lane) => {
        const [p0, p1, p2, p3] = lane.points;
        const d = lane.wrap ? `M${p0[0]} ${p0[1]}L${p1[0]} ${p1[1]}M${p2[0]} ${p2[1]}L${p3[0]} ${p3[1]}` : curve(p0, p1, 0.12);
        return <path key={`${lane.a}-${lane.b}`} d={d} className={styles.lane} />;
      })}
    </g>
  );
});

function curve(a: [number, number], b: [number, number], bend: number): string {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return `M${a[0]} ${a[1]}Q${mx - dy * bend} ${my + dx * bend} ${b[0]} ${b[1]}`;
}

// ---------- territories ----------

interface TerritoryProps {
  id: TerritoryId;
  color: string | null;
  selected: boolean;
  target: boolean;
  dimmed: boolean;
  clickable: boolean;
  onClick: (id: TerritoryId, e: ReactMouseEvent) => void;
  onContextMenu?: (id: TerritoryId) => void;
  onHover: (h: { id: TerritoryId; x: number; y: number } | null) => void;
}

const Territory = memo(function Territory(p: TerritoryProps) {
  const tint = CONTINENT_TINTS[TERRITORIES[p.id].continent];
  const fill = p.color ? mix(tint, p.color, 0.84) : tint;
  const className = [
    styles.territory,
    p.clickable ? styles.clickable : "",
    p.selected ? styles.selected : "",
    p.target ? styles.target : "",
    p.dimmed ? styles.dimmed : "",
  ].join(" ");
  return (
    <path
      d={BOARD.territories[p.id].path}
      fill={fill}
      className={className}
      style={p.color ? ({ "--owner": p.color } as CSSProperties) : undefined}
      onClick={(e) => p.onClick(p.id, e)}
      onContextMenu={(e) => {
        e.preventDefault();
        p.onContextMenu?.(p.id);
      }}
      onMouseMove={(e) => {
        const container = e.currentTarget.ownerSVGElement?.parentElement;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        p.onHover({ id: p.id, x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
      onMouseLeave={() => p.onHover(null)}
      aria-label={TERRITORIES[p.id].name}
    />
  );
});

function ContinentLabel({ id, holder }: { id: ContinentId; holder: PlayerState | null }) {
  const [x, y] = BOARD.continentLabels[id];
  const c = CONTINENTS[id];
  return (
    <g transform={`translate(${x} ${y})`} className={styles.continent}>
      <text className={styles.continentName} textAnchor="middle">
        {c.name.toUpperCase()}
      </text>
      <g transform="translate(0 16)">
        <rect
          x={-17}
          y={-10}
          width={34}
          height={20}
          rx={10}
          fill={holder ? withAlpha(holder.color, 0.25) : "rgba(10,18,34,0.7)"}
          stroke={holder ? holder.color : "rgba(212,168,75,0.5)"}
          strokeWidth={1.2}
          filter={holder ? "url(#glow)" : undefined}
        />
        <text className={styles.continentBonus} textAnchor="middle" dy="0.35em">
          +{c.bonusArmies}
        </text>
      </g>
    </g>
  );
}

function ArmyBadge(p: { id: TerritoryId; armies: number; color: string; initial: string; draft: number; highlight: boolean }) {
  const [x, y] = BOARD.territories[p.id].label;
  const r = badgeRadius(p.id);
  return (
    <g transform={`translate(${x} ${y})`} className={p.highlight ? styles.badgeActive : undefined}>
      <circle r={r + 2.5} fill="rgba(3,6,12,0.55)" />
      <circle r={r} fill="#0b1322" stroke={p.color} strokeWidth={2.4} />
      <text key={p.armies + p.draft} className={styles.badgeText} textAnchor="middle" dy="0.36em" fontSize={r > 14 ? 14 : 12.5}>
        {p.armies + p.draft}
      </text>
      {p.initial && (
        <g transform={`translate(${r * 0.8} ${r * 0.8})`}>
          <circle r={6.2} fill={p.color} stroke="#0b1322" strokeWidth={1.4} />
          <text textAnchor="middle" dy="0.36em" fontSize={7.4} fontWeight={700} fill={textOn(p.color)}>
            {p.initial}
          </text>
        </g>
      )}
      {p.draft > 0 && (
        <g transform={`translate(0 ${-r - 9})`} className={styles.draft}>
          <rect x={-11} y={-7} width={22} height={14} rx={7} fill="#d4a84b" />
          <text textAnchor="middle" dy="0.35em" fontSize={8.5} fontWeight={700} fill="#1a1204">
            +{p.draft}
          </text>
        </g>
      )}
    </g>
  );
}

function Arrow({ from, to, tone }: BoardArrow) {
  const a = BOARD.territories[from].label;
  const b = BOARD.territories[to].label;
  // Stop short of both badges.
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const start: [number, number] = [a[0] + (dx / len) * 15, a[1] + (dy / len) * 15];
  const end: [number, number] = [b[0] - (dx / len) * 18, b[1] - (dy / len) * 18];
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 6) return null;
  const d = curve(start, end, 0.18);
  return (
    <g pointerEvents="none">
      <path d={d} className={styles.arrowShadow} />
      <path d={d} className={tone === "attack" ? styles.arrowAttack : styles.arrowMove} markerEnd={`url(#arrow-head-${tone})`} />
    </g>
  );
}

function Flash({ id }: { id: TerritoryId }) {
  const [x, y] = BOARD.territories[id].label;
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      <circle r={14} className={styles.flash} />
      <circle r={14} className={`${styles.flash} ${styles.flashLate}`} />
    </g>
  );
}
