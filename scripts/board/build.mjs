// Builds src/board/geometry.json from real Natural Earth (1:50m) country
// outlines (world-atlas). Whole countries are assigned to Risk territories; a
// few big countries are cut along meridians/parallels, the way the classic
// board splits Canada, the US and Russia. Each territory is the union of its
// pieces, so internal country borders disappear.
//
// The build fails unless land borders plus sea lanes reproduce the 83
// canonical Risk borders exactly. Run: npm run build:board
import { readFileSync, writeFileSync } from "node:fs";
import { ADJACENCY, TERRITORIES } from "../../src/game/mapData.ts";

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const CANONICAL = new Set();
for (const [a, list] of Object.entries(ADJACENCY)) for (const b of list) CANONICAL.add(pairKey(a, b));

// ---------- projection: Miller cylindrical (like the classic board) + Europe magnifier ----------
const RAD = Math.PI / 180;
const CENTRAL_MERIDIAN = 10;
const WIDTH = 1600, MARGIN = 36;
const LAT_MIN = -56, LAT_MAX = 84;
const miller = (lat) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * RAD));
function raw(lon, lat) {
  let rel = lon - CENTRAL_MERIDIAN;
  if (rel > 180) rel -= 360;
  if (rel < -180) rel += 360;
  return [rel * RAD, miller(lat)];
}
/** Europe magnifier: Europe's seven territories are drawn larger so they're easy to tap. */
const EU = raw(14, 51), EU_ZOOM = 0.55, EU_RADIUS = 0.36;
function magnify([x, y]) {
  const dx = x - EU[0], dy = y - EU[1];
  const k = 1 + EU_ZOOM * Math.exp(-((Math.hypot(dx, dy) / EU_RADIUS) ** 2));
  return [EU[0] + dx * k, EU[1] + dy * k];
}
const SCALE = (WIDTH - 2 * MARGIN) / (2 * Math.PI);
const Y_TOP = miller(LAT_MAX), Y_BOTTOM = miller(LAT_MIN);
const HEIGHT = Math.ceil((Y_TOP - Y_BOTTOM) * SCALE + 2 * MARGIN);
function project(lon, lat) {
  const [x, y] = magnify(raw(lon, Math.max(LAT_MIN, Math.min(LAT_MAX, lat))));
  return [MARGIN + (x + Math.PI) * SCALE, MARGIN + (Y_TOP - y) * SCALE];
}
const CONTINENT_LABELS = {
  "north-america": [-132, 30],
  "south-america": [-105, -22],
  europe: [-32, 45],
  africa: [-26, -10],
  asia: [168, 44],
  australia: [118, -40],
};
const topo = JSON.parse(readFileSync(new URL("../../node_modules/world-atlas/countries-50m.json", import.meta.url), "utf8"));

/** Douglas-Peucker tolerance in board units, applied per shared arc so neighbours stay watertight. */
const SIMPLIFY_PX = 0.3;
/** Islands smaller than this (board units squared) are dropped. */
const MIN_PIECE_PX2 = 2.5;

