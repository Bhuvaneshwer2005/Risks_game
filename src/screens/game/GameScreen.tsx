import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ADJACENCY, ALL_TERRITORY_IDS, CONTINENTS, type TerritoryId } from "../../game/mapData.ts";
import { allValidSets } from "../../game/cards.ts";
import { MAX_TIMEOUT_STRIKES, SETUP_TIME_MULTIPLIER } from "../../game/engine.ts";
import { attackTargets, canAttackFrom, fortifyTargets, playerSummaries, territoriesOf } from "../../game/selectors.ts";
import { CLAIM_SECONDS, type GameAction, type GameEvent, type Placements, type PlayerId, type PlayerState, type PublicState } from "../../game/types.ts";
import { BoardMap, type BoardArrow, type BoardMapProps } from "../../board/BoardMap.tsx";
import { webglAvailable } from "../../board/webgl.ts";
import type { GameConnection } from "../../net/connection.ts";
import { sfx } from "../../audio/sfx.ts";
import { setPrefs, usePrefs } from "../../state/prefs.ts";
import { Button, CardFace, Dot, Icon, IconButton, Modal, TimerRing } from "../../ui/index.tsx";
import { useToast } from "../../ui/toast.ts";
import { RulesModal } from "../RulesModal.tsx";
import { ActionDock, type DockMode } from "./ActionDock.tsx";
import { DiceTray } from "./DiceTray.tsx";
import { GameLog } from "./GameLog.tsx";
import { TradeModal } from "./TradeModal.tsx";
import { StatsView, VictoryScreen } from "./Victory.tsx";
import { playerName } from "./describe.ts";
import styles from "./game.module.css";
import victoryStyles from "./victory.module.css";

type Battle = Extract<GameEvent, { type: "battle" }>;

// three.js is large, so the 3D board loads in its own chunk when a game opens.
const Board3D = lazy(() => import("../../board/Board3D.tsx"));
const WEBGL = webglAvailable();

/** The 3D board when the player wants it and the browser supports it, otherwise the 2D map. */
function GameBoard(props: BoardMapProps & { prefer3d: boolean }) {
  const { prefer3d, ...board } = props;
  const [failed, setFailed] = useState(false);
  if (!prefer3d || !WEBGL || failed) return <BoardMap {...board} />;
  return (
    <Suspense fallback={<div className={styles.boardLoading} />}>
      <Board3D {...board} onUnsupported={() => setFailed(true)} />
    </Suspense>
  );
}

export function GameScreen({ connection, onExit }: { connection: GameConnection; onExit: () => void }) {
  const snap = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  if (!snap.game) {
    return <div className={styles.loading}>Connecting…</div>;
  }
  return <GameView connection={connection} game={snap.game} onExit={onExit} />;
}

const PHASES = [
  { id: "reinforce", label: "Reinforce" },
  { id: "attack", label: "Attack" },
  { id: "fortify", label: "Fortify" },
] as const;

