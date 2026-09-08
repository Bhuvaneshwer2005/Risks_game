import { useEffect, useMemo, useState } from "react";
import { ALL_TERRITORY_IDS, TERRITORIES, type TerritoryId } from "../game/mapData";
import { buildTerritoryPaths, type TerritoryFeatureCollection, type TerritoryPaths } from "../game/projection";
import type { PlayerId, TerritoryState } from "../game/types";
import "./Map.css";

const BOARD_WIDTH = 1600;
const BOARD_HEIGHT = 900;
const UNCLAIMED_FILL = "#3a3f4b";

interface MapProps {
  territories: Record<TerritoryId, TerritoryState>;
  playerColors: Record<PlayerId, string>;
  selectedTerritory?: TerritoryId | null;
  /** Territories the selected one could legally act on right now (attack target / fortify destination) - drawn with a highlight ring. */
  eligibleTargets?: Set<TerritoryId>;
  onSelectTerritory?: (id: TerritoryId) => void;
}

// Module-level cache: the geometry is static and identical for every board
// on the page, so fetch and lay it out once no matter how many <Map>
// instances mount.
let cachedPaths: TerritoryPaths | null = null;
let cachedPathsPromise: Promise<TerritoryPaths> | null = null;

function loadTerritoryPaths(): Promise<TerritoryPaths> {
  if (cachedPaths) return Promise.resolve(cachedPaths);
  if (!cachedPathsPromise) {
    cachedPathsPromise = fetch("/territoryGeometry.json")
      .then((r) => r.json())
      .then((fc: TerritoryFeatureCollection) => {
        cachedPaths = buildTerritoryPaths(fc, BOARD_WIDTH, BOARD_HEIGHT);
        return cachedPaths;
      });
  }
  return cachedPathsPromise;
}

export function Map({ territories, playerColors, selectedTerritory, eligibleTargets, onSelectTerritory }: MapProps) {
  const [paths, setPaths] = useState<TerritoryPaths | null>(cachedPaths);

  useEffect(() => {
    if (paths) return;
    let cancelled = false;
    loadTerritoryPaths().then((p) => {
      if (!cancelled) setPaths(p);
    });
    return () => {
      cancelled = true;
    };
  }, [paths]);

  const fills = useMemo(() => {
    const result = {} as Record<TerritoryId, string>;
    for (const id of ALL_TERRITORY_IDS) {
      const owner = territories[id]?.owner ?? null;
      result[id] = owner ? (playerColors[owner] ?? UNCLAIMED_FILL) : UNCLAIMED_FILL;
    }
    return result;
  }, [territories, playerColors]);

  if (!paths) {
    return (
      <div className="map-loading" style={{ aspectRatio: `${BOARD_WIDTH} / ${BOARD_HEIGHT}` }}>
        Loading map…
      </div>
    );
  }

  return (
    <svg className="risk-map" viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`} role="img" aria-label="Risk world map">
      {ALL_TERRITORY_IDS.map((id) => {
        const d = paths.d[id];
        if (!d) return null;
        const isSelected = selectedTerritory === id;
        const isEligible = eligibleTargets?.has(id) ?? false;
        return (
          <path
            key={id}
            d={d}
            fill={fills[id]}
            className={`territory${isSelected ? " territory--selected" : ""}${isEligible ? " territory--eligible" : ""}`}
            onClick={onSelectTerritory ? () => onSelectTerritory(id) : undefined}
          >
            <title>{TERRITORIES[id].name}</title>
          </path>
        );
      })}
      {ALL_TERRITORY_IDS.map((id) => {
        const c = paths.centroid[id];
        const armies = territories[id]?.armies;
        if (!c || armies === undefined) return null;
        return (
          <g key={`label-${id}`} className="territory-label" transform={`translate(${c[0]}, ${c[1]})`}>
            <circle r={12} />
            <text dy="0.35em">{armies}</text>
          </g>
        );
      })}
    </svg>
  );
}