// ---------- country -> territory rules ----------
const WHOLE = {
  greenland: ["Greenland"],
  "central-america": ["Mexico", "Guatemala", "Belize", "Honduras", "El Salvador", "Nicaragua", "Costa Rica", "Panama", "Cuba", "Jamaica", "Haiti", "Dominican Rep.", "Bahamas", "Puerto Rico", "Cayman Is.", "Turks and Caicos Is."],
  venezuela: ["Venezuela", "Colombia", "Guyana", "Suriname", "Trinidad and Tobago"],
  peru: ["Peru", "Ecuador", "Bolivia"],
  brazil: ["Brazil"],
  argentina: ["Argentina", "Chile", "Uruguay", "Paraguay", "Falkland Is."],
  iceland: ["Iceland"],
  "great-britain": ["United Kingdom", "Ireland", "Isle of Man"],
  scandinavia: ["Norway", "Sweden", "Finland", "Åland"],
  "northern-europe": ["Germany", "Poland", "Denmark", "Netherlands", "Belgium", "Luxembourg", "Czechia"],
  "western-europe": ["France", "Spain", "Portugal", "Andorra", "Monaco"],
  "southern-europe": ["Italy", "Switzerland", "Liechtenstein", "Austria", "Slovenia", "Croatia", "Bosnia and Herz.", "Serbia", "Montenegro", "Kosovo", "Albania", "Macedonia", "Greece", "Bulgaria", "Romania", "Hungary", "Slovakia", "Malta", "San Marino", "Vatican"],
  ukraine: ["Ukraine", "Belarus", "Estonia", "Latvia", "Lithuania", "Moldova"],
  "north-africa": ["Morocco", "W. Sahara", "Algeria", "Tunisia", "Libya", "Mauritania", "Mali", "Niger", "Chad", "Senegal", "Gambia", "Guinea-Bissau", "Guinea", "Sierra Leone", "Liberia", "Côte d'Ivoire", "Burkina Faso", "Ghana", "Togo", "Benin", "Nigeria"],
  egypt: ["Egypt"],
  "east-africa": ["Sudan", "S. Sudan", "Ethiopia", "Eritrea", "Djibouti", "Somalia", "Somaliland", "Kenya", "Uganda", "Tanzania", "Rwanda", "Burundi"],
  congo: ["Dem. Rep. Congo", "Congo", "Gabon", "Eq. Guinea", "Central African Rep.", "Cameroon", "São Tomé and Principe"],
  "south-africa": ["Angola", "Zambia", "Malawi", "Mozambique", "Zimbabwe", "Botswana", "Namibia", "South Africa", "Lesotho", "eSwatini"],
  madagascar: ["Madagascar", "Comoros"],
  "middle-east": ["Turkey", "Syria", "Lebanon", "Israel", "Palestine", "Jordan", "Iraq", "Iran", "Saudi Arabia", "Yemen", "Oman", "United Arab Emirates", "Qatar", "Kuwait", "Bahrain", "Cyprus", "N. Cyprus", "Georgia", "Armenia", "Azerbaijan"],
  afghanistan: ["Afghanistan", "Kazakhstan", "Turkmenistan", "Uzbekistan", "Kyrgyzstan", "Tajikistan"],
  india: ["India", "Pakistan", "Nepal", "Bhutan", "Bangladesh", "Sri Lanka", "Siachen Glacier"],
  siam: ["Myanmar", "Thailand", "Laos", "Cambodia", "Vietnam", "Singapore"],
  china: ["Taiwan", "Hong Kong", "Macao"],
  mongolia: ["North Korea", "South Korea"],
  japan: ["Japan"],
  indonesia: ["Philippines", "Timor-Leste", "Brunei"],
  "new-guinea": ["Papua New Guinea"],
  "eastern-australia": ["New Zealand"],
};
const COUNTRY_TO = {};
for (const [t, names] of Object.entries(WHOLE)) for (const n of names) COUNTRY_TO[n] = t;

/** Territory for a piece of a country, given the piece's centroid; null drops it. */
function rule(name, lon, lat) {
  switch (name) {
    case "United States of America":
      if (lon > 0 || lon < -169 || lat < 25) return null; // Aleutians past 180, Hawaii
      if (lat > 50) return "alaska";
      return lon < -100 ? "western-united-states" : "eastern-united-states";
    case "Canada":
      if (lat < 60) return lon < -110 ? "alberta" : lon < -79.5 ? "ontario" : "quebec";
      return lon > -79.5 && lat < 62.6 ? "quebec" : "northwest-territory";
    case "Russia":
      if (lon < 58) return "ukraine";
      if (lon < 90) return "ural";
      if (lon < 105) return "siberia";
      if (lon < 145 && lat >= 60) return "yakutsk";
      if (lon < 125) return "irkutsk";
      return "kamchatka";
    case "China":
      return lat > 41.5 && lon > 115 ? "mongolia" : "china";
    case "Mongolia":
      return lon < 95 ? "china" : "mongolia";
    case "Australia":
      return lon < 135 ? "western-australia" : "eastern-australia";
    case "Indonesia":
      return lon > 130.9 && lat < -0.8 ? "new-guinea" : "indonesia";
    case "Malaysia":
      return lon > 108 ? "indonesia" : "siam";
    case "France":
      if (lon < -40) return lat > 0 && lat < 10 ? "venezuela" : null; // French Guiana
      return lat < 30 ? null : "western-europe";
    case "Norway":
      return lon < 0 || lat < 0 ? null : "scandinavia";
    case "Spain":
      return lat < 36 ? null : "western-europe"; // Canaries, Ceuta, Melilla
    case "Portugal":
      return lon < -12 ? null : "western-europe";
    case "Netherlands":
      return lon < 0 ? null : "northern-europe";
    case "United Kingdom":
      return lat < 45 ? null : "great-britain";
    case "Ecuador":
      return lon < -85 ? null : "peru";
    case "Chile":
      return lon < -80 ? null : "argentina";
    case "Colombia":
      return lon < -80 ? null : "venezuela";
    case "New Zealand":
      return lon < 0 ? null : "eastern-australia";
    default:
      return COUNTRY_TO[name] ?? null;
  }
}