function GameView({ connection, game, onExit }: { connection: GameConnection; game: PublicState; onExit: () => void }) {
  const snap = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const { me, hand, mode: connectionMode, clockOffset } = snap;
  const toast = useToast();
  const prefs = usePrefs();

  // ---------- local UI state ----------
  const [selection, setSelection] = useState<{ from: TerritoryId | null; to: TerritoryId | null }>({ from: null, to: null });
  const [draftState, setDraftState] = useState<{ key: string; placements: Placements }>({ key: "", placements: {} });
  const [busy, setBusy] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [kickTarget, setKickTarget] = useState<PlayerState | null>(null);
  const [resultsHidden, setResultsHidden] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [panel, setPanel] = useState<"cards" | "log">("cards");
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1500);
  // Phones hide the player list until asked for.
  const [playersOpen, setPlayersOpen] = useState(false);
  const [dismissedCapture, setDismissedCapture] = useState<string | null>(null);
  const [battle, setBattle] = useState<{ battle: Battle; key: number } | null>(null);
  const [arrow, setArrow] = useState<BoardArrow | null>(null);
  const [flash, setFlash] = useState<{ id: TerritoryId; key: number } | null>(null);
  const [banner, setBanner] = useState<{ text: string; color: string; key: number } | null>(null);

  const meState = game.players.find((p) => p.id === me) ?? null;
  const isMyTurn = game.status === "playing" && !!me && game.currentPlayer === me;
  const claiming = game.status === "setup" && game.phase === "claim";
  const isMyPick = claiming && !!me && game.currentPlayer === me;
  const current = game.players.find((p) => p.id === game.currentPlayer) ?? null;
  const unclaimed = useMemo(() => ALL_TERRITORY_IDS.filter((t) => game.territories[t].owner === null), [game.territories]);

  // ---------- what the player can do right now ----------
  const mode: DockMode = useMemo(() => {
    if (game.status === "finished") return { kind: "over" };
    if (game.status === "setup") {
      if (game.phase === "claim") {
        if (current && current.id === me && meState?.status === "active") return { kind: "claim", left: unclaimed.length };
        return current ? { kind: "claim-wait", player: current, left: unclaimed.length } : { kind: "over" };
      }
      const pool = me ? (game.setupPools[me] ?? 0) : 0;
      if (meState?.status === "active" && pool > 0) return { kind: "setup-place", pool };
      const humans = game.players.filter((p) => !p.neutral && p.status === "active");
      return { kind: "setup-wait", ready: humans.filter((p) => (game.setupPools[p.id] ?? 0) === 0).length, total: humans.length };
    }
    if (connectionMode === "online" && meState && meState.status !== "active") return { kind: "out", status: meState.status };
    if (!isMyTurn) return current ? { kind: "wait", player: current } : { kind: "over" };
    if (game.eliminationTrade) {
      return { kind: "trade", forced: true, reason: "You took a defeated player's cards: trade down to 4 or fewer before you continue." };
    }
    if (game.phase === "reinforce" && hand.length >= 5) {
      return { kind: "trade", forced: true, reason: "You hold 5 or more cards, so you must trade in a set before placing armies." };
    }
    if (game.reinforcements > 0) return { kind: "place", pool: game.reinforcements };
    if (game.phase === "attack") return { kind: "attack" };
    return { kind: "fortify" };
  }, [game, me, meState, isMyTurn, current, hand.length, unclaimed.length, connectionMode]);

  const placing = mode.kind === "place" || mode.kind === "setup-place";
  const pool = placing ? mode.pool : 0;
  const draftKey = `${game.status}-${game.turnNumber}-${game.phase}-${game.setsTraded}-${me}`;
  const draft = placing && draftState.key === draftKey ? draftState.placements : {};
  const draftTotal = Object.values(draft).reduce((a, b) => a + (b ?? 0), 0);

  // Selection is only kept while it's still legal (the board changes under it).
  const rule = game.settings.fortifyRule;
  const from =
    selection.from &&
    me &&
    ((mode.kind === "attack" && canAttackFrom(game, me, selection.from)) ||
      (mode.kind === "fortify" && game.territories[selection.from].owner === me && game.territories[selection.from].armies > 1))
      ? selection.from
      : null;
  const targets = useMemo(() => {
    if (!from || !me) return new Set<TerritoryId>();
    return new Set(mode.kind === "attack" ? attackTargets(game, from) : mode.kind === "fortify" ? fortifyTargets(game, rule, me, from) : []);
  }, [from, me, mode.kind, game, rule]);
  const to = selection.to && targets.has(selection.to) ? selection.to : null;

  const focusable = useMemo(() => {
    if (!me) return null;
    if (mode.kind === "claim") return new Set(unclaimed);
    if (placing) return new Set(territoriesOf(game, me));
    if (mode.kind === "attack" && !from) return new Set(territoriesOf(game, me).filter((t) => canAttackFrom(game, me, t)));
    if (mode.kind === "attack" && from) return new Set([from, ...targets]);
    if (mode.kind === "fortify" && !from) {
      return new Set(territoriesOf(game, me).filter((t) => game.territories[t].armies > 1 && fortifyTargets(game, rule, me, t).length > 0));
    }
    if (mode.kind === "fortify" && from) return new Set([from, ...targets]);
    return null;
  }, [me, placing, mode.kind, from, targets, game, rule, unclaimed]);

  const pendingKey = game.pendingCapture ? `${game.turnNumber}-${game.pendingCapture.from}-${game.pendingCapture.to}` : null;
  const captureDismissed = pendingKey !== null && pendingKey === dismissedCapture;
  const canTrade = allValidSets(hand).length > 0 && ((isMyTurn && game.phase === "reinforce") || game.eliminationTrade);
  const tradeForced = mode.kind === "trade";

  // ---------- actions ----------
  const run = useCallback(
    async (action: GameAction) => {
      setBusy(true);
      try {
        await connection.act(action);
        return true;
      } catch (e) {
        sfx.error();
        toast((e as Error).message, "error");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [connection, toast],
  );

  const setDraft = (placements: Placements) => setDraftState({ key: draftKey, placements });

  const claim = (id: TerritoryId) => {
    if (busy || game.territories[id].owner !== null) return;
    sfx.place();
    void run({ type: "claim", territory: id });
  };

  // Random, but next to territories already held when possible.
  const pickForMe = () => {
    if (!me) return;
    const near = unclaimed.filter((t) => ADJACENCY[t].some((n) => game.territories[n].owner === me));
    const choices = near.length ? near : unclaimed;
    if (choices.length) claim(choices[Math.floor(Math.random() * choices.length)]);
  };

  const onTerritoryClick = (id: TerritoryId, mods: { shift: boolean }) => {
    if (!me) return;
    if (mode.kind === "claim") return claim(id);
    const mine = game.territories[id].owner === me;
    if (placing) {
      if (!mine) return;
      const left = pool - draftTotal;
      if (left <= 0) {
        toast("All armies placed: confirm, or right-click to take some back.");
        return;
      }
      sfx.place();
      setDraft({ ...draft, [id]: (draft[id] ?? 0) + Math.min(left, mods.shift ? 5 : 1) });
      return;
    }
    if (mode.kind === "attack") {
      if (mine) {
        if (id === from) setSelection({ from: null, to: null });
        else if (canAttackFrom(game, me, id)) {
          sfx.click();
          setSelection({ from: id, to: null });
        }
      } else if (from && targets.has(id)) {
        sfx.click();
        setSelection({ from, to: id });
      }
      return;
    }
    if (mode.kind === "fortify" && mine) {
      if (id === from) setSelection({ from: null, to: null });
      else if (from && targets.has(id)) setSelection({ from, to: id });
      else if (game.territories[id].armies > 1) setSelection({ from: id, to: null });
      sfx.click();
    }
  };

  const onTerritoryContextMenu = (id: TerritoryId) => {
    if (!placing || !draft[id]) return;
    const next = { ...draft, [id]: (draft[id] ?? 0) - 1 };
    if (!next[id]) delete next[id];
    setDraft(next);
  };

  const autoPlace = () => {
    if (!me) return;
    const mine = territoriesOf(game, me);
    const borders = mine.filter((t) => ADJACENCY[t].some((n) => game.territories[n].owner !== me));
    const spots = borders.length ? borders : mine;
    const next = { ...draft };
    for (let i = draftTotal; i < pool; i++) {
      const t = spots[Math.floor(Math.random() * spots.length)];
      next[t] = (next[t] ?? 0) + 1;
    }
    setDraft(next);
  };

  const confirmPlacement = async () => {
    const ok = await run(mode.kind === "setup-place" ? { type: "setupPlace", placements: draft } : { type: "reinforce", placements: draft });
    if (ok) setDraftState({ key: "", placements: {} });
  };

  const trade = async (cardIds: number[]) => {
    if (await run({ type: "trade", cardIds })) {
      sfx.trade();
      setTradeOpen(false);
    }
  };

  const kick = async (p: PlayerState) => {
    setKickTarget(null);
    try {
      await connection.kickPlayer(p.id);
    } catch (e) {
      sfx.error();
      toast((e as Error).message, "error");
    }
  };

  // ---------- live events → animations ----------
  const gameRef = useRef(game);
  const meRef = useRef(me);
  useEffect(() => {
    gameRef.current = game;
    meRef.current = me;
  });
  const lastSeq = useRef(snap.feed.at(-1)?.seq ?? 0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
    const handle = () => {
      const { feed, mode: m } = connection.getSnapshot();
      const fresh = feed.filter((f) => f.seq > lastSeq.current);
      if (fresh.length === 0) return;
      lastSeq.current = fresh.at(-1)!.seq;
      const g = connection.getSnapshot().game ?? gameRef.current;
      for (const { seq, event } of fresh) {
        switch (event.type) {
          case "claimed":
            if (event.player !== meRef.current || m === "local") sfx.click();
            setFlash({ id: event.territory, key: seq });
            break;
          case "claimsComplete":
            sfx.turn();
            setBanner({ text: "Deploy your armies", color: "#f2cf78", key: seq });
            later(() => setBanner((b) => (b?.key === seq ? null : b)), 1700);
            break;
          case "battle":
            sfx.dice();
            setBattle({ battle: event, key: seq });
            setArrow({ from: event.from, to: event.to, tone: "attack" });
            later(() => setArrow(null), 1300);
            later(() => setBattle((b) => (b?.key === seq ? null : b)), 2800);
            if (event.captured) {
              later(() => sfx.capture(), 250);
              setFlash({ id: event.to, key: seq });
            }
            break;
          case "fortified":
          case "movedIn":
            setArrow({ from: event.from, to: event.to, tone: "move" });
            later(() => setArrow(null), 1300);
            break;
          case "turnStarted": {
            const p = g.players.find((x) => x.id === event.player);
            const mine = event.player === meRef.current;
            if (mine || m === "local") sfx.turn();
            setBanner({ text: mine && m === "online" ? "Your turn" : `${p?.name ?? "Next"}'s turn`, color: p?.color ?? "#fff", key: seq });
            later(() => setBanner((b) => (b?.key === seq ? null : b)), 1700);
            break;
          }
          case "traded":
            if (event.player !== meRef.current || m === "local") toast(`${playerName(g, event.player)} traded cards for +${event.armies}`, "gold");
            break;
          case "eliminated":
            toast(`${playerName(g, event.by)} eliminated ${playerName(g, event.player)}!`, "gold");
            break;
          case "timedOut":
            toast(`${playerName(g, event.player)} ran out of time`, "error");
            break;
          case "resigned":
            toast(`${playerName(g, event.player)} left the war`);
            break;
          case "kicked":
            if (event.player === meRef.current && m === "online") toast("The host removed you from the game", "error");
            else toast(`${playerName(g, event.player)} was removed from the game`);
            break;
          case "gameOver":
            sfx.victory();
            break;
        }
      }
    };
    const unsubscribe = connection.subscribe(handle);
    const pending = timers.current;
    return () => {
      unsubscribe();
      pending.forEach((t) => window.clearTimeout(t));
    };
  }, [connection, toast]);

  // Tab title nudges an online player whose turn (or pick) it is.
  const myMove = isMyTurn || isMyPick;
  useEffect(() => {
    document.title = myMove && connectionMode === "online" ? `● Your ${isMyPick ? "pick" : "turn"} · Risk` : "Risk · Global Domination";
    return () => {
      document.title = "Risk · Global Domination";
    };
  }, [myMove, isMyPick, connectionMode]);

  // Turn timer: when it runs out, claim the timeout (locally, or online if it's our turn to watch the clock).
  const deadline = game.turnDeadline !== null ? game.turnDeadline - clockOffset : null;
  useEffect(() => {
    if (deadline === null || game.status === "finished") return;
    const extra = connectionMode === "local" ? 0 : timeoutWatchDelay(game, me);
    if (extra === null) return;
    const wait = Math.max(0, deadline - Date.now()) + extra;
    const id = window.setTimeout(() => {
      void connection.act({ type: "claimTimeout" }).catch(() => {});
    }, wait);
    return () => window.clearTimeout(id);
  }, [deadline, game, me, connection, connectionMode]);

  // "+15s" pops up by the timer when a move buys more time on the same turn.
  const [clock, setClock] = useState({ turn: game.turnNumber, player: game.currentPlayer, deadline: game.turnDeadline, bonus: null as { seconds: number; key: number } | null });
  if (clock.deadline !== game.turnDeadline || clock.turn !== game.turnNumber || clock.player !== game.currentPlayer) {
    const sameTurn = clock.turn === game.turnNumber && clock.player === game.currentPlayer && game.status === "playing";
    const gained = sameTurn && clock.deadline !== null && game.turnDeadline !== null ? game.turnDeadline - clock.deadline : 0;
    setClock({
      turn: game.turnNumber,
      player: game.currentPlayer,
      deadline: game.turnDeadline,
      bonus: gained >= 1000 ? { seconds: Math.round(gained / 1000), key: game.turnDeadline ?? 0 } : sameTurn ? clock.bonus : null,
    });
  }

  // Esc clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelection({ from: null, to: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const summaries = useMemo(() => playerSummaries(game), [game]);
  const insets = useMemo(
    () => (window.innerWidth > 820 ? { top: 84, left: 272, right: 16, bottom: 150 } : { top: 112, left: 8, right: 8, bottom: 200 }),
    [],
  );
  const winner = game.winner ? game.players.find((p) => p.id === game.winner) : null;
  const ownedSet = useMemo(() => new Set(me ? territoriesOf(game, me) : []), [game, me]);
  const isHost = connectionMode === "local" || (!!me && snap.lobby?.hostId === me);
  const canKick = (p: PlayerState) =>
    game.status !== "finished" && isHost && !p.neutral && p.status === "active" && (connectionMode === "local" || p.id !== me);

  const timerTotal = !game.settings.turnSeconds
    ? 0
    : claiming
      ? CLAIM_SECONDS * 1000
      : game.settings.turnSeconds * (game.status === "setup" ? SETUP_TIME_MULTIPLIER : 1) * 1000;

  const leaveGame = async () => {
    setLeaveOpen(false);
    if (connectionMode === "online" && game.status !== "finished" && meState?.status === "active") await run({ type: "resign" });
    await connection.leave();
    onExit();
  };

  const statusTag = (p: PlayerState) => {
    if (p.neutral) return "neutral";
    if (p.status === "eliminated") return "out";
    if (p.status === "kicked") return "removed";
    if (p.status === "resigned") return p.timeoutStrikes >= MAX_TIMEOUT_STRIKES ? "timed out" : "left";
    return null;
  };

  const setupTag = (p: PlayerState) => {
    if (game.status !== "setup" || p.neutral || p.status !== "active") return null;
    if (claiming) return p.id === game.currentPlayer ? "picking" : null;
    return (game.setupPools[p.id] ?? 0) === 0 ? "ready" : "placing";
  };

  return (
    <div className={styles.screen}>
      <div className={styles.board}>
        <GameBoard
          prefer3d={prefs.board3d}
          territories={game.territories}
          players={game.players}
          selected={from}
          targets={targets}
          focusable={focusable}
          draft={draft}
          arrow={to && from ? { from, to, tone: mode.kind === "attack" ? "attack" : "move" } : arrow}
          flash={flash}
          insets={insets}
          onTerritoryClick={onTerritoryClick}
          onTerritoryContextMenu={onTerritoryContextMenu}
        />
      </div>

      {/* ---------- top bar ---------- */}
      <header className={`${styles.topBar} ${styles.glass}`}>
        <div className={styles.brand}>
          <span className={styles.wordmark}>RISK</span>
          <span className={styles.roomTag}>{connectionMode === "local" ? "Pass & play" : snap.lobby ? `Room ${snap.lobby.code}` : "Online"}</span>
        </div>
        <div className={styles.turn}>
          {claiming ? (
            <>
              <span className={styles.turnText}>
                <span className={styles.phaseLabel}>Claiming</span>
                {current && (
                  <>
                    <Dot color={current.color} /> {current.name}
                    {current.id === me && connectionMode === "online" && <em className={styles.you}>you</em>}
                  </>
                )}
              </span>
              <span className={styles.claimLeft}>{unclaimed.length} left</span>
            </>
          ) : game.status === "setup" ? (
            <span className={styles.turnText}>Deployment</span>
          ) : winner ? (
            <span className={styles.turnText}>
              <Dot color={winner.color} /> {winner.name} wins
            </span>
          ) : current ? (
            <>
              <span className={styles.turnText}>
                <Dot color={current.color} /> {current.name}
                {current.id === me && connectionMode === "online" && <em className={styles.you}>you</em>}
              </span>
              <ol className={styles.phases}>
                {PHASES.map((ph) => (
                  <li key={ph.id} className={game.phase === ph.id ? styles.phaseActive : undefined}>
                    {ph.label}
                  </li>
                ))}
              </ol>
            </>
          ) : null}
          {deadline !== null && timerTotal > 0 && game.status !== "finished" && (
            <span className={styles.timerWrap}>
              <TimerRing key={deadline} deadline={deadline} total={timerTotal} />
              {clock.bonus && (
                <span key={clock.bonus.key} className={styles.timeBonus} aria-live="polite">
                  +{clock.bonus.seconds}s
                </span>
              )}
            </span>
          )}
        </div>
        <div className={styles.topActions}>
          {WEBGL && (
            <IconButton
              icon={prefs.board3d ? "map" : "cube"}
              label={prefs.board3d ? "Switch to the flat map" : "Switch to the 3D map"}
              onClick={() => setPrefs({ board3d: !prefs.board3d })}
            />
          )}
          <span className={styles.mobileOnly}>
            <IconButton icon={playersOpen ? "close" : "users"} label={playersOpen ? "Hide players" : "Show players"} onClick={() => setPlayersOpen((o) => !o)} />
          </span>
          <IconButton icon="book" label="Rules" onClick={() => setRulesOpen(true)} />
          <IconButton icon={prefs.muted ? "soundOff" : "soundOn"} label={prefs.muted ? "Unmute" : "Mute"} onClick={() => setPrefs({ muted: !prefs.muted })} />
          <IconButton icon={panelOpen ? "close" : "cards"} label={panelOpen ? "Hide cards and log" : "Show cards and log"} onClick={() => setPanelOpen((o) => !o)} />
          <IconButton icon="flag" label="Leave game" onClick={() => setLeaveOpen(true)} />
        </div>
      </header>

      {/* ---------- players ---------- */}
      <aside className={`${styles.players} ${styles.glass} ${playersOpen ? styles.playersOpen : ""}`} aria-label="Players">
        {game.players.map((p) => {
          const s = summaries[p.id];
          const isCurrent = p.id === game.currentPlayer;
          const out = p.status !== "active";
          const tag = statusTag(p);
          const setup = setupTag(p);
          return (
            <div key={p.id} className={`${styles.player} ${isCurrent ? styles.playerCurrent : ""} ${out ? styles.playerOut : ""}`}>
              <span className={styles.playerBar} style={{ background: p.color }} />
              <div className={styles.playerMain}>
                <div className={styles.playerName}>
                  {p.name}
                  {p.id === me && connectionMode === "online" && <em className={styles.you}>you</em>}
                  {tag && <em className={styles.tag}>{tag}</em>}
                  {setup && <em className={setup === "picking" ? styles.you : styles.tag}>{setup}</em>}
                </div>
                <div className={styles.playerStats}>
                  <span title="Territories">{s.territories} terr.</span>
                  <span title="Armies">{s.armies} armies</span>
                  {!p.neutral && <span title="Cards">{game.cardCounts[p.id] ?? 0} cards</span>}
                </div>
                {/* The neutral army never collects continent bonuses. */}
                {s.continents.length > 0 && !p.neutral && (
                  <div className={styles.continentChips}>
                    {s.continents.map((c) => (
                      <span key={c} style={{ borderColor: p.color }}>
                        {CONTINENTS[c].name} +{CONTINENTS[c].bonusArmies}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {canKick(p) && (
                <button type="button" className={styles.kick} aria-label={`Remove ${p.name}`} title={`Remove ${p.name}`} onClick={() => setKickTarget(p)}>
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
          );
        })}
      </aside>

      {/* ---------- cards & log ---------- */}
      {panelOpen && (
        <aside className={`${styles.side} ${styles.glass}`}>
          <div className={styles.tabs} role="tablist">
            <button role="tab" aria-selected={panel === "cards"} className={panel === "cards" ? styles.tabActive : undefined} onClick={() => setPanel("cards")}>
              Cards <span className={styles.count}>{hand.length}</span>
            </button>
            <button role="tab" aria-selected={panel === "log"} className={panel === "log" ? styles.tabActive : undefined} onClick={() => setPanel("log")}>
              Game log
            </button>
          </div>
          {panel === "cards" ? (
            <div className={styles.cardsPanel}>
              {connectionMode === "local" && meState && (
                <p className={styles.muted}>
                  <Dot color={meState.color} /> {meState.name}'s hand
                </p>
              )}
              {hand.length === 0 ? (
                <p className={styles.empty}>No cards yet. Conquer at least one territory in a turn to earn a card.</p>
              ) : (
                <div className={styles.handGrid}>
                  {hand.map((c) => (
                    <CardFace key={c.id} card={c} ownedBonus={!!c.territory && ownedSet.has(c.territory)} />
                  ))}
                </div>
              )}
              {canTrade && !tradeForced && (
                <Button variant="primary" icon="cards" block onClick={() => setTradeOpen(true)}>
                  Trade a set
                </Button>
              )}
            </div>
          ) : (
            <GameLog feed={snap.feed} game={game} showKicker={connectionMode === "online"} />
          )}
        </aside>
      )}

      {/* ---------- action dock ---------- */}
      {me && mode.kind !== "over" && (
        <div className={styles.dockWrap}>
          <ActionDock
            mode={mode}
            actor={connectionMode === "local" ? meState : null}
            game={game}
            me={me}
            handSize={hand.length}
            canTrade={canTrade}
            busy={busy}
            draftTotal={draftTotal}
            from={from}
            to={to}
            captureDismissed={captureDismissed}
            onPickForMe={pickForMe}
            onConfirmPlacement={confirmPlacement}
            onAutoPlace={autoPlace}
            onClearDraft={() => setDraft({})}
            onOpenTrade={() => setTradeOpen(true)}
            onAttack={(dice) => from && to && void run({ type: "attack", from, to, dice })}
            onBlitz={() => from && to && void run({ type: "blitz", from, to })}
            onMoveMore={(count) => void run({ type: "moveMore", count })}
            onDismissCapture={() => setDismissedCapture(pendingKey)}
            onEndAttack={() => {
              setSelection({ from: null, to: null });
              void run({ type: "endAttack" });
            }}
            onFortify={(count) => {
              if (!from || !to) return;
              setSelection({ from: null, to: null });
              void run({ type: "fortify", from, to, count });
            }}
            onEndTurn={() => {
              setSelection({ from: null, to: null });
              void run({ type: "endTurn" });
            }}
            onClearSelection={() => setSelection({ from: null, to: null })}
          />
        </div>
      )}

      {battle && <DiceTray key={battle.key} battle={battle.battle} game={game} />}

      {banner && (
        <div key={banner.key} className={styles.banner} style={{ color: banner.color }}>
          <span>{banner.text}</span>
        </div>
      )}

      {(tradeOpen || (tradeForced && hand.length >= 3)) && me && (
        <TradeModal
          game={game}
          me={me}
          hand={hand}
          forced={tradeForced}
          reason={tradeForced && mode.kind === "trade" ? mode.reason : "Trade 3 cards for extra armies."}
          onTrade={trade}
          onClose={() => setTradeOpen(false)}
        />
      )}

      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}

      {kickTarget && (
        <Modal
          title={`Remove ${kickTarget.name}?`}
          subtitle={
            <>
              They're out of the game for good. Their armies stay on the board as neutral defenders, and their cards are discarded.
              {kickTarget.id === game.currentPlayer && game.status === "playing" && " Their turn ends right away."}
            </>
          }
          onClose={() => setKickTarget(null)}
        >
          <div className={styles.modalActions}>
            <Button variant="ghost" onClick={() => setKickTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" icon="close" onClick={() => void kick(kickTarget)}>
              Remove {kickTarget.name}
            </Button>
          </div>
        </Modal>
      )}

      {leaveOpen && (
        <Modal
          title={connectionMode === "local" ? "Leave this game?" : "Leave and resign?"}
          subtitle={
            connectionMode === "local"
              ? "It's saved on this device, so you can resume it from the home screen."
              : "Your armies stay on the board as a neutral force. You can't rejoin."
          }
          onClose={() => setLeaveOpen(false)}
        >
          <div className={styles.modalActions}>
            {connectionMode === "local" && game.status !== "finished" && (
              <Button variant="danger" onClick={() => void leaveGame()}>
                Abandon game
              </Button>
            )}
            <Button variant="ghost" onClick={() => setLeaveOpen(false)}>
              Stay
            </Button>
            <Button variant="primary" onClick={connectionMode === "local" ? onExit : () => void leaveGame()}>
              {connectionMode === "local" ? "Save & exit" : "Resign & leave"}
            </Button>
          </div>
        </Modal>
      )}

      {game.status === "finished" &&
        (resultsHidden ? (
          <div className={victoryStyles.pill}>
            {winner && <Dot color={winner.color} />}
            {winner ? `${winner.name} won` : "Game over"}
            <Button size="sm" variant="primary" icon="crown" onClick={() => setResultsHidden(false)}>
              Results
            </Button>
          </div>
        ) : (
          <VictoryScreen
            game={game}
            showKicker={connectionMode === "online"}
            onShowStats={() => setStatsOpen(true)}
            onViewBoard={() => setResultsHidden(true)}
            onHome={() => void connection.leave().then(onExit)}
            onRematch={
              connection.rematch && snap.lobby?.hostId === me
                ? () => void connection.rematch?.().catch((e: Error) => toast(e.message, "error"))
                : undefined
            }
          />
        ))}

      {statsOpen && game.status === "finished" && <StatsView game={game} onClose={() => setStatsOpen(false)} />}
    </div>
  );
}

/**
 * Online, a lapsed timer is claimed by whoever's watching. The player seated
 * after the idle one goes first; everyone else backs them up a few seconds
 * apart, so one dropped connection can't stall the game. (Duplicates are
 * rejected by the server: the deadline has moved on by then.)
 */
function timeoutWatchDelay(game: PublicState, me: PlayerId | null): number | null {
  const active = game.turnOrder.filter((id) => game.players.find((p) => p.id === id)?.status === "active");
  const mine = me ? active.indexOf(me) : -1;
  if (mine < 0) return null;
  const everyoneAtOnce = game.status === "setup" && game.phase !== "claim";
  const first = everyoneAtOnce ? 0 : (active.indexOf(game.currentPlayer ?? "") + 1) % active.length;
  const rank = (mine - first + active.length) % active.length;
  return 1500 + rank * 4000;
}
