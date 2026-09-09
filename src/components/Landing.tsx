import { useState } from "react";
import { gameClient } from "../lib/gameClient";
import "./Landing.css";

export const PLAYER_COLORS = ["#e63946", "#2a9d8f", "#f4a261", "#457b9d", "#9b5de5", "#ffb703"];

interface LandingProps {
  onEnter: (roomId: string, playerId: string) => void;
}

export function Landing({ onEnter }: LandingProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PLAYER_COLORS[0]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createRoom() {
    if (!name.trim()) return setError("Enter a name first");
    setBusy(true);
    setError(null);
    try {
      const result = await gameClient.createRoom(name.trim(), color);
      onEnter(result.roomId, result.playerId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom() {
    if (!name.trim()) return setError("Enter a name first");
    if (!code.trim()) return setError("Enter a room code");
    setBusy(true);
    setError(null);
    try {
      const result = await gameClient.joinRoom(code.trim(), name.trim(), color);
      onEnter(result.roomId, result.playerId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="landing">
      <h1>Risk</h1>
      <p className="landing-sub">Online multiplayer, real-time, real geography.</p>

      <div className="landing-field">
        <label htmlFor="player-name">Your name</label>
        <input id="player-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="e.g. Amara" />
      </div>

      <div className="landing-field">
        <label>Your color</label>
        <div className="color-picker">
          {PLAYER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-swatch${c === color ? " color-swatch--selected" : ""}`}
              style={{ background: c }}
              aria-label={c}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>

      {error && <p className="landing-error">{error}</p>}

      <div className="landing-actions">
        <button type="button" className="primary" disabled={busy} onClick={createRoom}>
          Create room
        </button>

        <div className="landing-join">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="ROOM CODE"
            className="code-input"
          />
          <button type="button" disabled={busy} onClick={joinRoom}>
            Join
          </button>
        </div>
      </div>
    </div>
  );
}
