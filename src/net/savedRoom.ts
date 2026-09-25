// The online room this browser is seated in, so a reload reconnects to it.
// Kept apart from online.ts so the home screen can check it without loading
// the Supabase client.

const ROOM_KEY = "risk.onlineRoom.v2";

export function getSavedRoom(): string | null {
  try {
    return localStorage.getItem(ROOM_KEY);
  } catch {
    return null;
  }
}

export function setSavedRoom(roomId: string | null): void {
  try {
    if (roomId) localStorage.setItem(ROOM_KEY, roomId);
    else localStorage.removeItem(ROOM_KEY);
  } catch {
    // no storage: reconnect-on-reload just won't work
  }
}
