import type { ContinentId } from "../game/mapData.ts";

/** Six player colors chosen to stay distinct from each other on the dark board. */
export const PLAYER_COLORS = [
  { id: "crimson", hex: "#e5484d", name: "Crimson" },
  { id: "azure", hex: "#3d8bfd", name: "Azure" },
  { id: "emerald", hex: "#2fb36c", name: "Emerald" },
  { id: "amber", hex: "#f5a524", name: "Amber" },
  { id: "violet", hex: "#9d5cf0", name: "Violet" },
  { id: "cyan", hex: "#14b8cf", name: "Cyan" },
] as const;

export const DEFAULT_COLOR = PLAYER_COLORS[0].hex;

/** Unowned or decorative land: a muted tint per continent. */
export const CONTINENT_TINTS: Record<ContinentId, string> = {
  "north-america": "#3a3223",
  "south-america": "#3b2626",
  europe: "#23304a",
  africa: "#3b3322",
  asia: "#223a2e",
  australia: "#33243f",
};

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear mix of two hex colors; t = 0 gives `a`, t = 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${c(r1, r2)}, ${c(g1, g2)}, ${c(b1, b2)})`;
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Readable text color on top of a player color. */
export function textOn(hex: string): string {
  const [r, g, b] = parseHex(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#0b1220" : "#ffffff";
}
