// Geometry shared by build.mjs (writes the board) and tune.mjs (searches for
// seed positions/weights that reproduce the canonical borders).

import { ADJACENCY, ALL_TERRITORY_IDS } from "../../src/game/mapData.ts";
import { ANCHORS, LAKES, LANDMASSES } from "./source.mjs";

export const BOARD_WIDTH = 1600;
const MARGIN = 36;
const CENTRAL_MERIDIAN = 10;
const SMOOTHING_PASSES = 2;
/** Europe magnifier: strength and radius (in projected units). */
const EUROPE_CENTER = [14, 50];
const EUROPE_ZOOM = 0.5;
const EUROPE_RADIUS = 0.4;
/** Land borders shorter than this (board units) are ambiguous and rejected. */
export const MIN_BORDER = 6;
/** Canonical borders between territories on one landmass that may cross water instead. */
export const SAME_LANDMASS_SEA_LANES = new Set(["northern-europe|scandinavia"]);

export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const CANONICAL = new Set();
for (const a of ALL_TERRITORY_IDS) for (const b of ADJACENCY[a]) CANONICAL.add(pairKey(a, b));

// ---------- projection ----------

const RAD = Math.PI / 180;

function naturalEarth(lon, lat) {
  let rel = lon - CENTRAL_MERIDIAN;
  if (rel > 180) rel -= 360;
  if (rel < -180) rel += 360;
  const l = rel * RAD;
  const p = lat * RAD;
  const p2 = p * p;
  const p4 = p2 * p2;
  return [
    l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
    p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))),
  ];
}

const europeCenter = naturalEarth(...EUROPE_CENTER);

// Radial magnifier: monotonic as long as EUROPE_ZOOM < 2.2.
function magnify([x, y]) {
  const dx = x - europeCenter[0];
  const dy = y - europeCenter[1];
  const r = Math.hypot(dx, dy);
  const k = 1 + EUROPE_ZOOM * Math.exp(-((r / EUROPE_RADIUS) ** 2));
  return [europeCenter[0] + dx * k, europeCenter[1] + dy * k];
}

const projectRaw = (lon, lat) => magnify(naturalEarth(lon, lat));

const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
for (const lm of LANDMASSES) {
  for (const ring of lm.rings) {
    for (const [lon, lat] of ring) {
      const [x, y] = projectRaw(lon, lat);
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
}
const scale = (BOARD_WIDTH - 2 * MARGIN) / (bounds.maxX - bounds.minX);
export const BOARD_HEIGHT = Math.ceil((bounds.maxY - bounds.minY) * scale + 2 * MARGIN);

export function project(lon, lat) {
  const [x, y] = projectRaw(lon, lat);
  return [MARGIN + (x - bounds.minX) * scale, MARGIN + (bounds.maxY - y) * scale];
}

// ---------- polygons ----------

function chaikin(ring, passes) {
  let pts = ring;
  for (let n = 0; n < passes; n++) {
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[(i + 1) % pts.length];
      next.push([0.75 * px + 0.25 * qx, 0.75 * py + 0.25 * qy], [0.25 * px + 0.75 * qx, 0.25 * py + 0.75 * qy]);
    }
    pts = next;
  }
  return pts;
}

export function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

// Sutherland-Hodgman against one half-plane a.x <= b. The subject may be
// concave; the clip region (an intersection of half-planes) is convex.
function clipHalfPlane(poly, a, b) {
  const out = [];
  for (let k = 0; k < poly.length; k++) {
    const P = poly[k];
    const Q = poly[(k + 1) % poly.length];
    const dp = a[0] * P[0] + a[1] * P[1] - b;
    const dq = a[0] * Q[0] + a[1] * Q[1] - b;
    if (dp <= 0) out.push(P);
    if (dp <= 0 !== dq <= 0) {
      const t = dp / (dp - dq);
      out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]);
    }
  }
  return out;
}

