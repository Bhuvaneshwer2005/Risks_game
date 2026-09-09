import { useMemo, useState } from "react";
import { Map } from "./Map";
import type { RoomData } from "../hooks/useGameRoom";
import { gameClient, type AttackResult } from "../lib/gameClient";
import { toTerritoryRecord } from "../lib/adapters";
import { ADJACENCY, TERRITORIES, areAdjacent, type TerritoryId } from "../game/mapData";
import { maxAttackerDice, maxDefenderDice } from "../game/combat";
import { isFortifyPathConnected } from "../game/fortify";
import { ALL_TERRITORY_IDS } from "../game/mapData";
import "./GameView.css";

interface GameViewProps {
  roomId: string;
  myUserId: string;
  data: RoomData;
}

function describeMove(move: { type: string; payload: unknown; player_id: string | null }, nameOf: (id: string | null) => string): string {
  const payload = move.payload as Record<string, unknown>;
  const who = nameOf(move.player_id);
  switch (move.type) {
    case "game_started":
      return `Game started (${payload.playerCount} players)`;
    case "reinforce":
      return `${who} placed ${payload.count} on ${TERRITORIES[payload.territoryId as TerritoryId]?.name ?? payload.territoryId}`;
    case "attack": {
      const from = TERRITORIES[payload.from as TerritoryId]?.name;
      const to = TERRITORIES[payload.to as TerritoryId]?.name;
      if (payload.defenderEliminated) return `${who} attacked ${from} -> ${to} and eliminated a player!`;
      if (payload.captured) return `${who} conquered ${to} from ${from}`;
      return `${who} attacked ${from} -> ${to}`;
    }
    case "fortify": {
      const from = TERRITORIES[payload.from as TerritoryId]?.name;
      const to = TERRITORIES[payload.to as TerritoryId]?.name;
      return `${who} moved ${payload.armies} from ${from} to ${to}`;
    }
    case "end_turn":
      return `${who} ended their turn`;
    case "trade_cards":
      return `${who} traded cards for +${payload.bonus} armies`;
    default:
      return `${who}: ${move.type}`;
  }
}

