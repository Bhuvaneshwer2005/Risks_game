// Builds src/board/geometry.json from the hand-authored source.mjs:
//
//   1. Project the [lon, lat] coastlines (Natural Earth projection), enlarge
//      Europe a little so it's easy to click, and scale to board units.
//   2. Smooth the coastlines (Chaikin corner cutting).
//   3. Split each landmass between its territories with a power diagram:
//      each territory is its landmass clipped to the half-planes that keep it
//      closer (in weighted distance) to its own seed than to any other seed.
//   4. Rasterize the result to validate it: every territory is one piece and
//      contains its anchors, land borders plus sea lanes match the 83
//      canonical borders exactly, and label points sit well inside.
//
// Run with `npm run build:board`. Pass --preview to also write
// scripts/board/preview.html (open it with ?vb=x,y,w,h to zoom in).
// If the check fails, `node scripts/board/tune.mjs --write` can search for
// seeds that pass.

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_TERRITORY_IDS, TERRITORIES } from "../../src/game/mapData.ts";
import { CONTINENT_LABELS, SEEDS } from "./source.mjs";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CANONICAL,
  SAME_LANDMASS_SEA_LANES,
  evaluateLandmass,
  lakes,
  landmassOfTerritory,
  landmasses,
  project,
  projectSeeds,
  rasterizeLand,
  territoryPolygons,
} from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../src/board/geometry.json");
const PREVIEW = resolve(here, "preview.html");

/** Label points must be at least this far (board units) from the territory's edge. */
const MIN_LABEL_CLEARANCE = 7;

const fmt = (n) => Math.round(n * 10) / 10;
const ringPath = (ring) => "M" + ring.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L") + "Z";

const seeds = projectSeeds(SEEDS);
const polygons = territoryPolygons(seeds);
const raster = rasterizeLand(1);
const { W, H } = raster;
const index = Object.fromEntries(ALL_TERRITORY_IDS.map((id, i) => [id, i]));

// ---------- validate every landmass, and build a global owner map ----------

const errors = [];
const landBorders = [];
const localOwner = new Int16Array(W * H);
const owner = new Int16Array(W * H).fill(-1);
landmasses.forEach((lm, li) => {
  const result = evaluateLandmass(raster, li, seeds, localOwner);
  errors.push(...result.problems);
  landBorders.push(...result.landBorders);
  for (const i of raster.pixelsByLandmass[li]) owner[i] = index[lm.territories[localOwner[i]]];
});

// ---------- labels: the point deepest inside each territory ----------

const dist = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) dist[i] = owner[i] === -1 ? 0 : 1e9;
const same = (i, n) => owner[n] === owner[i];
// Two-pass chamfer distance to the nearest pixel of anything else.
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (dist[i] === 0) continue;
    const left = x > 0 && same(i, i - 1) ? dist[i - 1] + 1 : 1;
    const up = y > 0 && same(i, i - W) ? dist[i - W] + 1 : 1;
    const ul = x > 0 && y > 0 && same(i, i - W - 1) ? dist[i - W - 1] + Math.SQRT2 : 1;
    const ur = x < W - 1 && y > 0 && same(i, i - W + 1) ? dist[i - W + 1] + Math.SQRT2 : 1;
    dist[i] = Math.min(dist[i], left, up, ul, ur);
  }
}
for (let y = H - 1; y >= 0; y--) {
  for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    if (dist[i] === 0) continue;
    const right = x < W - 1 && same(i, i + 1) ? dist[i + 1] + 1 : 1;
    const down = y < H - 1 && same(i, i + W) ? dist[i + W] + 1 : 1;
    const dr = x < W - 1 && y < H - 1 && same(i, i + W + 1) ? dist[i + W + 1] + Math.SQRT2 : 1;
    const dl = x > 0 && y < H - 1 && same(i, i + W - 1) ? dist[i + W - 1] + Math.SQRT2 : 1;
    dist[i] = Math.min(dist[i], right, down, dr, dl);
  }
}

const labels = {};
const clearance = {};
for (let i = 0; i < W * H; i++) {
  const t = owner[i];
  if (t === -1) continue;
  const id = ALL_TERRITORY_IDS[t];
  if (clearance[id] === undefined || dist[i] > clearance[id]) {
    clearance[id] = dist[i];
    labels[id] = [(i % W) + 0.5, Math.floor(i / W) + 0.5];
  }
}
for (const id of ALL_TERRITORY_IDS) {
  if (clearance[id] === undefined) errors.push(`${id} has no land`);
  else if (clearance[id] < MIN_LABEL_CLEARANCE) errors.push(`${id} is too thin for its army badge (clearance ${clearance[id].toFixed(1)})`);
}

// ---------- sea lanes for canonical borders that aren't land borders ----------

