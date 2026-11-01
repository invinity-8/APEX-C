# APEX – Arena of the Eternal Will

An online Game Master platform for a Dungeons & Dragons campaign set in a magical arena of the Roman Empire.

**Version 0.2** adds secure accounts and a shared, server-validated multiplayer campaign (Supabase + a Vercel
Function), a ten-times larger procedurally generated world, true exploration Fog of War that hides the arena's
outline, a day/night cycle, a new painted 2.5D map with the golden *Aquila Aurea* and its labyrinth, and a fully
English interface.

| Mode | When | Security |
|---|---|---|
| **Online** | `VITE_SUPABASE_URL` + publishable key configured | Login required. Roles and permissions enforced on the server. Players only receive their filtered view. |
| **Demo** | no Supabase configuration, or `/?demo` where allowed | Local sandbox in one browser (localStorage). The GM/player switch is a testing tool, not protection. It never touches the shared campaign. |

---

## 1. Run locally

Requires **Node.js 22 LTS** (or ≥ 20.19).

```bash
npm install
npm run dev            # demo mode at http://localhost:5173
```

| Command | Purpose |
|---|---|
| `npm run dev` | Development server (demo mode unless `.env.local` configures Supabase) |
| `npm test` | 91 unit/security tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Type check + production bundle in `dist/` |
| `npm run dev:mock` | Online mode against a **local mock** of Supabase (http://localhost:5174) |
| `node dev/e2e-online.cjs` | 24 multi-browser acceptance checks against `dev:mock` (needs Playwright) |
| `npm run verify:db` | Runs the SQL migrations twice + RLS tests on a local PostgreSQL |

Mock accounts for `dev:mock` (email-code login; the code is printed in the terminal): GM profile `gm@apex.test`,
Hannah `hannah@apex.test`, Jean `jean@apex.test`; `simon@apex.test` (profile not yet linked) and `stranger@apex.test`.

To use the real Supabase project locally, copy `.env.example` to `.env.local` and fill in the values
(the `/api/apex` function is served by `vercel dev`, not by plain `vite`).

---

## 2. Playing

1. **Select a character** in the party list or on the map. Reachable hexes glow gold; hovering shows the path and its cost.
2. **Click a gold hex** to move. Unreachable targets are explained (lake, not enough MP, unexplored, closed zone …).
3. **Time** (GM only, golden button): *Begin Night 1* → *Begin Day 2* → … Movement points return at dawn.
4. **Map:** mouse wheel / pinch / `+` `−` to zoom, drag or arrow keys to pan, `0` recentres, `Esc` clears the selection.
5. **Players** see only what their party has discovered. The unknown is an endless dark canvas – no outline, no size.

**GM tools:** movement points and points per day, vision and temporary vision bonus, free placement, control
rights, knowledge sharing, rival visibility and tracking (approximate/exact), events, site visibility, clock
correction, shrinking arena, party-vision overlay, new arena (radius 4–45, seed), JSON export/import.
Online only: **Players & Access** (invitations, roles, character assignment, backups/restore).

---

## 3. Rules and rule changes in v0.2

All rules live in `src/game/` and are covered by tests. Changes compared with v0.1:

| Topic | v0.1 | v0.2 | Where |
|---|---|---|---|
| Default arena | radius 12, 469 hexes | **radius 39, 4,681 hexes** (configurable 4–45) | `src/data/demo.ts` |
| Travel scale | crossing ≈ 3 days | crossing ≈ **8 days** at 8 MP/day (test-verified ≥ 6) | unchanged MP & costs |
| Terrain | 7 types | **+ Hills (2 MP)**, **+ River (3 MP, fordable)**; lakes stay impassable | `src/game/terrain.ts` |
| Time | days only | **Day N → Night N → Day N+1** at state level | `src/game/day.ts` |
| Movement reset | each new day | **at dawn only**; unspent points can be used at night | `src/game/day.ts` |
| Night | – | vision **−1** (minimum 1), configurable per phase | `GameConfig.phases` |
| Events | trigger on a day | on a day's **dawn** (as before) or on a specific **phase** | `src/game/events.ts` |
| Shrinking | per day | evaluated **only at dawn** (no double steps); rings per step scale with the radius (3 at radius 39) | `src/game/day.ts` |
| Shrink announcements | "beyond ring N" | players get no ring numbers (they would reveal the map size); the GM log keeps the details | `src/game/text.ts` |
| Start | everyone on the centre hex | party starts on the eagle's dais (0,1) / (−1,2) so the landmark stays visible | `src/data/demo.ts` |
| Units | "BP" | **MP** (movement points) | UI |

Unchanged: grassland 1, road 0.5, forest/ruins/anomaly 2, mountains 3, vision 2 (scout 3), 8 MP per day.

---

## 4. Architecture

```
src/
├─ game/        Pure rules (no React): hex math, terrain, map generator, movement, Fog of War,
│               day/night, events, shrinking zone, commands, text (all user-facing game strings)
├─ data/        Demo campaign factory (also used to create the online campaign)
├─ server/      Online API: auth & roles, command validation, GM admin, Supabase repository
├─ online/      Login screens, Supabase client, API client, useOnlineGame (realtime sync)
├─ state/       GameApi interface, local demo backend, local storage
└─ components/  UI; map/ = layered renderer (Canvas terrain, lights, SVG overlay)
api/apex.ts     Vercel Function → /api/apex
supabase/       migrations/ (schema + RLS + seed), tests/ (RLS checks), verify_security.sql
dev/            Local mock Supabase harness and E2E script (never deployed)
tests/          Vitest: rules, map generation, visibility/secrecy, day/night, server security
```

Data flow (online): click → `POST /api/apex?op=command` → token verified → role from DB → `executeCommand()`
→ saved with version check → Realtime "version" ping → every client refetches **its own** filtered view.
Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## 5. Deployment & environment variables

**German click-by-click guide: [`docs/SETUP_DE.md`](docs/SETUP_DE.md).** English reference: **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** (migrations, Auth settings, Vercel variables,
preview test checklist, go-live and rollback).

**Database migrations are deployed automatically** by the Supabase GitHub integration when a PR is merged to `main`;
`.github/workflows/supabase-migrations.yml` blocks missing/out-of-order/destructive migrations and verifies production
afterwards. German guide: [`docs/MIGRATIONS_DE.md`](docs/MIGRATIONS_DE.md). Local check: `npm run check:migrations`.

| Variable | Where | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | Vercel (browser) | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Vercel (browser) | publishable/anon key – public, protected by RLS |
| `SUPABASE_URL` | Vercel (server) | same URL |
| `SUPABASE_SECRET_KEY` | Vercel (server) | secret/service_role key – **never** with a `VITE_` prefix |
| `VITE_APEX_ALLOW_DEMO` | optional | `true` makes the local demo reachable via `/?demo` (never automatic) |

Production builds **never** fall back to a local game: without these variables they show the notice
*“APEX is not connected yet”*. Check a deployment any time at `/api/apex?op=health` (no secrets in the answer).

**Entry & login:** *Welcome to APEX* → *Join Campaign* → *Who are you?* (GM, Hannah/Sinna, Jean/Aster, Simon/Elwin,
Jerba/Javi) → *Continue as …* → email code. Invite-only and passwordless: a code is only sent when the email is linked to
the chosen profile (the GM links profiles in *Players & Access → Profiles*). Supabase Auth emails a
single-use 6-digit code (expiring, rate-limited, verified by Supabase). Uninvited addresses get the same neutral
answer and no email. The GM sees who is online in *Players & Access*.

---

## 6. Verified in v0.2

- `npm test`: 79 tests – hex math, deterministic coherent generation (radius 12 and 39), reachability, travel
  scale, movement costs incl. rivers, permissions, Fog of War, **no secrets / no map size / no outline in player
  views**, boundary revealed only locally, day/night sequence, MP reset at dawn, night vision, phase events,
  single shrink step per day, save migration, and 19 server security tests (unauthenticated, uninvited,
  unconfirmed email, role from server only, filtered state, foreign characters, GM-only commands, forged fields,
  malformed commands, concurrent writes, audit log, invitations, reassignment, snapshots).
- `npm run verify:db`: migrations apply twice without errors on PostgreSQL; RLS denies players reading/writing
  game state, invitations, assignments, snapshots and escalating their role; strangers see nothing.
- `vercel build` (local): the `/api/apex` function bundles and answers correctly (401/400) when executed.
- `dev:mock` + `dev/e2e-online.cjs`: 20/20 acceptance checks across separate browser sessions (email-code login, denial, live sync of
  moves and phase changes via Realtime, forbidden actions, refresh persistence, sign-out).
- Visual checks in Chromium: GM full map, player exploration view, night lighting, landmark, login page.

## 7. Known limitations

- **Not yet tested against the real Supabase project and a Vercel preview** – the build environment used for
  v0.2 had no network access to Supabase/Vercel. The steps and checklist in `docs/DEPLOYMENT.md` must be run
  before go-live. The schema was tested on PostgreSQL with a Supabase stub, the client against a protocol mock.
- No line of sight yet (mountains/forests do not block vision).
- Rival strategies are stored but not automated; inventory and willpower are displayed but not playable.
- Tree crowns do not sway (water glints, flickering lights and arcane motes are animated).
- Performance was measured in headless Chromium without GPU; real laptops should be faster, but a check on the
  players' actual devices is recommended (especially Safari and touch devices).
- No rate limiting on `/api/apex` beyond Vercel's defaults; no undo (use backups or free placement).

## 8. Roadmap

| Phase | Content | Status |
|---|---|---|
| 0.1 | Demo harness: map, movement, days, fog, roles, local saves | ✅ |
| 0.2 | Accounts, secure multiplayer, large world, true exploration fog, day/night, new visuals | ✅ (pending live verification) |
| 0.3 | Line of sight, terrain/site/event editors, weather, landmark events | planned |
| 0.4 | Inventory & Voluntas mechanics, rival automation, factions | data models prepared |
