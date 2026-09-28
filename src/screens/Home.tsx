import { useState } from "react";
import { BoardMap } from "../board/BoardMap.tsx";
import { PLAYER_COLORS } from "../board/colors.ts";
import { setPrefs, usePrefs } from "../state/prefs.ts";
import { Button, ColorSwatches, Field, Icon, TextInput } from "../ui/index.tsx";
import { RulesModal } from "./RulesModal.tsx";
import styles from "./screens.module.css";

export interface HomeProps {
  initialCode?: string;
  canResume: boolean;
  onlineAvailable: boolean;
  busy: boolean;
  onCreateOnline: () => void;
  onJoinOnline: (code: string) => void;
  onPlayLocal: () => void;
  onResumeLocal: () => void;
}

export function Home(props: HomeProps) {
  const prefs = usePrefs();
  const [code, setCode] = useState(props.initialCode ?? "");
  const [rulesOpen, setRulesOpen] = useState(false);
  const named = prefs.name.trim().length > 0;

  return (
    <div className={styles.home}>
      <div className={styles.homeBoard} aria-hidden="true">
        <BoardMap interactive={false} />
      </div>
      <div className={styles.homeVignette} />

      <main className={styles.homeCard}>
        <div className={styles.hero}>
          <h1 className={styles.logo}>RISK</h1>
          <p className={styles.tagline}>The game of global domination</p>
        </div>

        <div className={styles.form}>
          <Field label="Commander name">
            <TextInput
              value={prefs.name}
              maxLength={20}
              placeholder="e.g. Amara"
              autoComplete="nickname"
              onChange={(e) => setPrefs({ name: e.target.value })}
            />
          </Field>
          <Field label="Your color" group>
            <ColorSwatches colors={PLAYER_COLORS} value={prefs.color} onChange={(color) => setPrefs({ color })} />
          </Field>
        </div>

        <div className={styles.actions}>
          <Button variant="primary" size="lg" block icon="globe" disabled={!named || !props.onlineAvailable || props.busy} onClick={props.onCreateOnline}>
            Create online game
          </Button>
          <form
            className={styles.joinRow}
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) props.onJoinOnline(code.trim().toUpperCase());
            }}
          >
            <TextInput
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              maxLength={6}
              placeholder="ROOM CODE"
              aria-label="Room code"
              className={styles.codeInput}
            />
            <Button type="submit" variant="secondary" size="lg" disabled={!named || code.length < 4 || !props.onlineAvailable || props.busy}>
              Join
            </Button>
          </form>

          <div className={styles.divider}>
            <span>or play on this device</span>
          </div>

          <div className={styles.localRow}>
            <Button variant="secondary" size="lg" icon="device" onClick={props.onPlayLocal}>
              Pass &amp; play
            </Button>
            {props.canResume && (
              <Button variant="ghost" size="lg" icon="undo" onClick={props.onResumeLocal}>
                Resume game
              </Button>
            )}
          </div>
          {!named && <p className={styles.hint}>Enter a name to play online.</p>}
        </div>

        <button type="button" className={styles.rulesLink} onClick={() => setRulesOpen(true)}>
          <Icon name="book" size={15} /> How to play
        </button>
      </main>

      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
    </div>
  );
}
