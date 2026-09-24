// Searches for seed positions and weights that make a landmass split into
// territories with exactly the canonical borders (simulated annealing, with a
// small penalty for drifting far from the hand-placed seeds).
//
//   node scripts/board/tune.mjs [landmass-id ...] [--iterations=4000] [--write]
//
// --write updates the SEEDS block in source.mjs in place.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SEEDS } from "./source.mjs";
import { evaluateLandmass, landmasses, projectSeeds, rasterizeLand } from "./lib.mjs";

const args = process.argv.slice(2);
const write = args.includes("--write");
const iterations = Number(args.find((a) => a.startsWith("--iterations="))?.split("=")[1] ?? 4000);
const only = args.filter((a) => !a.startsWith("--"));

let rngState = 12345;
const rand = () => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
};
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

const raster = rasterizeLand(2);
const owner = new Int16Array(raster.landmassOf.length);
const seeds = structuredClone(SEEDS);

function drift(current, id) {
  const [lon, lat, w] = current[id];
  const [lon0, lat0, w0] = SEEDS[id];
  return Math.hypot(lon - lon0, lat - lat0) * 0.05 + Math.abs(w - w0) / 12000;
}

function evaluate(li, candidate) {
  // Ask for wider borders than the build does, so the full-resolution check has headroom.
  const result = evaluateLandmass(raster, li, projectSeeds(candidate), owner, 14);
  const penalty = landmasses[li].territories.reduce((s, id) => s + drift(candidate, id), 0);
  return { ...result, total: result.score + penalty };
}

landmasses.forEach((lm, li) => {
  if (lm.territories.length < 2) return;
  if (only.length && !only.includes(lm.id)) return;

  let current = evaluate(li, seeds);
  let best = { total: current.total, score: current.score, seeds: structuredClone(seeds) };
  console.log(`${lm.id}: start score ${current.score.toFixed(1)} (${current.problems.length} problems)`);
  if (current.score === 0) return;

  for (let it = 0; it < iterations && best.score > 0; it++) {
    const temperature = 4 * (1 - it / iterations) + 0.05;
    const id = lm.territories[Math.floor(rand() * lm.territories.length)];
    const [lon, lat, w] = seeds[id];
    seeds[id] = [
      Math.round((lon + gauss() * 1.5) * 10) / 10,
      Math.round((lat + gauss() * 1.2) * 10) / 10,
      Math.max(-4000, Math.min(12000, Math.round((w + gauss() * 900) / 50) * 50)),
    ];
    const next = evaluate(li, seeds);
    if (next.total <= current.total || rand() < Math.exp((current.total - next.total) / temperature)) {
      current = next;
      if (next.total < best.total || (next.score === 0 && best.score > 0)) {
        best = { total: next.total, score: next.score, seeds: structuredClone(seeds) };
      }
    } else {
      seeds[id] = [lon, lat, w];
    }
  }

  for (const id of lm.territories) seeds[id] = best.seeds[id];
  const final = evaluate(li, seeds);
  console.log(`${lm.id}: best score ${final.score.toFixed(1)}`);
  for (const p of final.problems) console.log(`   - ${p}`);
  for (const id of lm.territories) console.log(`   ${JSON.stringify(id)}: [${seeds[id].join(", ")}],`);
});

if (write) {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = resolve(here, "source.mjs");
  let text = readFileSync(file, "utf8");
  for (const [id, [lon, lat, w]] of Object.entries(seeds)) {
    const pattern = new RegExp(`(\\n\\s+"?${id}"?: )\\[[^\\]]*\\]`);
    text = text.replace(pattern, `$1[${lon}, ${lat}, ${w}]`);
  }
  writeFileSync(file, text);
  console.log("updated source.mjs");
}
