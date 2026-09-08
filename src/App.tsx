import { useMemo, useState } from "react";
import { Map } from "./components/Map";
import { createGame } from "./game/engine";
import type { TerritoryId } from "./game/mapData";
import "./App.css";

// Local-only smoke test for the board renderer: a 3-player game generated
// entirely client-side (no Supabase yet). Confirms the map, territory
// ownership colors, and army counts all render correctly before wiring in
// realtime multiplayer.
const DEMO_PLAYERS = [
  { id: "p1", name: "Amara", color: "#e63946" },
  { id: "p2", name: "Kenji", color: "#2a9d8f" },
  { id: "p3", name: "Priya", color: "#f4a261" },
];

function App() {
  const [game] = useState(() => createGame({ players: DEMO_PLAYERS }));
  const [selected, setSelected] = useState<TerritoryId | null>(null);

  const playerColors = useMemo(
    () => Object.fromEntries(DEMO_PLAYERS.map((p) => [p.id, p.color])),
    [],
  );

  return (
    <div className="app-shell">
      <h1>Risk - board preview</h1>
      <p>
        {selected
          ? `Selected: ${selected} (owner ${game.territories[selected].owner}, ${game.territories[selected].armies} armies)`
          : "Click a territory"}
      </p>
      <Map territories={game.territories} playerColors={playerColors} selectedTerritory={selected} onSelectTerritory={setSelected} />
    </div>
  );
}

export default App;