/** Mainland cuts (lon = axis 0, lat = axis 1) for countries split across territories. */
const CUTS = {
  "United States of America": [[0, -100]],
  Canada: [[0, -110], [0, -79.5], [1, 60], [1, 62.6]],
  Russia: [[0, 58], [0, 90], [0, 105], [0, 125], [0, 145], [1, 60]],
  China: [[0, 115], [1, 41.5]],
  Mongolia: [[0, 95]],
  Australia: [[0, 135]],
};
const ALL_CUTS = Object.values(CUTS).flat();

// ---------- arcs: decode, simplify (topology-preserving, per arc) ----------
const [sx, sy] = topo.transform.scale;
const [tx, ty] = topo.transform.translate;
// Russia's far east crosses 180; keep it on the right edge of the board.
const safeLon = (lon) => (lon > -170.5 && lon < -168 ? -170.5 : lon);
const px = ([lon, lat]) => project(safeLon(lon), lat);

function dp(points, tol) {
  const P = points.map(px);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bi = -1;
    const [ax, ay] = P[a], [bx, by] = P[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (P[i][0] - ax) - dx * (P[i][1] - ay)) / len;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

let rawPoints = 0;
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  const pts = arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
  rawPoints += pts.length;
  // Closed single-arc rings need a middle anchor so DP doesn't collapse them.
  if (pts.length > 3 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) {
    const m = pts.length >> 1;
    return [...dp(pts.slice(0, m + 1), SIMPLIFY_PX), ...dp(pts.slice(m), SIMPLIFY_PX).slice(1)];
  }
  return dp(pts, SIMPLIFY_PX);
});

function ringFromArcs(ids) {
  const out = [];
  for (const id of ids) {
    const a = id >= 0 ? arcs[id] : [...arcs[~id]].reverse();
    out.push(...(out.length ? a.slice(1) : a));
  }
  if (out.length > 1 && out[0][0] === out.at(-1)[0] && out[0][1] === out.at(-1)[1]) out.pop();
  return out;
}

// ---------- geometry helpers ----------
function area(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}
function centroid(ring) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-12) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

/** Point exactly on axis-line `c` for edge p-q, computed from the ordered endpoints so both directions agree. */
function cutPoint(p, q, axis, c) {
  const [A, B] = p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]) ? [p, q] : [q, p];
  const t = (c - A[axis]) / (B[axis] - A[axis]);
  const pt = [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])];
  pt[axis] = c;
  return pt;
}

/** Inserts on-line vertices wherever an edge crosses one of the cut lines (harmless for uncut rings). */
function insertCutPoints(ring) {
  let r = ring;
  for (const [axis, c] of ALL_CUTS) {
    const out = [];
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length];
      out.push(p);
      if ((p[axis] - c) * (q[axis] - c) < 0) out.push(cutPoint(p, q, axis, c));
    }
    r = out;
  }
  return r;
}

