import { geoNaturalEarth1, geoPath, type GeoPath, type GeoPermissibleObjects } from "d3-geo";
import type { TerritoryId } from "./mapData";

export interface TerritoryFeatureCollection {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: { id: TerritoryId }; geometry: GeoPermissibleObjects }[];
}

export interface TerritoryPaths {
  /** territory id -> SVG path "d" string */
  d: Record<TerritoryId, string>;
  /** territory id -> [x, y] label position */
  centroid: Record<TerritoryId, [number, number]>;
  width: number;
  height: number;
}

// Builds one projection fitted to the whole board and derives the SVG path
// + label centroid for every territory from it - done once when the
// geometry loads, not per-render, since fitting/path generation isn't free.
export function buildTerritoryPaths(fc: TerritoryFeatureCollection, width: number, height: number): TerritoryPaths {
  const projection = geoNaturalEarth1().fitSize([width, height], fc as unknown as GeoPermissibleObjects);
  const pathGen: GeoPath = geoPath(projection);

  const d = {} as Record<TerritoryId, string>;
  const centroid = {} as Record<TerritoryId, [number, number]>;
  for (const feature of fc.features) {
    const dString = pathGen(feature.geometry);
    if (dString) d[feature.properties.id] = dString;
    const c = pathGen.centroid(feature.geometry);
    if (Number.isFinite(c[0]) && Number.isFinite(c[1])) centroid[feature.properties.id] = c;
  }
  return { d, centroid, width, height };
}
