// Build-time script: turns real-world country boundaries (world-atlas,
// public-domain Natural Earth data) into one merged GeoJSON shape per
// classic Risk territory, and writes the result to
// src/game/territoryGeometry.json for the frontend to render directly with
// d3-geo. This runs once (re-run manually if the grouping below changes) -
// the app never re-derives this at runtime.
//
// Most territories are just a merge of whole countries (e.g. "Western
// Europe" = France + Spain + Portugal). A handful of countries are far
// bigger than any single Risk territory (USA, Canada, Russia, Australia) and
// map to *multiple* territories, so those are carved up with bounding-box
// clips at approximate real-world dividing lines instead - there's no
// official-Risk-board source for exact province-level borders, so this is a
// deliberate, documented approximation rather than a precise province split.
//
// Every territory - merged or clipped - gets a final bboxClip to a sane
// real-world extent. This is what actually matters for correctness: several
// Natural Earth country features carry far-flung exclaves as part of the
// same polygon (French Guiana bundled into "France", Fiji straddling the
// antimeridian at +-180deg), and without this pass a country merge would
// happily drag a chunk of the map into some tiny island the next continent
// over, or produce a bogus multi-thousand-km-wide shape.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as topojson from "topojson-client";
import bboxClipFn from "@turf/bbox-clip";
import simplifyFn from "@turf/simplify";
import { featureCollection } from "@turf/helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const topology = JSON.parse(readFileSync(path.join(root, "node_modules/world-atlas/countries-50m.json"), "utf8"));
const countryGeometries = topology.objects.countries.geometries;

function mergedGeometry(countryNames) {
  const geoms = countryGeometries.filter((g) => countryNames.includes(g.properties.name));
  const missing = countryNames.filter((n) => !geoms.some((g) => g.properties.name === n));
  if (missing.length > 0) throw new Error(`Unknown country name(s): ${missing.join(", ")}`);
  return topojson.merge(topology, geoms);
}

// @turf/bbox-clip leaves a `[]` placeholder in a MultiPolygon's coordinate
// list for every constituent polygon that got clipped away entirely. That's
// not valid GeoJSON (every Polygon needs at least one ring) and it breaks
// d3-geo's path rendering outright - one clipped feature with these left in
// rendered as a shape covering nearly the whole map instead of nothing.
function stripEmptyPolygons(geometry) {
  if (geometry.type !== "MultiPolygon") return geometry;
  return { ...geometry, coordinates: geometry.coordinates.filter((poly) => poly.length > 0 && poly[0].length > 0) };
}

// Signed planar (shoelace) area of a ring, x=lon, y=lat. Positive means
// counter-clockwise in standard "x right, y up" orientation, which is what
// RFC7946 (and d3-geo) expect for an exterior ring.
function signedRingArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

// @turf/bbox-clip's planar clip doesn't reliably preserve RFC7946 ring
// winding (exterior rings counter-clockwise, holes clockwise) on the
// result. d3-geo relies on that winding to know which side of a ring is
// "inside" - get it backwards and a small clipped sliver renders as
// everything *except* itself, i.e. a shape covering almost the whole map.
// Force the correct winding on every ring after every clip.
function rewind(geometry) {
  if (geometry.type !== "MultiPolygon") return geometry;
  const coordinates = geometry.coordinates.map((polygon) =>
    polygon.map((ring, ringIndex) => {
      const area = signedRingArea(ring);
      const shouldBePositive = ringIndex !== 0; // empirically: exterior rings need negative signed area here
      const isPositive = area > 0;
      return isPositive === shouldBePositive ? ring : [...ring].reverse();
    }),
  );
  return { ...geometry, coordinates };
}

function clipToBbox(geometry, bbox) {
  const clipped = bboxClipFn({ type: "Feature", properties: {}, geometry }, bbox).geometry;
  return rewind(stripEmptyPolygons(clipped));
}

