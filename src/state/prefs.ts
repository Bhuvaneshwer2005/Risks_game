// Per-device preferences, kept in localStorage. Every access is guarded:
// storage can be missing or blocked (private windows, embedded previews).

import { useSyncExternalStore } from "react";
import { DEFAULT_COLOR } from "../board/colors.ts";

export interface Prefs {
  name: string;
  color: string;
  muted: boolean;
}

const KEY = "risk.prefs.v2";
const listeners = new Set<() => void>();

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { name: "", color: DEFAULT_COLOR, muted: false, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    // fall through to defaults
  }
  return { name: "", color: DEFAULT_COLOR, muted: false };
}

let current = read();

export function getPrefs(): Prefs {
  return current;
}

export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // keep the in-memory value
  }
  for (const l of listeners) l();
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getPrefs,
  );
}
