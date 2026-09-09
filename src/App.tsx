import { useEffect, useState } from "react";
import { Landing } from "./components/Landing";
import { Lobby } from "./components/Lobby";
import { GameView } from "./components/GameView";
import { ensureSignedIn, supabase } from "./lib/supabaseClient";
import { useGameRoom } from "./hooks/useGameRoom";
import "./App.css";

const STORAGE_KEY = "risk-online-room";

// useGameRoom opens one realtime channel per call - it's called exactly
// once here, with the live data threaded down as props, rather than having
// Lobby/GameView each subscribe independently (which briefly raced two
// channels for the same room under StrictMode's double-mount and crashed
// with "cannot add postgres_changes callbacks... after subscribe()").
function RoomRouter({ roomId, myUserId }: { roomId: string; myUserId: string }) {
  const roomData = useGameRoom(roomId, myUserId);
  if (roomData.loading || !roomData.room) return <div className="app-loading">Loading…</div>;
  return roomData.room.status === "lobby" ? (
    <Lobby roomId={roomId} myUserId={myUserId} data={roomData} />
  ) : (
    <GameView roomId={roomId} myUserId={myUserId} data={roomData} />
  );
}

function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);

  useEffect(() => {
    ensureSignedIn().then(setUserId);
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setRoomId(saved);
  }, []);

  useEffect(() => {
    if (roomId) localStorage.setItem(STORAGE_KEY, roomId);
    else localStorage.removeItem(STORAGE_KEY);
  }, [roomId]);

  // Cheap safety net: if the saved room turns out not to exist (or this
  // user isn't in it), fall back to the landing page instead of showing a
  // permanent loading spinner.
  useEffect(() => {
    if (!roomId) return;
    supabase
      .from("rooms")
      .select("id")
      .eq("id", roomId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) setRoomId(null);
      });
  }, [roomId]);

  if (!userId) return <div className="app-loading">Connecting…</div>;

  if (!roomId) {
    return <Landing onEnter={(id) => setRoomId(id)} />;
  }

  return <RoomRouter roomId={roomId} myUserId={userId} />;
}

export default App;
