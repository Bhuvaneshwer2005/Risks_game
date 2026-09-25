// Canonical Risk board data: 42 territories grouped into 6 continents, with
// the classic adjacency graph (including the non-contiguous sea crossings,
// e.g. Alaska-Kamchatka, Greenland-Iceland, Brazil-North Africa). This is
// factual game data, not artwork - it's what the rules engine and the map
// renderer both key off of.

export type ContinentId =
  | "north-america"
  | "south-america"
  | "europe"
  | "africa"
  | "asia"
  | "australia";

export interface Continent {
  id: ContinentId;
  name: string;
  bonusArmies: number;
}

export const CONTINENTS: Record<ContinentId, Continent> = {
  "north-america": { id: "north-america", name: "North America", bonusArmies: 5 },
  "south-america": { id: "south-america", name: "South America", bonusArmies: 2 },
  europe: { id: "europe", name: "Europe", bonusArmies: 5 },
  africa: { id: "africa", name: "Africa", bonusArmies: 3 },
  asia: { id: "asia", name: "Asia", bonusArmies: 7 },
  australia: { id: "australia", name: "Australia", bonusArmies: 2 },
};

export type TerritoryId =
  // North America (9)
  | "alaska"
  | "northwest-territory"
  | "greenland"
  | "alberta"
  | "ontario"
  | "quebec"
  | "western-united-states"
  | "eastern-united-states"
  | "central-america"
  // South America (4)
  | "venezuela"
  | "brazil"
  | "peru"
  | "argentina"
  // Europe (7)
  | "iceland"
  | "great-britain"
  | "scandinavia"
  | "northern-europe"
  | "southern-europe"
  | "western-europe"
  | "ukraine"
  // Africa (6)
  | "north-africa"
  | "egypt"
  | "east-africa"
  | "congo"
  | "south-africa"
  | "madagascar"
  // Asia (12)
  | "ural"
  | "siberia"
  | "yakutsk"
  | "kamchatka"
  | "irkutsk"
  | "mongolia"
  | "japan"
  | "china"
  | "afghanistan"
  | "middle-east"
  | "india"
  | "siam"
  // Australia (4)
  | "indonesia"
  | "new-guinea"
  | "western-australia"
  | "eastern-australia";

export interface Territory {
  id: TerritoryId;
  name: string;
  continent: ContinentId;
}

export const TERRITORIES: Record<TerritoryId, Territory> = {
  alaska: { id: "alaska", name: "Alaska", continent: "north-america" },
  "northwest-territory": { id: "northwest-territory", name: "Northwest Territory", continent: "north-america" },
  greenland: { id: "greenland", name: "Greenland", continent: "north-america" },
  alberta: { id: "alberta", name: "Alberta", continent: "north-america" },
  ontario: { id: "ontario", name: "Ontario", continent: "north-america" },
  quebec: { id: "quebec", name: "Quebec", continent: "north-america" },
  "western-united-states": { id: "western-united-states", name: "Western United States", continent: "north-america" },
  "eastern-united-states": { id: "eastern-united-states", name: "Eastern United States", continent: "north-america" },
  "central-america": { id: "central-america", name: "Central America", continent: "north-america" },

  venezuela: { id: "venezuela", name: "Venezuela", continent: "south-america" },
  brazil: { id: "brazil", name: "Brazil", continent: "south-america" },
  peru: { id: "peru", name: "Peru", continent: "south-america" },
  argentina: { id: "argentina", name: "Argentina", continent: "south-america" },

  iceland: { id: "iceland", name: "Iceland", continent: "europe" },
  "great-britain": { id: "great-britain", name: "Great Britain", continent: "europe" },
  scandinavia: { id: "scandinavia", name: "Scandinavia", continent: "europe" },
  "northern-europe": { id: "northern-europe", name: "Northern Europe", continent: "europe" },
  "southern-europe": { id: "southern-europe", name: "Southern Europe", continent: "europe" },
  "western-europe": { id: "western-europe", name: "Western Europe", continent: "europe" },
  ukraine: { id: "ukraine", name: "Ukraine", continent: "europe" },

  "north-africa": { id: "north-africa", name: "North Africa", continent: "africa" },
  egypt: { id: "egypt", name: "Egypt", continent: "africa" },
  "east-africa": { id: "east-africa", name: "East Africa", continent: "africa" },
  congo: { id: "congo", name: "Congo", continent: "africa" },
  "south-africa": { id: "south-africa", name: "South Africa", continent: "africa" },
  madagascar: { id: "madagascar", name: "Madagascar", continent: "africa" },

  ural: { id: "ural", name: "Ural", continent: "asia" },
  siberia: { id: "siberia", name: "Siberia", continent: "asia" },
  yakutsk: { id: "yakutsk", name: "Yakutsk", continent: "asia" },
  kamchatka: { id: "kamchatka", name: "Kamchatka", continent: "asia" },
  irkutsk: { id: "irkutsk", name: "Irkutsk", continent: "asia" },
  mongolia: { id: "mongolia", name: "Mongolia", continent: "asia" },
  japan: { id: "japan", name: "Japan", continent: "asia" },
  china: { id: "china", name: "China", continent: "asia" },
  afghanistan: { id: "afghanistan", name: "Afghanistan", continent: "asia" },
  "middle-east": { id: "middle-east", name: "Middle East", continent: "asia" },
  india: { id: "india", name: "India", continent: "asia" },
  siam: { id: "siam", name: "Siam", continent: "asia" },

  indonesia: { id: "indonesia", name: "Indonesia", continent: "australia" },
  "new-guinea": { id: "new-guinea", name: "New Guinea", continent: "australia" },
  "western-australia": { id: "western-australia", name: "Western Australia", continent: "australia" },
  "eastern-australia": { id: "eastern-australia", name: "Eastern Australia", continent: "australia" },
};

