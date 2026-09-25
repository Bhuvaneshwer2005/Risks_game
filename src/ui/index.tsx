// Shared UI building blocks. Styles live in ui.module.css.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { TERRITORIES } from "../game/mapData.ts";
import type { Card } from "../game/types.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { ToastContext, type ToastTone } from "./toast.ts";
import s from "./ui.module.css";

export { Icon } from "./Icon.tsx";
export type { IconName } from "./Icon.tsx";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

// ---------- Button ----------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  icon?: IconName;
};

export function Button({ variant = "secondary", size = "md", block, icon, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={cx(s.button, s[variant], size !== "md" && s[size], block && s.block, className)} {...rest}>
      {icon && <Icon name={icon} size={size === "sm" ? 15 : 17} />}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, ...rest }: { icon: IconName; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={s.iconButton} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

// ---------- Segmented ----------

export function Segmented<T extends string | number>(props: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div className={s.segmented} role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          disabled={o.disabled}
          className={cx(s.segment, o.value === props.value && s.segmentActive)}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Range ----------

export function RangeField(props: { min: number; max: number; value: number; onChange: (v: number) => void; label: string }) {
  const { min, max } = props;
  const value = Math.min(max, Math.max(min, props.value));
  return (
    <div className={s.range}>
      <Button size="sm" variant="ghost" onClick={() => props.onChange(min)} disabled={value === min} aria-label="Minimum">
        Min
      </Button>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-label={props.label}
        onChange={(e) => props.onChange(Number(e.target.value))}
        disabled={min === max}
      />
      <span className={s.rangeValue}>{value}</span>
      <Button size="sm" variant="ghost" onClick={() => props.onChange(max)} disabled={value === max} aria-label="Maximum">
        Max
      </Button>
    </div>
  );
}

// ---------- Modal ----------

export function Modal(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose?: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  useEffect(() => {
    ref.current?.focus();
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className={cx(s.modal, props.wide && s.modalWide)}>
        <div className={s.modalHeader}>
          <div>
            <h2 className={s.modalTitle}>{props.title}</h2>
            {props.subtitle && <p className={s.modalSubtitle}>{props.subtitle}</p>}
          </div>
          {onClose && <IconButton icon="close" label="Close" onClick={onClose} />}
        </div>
        {props.children}
      </div>
    </div>
  );
}

// ---------- Toasts ----------

interface ToastItem {
  id: number;
  text: ReactNode;
  tone: ToastTone;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const push = useCallback((text: ReactNode, tone: ToastTone = "info") => {
    const id = nextId.current++;
    setItems((prev) => [...prev.slice(-3), { id, text, tone }]);
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), tone === "error" ? 4200 : 2800);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className={s.toasts} aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx(s.toast, t.tone === "error" && s.toastError, t.tone === "gold" && s.toastGold)}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------- Dice ----------

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

export function Die({ value, side, lost, delay = 0 }: { value: number; side: "attack" | "defend"; lost?: boolean; delay?: number }) {
  return (
    <div
      className={cx(s.die, side === "attack" ? s.dieAttack : s.dieDefend, lost && s.dieLost)}
      style={{ animationDelay: `${delay}ms` }}
      role="img"
      aria-label={`${side === "attack" ? "Attacker" : "Defender"} rolled ${value}`}
    >
      {PIPS[value]?.map(([x, y], i) => <span key={i} className={s.pip} style={{ left: `${x}%`, top: `${y}%` }} />)}
    </div>
  );
}

export function DiceRow({ values, side, lostFlags }: { values: number[]; side: "attack" | "defend"; lostFlags: boolean[] }) {
  return (
    <div className={s.dieRow}>
      {values.map((v, i) => (
        <Die key={i} value={v} side={side} lost={lostFlags[i]} delay={i * 70} />
      ))}
    </div>
  );
}

// ---------- Cards ----------

const UNIT_ICON: Record<Card["type"], ReactNode> = {
  infantry: (
    <svg viewBox="0 0 40 40" width="38" height="38" fill="currentColor" aria-hidden="true">
      <circle cx="20" cy="9" r="5" />
      <path d="M13 17h14l-2 10h-3v9h-4v-9h-3z" />
      <path d="M28 14l6-6 1.5 1.5-6 6z" />
    </svg>
  ),
  cavalry: (
    <svg viewBox="0 0 40 40" width="38" height="38" fill="currentColor" aria-hidden="true">
      <path d="M8 30l3-9c1-3 4-5 7-5h6l4-5 3 1-2 5 4 3-2 3-4-2-2 3v6h-3v-5h-7l-2 5h-3z" />
      <circle cx="21" cy="9" r="3.5" />
    </svg>
  ),
  artillery: (
    <svg viewBox="0 0 40 40" width="38" height="38" fill="currentColor" aria-hidden="true">
      <path d="M6 22l22-10 2 4-18 9z" />
      <circle cx="14" cy="28" r="6" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="14" cy="28" r="1.8" />
      <path d="M20 27h12v3H20z" />
    </svg>
  ),
  wild: (
    <svg viewBox="0 0 40 40" width="38" height="38" fill="currentColor" aria-hidden="true">
      <path d="M20 4l4.6 10.4L36 15.6l-8.6 7.6L30 34.6 20 28.8 10 34.6l2.6-11.4L4 15.6l11.4-1.2z" />
    </svg>
  ),
};

export function CardFace(props: { card: Card; selected?: boolean; ownedBonus?: boolean; onClick?: () => void; disabled?: boolean }) {
  const { card } = props;
  const body = (
    <>
      <span className={s.cardType}>{card.type}</span>
      <span className={s.cardUnit}>{UNIT_ICON[card.type]}</span>
      <span className={s.cardName}>{card.territory ? TERRITORIES[card.territory].name : "Any unit"}</span>
    </>
  );
  const className = cx(s.card, props.selected && s.cardSelected, props.ownedBonus && s.cardOwned);
  return props.onClick ? (
    <button type="button" className={className} onClick={props.onClick} disabled={props.disabled} aria-pressed={props.selected}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

// ---------- Small bits ----------

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <span className={s.dot} style={{ background: color, width: size, height: size }} />;
}

export function Panel({ className, children, ...rest }: { className?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx(s.panel, className)} {...rest}>
      {children}
    </div>
  );
}

/** A countdown ring for the turn timer. `deadline` is in local-clock ms. */
export function TimerRing({ deadline, total, size = 34 }: { deadline: number; total: number; size?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, deadline - now);
  const frac = Math.min(1, left / total);
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const urgent = left < 10_000;
  return (
    <div className={cx(s.timer, urgent && s.timerUrgent)} style={{ width: size, height: size }} aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,170,210,0.18)" strokeWidth="3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={urgent ? "var(--danger)" : "var(--gold)"}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.25s linear" }}
        />
      </svg>
      <span className={s.timerText}>{Math.ceil(left / 1000)}</span>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={s.field}>
      <span className={s.label}>{label}</span>
      {children}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(s.input, props.className)} />;
}

export function ColorSwatches(props: { colors: readonly { hex: string; name: string }[]; value: string; taken?: string[]; onChange: (hex: string) => void }) {
  return (
    <div className={s.swatches} role="radiogroup" aria-label="Color">
      {props.colors.map((c) => (
        <button
          key={c.hex}
          type="button"
          role="radio"
          aria-checked={c.hex === props.value}
          aria-label={c.name}
          title={c.name}
          disabled={props.taken?.includes(c.hex) && c.hex !== props.value}
          className={cx(s.swatch, c.hex === props.value && s.swatchActive)}
          style={{ background: c.hex }}
          onClick={() => props.onChange(c.hex)}
        />
      ))}
    </div>
  );
}
