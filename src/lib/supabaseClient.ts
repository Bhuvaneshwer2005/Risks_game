import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY - copy .env.example to .env.local");
}

export const supabase = createClient<Database>(url, publishableKey);

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
