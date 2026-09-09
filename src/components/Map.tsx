import { useEffect, useMemo, useState } from "react";
import { ALL_TERRITORY_IDS, TERRITORIES, type TerritoryId } from "../game/mapData";
import type { PlayerId, TerritoryState } from "../game/types";
import "./Map.css";

const BOARD_WIDTH = 1234;
const BOARD_HEIGHT = 864;

interface IllustratedMapData {
  width: number;
  height: number;
  paths: Record<TerritoryId, string>;
  centroids: Record<TerritoryId, [number, number]>;
}

interface MapProps {
  territories: Record<TerritoryId, TerritoryState>;
  playerColors: Record<PlayerId, string>;
  selectedTerritory?: TerritoryId | null;
  /** Territories the selected one could legally act on right now (attack target / fortify destination) - drawn with a highlight ring. */
  eligibleTargets?: Set<TerritoryId>;
  onSelectTerritory?: (id: TerritoryId) => void;
}

// Module-level cache: the map data is static and identical for every board
// on the page, so fetch it once no matter how many <Map> instances mount.
let cachedData: IllustratedMapData | null = null;
let cachedDataPromise: Promise<IllustratedMapData> | null = null;

function loadMapData(): Promise<IllustratedMapData> {
  if (cachedData) return Promise.resolve(cachedData);
  if (!cachedDataPromise) {
    cachedDataPromise = fetch("/illustratedMap.json")
      .then((r) => r.json())
      .then((data: IllustratedMapData) => {
        cachedData = data;
        return data;
      });
  }
  return cachedDataPromise;
}

export function Map({ territories, playerColors, selectedTerritory, eligibleTargets, onSelectTerritory }: MapProps) {
  const [data, setData] = useState<IllustratedMapData | null>(cachedData);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    loadMapData().then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  // Unclaimed territories keep the illustration's own continent color
  // showing through (no overlay); claimed ones get a solid owner-color
  // tint painted on top, opaque enough to read clearly as "owned" while
  // the hand-drawn linework still shows through underneath.
  const overlays = useMemo(() => {
    const result = {} as Record<TerritoryId, string | null>;
    for (const id of ALL_TERRITORY_IDS) {
      const owner = territories[id]?.owner ?? null;
      result[id] = owner ? (playerColors[owner] ?? null) : null;
    }
    return result;
  }, [territories, playerColors]);

  if (!data) {
    return (
      <div className="map-loading" style={{ aspectRatio: `${BOARD_WIDTH} / ${BOARD_HEIGHT}` }}>
        Loading map…
      </div>
    );
  }

  return (
    <svg className="risk-map" viewBox={`0 0 ${data.width} ${data.height}`} role="img" aria-label="Risk world map">
      <image href="/risk_map.jpg" width={data.width} height={data.height} />
      {ALL_TERRITORY_IDS.map((id) => {
        const d = data.paths[id];
        if (!d) return null;
        const isSelected = selectedTerritory === id;
        const isEligible = eligibleTargets?.has(id) ?? false;
        const owner = overlays[id];
        return (
          <path
            key={id}
            d={d}
            fill={owner ?? "#000"}
            fillOpacity={owner ? 0.62 : 0}
            className={`territory${isSelected ? " territory--selected" : ""}${isEligible ? " territory--eligible" : ""}`}
            onClick={onSelectTerritory ? () => onSelectTerritory(id) : undefined}
          >
            <title>{TERRITORIES[id].name}</title>
          </path>
        );
      })}
      {ALL_TERRITORY_IDS.map((id) => {
        const c = data.centroids[id];
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
