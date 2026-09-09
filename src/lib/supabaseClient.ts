import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// The Supabase URL and publishable ("anon") key are not secrets - they're
// meant to ship in client-side code (that's the whole point of the
// Row Level Security policies guarding every table). Hardcoding them as
// defaults means the app works out of the box on any static host without
// needing build-time environment variables configured first; env vars
// still override them for pointing a local checkout at a different project.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://qshfimgyavoxutecihbw.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_X4bEafQ5atcRXbxDSdyLrg_Ma-wh2zd";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Every player is anonymous - a room code plus a display name is the whole
// identity model for v1, no email/password signup. Idempotent: if a session
// already exists (page reload), reuse it instead of minting a new player.
export async function ensureSignedIn(): Promise<string> {
  const { data: existing } = await supabase.auth.getSession();
  if (existing.session?.user.id) return existing.session.user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!data.user) throw new Error("Anonymous sign-in returned no user");
  return data.user.id;
}