// Keeps x where |x - p_i|^2 - w_i <= |x - p_j|^2 - w_j.
function powerHalfPlane(pi, wi, pj, wj) {
  return {
    a: [2 * (pj[0] - pi[0]), 2 * (pj[1] - pi[1])],
    b: pj[0] ** 2 + pj[1] ** 2 - pi[0] ** 2 - pi[1] ** 2 - wj + wi,
  };
}

export const landmasses = LANDMASSES.map((lm) => ({
  ...lm,
  rings: lm.rings.map((ring) => {
    const projected = chaikin(
      ring.map(([lon, lat]) => project(lon, lat)),
      SMOOTHING_PASSES,
    );
    return signedArea(projected) < 0 ? projected.reverse() : projected;
  }),
}));

export const lakes = LAKES.map((ring) =>
  chaikin(
    ring.map(([lon, lat]) => project(lon, lat)),
    SMOOTHING_PASSES,
  ),
);

export const landmassOfTerritory = Object.fromEntries(landmasses.flatMap((lm) => lm.territories.map((t) => [t, lm.id])));

/** Seeds as {id: {point: [x, y] in board units, weight}}. */
export function projectSeeds(seedSource) {
  const seeds = {};
  for (const id of ALL_TERRITORY_IDS) {
    const s = seedSource[id];
    if (!s) throw new Error(`No seed for ${id}`);
    seeds[id] = { point: project(s[0], s[1]), weight: s[2] };
  }
  return seeds;
}

export function territoryPolygons(seeds) {
  const result = {};
  for (const lm of landmasses) {
    for (const id of lm.territories) {
      const others = lm.territories.filter((o) => o !== id);
      result[id] = [];
      for (const ring of lm.rings) {
        let poly = ring;
        for (const other of others) {
          const { a, b } = powerHalfPlane(seeds[id].point, seeds[id].weight, seeds[other].point, seeds[other].weight);
          poly = clipHalfPlane(poly, a, b);
          if (poly.length === 0) break;
        }
        if (poly.length >= 3 && Math.abs(signedArea(poly)) > 1) result[id].push(poly);
      }
    }
  }
  return result;
}

// ---------- raster validation ----------

function scanFill(rings, W, H, cell, write) {
  for (let y = 0; y < H; y++) {
    const cy = (y + 0.5) * cell;
    const xs = [];
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % ring.length];
        if (y1 <= cy !== y2 <= cy) xs.push(x1 + ((cy - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] / cell - 0.5));
      const to = Math.min(W - 1, Math.floor(xs[k + 1] / cell - 0.5));
      for (let x = from; x <= to; x++) write(y * W + x);
    }
  }
}

/** A land mask at `cell` board units per pixel: landmass index per pixel (-1 for water or lake). */
export function rasterizeLand(cell) {
  const W = Math.ceil(BOARD_WIDTH / cell);
  const H = Math.ceil(BOARD_HEIGHT / cell);
  const landmassOf = new Int16Array(W * H).fill(-1);
  landmasses.forEach((lm, li) => scanFill(lm.rings, W, H, cell, (i) => (landmassOf[i] = li)));
  scanFill(lakes, W, H, cell, (i) => (landmassOf[i] = -1));
  const pixelsByLandmass = landmasses.map(() => []);
  for (let i = 0; i < W * H; i++) if (landmassOf[i] >= 0) pixelsByLandmass[landmassOf[i]].push(i);
  return { W, H, cell, landmassOf, pixelsByLandmass };
}

/**
 * Checks one landmass's split for the given seeds. Returns the problems found
 * and a score (0 = perfect) that tune.mjs minimizes.
 */