export const ALL_TERRITORY_IDS = Object.keys(TERRITORIES) as TerritoryId[];

// Undirected adjacency pairs, listed once each. buildAdjacency() below turns
// this into a symmetric lookup table so callers never have to worry about
// which side of a pair they're checking.
const ADJACENCY_PAIRS: [TerritoryId, TerritoryId][] = [
  // North America
  ["alaska", "northwest-territory"],
  ["alaska", "alberta"],
  ["alaska", "kamchatka"], // Bering Strait
  ["northwest-territory", "alberta"],
  ["northwest-territory", "ontario"],
  ["northwest-territory", "greenland"],
  ["greenland", "ontario"],
  ["greenland", "quebec"],
  ["greenland", "iceland"], // sea crossing
  ["alberta", "ontario"],
  ["alberta", "western-united-states"],
  ["ontario", "quebec"],
  ["ontario", "western-united-states"],
  ["ontario", "eastern-united-states"],
  ["quebec", "eastern-united-states"],
  ["western-united-states", "eastern-united-states"],
  ["western-united-states", "central-america"],
  ["eastern-united-states", "central-america"],
  ["central-america", "venezuela"],

  // South America
  ["venezuela", "brazil"],
  ["venezuela", "peru"],
  ["brazil", "peru"],
  ["brazil", "argentina"],
  ["brazil", "north-africa"], // sea crossing
  ["peru", "argentina"],

  // Europe
  ["iceland", "great-britain"],
  ["iceland", "scandinavia"],
  ["great-britain", "scandinavia"],
  ["great-britain", "northern-europe"],
  ["great-britain", "western-europe"],
  ["scandinavia", "northern-europe"],
  ["scandinavia", "ukraine"],
  ["northern-europe", "ukraine"],
  ["northern-europe", "southern-europe"],
  ["northern-europe", "western-europe"],
  ["western-europe", "southern-europe"],
  ["western-europe", "north-africa"], // sea crossing
  ["southern-europe", "ukraine"],
  ["southern-europe", "middle-east"],
  ["southern-europe", "egypt"],
  ["southern-europe", "north-africa"],
  ["ukraine", "ural"],
  ["ukraine", "afghanistan"],
  ["ukraine", "middle-east"],

  // Africa
  ["north-africa", "egypt"],
  ["north-africa", "east-africa"],
  ["north-africa", "congo"],
  ["egypt", "east-africa"],
  ["egypt", "middle-east"],
  ["east-africa", "congo"],
  ["east-africa", "south-africa"],
  ["east-africa", "madagascar"],
  ["east-africa", "middle-east"],
  ["congo", "south-africa"],
  ["south-africa", "madagascar"],

  // Asia
  ["ural", "siberia"],
  ["ural", "china"],
  ["ural", "afghanistan"],
  ["siberia", "yakutsk"],
  ["siberia", "irkutsk"],
  ["siberia", "mongolia"],
  ["siberia", "china"],
  ["yakutsk", "kamchatka"],
  ["yakutsk", "irkutsk"],
  ["kamchatka", "irkutsk"],
  ["kamchatka", "mongolia"],
  ["kamchatka", "japan"],
  ["irkutsk", "mongolia"],
  ["mongolia", "japan"],
  ["mongolia", "china"],
  ["china", "afghanistan"],
  ["china", "india"],
  ["china", "siam"],
  ["afghanistan", "middle-east"],
  ["afghanistan", "india"],
  ["middle-east", "india"],
  ["india", "siam"],

  // Australia
  ["siam", "indonesia"],
  ["indonesia", "new-guinea"],
  ["indonesia", "western-australia"],
  ["new-guinea", "western-australia"],
  ["new-guinea", "eastern-australia"],
  ["western-australia", "eastern-australia"],
];

function buildAdjacency(): Record<TerritoryId, TerritoryId[]> {
  const map = Object.fromEntries(ALL_TERRITORY_IDS.map((id) => [id, [] as TerritoryId[]])) as Record<
    TerritoryId,
    TerritoryId[]
  >;
  for (const [a, b] of ADJACENCY_PAIRS) {
    map[a].push(b);
    map[b].push(a);
  }
  return map;
}

export const ADJACENCY = buildAdjacency();

export function areAdjacent(a: TerritoryId, b: TerritoryId): boolean {
  return ADJACENCY[a].includes(b);
}

export function territoriesInContinent(continent: ContinentId): TerritoryId[] {
  return ALL_TERRITORY_IDS.filter((id) => TERRITORIES[id].continent === continent);
}