/** Splits a simple ring by the line coord[axis] = c. Crossing vertices must already lie on the line. */
function splitRing(input, axis, c) {
  // Earlier cuts leave long straight edges that may cross this line without a vertex on it.
  const ring = [];
  for (let i = 0; i < input.length; i++) {
    const p = input[i], q = input[(i + 1) % input.length];
    ring.push(p);
    if ((p[axis] - c) * (q[axis] - c) < 0) ring.push(cutPoint(p, q, axis, c));
  }
  const n = ring.length;
  const side = ring.map((p) => (p[axis] === c ? 0 : p[axis] < c ? -1 : 1));
  if (side.every((s) => s <= 0) || side.every((s) => s >= 0)) return [ring];
  const prevSide = (i) => { for (let k = 1; k < n; k++) { const s = side[(i - k + n) % n]; if (s) return s; } return 0; };
  const nextSide = (i) => { for (let k = 1; k < n; k++) { const s = side[(i + k) % n]; if (s) return s; } return 0; };
  const crossings = [];
  for (let i = 0; i < n; i++) if (side[i] === 0 && prevSide(i) !== nextSide(i)) crossings.push(i);
  if (crossings.length % 2) { console.warn("odd crossings at", axis, c); return [ring]; }
  crossings.sort((a, b) => ring[a][1 - axis] - ring[b][1 - axis]);
  const partner = new Map();
  for (let k = 0; k + 1 < crossings.length; k += 2) { partner.set(crossings[k], crossings[k + 1]); partner.set(crossings[k + 1], crossings[k]); }

  const pieces = [];
  const used = new Uint8Array(n);
  for (const S of [-1, 1]) {
    for (let start = 0; start < n; start++) {
      if (side[start] !== S || used[start]) continue;
      const poly = [];
      let i = start, guard = 0;
      while (guard++ < 4 * n) {
        poly.push(ring[i]);
        if (side[i] === S) used[i] = 1;
        if (partner.has(i) && nextSide(i) !== S) {
          const j = partner.get(i);
          poly.push(ring[j]);
          i = (j + 1) % n;
        } else i = (i + 1) % n;
        if (i === start) break;
      }
      if (poly.length >= 3) pieces.push(poly);
    }
  }
  return pieces;
}

// ---------- assign pieces to territories ----------
const edges = {}; // territory -> directed edge list
const addRing = (t, ring) => {
  (edges[t] ??= []);
  for (let i = 0; i < ring.length; i++) edges[t].push([ring[i], ring[(i + 1) % ring.length]]);
};
const unassigned = new Map();

for (const g of topo.objects.countries.geometries) {
  const name = g.properties.name;
  if (name === "Antarctica") continue;
  const polys = g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : [];
  // Unwrap rings that cross the antimeridian (and keep all of Russia east of it) before cutting.
  const unwrap = (r) => {
    const crosses = r.some((p, i) => Math.abs(p[0] - r[(i + 1) % r.length][0]) > 180);
    return crosses || name === "Russia" ? r.map(([lon, lat]) => [lon < (name === "Russia" ? -168 : 0) ? lon + 360 : lon, lat]) : r;
  };
  const rings = polys.map((p) => p.map((ids) => insertCutPoints(unwrap(ringFromArcs(ids)))));
  const mainIndex = rings.reduce((best, p, i) => (Math.abs(area(p[0])) > Math.abs(area(rings[best][0])) ? i : best), 0);

  rings.forEach((poly, i) => {
    const [outer, ...holes] = poly;
    let pieces = [outer];
    if (CUTS[name] && i === mainIndex) {
      for (const [axis, c] of CUTS[name]) pieces = pieces.flatMap((r) => splitRing(r, axis, c));
    }
    for (const piece of pieces) {
      const [lon, lat] = centroid(piece);
      const t = rule(name, lon, lat);
      if (!t) { unassigned.set(name, (unassigned.get(name) ?? 0) + Math.abs(area(piece))); continue; }
      addRing(t, piece);
    }
    for (const h of holes) {
      const [lon, lat] = centroid(outer);
      const t = rule(name, lon, lat);
      if (t) addRing(t, h);
    }
  });
}