const landSet = new Set(landBorders);
const seaLanes = [];
for (const key of [...CANONICAL].sort()) {
  if (landSet.has(key)) continue;
  const [a, b] = key.split("|");
  if (landmassOfTerritory[a] === landmassOfTerritory[b] && !SAME_LANDMASS_SEA_LANES.has(key)) continue; // reported above
  const pa = polygons[a].flat();
  const pb = polygons[b].flat();
  let best = null;
  for (const p of pa) {
    for (const q of pb) {
      const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
      if (!best || d < best.d) best = { d, p, q };
    }
  }
  if (Math.abs(best.p[0] - best.q[0]) > W / 2) {
    // Alaska-Kamchatka: run each end off its own edge of the board.
    const minX = (pts) => Math.min(...pts.map((p) => p[0]));
    const [leftPts, rightPts] = minX(pa) < minX(pb) ? [pa, pb] : [pb, pa];
    const l = leftPts.reduce((m, p) => (p[0] < m[0] ? p : m));
    const r = rightPts.reduce((m, p) => (p[0] > m[0] ? p : m));
    seaLanes.push({ a, b, wrap: true, points: [[fmt(l[0]), fmt(l[1])], [0, fmt(l[1])], [fmt(r[0]), fmt(r[1])], [W, fmt(r[1])]] });
  } else {
    seaLanes.push({ a, b, wrap: false, points: [[fmt(best.p[0]), fmt(best.p[1])], [fmt(best.q[0]), fmt(best.q[1])]] });
  }
}

// ---------- report and write ----------

if (errors.length) console.error(`\n${errors.length} problem(s) with the board:\n  - ` + errors.sort().join("\n  - "));
console.log(`board ${W}x${H}: ${landBorders.length} land borders + ${seaLanes.length} sea lanes (canonical ${CANONICAL.size})`);

const geometry = {
  width: BOARD_WIDTH,
  height: BOARD_HEIGHT,
  territories: Object.fromEntries(
    ALL_TERRITORY_IDS.map((id) => [
      id,
      { path: polygons[id].map(ringPath).join(""), label: labels[id].map(fmt), clearance: fmt(clearance[id]) },
    ]),
  ),
  landmasses: landmasses.map((lm) => lm.rings.map(ringPath).join("")),
  lakes: lakes.map(ringPath),
  seaLanes,
  landBorders: landBorders.sort(),
  continentLabels: Object.fromEntries(Object.entries(CONTINENT_LABELS).map(([id, [lon, lat]]) => [id, project(lon, lat).map(fmt)])),
};

if (errors.length === 0 || process.argv.includes("--force")) {
  const json = JSON.stringify(geometry);
  writeFileSync(OUT, json + "\n");
  console.log(`wrote src/board/geometry.json (${(json.length / 1024).toFixed(1)} KB)`);
}

if (process.argv.includes("--preview")) {
  const hues = { "north-america": 35, "south-america": 5, europe: 220, africa: 45, asia: 140, australia: 290 };
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="background:#0b1424;width:100%">`,
    ...ALL_TERRITORY_IDS.map((id) => {
      const h = hues[TERRITORIES[id].continent];
      return `<path d="${geometry.territories[id].path}" fill="hsl(${h} 45% ${35 + (index[id] % 4) * 7}%)" stroke="#0b1424" stroke-width="1.2"><title>${id}</title></path>`;
    }),
    ...geometry.lakes.map((d) => `<path d="${d}" fill="#0b1424"/>`),
    ...seaLanes.map((l) => {
      const d = l.wrap ? `M${l.points[0]}L${l.points[1]}M${l.points[2]}L${l.points[3]}` : `M${l.points[0]}L${l.points[1]}`;
      return `<path d="${d}" stroke="#9fb3d1" stroke-dasharray="4 4" fill="none"/>`;
    }),
    ...ALL_TERRITORY_IDS.map((id) => {
      const [x, y] = geometry.territories[id].label;
      const [sx, sy] = seeds[id].point;
      return (
        `<circle cx="${sx}" cy="${sy}" r="2" fill="#f55"/><circle cx="${x}" cy="${y}" r="9" fill="#111a" stroke="#fff"/>` +
        `<text x="${x}" y="${y + 20}" font-size="10" fill="#fff" text-anchor="middle" font-family="sans-serif">${TERRITORIES[id].name}</text>`
      );
    }),
    `</svg>`,
  ].join("\n");
  const list = errors.length ? `<ul style="color:#f88;font:13px monospace">${errors.map((e) => `<li>${e}</li>`).join("")}</ul>` : "";
  const zoom = `<script>const vb=new URLSearchParams(location.search).get("vb");if(vb)document.querySelector("svg").setAttribute("viewBox",vb.split(",").join(" "));</script>`;
  writeFileSync(PREVIEW, `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#050a14">${svg}${list}${zoom}</body>`);
  console.log("wrote scripts/board/preview.html");
}

if (errors.length) process.exit(1);
