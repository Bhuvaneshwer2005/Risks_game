import { useState, useSyncExternalStore } from "react";
import { PLAYER_COLORS } from "../board/colors.ts";
import { MAX_PLAYERS, MIN_PLAYERS } from "../game/engine.ts";
import type { OnlineConnection } from "../net/online.ts";
import { Button, ColorSwatches, Dot, IconButton } from "../ui/index.tsx";
import { useToast } from "../ui/toast.ts";
import { SettingsFields } from "./SettingsFields.tsx";
import styles from "./screens.module.css";

export function Lobby({ connection, onExit }: { connection: OnlineConnection; onExit: () => void }) {
  const snap = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const lobby = snap.lobby;
  if (!lobby) return <div className={styles.page}>Loading…</div>;

  const isHost = lobby.hostId === snap.me;
  const mine = lobby.seats.find((s) => s.userId === snap.me);
  const shareUrl = `${location.origin}${location.pathname}?room=${lobby.code}`;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`, "gold");
    } catch {
      toast(`Copy failed. The ${what.toLowerCase()} is ${text}`);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageCard}>
        <header className={styles.pageHeader}>
          <IconButton icon="close" label="Leave lobby" onClick={() => void connection.leave().then(onExit)} />
          <div>
            <h1 className={styles.pageTitle}>War room</h1>
            <p className={styles.pageSubtitle}>Share the code. The host starts the game when everyone's in.</p>
          </div>
        </header>

        <div className={styles.roomCode}>
          <div>
            <div className={styles.roomCodeLabel}>Room code</div>
            <div className={styles.roomCodeValue}>{lobby.code}</div>
          </div>
          <div className={styles.roomCodeActions}>
            <Button icon="copy" onClick={() => void copy(lobby.code, "Code")}>
              Copy code
            </Button>
            <Button icon="link" onClick={() => void copy(shareUrl, "Invite link")}>
              Copy link
            </Button>
          </div>
        </div>

        <div className={styles.seatGrid}>
          {Array.from({ length: MAX_PLAYERS }, (_, i) => {
            const seat = lobby.seats[i];
            if (!seat) {
              return (
                <div key={`empty-${i}`} className={`${styles.lobbySeat} ${styles.lobbySeatEmpty}`}>
                  Open seat
                </div>
              );
            }
            return (
              <div key={seat.userId} className={styles.lobbySeat}>
                <Dot color={seat.color} size={14} />
                <span className={styles.lobbySeatName}>
                  {seat.name}
                  {seat.userId === snap.me && " (you)"}
                </span>
                {seat.userId === lobby.hostId && <span className={styles.hostBadge}>Host</span>}
                {isHost && seat.userId !== snap.me && (
                  <IconButton icon="close" label={`Remove ${seat.name}`} disabled={busy} onClick={() => void run(() => connection.kick(seat.userId))} />
                )}
              </div>
            );
          })}
        </div>

        {mine && (
          <div>
            <p className={styles.roomCodeLabel} style={{ marginBottom: 8 }}>
              Your color
            </p>
            <ColorSwatches
              colors={PLAYER_COLORS}
              value={mine.color}
              taken={lobby.seats.filter((s) => s.userId !== snap.me).map((s) => s.color)}
              onChange={(color) => void run(() => connection.updateSeat({ color }))}
            />
          </div>
        )}

        <SettingsFields value={lobby.settings} disabled={!isHost || busy} onChange={(settings) => void run(() => connection.updateSettings(settings))} />
        {!isHost && <p className={styles.hint}>Only the host can change the rules.</p>}

        <div className={styles.pageFooter}>
          <Button variant="ghost" onClick={() => void connection.leave().then(onExit)}>
            Leave
          </Button>
          {isHost ? (
            <Button
              variant="primary"
              size="lg"
              icon="sword"
              disabled={busy || lobby.seats.length < MIN_PLAYERS}
              onClick={() => void run(() => connection.start())}
            >
              {lobby.seats.length < MIN_PLAYERS ? "Waiting for players…" : `Start with ${lobby.seats.length} players`}
            </Button>
          ) : (
            <span className={styles.hint}>Waiting for the host to start…</span>
          )}
        </div>
      </div>
    </div>
  );
}