// ---------- union: cancel shared edges, stitch the rest into rings ----------
const key = (p) => `${p[0]},${p[1]}`;
function union(list) {
  // Count directed edges; an edge and its reverse cancel (shared border inside one territory).
  const fwd = new Map();
  for (const [a, b] of list) { const f = `${key(a)}>${key(b)}`; fwd.set(f, (fwd.get(f) ?? 0) + 1); }
  const next = new Map();
  for (const [a, b] of list) {
    const f = `${key(a)}>${key(b)}`, r = `${key(b)}>${key(a)}`;
    const nf = fwd.get(f) ?? 0, nr = fwd.get(r) ?? 0;
    if (nr > 0 && nf > 0) { fwd.set(f, nf - 1); fwd.set(r, nr - 1); continue; }
    if (nf <= 0) continue;
    fwd.set(f, nf - 1);
    (next.get(key(a)) ?? next.set(key(a), []).get(key(a))).push([a, b]);
  }
  const rings = [];
  for (const [k0, outs] of next) {
    while (outs.length) {
      const ring = [];
      let [a, b] = outs.pop();
      ring.push(a);
      let guard = 0;
      while (key(b) !== k0 && guard++ < 1e6) {
        ring.push(b);
        const cand = next.get(key(b));
        if (!cand || !cand.length) break;
        [a, b] = cand.pop();
      }
      if (ring.length >= 3) rings.push(ring);
    }
  }
  return rings;
}

