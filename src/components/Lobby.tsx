import { useState } from "react";
import { gameClient } from "../lib/gameClient";
import type { RoomData } from "../hooks/useGameRoom";
import "./Lobby.css";

interface LobbyProps {
  roomId: string;
  myUserId: string;
  data: RoomData;
}

export function Lobby({ roomId, myUserId, data }: LobbyProps) {
  const { room, players, myPlayerId } = data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!room) return <div className="lobby-loading">Loading…</div>;

  const isHost = room.host_user_id === myUserId;
  const canStart = players.length >= 2 && players.length <= 6;

  async function startGame() {
    setBusy(true);
    setError(null);
    try {
      await gameClient.startGame(roomId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lobby">
      <h1>Lobby</h1>
      <div className="room-code">
        Room code <span>{room.code}</span>
      </div>
      <p className="lobby-hint">Share this code - up to 6 players, need at least 2 to start.</p>

      <ul className="player-list">
        {players.map((p) => (
          <li key={p.id} className={p.id === myPlayerId ? "player-list-item player-list-item--me" : "player-list-item"}>
            <span className="player-dot" style={{ background: p.color }} />
            {p.name}
            {p.id === myPlayerId && " (you)"}
            {p.user_id === room.host_user_id && <span className="host-tag">host</span>}
          </li>
        ))}
      </ul>

      {error && <p className="landing-error">{error}</p>}

      {isHost ? (
        <button type="button" className="primary" disabled={!canStart || busy} onClick={startGame}>
          {canStart ? "Start game" : "Waiting for at least 2 players…"}
        </button>
      ) : (
        <p className="lobby-hint">Waiting for the host to start the game…</p>
      )}
    </div>
  );
}
