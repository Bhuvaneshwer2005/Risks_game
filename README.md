# Risk · Global Domination

The classic board game, rebuilt for the browser: play online with friends in real time, or pass one device around.

- **All the standard rules:** 42 territories, continent bonuses, 3-vs-2 dice where ties go to the defender, escalating card sets with the +2 territory bonus, forced trades, taking an eliminated player's cards, and the official 2-player neutral army.
- **Online adaptations:** the defender auto-rolls the maximum dice, Blitz attacks, a turn timer with auto-resign after three timeouts, and resigning.
- **House rules in the lobby:** classic or connected-chain fortify, escalating or fixed card values, and the turn timer length.

## Playing

```bash
npm install
npm run dev
```

Open http://localhost:5173, enter a name, then either **Create online game** (share the 6-letter code or invite link) or **Pass & play** on one device. Pass-and-play games are saved in the browser, so a reload resumes them.

## How it's built

| Part | Where | Notes |
|---|---|---|
| Rules engine | `src/game/` | One pure reducer, `applyAction(state, action, ctx)`. Every rule and phase check lives here. |
| Board | `scripts/board/`, `src/board/` | Real Natural Earth coastlines grouped into the 42 territories, rendered as a 3D board (three.js) you can pan, tilt and zoom, with a 2D SVG fallback. |
| UI | `src/screens/`, `src/ui/` | React 19 with CSS modules and design tokens in `src/styles/`. No UI framework. |
| Online | `src/net/online.ts`, `supabase/` | Supabase anonymous auth, one Edge Function, Postgres with RLS, and Realtime. |

**Server-authoritative:** clients can only read. Every move goes to the `game` Edge Function, which runs a byte-for-byte copy of `src/game` (`supabase/functions/game/_engine/`) and commits the result atomically: the whole game is one JSON document with a version number. Hidden information (the deck and other players' hands) lives in tables that RLS keeps private.

## Scripts

| Command | What it does |
|---|---|
| `npm test` | Rules and phase tests, a random full-game fuzz test (`FUZZ_GAMES=200 npm test` runs a deeper pass), board geometry checks, and the engine-copy check. |
| `npm run build` | Type-checks and builds to `dist/`. |
| `npm run build:board` | Rebuilds `src/board/geometry.json` from the Natural Earth outlines in `world-atlas` and fails if any border doesn't match the classic board. Country-to-territory rules live at the top of `scripts/board/build.mjs`. |
| `npm run sync:engine` | Copies `src/game` into the Edge Function. Run it after any engine change. `npm test` fails if you forget. |

## Deploying the backend

1. Apply `supabase/migrations/20260924000000_risk_v2.sql` (`supabase db push`, or paste it into the SQL editor). It replaces the v1 tables.
2. Enable **Anonymous sign-ins** under Authentication → Sign In / Providers.
3. Deploy the function: `npm run sync:engine && supabase functions deploy game`.

To point the frontend at a different project, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`). Both values are public by design.
