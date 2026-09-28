import { TIME_BONUS_SECONDS, TURN_SECONDS_OPTIONS, type GameSettings } from "../game/types.ts";
import { Field, Segmented } from "../ui/index.tsx";
import styles from "./screens.module.css";

const SETUP_HINTS: Record<GameSettings["setupMode"], string> = {
  claim: "The map starts empty. Players take turns claiming one territory at a time, then everyone places the rest of their armies.",
  deal: "Territories are dealt out at random with one army each, then everyone places the rest of their armies.",
};

const FORTIFY_HINTS: Record<GameSettings["fortifyRule"], string> = {
  adjacent: "At the end of your turn you may move armies once, into a neighbouring territory you own.",
  connected: "At the end of your turn you may move armies once, to any of your territories linked to it through your own land.",
};

const CARD_HINTS: Record<GameSettings["cardMode"], string> = {
  progressive: "Every set traded by anyone is worth more than the last: 4, 6, 8, 10, 12, 15, then 5 more each time.",
  fixed: "A set's value depends on its cards: 3 infantry 4, 3 cavalry 6, 3 artillery 8, one of each 10.",
};

/** The house-rule options a game can be started with. */
export function SettingsFields({ value, onChange, disabled }: { value: GameSettings; onChange: (v: GameSettings) => void; disabled?: boolean }) {
  // Rooms created before claiming existed have no setup mode; the server treats that as "claim".
  const setupMode = value.setupMode ?? "claim";
  return (
    <div className={styles.settings}>
      <Field label="Starting map" group hint={SETUP_HINTS[setupMode]}>
        <Segmented
          label="Starting map"
          value={setupMode}
          onChange={(mode) => onChange({ ...value, setupMode: mode })}
          options={[
            { value: "claim", label: "Claim territories", disabled },
            { value: "deal", label: "Deal at random", disabled },
          ]}
        />
      </Field>
      <Field label="Fortify" group hint={FORTIFY_HINTS[value.fortifyRule]}>
        <Segmented
          label="Fortify rule"
          value={value.fortifyRule}
          onChange={(fortifyRule) => onChange({ ...value, fortifyRule })}
          options={[
            { value: "adjacent", label: "Neighbour (classic)", disabled },
            { value: "connected", label: "Connected chain", disabled },
          ]}
        />
      </Field>
      <Field label="Card sets" group hint={CARD_HINTS[value.cardMode]}>
        <Segmented
          label="Card set values"
          value={value.cardMode}
          onChange={(cardMode) => onChange({ ...value, cardMode })}
          options={[
            { value: "progressive", label: "Escalating (classic)", disabled },
            { value: "fixed", label: "Fixed 4/6/8/10", disabled },
          ]}
        />
      </Field>
      <Field
        label="Turn timer"
        group
        hint={
          value.turnSeconds
            ? `Every move adds ${TIME_BONUS_SECONDS} seconds, up to a full turn. When time runs out the turn ends; three in a row and that player is out.`
            : "No time limit. Best for pass & play at one table."
        }
      >
        <Segmented
          label="Turn timer"
          value={value.turnSeconds ?? 0}
          onChange={(s) => onChange({ ...value, turnSeconds: s === 0 ? null : s })}
          options={TURN_SECONDS_OPTIONS.map((s) => ({ value: s ?? 0, label: s ? `${s}s` : "Off", disabled }))}
        />
      </Field>
    </div>
  );
}
