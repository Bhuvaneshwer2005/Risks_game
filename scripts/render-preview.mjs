// One-off visual sanity check for territoryGeometry.json - renders every
// territory as a colored SVG path with a label at its centroid, so map
// mistakes (wrong country dropped into the wrong territory, a bad bbox
// clip leaving a gap or an overlap) are obvious at a glance before wiring
// the real geometry into the React map component.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { geoPath, geoNaturalEarth1 } from "d3-geo";
import { TERRITORIES, CONTINENTS } from "../src/game/mapData.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const fc = JSON.parse(readFileSync(path.join(root, "public/territoryGeometry.json"), "utf8"));

const width = 1600;
const height = 900;
const projection = geoNaturalEarth1().fitSize([width, height], fc);
const pathGen = geoPath(projection);

const continentColors = {
  "north-america": "#e07a5f",
  "south-america": "#f2cc8f",
  europe: "#81b29a",
  africa: "#3d5a80",
  asia: "#9b5de5",
  australia: "#f4a261",
};

const parts = fc.features.map((f) => {
  const d = pathGen(f);
  const territory = TERRITORIES[f.properties.id];
  if (!d || !territory) return "";
  const color = continentColors[territory.continent];
  const centroid = pathGen.centroid(f);
  const label =
    Number.isFinite(centroid[0]) && Number.isFinite(centroid[1])
      ? `<text x="${centroid[0]}" y="${centroid[1]}" font-size="8" text-anchor="middle" fill="#000" stroke="#fff" stroke-width="0.3">${territory.name}</text>`
      : "";
  return `<path d="${d}" fill="${color}" stroke="#222" stroke-width="0.5" fill-opacity="0.85" />${label}`;
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#cfe8f3" />
${parts.join("\n")}
</svg>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Territory geometry preview</title>
<style>body{margin:0;background:#111;display:flex;align-items:center;justify-content:center;height:100vh}svg{width:100%;height:auto;max-width:1800px}</style>
</head><body>${svg}</body></html>`;

writeFileSync(path.join(root, "scripts/preview.html"), html);
console.log("Wrote scripts/preview.html -", fc.features.length, "features");