function asPolygonList(geometry) {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

// territoryId -> { countries: real-world countries merged into it, bbox:
// [west, south, east, north] sane real-world extent applied as a final
// clip }.
const TERRITORIES_SOURCE = {
  // North America
  alaska: { countries: ["United States of America"], bbox: [-180, 45, -125, 75] },
  "northwest-territory": { countries: ["Canada"], bbox: [-141, 60, -52, 83] },
  greenland: { countries: ["Greenland"], bbox: [-75, 58, -10, 84] },
  alberta: { countries: ["Canada"], bbox: [-141, 41, -110, 60] },
  ontario: { countries: ["Canada"], bbox: [-110, 41, -74, 60] },
  quebec: { countries: ["Canada"], bbox: [-80, 41, -52, 63] },
  "western-united-states": { countries: ["United States of America"], bbox: [-125, 24, -100, 50] },
  "eastern-united-states": { countries: ["United States of America"], bbox: [-100, 24, -65, 50] },
  "central-america": {
    countries: ["Mexico", "Guatemala", "Belize", "El Salvador", "Honduras", "Nicaragua", "Costa Rica", "Panama"],
    bbox: [-105, 6, -77, 24],
  },

  // South America
  venezuela: { countries: ["Venezuela", "Colombia", "Guyana", "Suriname"], bbox: [-82, -5, -55, 13] },
  brazil: { countries: ["Brazil"], bbox: [-74, -34, -34, 6] },
  peru: { countries: ["Peru", "Ecuador", "Bolivia"], bbox: [-82, -23, -57, 1] },
  argentina: { countries: ["Argentina", "Chile", "Paraguay", "Uruguay"], bbox: [-76, -56, -53, -21] },

  // Europe
  iceland: { countries: ["Iceland"], bbox: [-25, 62, -12, 67] },
  "great-britain": { countries: ["United Kingdom", "Ireland"], bbox: [-11, 49, 2, 61] },
  scandinavia: { countries: ["Norway", "Sweden", "Finland"], bbox: [4, 54, 32, 72] },
  "northern-europe": {
    countries: ["Germany", "Poland", "Denmark", "Czechia", "Slovakia", "Austria", "Switzerland", "Netherlands", "Belgium", "Luxembourg"],
    bbox: [-1, 45, 24, 58],
  },
  "western-europe": { countries: ["France", "Spain", "Portugal"], bbox: [-10, 35, 9, 51.5] },
  "southern-europe": {
    countries: ["Italy", "Greece", "Albania", "Bosnia and Herz.", "Croatia", "Serbia", "Montenegro", "Macedonia", "Bulgaria", "Romania", "Hungary", "Slovenia"],
    bbox: [6, 34, 30, 47.5],
  },

  // Africa
  "north-africa": { countries: ["Morocco", "Algeria", "Tunisia", "Libya", "W. Sahara"], bbox: [-17, 19, 25, 37] },
  egypt: { countries: ["Egypt"], bbox: [24, 21, 37, 32] },
  "east-africa": { countries: ["Sudan", "S. Sudan", "Ethiopia", "Eritrea", "Djibouti", "Somalia", "Kenya", "Uganda", "Tanzania"], bbox: [21, -12, 51, 23] },
  congo: {
    countries: ["Dem. Rep. Congo", "Congo", "Central African Rep.", "Gabon", "Cameroon", "Eq. Guinea", "Chad", "Nigeria", "Niger", "Benin", "Togo", "Ghana", "Côte d'Ivoire", "Liberia", "Sierra Leone", "Guinea", "Guinea-Bissau", "Senegal", "Gambia", "Mali", "Burkina Faso"],
    bbox: [-18, -14, 34, 25],
  },
  "south-africa": { countries: ["South Africa", "Namibia", "Botswana", "Zimbabwe", "Zambia", "Malawi", "Mozambique", "Lesotho", "eSwatini", "Angola"], bbox: [11, -35, 41, -8] },
  madagascar: { countries: ["Madagascar"], bbox: [43, -26, 51, -11] },

  // Asia
  ural: { countries: ["Russia"], bbox: [60, 41, 88, 84] },
  siberia: { countries: ["Russia"], bbox: [88, 41, 110, 84] },
  irkutsk: { countries: ["Russia"], bbox: [110, 41, 128, 84] },
  yakutsk: { countries: ["Russia"], bbox: [128, 41, 155, 84] },
  kamchatka: { countries: ["Russia"], bbox: [155, 41, 180, 84] },
  mongolia: { countries: ["Mongolia"], bbox: [87, 41, 120, 53] },
  japan: { countries: ["Japan"], bbox: [123, 24, 146, 46] },
  china: { countries: ["China", "Taiwan"], bbox: [73, 18, 135, 54] },
  afghanistan: { countries: ["Afghanistan", "Pakistan", "Turkmenistan", "Uzbekistan", "Tajikistan", "Kyrgyzstan", "Kazakhstan"], bbox: [46, 20, 80, 56] },
  "middle-east": {
    countries: ["Saudi Arabia", "Iraq", "Syria", "Jordan", "Israel", "Lebanon", "Kuwait", "United Arab Emirates", "Oman", "Qatar", "Yemen", "Turkey", "Cyprus", "Palestine", "Iran"],
    bbox: [25, 12, 63, 42],
  },
  india: { countries: ["India", "Nepal", "Bhutan", "Bangladesh", "Sri Lanka"], bbox: [60, 5, 93, 36] },
  siam: { countries: ["Thailand", "Vietnam", "Laos", "Cambodia", "Myanmar", "Malaysia"], bbox: [92, 0, 110, 29] },

  // Australia
  indonesia: { countries: ["Indonesia", "Timor-Leste", "Brunei", "Philippines"], bbox: [95, -11, 128, 8] },
  "new-guinea": { countries: ["Papua New Guinea", "Solomon Is.", "Vanuatu", "New Caledonia"], bbox: [130, -25, 170, -1] },
  "western-australia": { countries: ["Australia"], bbox: [112, -36, 129, -9] },
  "eastern-australia": { countries: ["Australia"], bbox: [129, -45, 154, -9] },
};

const features = [];

for (const [territoryId, { countries, bbox }] of Object.entries(TERRITORIES_SOURCE)) {
  const geometry = clipToBbox(mergedGeometry(countries), bbox);
  features.push({ type: "Feature", properties: { id: territoryId }, geometry });
}

// "ukraine" = European Russia (west of the Ural clip) + Ukraine/Belarus/the
// Baltics/Moldova - built separately since it mixes a clip-of-Russia and a
// merge-of-neighbors, each with its own bbox safety net.
const europeanRussia = clipToBbox(mergedGeometry(["Russia"]), [19, 41, 60, 84]);
const ukraineNeighbors = clipToBbox(
  mergedGeometry(["Ukraine", "Belarus", "Estonia", "Latvia", "Lithuania", "Moldova"]),
  [19, 41, 60, 84],
);
features.push({
  type: "Feature",
  properties: { id: "ukraine" },
  geometry: {
    type: "MultiPolygon",
    coordinates: [...asPolygonList(europeanRussia), ...asPolygonList(ukraineNeighbors)],
  },
});

// Simplify point density before writing - the 50m source is far more
// detailed than a small on-screen board needs, and it's the single biggest
// lever on the shipped bundle size. Simplification can flip a ring's
// winding again (it did, at higher tolerances, during development), so
// re-apply the same rewind fix afterward rather than trusting it's still
// correct.
const simplified = simplifyFn(featureCollection(features), { tolerance: 0.03, highQuality: true, mutate: true });
simplified.features = simplified.features.map((f) => ({ ...f, geometry: rewind(stripEmptyPolygons(f.geometry)) }));

// Lives in public/, not src/, and is fetched at runtime rather than
// imported - at ~1MB it's better as its own cacheable static asset than
// inlined into the JS bundle.
const outPath = path.join(root, "public/territoryGeometry.json");
writeFileSync(outPath, JSON.stringify(simplified));

console.log(`Wrote ${features.length} features (for ${new Set(features.map((f) => f.properties.id)).size} territories) to ${outPath}`);