export function evaluateLandmass(raster, li, seeds, owner, minBorder = MIN_BORDER) {
  const { W, cell, pixelsByLandmass } = raster;
  const lm = landmasses[li];
  const ids = lm.territories;
  const pixels = pixelsByLandmass[li];
  const pts = ids.map((id) => [seeds[id].point[0] / cell, seeds[id].point[1] / cell, seeds[id].weight / (cell * cell)]);

  for (const i of pixels) {
    const x = (i % W) + 0.5;
    const y = Math.floor(i / W) + 0.5;
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < pts.length; k++) {
      const d = (x - pts[k][0]) ** 2 + (y - pts[k][1]) ** 2 - pts[k][2];
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    owner[i] = best;
  }

  const problems = [];
  let score = 0;

  // Every territory must contain its geographic anchors.
  for (const [t, id] of ids.entries()) {
    for (const [lon, lat] of ANCHORS[id] ?? []) {
      const [ax, ay] = project(lon, lat);
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < ids.length; k++) {
        const s = seeds[ids[k]];
        const d = (ax - s.point[0]) ** 2 + (ay - s.point[1]) ** 2 - s.weight;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      if (best !== t) {
        problems.push(`${id} doesn't contain its anchor ${lon},${lat} (${ids[best]} does)`);
        score += 25;
      }
    }
  }

  // Pieces per territory.
  const pieceSizes = ids.map(() => []);
  const seen = new Uint8Array(raster.landmassOf.length);
  const isMine = (i) => raster.landmassOf[i] === li;
  for (const start of pixels) {
    if (seen[start]) continue;
    const t = owner[start];
    let size = 0;
    let sx = 0;
    let sy = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      size++;
      sx += i % W;
      sy += Math.floor(i / W);
      const x = i % W;
      for (const n of [i - W, i + W, x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1]) {
        if (n >= 0 && n < raster.landmassOf.length && isMine(n) && !seen[n] && owner[n] === t) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    pieceSizes[t].push({ size: size * cell * cell, at: [Math.round((sx / size) * cell), Math.round((sy / size) * cell)] });
  }
  ids.forEach((id, t) => {
    const expected = ids.length === 1 ? lm.rings.length : 1;
    // Specks under 12 square units are coastline noise, invisible at any zoom.
    const real = pieceSizes[t].filter((p) => p.size >= 12);
    if (real.length === 0) {
      problems.push(`${id} has no land at all`);
      score += 100;
    } else if (real.length !== expected) {
      const list = pieceSizes[t].map((p) => `${p.size} at ${p.at.join(",")}`).join("; ");
      problems.push(`${id} is in ${real.length} pieces (expected ${expected}): ${list}`);
      const extra = real
        .map((p) => p.size)
        .sort((a, b) => b - a)
        .slice(expected);
      score += extra.reduce((s, size) => s + 5 + Math.min(20, size / 50), 0);
    }
  });

  // Land borders, as the number of pixel edges two territories share.
  const contact = new Map();
  for (const i of pixels) {
    const x = i % W;
    for (const n of [x < W - 1 ? i + 1 : -1, i + W]) {
      if (n < 0 || n >= raster.landmassOf.length || !isMine(n) || owner[n] === owner[i]) continue;
      const key = pairKey(ids[owner[i]], ids[owner[n]]);
      contact.set(key, (contact.get(key) ?? 0) + cell);
    }
  }
  const landBorders = [];
  for (const [key, length] of contact) {
    if (!CANONICAL.has(key)) {
      problems.push(`${key} share a land border (${length}) but must not`);
      score += 10 + length / 4;
    } else if (length < minBorder) {
      problems.push(`${key} only touch for ${length} units - widen it or separate them`);
      score += 5 + (minBorder - length);
    } else {
      landBorders.push(key);
    }
  }
  for (const a of ids) {
    for (const b of ids) {
      if (a >= b) continue;
      const key = pairKey(a, b);
      if (CANONICAL.has(key) && !contact.has(key) && !SAME_LANDMASS_SEA_LANES.has(key)) {
        problems.push(`${key} must share a land border (they're on the same landmass)`);
        score += 15;
      }
    }
  }

  return { problems, score, landBorders, pieces: Object.fromEntries(ids.map((id, t) => [id, pieceSizes[t]])) };
}
