import { TERRITORIES, type TerritoryId } from "../../game/mapData.ts";
import type { GameEvent, PlayerId, PublicState } from "../../game/types.ts";

const t = (id: TerritoryId) => TERRITORIES[id].name;

export function playerName(state: PublicState | null, id: PlayerId | null): string {
  return state?.players.find((p) => p.id === id)?.name ?? "Someone";
}

/** One line of game log for an event, or null for events not worth logging. */
export function describeEvent(e: GameEvent, state: PublicState | null): string | null {
  const name = (id: PlayerId | null) => playerName(state, id);
  switch (e.type) {
    case "gameStarted":
      return "The war begins.";
    case "setupReady":
      return `${name(e.player)} deployed their starting armies.`;
    case "turnStarted":
      return `Turn ${e.turn}: ${name(e.player)} receives ${e.reinforcements} armies.`;
    case "reinforced": {
      const total = Object.values(e.placements).reduce((a, b) => a + (b ?? 0), 0);
      return `${name(e.player)} placed ${total} ${total === 1 ? "army" : "armies"}.`;
    }
    case "traded":
      return `${name(e.player)} traded cards for ${e.armies} armies${e.bonusTerritory ? ` (+2 on ${t(e.bonusTerritory)})` : ""}.`;
    case "battle": {
      const rolls = e.rolls.length > 1 ? ` in ${e.rolls.length} rolls` : "";
      if (e.captured) return `${name(e.player)} conquered ${t(e.to)} from ${t(e.from)}${rolls}.`;
      return `${name(e.player)} attacked ${t(e.to)} from ${t(e.from)}${rolls}: lost ${e.attackerLosses}, killed ${e.defenderLosses}.`;
    }
    case "movedIn":
      return `${name(e.player)} moved ${e.count} more into ${t(e.to)}.`;
    case "eliminated":
      return `${name(e.by)} eliminated ${name(e.player)}${e.cardsTaken ? ` and took ${e.cardsTaken} cards` : ""}!`;
    case "fortified":
      return `${name(e.player)} moved ${e.count} from ${t(e.from)} to ${t(e.to)}.`;
    case "cardDrawn":
      return `${name(e.player)} earned a card.`;
    case "timedOut":
      return `${name(e.player)} ran out of time (${e.strikes}/3).`;
    case "resigned":
      return `${name(e.player)} left the war.`;
    case "gameOver":
      return e.winner ? `${name(e.winner)} conquered the world!` : "The game is over.";
  }
}
