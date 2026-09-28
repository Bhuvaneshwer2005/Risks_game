import { useEffect, useMemo, useRef, useState } from "react";
import { ALL_TERRITORY_IDS, CONTINENTS, TERRITORIES, type ContinentId, type TerritoryId } from "../game/mapData.ts";
import type { PlayerState } from "../game/types.ts";
import type { BoardMapProps } from "./BoardMap.tsx";
import { BoardScene } from "./scene3d.ts";
import styles from "./BoardMap.module.css";

const CONTINENT_IDS = Object.keys(CONTINENTS) as ContinentId[];

/**
 * The 3D board: same props as the 2D BoardMap, rendered with three.js.
 * Drag pans, right-drag (or two fingers) tilts and rotates, wheel or pinch zooms.
 * Calls `onUnsupported` if WebGL can't start, so the caller can fall back to 2D.
 */
export default function Board3D(props: BoardMapProps & { onUnsupported?: () => void }) {
  const { territories, players, selected, targets, focusable, draft, arrow, flash, interactive = true, insets } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<BoardScene | null>(null);
  const [hover, setHover] = useState<{ id: TerritoryId; x: number; y: number } | null>(null);

  // Handlers change every render; the scene calls through this ref.
  const handlers = useRef(props);
  useEffect(() => {
    handlers.current = props;
  });

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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let scene: BoardScene;
    try {
      scene = new BoardScene(host, {
        onClick: (id, modifiers) => handlers.current.onTerritoryClick?.(id, modifiers),
        onContextMenu: (id) => handlers.current.onTerritoryContextMenu?.(id),
        onHover: setHover,
      });
    } catch {
      handlers.current.onUnsupported?.();
      return;
    }
    sceneRef.current = scene;
    return () => {
      sceneRef.current = null;
      scene.dispose();
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setInteractive(interactive);
  }, [interactive]);

  useEffect(() => {
    if (insets) sceneRef.current?.setInsets(insets);
  }, [insets]);

  useEffect(() => {
    sceneRef.current?.update({
      territories,
      players,
      selected,
      targets,
      focusable,
      draft,
      arrow,
      flash,
      holders,
      clickable: interactive && !!props.onTerritoryClick,
    });
  }, [territories, players, selected, targets, focusable, draft, arrow, flash, holders, interactive, props.onTerritoryClick]);

  const hovered = hover ? territories?.[hover.id] : undefined;
  const hoverOwner = hovered?.owner ? playerById.get(hovered.owner) : undefined;

  return (
    <div className={styles.wrap} onMouseLeave={() => setHover(null)}>
      <div ref={hostRef} className={styles.canvasHost} role="img" aria-label="World map" />

      {interactive && (
        <div className={styles.zoomControls}>
          <button type="button" aria-label="Zoom in" onClick={() => sceneRef.current?.zoomBy(1.5)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => sceneRef.current?.zoomBy(1 / 1.5)}>
            −
          </button>
          <button type="button" aria-label="Fit the whole map" onClick={() => sceneRef.current?.fit()} className={styles.fit}>
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
              {hovered.owner ? `${hoverOwner?.name ?? "Someone"} · ${hovered.armies} ${hovered.armies === 1 ? "army" : "armies"}` : "Unclaimed"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
