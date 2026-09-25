import { createClient } from "@supabase/supabase-js";

// The project URL and publishable key are public by design (Row Level
// Security guards the data), so they ship as defaults; env vars override them
// to point a checkout at a different project.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://qshfimgyavoxutecihbw.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_X4bEafQ5atcRXbxDSdyLrg_Ma-wh2zd";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

/**
 * Every player is anonymous: a display name plus a room code is the whole
 * identity. Reuses the existing session on reload so you keep your seat.
 */
export async function ensureSignedIn(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id) return data.session.user.id;
  const { data: signedIn, error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error("Couldn't connect to the game server. Check your connection and try again.");
  if (!signedIn.user) throw new Error("Sign-in returned no user");
  return signedIn.user.id;
}

export interface GameResponse {
  ok: true;
  serverTime: number;
  [key: string]: unknown;
}

/** Calls one operation of the `game` Edge Function. Rejects with the server's message on failure. */
export async function callGame<T extends object = object>(op: string, body: Record<string, unknown> = {}): Promise<T & GameResponse & { latency: number }> {
  await ensureSignedIn();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const sent = Date.now();
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/game`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ op, ...body }),
    });
  } catch {
    throw new Error("Can't reach the game server. Check your connection.");
  }
  const json = (await res.json().catch(() => ({}))) as Partial<GameResponse> & { error?: string };
  if (!res.ok || json.ok !== true) throw new Error(json.error ?? `The server couldn't do that (${res.status})`);
  return { ...(json as T & GameResponse), latency: Date.now() - sent };
}
