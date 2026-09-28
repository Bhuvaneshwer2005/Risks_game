// Shape checks for request bodies. The rules engine re-validates every value
// (territory ids, whole numbers, ranges) and rejects anything illegal; this
// layer only makes sure the payload has the right structure and drops any
// fields the engine doesn't expect.

import type { GameAction, GameSettings, Placements } from "./_engine/types.ts";

export class BadRequest extends Error {}

function fail(message: string): never {
  throw new BadRequest(message);
}

type Obj = Record<string, unknown>;

function obj(value: unknown, what: string): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${what} must be an object`);
  return value as Obj;
}

function str(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) fail(`${what} must be a string`);
  return value;
}

function num(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${what} must be a number`);
  return value;
}

function placements(value: unknown): Placements {
  const raw = obj(value, "placements");
  const entries = Object.entries(raw);
  if (entries.length > 42) fail("Too many placements");
  return Object.fromEntries(entries.map(([k, v]) => [str(k, "territory"), num(v, "armies")])) as Placements;
}

export function parseAction(value: unknown): GameAction {
  const a = obj(value, "action");
  switch (a.type) {
    case "claim":
      return { type: "claim", territory: str(a.territory, "territory") as never };
    case "setupPlace":
    case "reinforce":
      return { type: a.type, placements: placements(a.placements) };
    case "trade": {
      if (!Array.isArray(a.cardIds) || a.cardIds.length !== 3) fail("cardIds must list 3 cards");
      return { type: "trade", cardIds: a.cardIds.map((c) => num(c, "card id")) };
    }
    case "attack":
      return {
        type: "attack",
        from: str(a.from, "from") as never,
        to: str(a.to, "to") as never,
        ...(a.dice === undefined || a.dice === null ? {} : { dice: num(a.dice, "dice") }),
      };
    case "blitz":
      return { type: "blitz", from: str(a.from, "from") as never, to: str(a.to, "to") as never };
    case "moveMore":
      return { type: "moveMore", count: num(a.count, "count") };
    case "fortify":
      return { type: "fortify", from: str(a.from, "from") as never, to: str(a.to, "to") as never, count: num(a.count, "count") };
    case "autoSetup":
    case "endAttack":
    case "endTurn":
    case "resign":
    case "claimTimeout":
      return { type: a.type };
    default:
      fail("Unknown action");
  }
}

const TURN_SECONDS = new Set([null, 60, 90, 120, 180]);

export function parseSettings(value: unknown): GameSettings {
  const s = obj(value, "settings");
  if (s.fortifyRule !== "adjacent" && s.fortifyRule !== "connected") fail("Unknown fortify rule");
  if (s.cardMode !== "progressive" && s.cardMode !== "fixed") fail("Unknown card mode");
  const turnSeconds = s.turnSeconds ?? null;
  if (!TURN_SECONDS.has(turnSeconds as number | null)) fail("Unsupported turn timer");
  // Rooms created before claiming existed have no setupMode.
  const setupMode = s.setupMode ?? "claim";
  if (setupMode !== "claim" && setupMode !== "deal" && setupMode !== "neutral") fail("Unknown setup mode");
  return { setupMode, fortifyRule: s.fortifyRule, cardMode: s.cardMode, turnSeconds: turnSeconds as number | null };
}

export function parseName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (name.length < 1 || name.length > 20) fail("Names must be 1-20 characters");
  return name;
}

const COLORS = new Set(["#e5484d", "#3d8bfd", "#2fb36c", "#f5a524", "#9d5cf0", "#14b8cf"]);

export function parseColor(value: unknown): string {
  const color = typeof value === "string" ? value.toLowerCase() : "";
  if (!COLORS.has(color)) fail("Pick one of the six player colors");
  return color;
}

export function parseCode(value: unknown): string {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{6}$/.test(code)) fail("Room codes are 6 letters or digits");
  return code;
}

export function parseUuid(value: unknown, what: string): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) fail(`${what} is not a valid id`);
  return value;
}
