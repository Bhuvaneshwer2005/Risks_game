import { useEffect, useState, useSyncExternalStore } from "react";
import type { GameConnection } from "./net/connection.ts";
import { LocalConnection } from "./net/local.ts";
import type { OnlineConnection } from "./net/online.ts";
import { getSavedRoom } from "./net/savedRoom.ts";
import { getPrefs } from "./state/prefs.ts";
import { Home } from "./screens/Home.tsx";
import { LocalSetup } from "./screens/LocalSetup.tsx";
import { Lobby } from "./screens/Lobby.tsx";
import { GameScreen } from "./screens/game/GameScreen.tsx";
import { ToastProvider } from "./ui/index.tsx";
import { useToast } from "./ui/toast.ts";
import styles from "./screens/screens.module.css";

type Route =
  | { name: "home" }
  | { name: "local-setup" }
  | { name: "local"; connection: LocalConnection }
  | { name: "online"; connection: OnlineConnection };

// Online play (and the Supabase client) loads only when it's needed.
const loadOnline = () => import("./net/online.ts");

function roomCodeFromUrl(): string | undefined {
  const code = new URLSearchParams(location.search).get("room");
  return code ? code.toUpperCase().slice(0, 6) : undefined;
}

function clearRoomFromUrl() {
  if (location.search) history.replaceState(null, "", location.pathname);
}

function OnlineRoom({ connection, onExit }: { connection: OnlineConnection; onExit: () => void }) {
  const snap = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const toast = useToast();
  useEffect(() => {
    if (!snap.error) return;
    toast(snap.error, "error");
    // The room is really gone (not just a network hiccup): back to the home screen.
    if (snap.view === "connecting" && !getSavedRoom()) onExit();
  }, [snap.error, snap.view, toast, onExit]);
  if (snap.view === "lobby") return <Lobby connection={connection} onExit={onExit} />;
  if (snap.view === "game") return <GameScreen connection={connection as GameConnection} onExit={onExit} />;
  return <div className={styles.connecting}>Connecting to the war room…</div>;
}

function Router() {
  const toast = useToast();
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [busy, setBusy] = useState(false);
  const [initialCode] = useState(roomCodeFromUrl);

  // Reconnect to an online game after a reload.
  useEffect(() => {
    if (!getSavedRoom()) return;
    let cancelled = false;
    loadOnline()
      .then((m) => m.OnlineConnection.resume())
      .then((connection) => {
        if (connection && !cancelled) setRoute({ name: "online", connection });
        else connection?.dispose();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const goHome = () => {
    if (route.name === "local" || route.name === "online") route.connection.dispose();
    setRoute({ name: "home" });
  };

  const goOnline = async (open: () => Promise<OnlineConnection>) => {
    setBusy(true);
    try {
      const connection = await open();
      clearRoomFromUrl();
      setRoute({ name: "online", connection });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  switch (route.name) {
    case "home":
      return (
        <Home
          initialCode={initialCode}
          canResume={LocalConnection.hasSaved()}
          onlineAvailable
          busy={busy}
          onCreateOnline={() => void goOnline(async () => (await loadOnline()).OnlineConnection.create(getPrefs().name.trim(), getPrefs().color))}
          onJoinOnline={(code) => void goOnline(async () => (await loadOnline()).OnlineConnection.join(code, getPrefs().name.trim(), getPrefs().color))}
          onPlayLocal={() => setRoute({ name: "local-setup" })}
          onResumeLocal={() => {
            const connection = LocalConnection.restore();
            if (connection) setRoute({ name: "local", connection });
            else toast("That saved game couldn't be loaded.", "error");
          }}
        />
      );
    case "local-setup":
      return <LocalSetup onBack={goHome} onStart={(players, settings) => setRoute({ name: "local", connection: LocalConnection.create(players, settings) })} />;
    case "local":
      return <GameScreen connection={route.connection} onExit={goHome} />;
    case "online":
      return <OnlineRoom key={route.connection.roomId} connection={route.connection} onExit={goHome} />;
  }
}

export default function App() {
  return (
    <ToastProvider>
      <Router />
    </ToastProvider>
  );
}