export function GameView({ roomId, data }: GameViewProps) {
  const { room, players, territories, moves, myCards, myPlayerId } = data;

  const [selectedFrom, setSelectedFrom] = useState<TerritoryId | null>(null);
  const [selectedTo, setSelectedTo] = useState<TerritoryId | null>(null);
  const [attackerDiceChoice, setAttackerDiceChoice] = useState(1);
  const [fortifyCount, setFortifyCount] = useState(1);
  const [moveInCount, setMoveInCount] = useState(1);
  const [lastRoll, setLastRoll] = useState<AttackResult | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const territoryMap = useMemo(() => toTerritoryRecord(territories), [territories]);
  const playerColors = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p.color])), [players]);
  const playerName = (id: string | null) => players.find((p) => p.id === id)?.name ?? "Someone";

  const eligibleTargets = useMemo(() => {
    if (!selectedFrom || !room) return undefined;
    if (room.phase === "attack") {
      return new Set(ADJACENCY[selectedFrom].filter((t) => territoryMap[t]?.owner && territoryMap[t].owner !== myPlayerId));
    }
    if (room.phase === "fortify") {
      return new Set(
        ALL_TERRITORY_IDS.filter(
          (t) => t !== selectedFrom && isFortifyPathConnected({ territories: territoryMap } as never, myPlayerId ?? "", selectedFrom, t),
        ),
      );
    }
    return undefined;
  }, [selectedFrom, room, territoryMap, myPlayerId]);

  if (!room) return <div className="gameview-loading">Loading…</div>;

  const isMyTurn = room.current_player_id === myPlayerId;
  const myTerritory = selectedFrom ? territoryMap[selectedFrom] : null;

  function resetSelection() {
    setSelectedFrom(null);
    setSelectedTo(null);
    setAttackerDiceChoice(1);
    setLastRoll(null);
    setMoveInCount(1);
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleTerritoryClick(id: TerritoryId) {
    if (!room || !isMyTurn || busy || room.winner_player_id) return;
    const owner = territoryMap[id]?.owner;

    if (room.phase === "reinforce") {
      if (owner === myPlayerId) setSelectedFrom(id);
      return;
    }

    if (room.phase === "attack") {
      if (room.pending_capture) return;
      if (owner === myPlayerId) {
        setSelectedFrom(territoryMap[id].armies > 1 ? id : null);
        setSelectedTo(null);
        setLastRoll(null);
        return;
      }
      if (selectedFrom && areAdjacent(selectedFrom, id)) setSelectedTo(id);
      return;
    }

    if (room.phase === "fortify") {
      if (owner === myPlayerId) {
        if (selectedFrom === id) return;
        if (!selectedFrom || territoryMap[id].armies > 1) {
          if (!selectedTo) {
            setSelectedFrom(id);
            return;
          }
        }
      }
      if (selectedFrom && owner === myPlayerId) setSelectedTo(id);
    }
  }

  const pending = room.pending_capture as { from: TerritoryId; to: TerritoryId; diceUsed: number } | null;

  return (
    <div className="gameview">
      <header className="gameview-header">
        <div className="room-code-small">{room.code}</div>
        {room.winner_player_id ? (
          <div className="turn-banner turn-banner--win">{playerName(room.winner_player_id)} wins!</div>
        ) : (
          <div className="turn-banner">
            <strong style={{ color: playerColors[room.current_player_id ?? ""] }}>{playerName(room.current_player_id)}</strong>
            {isMyTurn ? " (you) - " : " - "}
            {room.phase} phase
          </div>
        )}
      </header>

      {error && <p className="gameview-error">{error}</p>}

      <div className="gameview-body">
        <div className="gameview-map">
          <Map territories={territoryMap} playerColors={playerColors} selectedTerritory={selectedFrom} eligibleTargets={eligibleTargets} onSelectTerritory={handleTerritoryClick} />
        </div>

        <aside className="gameview-side">
          <section className="panel">
            <h3>Players</h3>
            <ul className="side-player-list">
              {players.map((p) => (
                <li key={p.id} className={p.id === room.current_player_id ? "side-player side-player--turn" : "side-player"}>
                  <span className="player-dot" style={{ background: p.color }} />
                  {p.name}
                  {p.eliminated && " (out)"}
                  <span className="side-player-meta">
                    {p.card_count} cards
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {isMyTurn && room.phase === "reinforce" && (
            <section className="panel">
              <h3>Reinforce ({room.reinforcements_remaining} left)</h3>
              {selectedFrom ? (
                <>
                  <p>Placing on {TERRITORIES[selectedFrom].name}</p>
                  <div className="button-row">
                    <button disabled={busy || room.reinforcements_remaining < 1} onClick={() => run(() => gameClient.reinforce(roomId, selectedFrom, 1))}>
                      +1
                    </button>
                    <button disabled={busy || room.reinforcements_remaining < 5} onClick={() => run(() => gameClient.reinforce(roomId, selectedFrom, 5))}>
                      +5
                    </button>
                    <button disabled={busy || room.reinforcements_remaining < 1} onClick={() => run(() => gameClient.reinforce(roomId, selectedFrom, room.reinforcements_remaining))}>
                      Place all
                    </button>
                  </div>
                </>
              ) : (
                <p className="hint">Click one of your territories to reinforce it.</p>
              )}
              <button className="primary full-width" disabled={busy || room.reinforcements_remaining > 0} onClick={() => run(() => gameClient.finishReinforcing(roomId)).then(resetSelection)}>
                Finish reinforcing
              </button>
            </section>
          )}

          {isMyTurn && room.phase === "attack" && (
            <section className="panel">
              <h3>Attack</h3>
              {pending ? (
                (() => {
                  const moveInMax = territoryMap[pending.from].armies - 1;
                  const moveInMin = Math.min(pending.diceUsed, moveInMax);
                  const clamped = Math.min(Math.max(moveInCount, moveInMin), moveInMax);
                  return (
                    <>
                      <p>
                        Conquered {TERRITORIES[pending.to].name}! Move in how many armies? (min {moveInMin}, max {moveInMax})
                      </p>
                      <input type="range" min={moveInMin} max={moveInMax} value={clamped} onChange={(e) => setMoveInCount(Number(e.target.value))} />
                      <p>{clamped} armies</p>
                      <button className="primary full-width" disabled={busy} onClick={() => run(() => gameClient.moveIn(roomId, clamped)).then(resetSelection)}>
                        Confirm move-in
                      </button>
                    </>
                  );
                })()
              ) : selectedFrom && selectedTo ? (
                <>
                  <p>
                    {TERRITORIES[selectedFrom].name} ({myTerritory?.armies}) attacking {TERRITORIES[selectedTo].name} ({territoryMap[selectedTo].armies})
                  </p>
                  <label>
                    Attacker dice
                    <select value={attackerDiceChoice} onChange={(e) => setAttackerDiceChoice(Number(e.target.value))}>
                      {Array.from({ length: maxAttackerDice(myTerritory?.armies ?? 1) }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary full-width"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await gameClient.attack(
                          roomId,
                          selectedFrom,
                          selectedTo,
                          attackerDiceChoice,
                          maxDefenderDice(territoryMap[selectedTo].armies),
                        );
                        setLastRoll(result);
                        if (!result.captured) setSelectedTo(null);
                      })
                    }
                  >
                    Roll dice!
                  </button>
                </>
              ) : (
                <p className="hint">Click one of your territories, then an adjacent enemy territory.</p>
              )}

              {lastRoll && !pending && (
                <div className="roll-result">
                  <p>Attacker: {lastRoll.roll.attackerDice.join(", ")}</p>
                  <p>Defender: {lastRoll.roll.defenderDice.join(", ")}</p>
                  <p>
                    Losses - you: {lastRoll.roll.attackerLosses}, them: {lastRoll.roll.defenderLosses}
                  </p>
                </div>
              )}

              <button className="full-width" disabled={busy || !!pending} onClick={() => run(() => gameClient.finishAttacking(roomId)).then(resetSelection)}>
                Finish attacking
              </button>
            </section>
          )}

          {isMyTurn && room.phase === "fortify" && (
            <section className="panel">
              <h3>Fortify</h3>
              {selectedFrom && selectedTo ? (
                <>
                  <p>
                    Move armies: {TERRITORIES[selectedFrom].name} -&gt; {TERRITORIES[selectedTo].name}
                  </p>
                  <input type="range" min={1} max={territoryMap[selectedFrom].armies - 1} value={fortifyCount} onChange={(e) => setFortifyCount(Number(e.target.value))} />
                  <p>{fortifyCount} armies</p>
                  <button className="primary full-width" disabled={busy} onClick={() => run(() => gameClient.fortify(roomId, selectedFrom, selectedTo, fortifyCount)).then(resetSelection)}>
                    Fortify
                  </button>
                </>
              ) : (
                <p className="hint">Click one of your territories, then another one you own (through a connected chain) - or just end your turn.</p>
              )}
              <button className="full-width" disabled={busy} onClick={() => run(() => gameClient.endTurn(roomId)).then(resetSelection)}>
                End turn
              </button>
            </section>
          )}

          <section className="panel">
            <h3>Your cards ({myCards.length})</h3>
            <div className="card-hand">
              {myCards.map((c) => (
                <button
                  key={c.id}
                  className={`card-chip${selectedCardIds.includes(c.id) ? " card-chip--selected" : ""}`}
                  onClick={() => setSelectedCardIds((prev) => (prev.includes(c.id) ? prev.filter((id) => id !== c.id) : prev.length < 3 ? [...prev, c.id] : prev))}
                >
                  {c.card_type}
                  {c.territory_id ? ` - ${TERRITORIES[c.territory_id as TerritoryId]?.name}` : ""}
                </button>
              ))}
            </div>
            <button
              className="full-width"
              disabled={busy || selectedCardIds.length !== 3 || !isMyTurn || room.phase !== "reinforce"}
              onClick={() =>
                run(async () => {
                  await gameClient.tradeCards(roomId, selectedCardIds);
                  setSelectedCardIds([]);
                })
              }
            >
              Trade selected set
            </button>
          </section>

          <section className="panel">
            <h3>Log</h3>
            <ul className="event-log">
              {moves.map((m) => (
                <li key={m.id}>{describeMove(m, playerName)}</li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