// ---------- project, group outers with holes, label points ----------
function densify(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    out.push(p);
    const steps = Math.floor(Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])) / 0.75);
    for (let s = 1; s < steps; s++) out.push([p[0] + ((q[0] - p[0]) * s) / steps, p[1] + ((q[1] - p[1]) * s) / steps]);
  }
  return out;
}
const round = (v) => Math.round(v * 10) / 10;
const projRing = (ring) => {
  const out = [];
  for (const p of densify(ring)) {
    const [x, y] = project(Math.min(p[0], 189.9), p[1]);
    const q = [round(x), round(y)];
    const last = out.at(-1);
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  if (out.length > 1 && out[0][0] === out.at(-1)[0] && out[0][1] === out.at(-1)[1]) out.pop();
  return out;
};

function inside(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function labelPoint({ outer, holes }) {
  const rings = [outer, ...holes];
  const score = (p) => {
    if (!inside(p, outer) || holes.some((h) => inside(p, h))) return -1;
    let d = Infinity;
    for (const r of rings) for (let i = 0; i < r.length; i++) d = Math.min(d, segDist(p, r[i], r[(i + 1) % r.length]));
    return d;
  };
  let cx0 = Infinity, cx1 = -Infinity, cy0 = Infinity, cy1 = -Infinity;
  for (const [x, y] of outer) { cx0 = Math.min(cx0, x); cx1 = Math.max(cx1, x); cy0 = Math.min(cy0, y); cy1 = Math.max(cy1, y); }
  let step = Math.max(cx1 - cx0, cy1 - cy0) / 30;
  let best = centroid(outer), bestScore = score(best);
  for (let pass = 0; pass < 4; pass++) {
    for (let x = cx0; x <= cx1; x += step) for (let y = cy0; y <= cy1; y += step) {
      const s = score([x, y]);
      if (s > bestScore) { bestScore = s; best = [x, y]; }
    }
    cx0 = best[0] - step * 2; cx1 = best[0] + step * 2; cy0 = best[1] - step * 2; cy1 = best[1] + step * 2;
    step /= 4;
  }
  return { point: best.map(round), clearance: round(bestScore) };
}

/** Projects unioned lon/lat rings and groups them into outer rings with their holes, largest first. */
function toPolygons(lonLatRings) {
  const rings = lonLatRings.map(projRing).filter((r) => r.length >= 3);
  // Outer rings share the orientation of the largest ring; holes have the other.
  const signed = rings.map((r) => area(r));
  const outerSign = Math.sign(signed.reduce((best, a) => (Math.abs(a) > Math.abs(best) ? a : best), 0));
  const outers = rings.filter((_, i) => Math.sign(signed[i]) === outerSign).map((r) => ({ outer: r, holes: [], a: Math.abs(area(r)) }));
  for (const [i, r] of rings.entries()) {
    if (Math.sign(signed[i]) === outerSign) continue;
    const host = outers.find((o) => inside(r[0], o.outer));
    if (host) host.holes.push(r);
  }
  outers.sort((a, b) => b.a - a.a);
  return outers.filter((o, i) => i === 0 || o.a >= MIN_PIECE_PX2).map(({ outer, holes }) => ({ outer, holes }));
}

const territories = {};
const segOwner = new Map(); // undirected projected segment -> territories touching it
let outPoints = 0;
for (const id of Object.keys(TERRITORIES)) {
  if (!edges[id]) throw new Error(`No land assigned to ${id}`);
  const u = union(edges[id]);
  const polys = toPolygons(u);
  const { point, clearance } = labelPoint(polys[0]);
  territories[id] = { polys, label: point, clearance };
  for (const { outer, holes } of polys) for (const r of [outer, ...holes]) {
    outPoints += r.length;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const k = key(a) < key(b) ? `${key(a)}|${key(b)}` : `${key(b)}|${key(a)}`;
      const set = segOwner.get(k) ?? segOwner.set(k, { len: Math.hypot(a[0] - b[0], a[1] - b[1]), ts: new Set() }).get(k);
      set.ts.add(id);
    }
  }
}

// ---------- adjacency check and sea lanes ----------
const borderLen = new Map();
for (const { len, ts } of segOwner.values()) {
  if (ts.size !== 2) continue;
  const [a, b] = [...ts];
  const k = pairKey(a, b);
  borderLen.set(k, (borderLen.get(k) ?? 0) + len);
}
const unwanted = [...borderLen].filter(([k]) => !CANONICAL.has(k));
const land = [...CANONICAL].filter((k) => borderLen.has(k));
const sea = [...CANONICAL].filter((k) => !borderLen.has(k));

function closest(aId, bId) {
  let best = [Infinity];
  const A = territories[aId].polys.flatMap((p) => p.outer), B = territories[bId].polys.flatMap((p) => p.outer);
  for (const p of A) for (const q of B) {
    const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    if (d < best[0]) best = [d, p, q];
  }
  return [best[1], best[2]];
}
const seaLanes = sea.map((k) => {
  const [a, b] = k.split("|");
  if (k === pairKey("alaska", "kamchatka")) {
    const al = territories.alaska.polys[0].outer.reduce((m, p) => (p[0] < m[0] ? p : m));
    const ka = territories.kamchatka.polys.flatMap((p) => p.outer).reduce((m, p) => (p[0] > m[0] ? p : m));
    return { a: "alaska", b: "kamchatka", wrap: true, points: [al, [0, al[1]], [WIDTH, ka[1]], ka] };
  }
  const [p, q] = closest(a, b);
  return { a, b, wrap: false, points: [p, q] };
});

const toPath = (polys) =>
  polys.flatMap(({ outer, holes }) => [outer, ...holes]).map((r) => `M${r.map(([x, y]) => `${x} ${y}`).join("L")}Z`).join("");

// The coastline: every territory's land merged into landmasses.
const landmasses = toPolygons(union(Object.values(edges).flat())).map((p) => toPath([p]));

const problems = [];
if (unwanted.length) problems.push(`land borders that aren't in the rules: ${unwanted.map(([k]) => k).join(", ")}`);
const short = land.filter((k) => borderLen.get(k) < 6);
if (short.length) problems.push(`land borders too short to see: ${short.join(", ")}`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

const geometry = {
  width: WIDTH,
  height: HEIGHT,
  territories: Object.fromEntries(Object.entries(territories).map(([id, t]) => [id, { path: toPath(t.polys), label: t.label, clearance: t.clearance }])),
  landmasses,
  lakes: [],
  seaLanes,
  landBorders: land,
  continentLabels: Object.fromEntries(Object.entries(CONTINENT_LABELS).map(([k, [lon, lat]]) => [k, project(lon, lat).map(round)])),
};
const out = new URL("../../src/board/geometry.json", import.meta.url);
writeFileSync(out, JSON.stringify(geometry));
console.log(`geometry.json: ${Object.keys(territories).length} territories, ${outPoints} points, ${land.length} land borders + ${sea.length} sea lanes = ${land.length + sea.length} (of ${CANONICAL.size}), ${(JSON.stringify(geometry).length / 1024).toFixed(0)} KB`);
if (unassigned.size) console.log("countries with pieces left off the board:", [...unassigned.keys()].sort().join(", "));
