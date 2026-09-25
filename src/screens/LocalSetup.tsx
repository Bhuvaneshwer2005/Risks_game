import { useState } from "react";
import { PLAYER_COLORS } from "../board/colors.ts";
import { DEFAULT_SETTINGS, type GameSettings } from "../game/types.ts";
import { MAX_PLAYERS, MIN_PLAYERS, type NewPlayer } from "../game/engine.ts";
import { getPrefs } from "../state/prefs.ts";
import { Button, ColorSwatches, IconButton, TextInput } from "../ui/index.tsx";
import { SettingsFields } from "./SettingsFields.tsx";
import styles from "./screens.module.css";

interface Seat {
  name: string;
  color: string;
}

function initialSeats(): Seat[] {
  const prefs = getPrefs();
  const first = { name: prefs.name.trim() || "Player 1", color: prefs.color };
  const others = PLAYER_COLORS.filter((c) => c.hex !== first.color).slice(0, 2);
  return [first, ...others.map((c, i) => ({ name: `Player ${i + 2}`, color: c.hex }))];
}

export function LocalSetup({ onStart, onBack }: { onStart: (players: NewPlayer[], settings: GameSettings) => void; onBack: () => void }) {
  const [seats, setSeats] = useState<Seat[]>(initialSeats);
  const [settings, setSettings] = useState<GameSettings>({ ...DEFAULT_SETTINGS, turnSeconds: null });

  const update = (i: number, patch: Partial<Seat>) => setSeats((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const add = () => {
    const free = PLAYER_COLORS.find((c) => !seats.some((s) => s.color === c.hex));
    if (free) setSeats([...seats, { name: `Player ${seats.length + 1}`, color: free.hex }]);
  };
  const valid = seats.length >= MIN_PLAYERS && seats.every((s) => s.name.trim()) && new Set(seats.map((s) => s.color)).size === seats.length;

  return (
    <div className={styles.page}>
      <div className={styles.pageCard}>
        <header className={styles.pageHeader}>
          <IconButton icon="close" label="Back" onClick={onBack} />
          <div>
            <h1 className={styles.pageTitle}>Pass &amp; play</h1>
            <p className={styles.pageSubtitle}>Everyone plays on this device, taking turns. {seats.length === 2 && "Two players get a neutral army too."}</p>
          </div>
        </header>

        <div className={styles.seats}>
          {seats.map((seat, i) => (
            <div key={i} className={styles.seat}>
              <span className={styles.seatNumber} style={{ background: seat.color }}>
                {i + 1}
              </span>
              <div className={styles.seatBody}>
                <TextInput value={seat.name} maxLength={20} aria-label={`Player ${i + 1} name`} onChange={(e) => update(i, { name: e.target.value })} />
                <ColorSwatches
                  colors={PLAYER_COLORS}
                  value={seat.color}
                  taken={seats.filter((_, j) => j !== i).map((s) => s.color)}
                  onChange={(color) => update(i, { color })}
                />
              </div>
              {seats.length > MIN_PLAYERS && <IconButton icon="close" label={`Remove ${seat.name}`} onClick={() => setSeats(seats.filter((_, j) => j !== i))} />}
            </div>
          ))}
          {seats.length < MAX_PLAYERS && (
            <Button variant="ghost" icon="plus" onClick={add}>
              Add player
            </Button>
          )}
        </div>

        <SettingsFields value={settings} onChange={setSettings} />

        <div className={styles.pageFooter}>
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button
            variant="primary"
            size="lg"
            icon="sword"
            disabled={!valid}
            onClick={() => onStart(seats.map((s, i) => ({ id: `p${i + 1}`, name: s.name.trim(), color: s.color })), settings)}
          >
            Start the war
          </Button>
        </div>
      </div>
    </div>
  );
}
