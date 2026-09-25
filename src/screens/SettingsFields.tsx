import { TURN_SECONDS_OPTIONS, type GameSettings } from "../game/types.ts";
import { Field, Segmented } from "../ui/index.tsx";
import styles from "./screens.module.css";

/** The house-rule options a game can be started with. */
export function SettingsFields({ value, onChange, disabled }: { value: GameSettings; onChange: (v: GameSettings) => void; disabled?: boolean }) {
  return (
    <div className={styles.settings}>
      <Field label="Fortify">
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
      <Field label="Card sets">
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
      <Field label="Turn timer">
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
