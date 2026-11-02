# APEX – Arena of the Eternal Will

An online Game Master platform for a Dungeons & Dragons campaign set in a magical arena of the Roman Empire.

**Version 0.3** replaces the email-code login with **profile + password** (no email at all), adds a persistent
**Character sheet** per player (with **PDF import**) and a flexible free-text **Inventory** with containers.
See [section 3a](#3a-new-in-v03).

**Version 0.2** added secure accounts and a shared, server-validated multiplayer campaign (Supabase + a Vercel
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
| `npm test` | 119 unit/security tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Type check + production bundle in `dist/` |
| `npm run dev:mock` | Online mode against a **local mock** of Supabase (http://localhost:5174) |
| `node dev/e2e-online.cjs` | 43 multi-browser acceptance checks against `dev:mock` or a real deployment (needs Playwright) |
| `npm run verify:db` | Runs the SQL migrations twice + RLS tests on a local PostgreSQL |

Mock profiles for `dev:mock`: Hannah (`hannah-test-pass`), Jean (`jean-test-pass`); the GM uses first-time setup with
the setup code printed in the terminal (also at `/__mock/setup-code`); Simon and Jerba are locked until the GM sets a password.

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
correction, shrinking arena, party-vision overlay, new arena (radius 4–78, seed), JSON export/import.
Online only: **Players & Access** (passwords, activation, signed-in devices, character assignment, backups/restore),
**Character sheets** and **Inventory** of every character.

---

## 3d. GM events, announcements & navigation (v0.4)

- **Event approval** – events no longer fire on their own. When a scheduled event is due (dawn of its day, or its
  phase), the server marks it *awaiting* and writes a GM-only log line; nothing on the map changes. The GM gets a
  centred dialog with a preview of the consequences and **Approve & Trigger / Reject / Postpone (next phase / next
  day) / Edit**. Only approval applies the effects – exactly once, also when a request is retried (request ids).
- **Day/night rules** – events are checked whenever time advances. An awaiting event stays awaiting across phase
  changes until decided; when approved later it applies at that moment. A postponed event becomes due again at the
  chosen phase. Rejected and triggered events never fire again.
- **What needs approval and what does not** – *approval-gated*: every arena event (scheduled by day or phase,
  postponed, or custom) – its terrain changes, site reveals, movement changes, log entry and announcement. Only the
  GM commands `decideEvent` (approve) and `triggerEvent` (manual trigger with preview) apply them; players get 403.
  *Built-in phase mechanics, not gated*: day/night switch, movement points and vision bonus restored at dawn, arena
  shrinking with its warnings, fog-of-war refresh, the dawn snapshot.
- **Event Library** (GM sidebar → Events) – pending decisions, available, triggered, rejected/postponed and custom
  events with search and filters. Manual triggering always shows a preview first and uses the same server command
  (`decideEvent`) and validation as automatic events. Custom events (movement change, terrain around a hex, reveal a
  site) are created with `createEvent` and only take effect after approval.
- **Arena Announcements** (GM sidebar → Announcements) – category (General, Warning, Death, World event, Custom),
  headline and text, preview, broadcast. Announcements are part of the shared game state, so they reach every
  player through the normal sync; players who were offline see the newest unacknowledged ones when they return.
  The overlay is accessible (alert dialog, Acknowledge / Esc / click, auto-hides after 14 s) and has no animation
  with *prefers-reduced-motion*. Players can re-read them in “Arena announcements”. Approved events with
  “notify players” create a World-event announcement automatically. Only the GM can broadcast.
- **GM navigation** – the GM sidebar is a list of collapsible sections (Events, Announcements, Rival teams, Sites,
  Time/arena/settings, World Management, Players & Access) with search, quick-jump chips, ★ pinning and a badge for
  events awaiting a decision. Open and pinned sections are remembered per campaign and profile on the device.
  Collapsed sections are unmounted, so closed panels cost nothing.

## 3c. Character experience (v0.4)

- **Aurora Builder PDFs** are imported from their real form fields (identity, abilities, saves and skills with proficiency,
  combat values, attacks, equipment without duplicates, currency, spellcasting, cantrips / prepared spells / full spell list,
  spell slots, background). Features & traits come from Aurora's printed "Name. Description" block (marked *Please check*).
  Other fillable sheets and text PDFs still work; page-text guesses are only used when no form field exists.
- **Readable import preview** grouped into Identity & appearance, Attributes, Combat & resources, Skills & saving throws,
  Features & traits, Spells, Equipment & inventory, Background & notes – with overwrite warnings and an optional Advanced
  section for unrecognised fields.
- **Character dashboard** with tabs Overview · Attributes & Skills · Abilities & Spells · Resources · Inventory · Appearance · Notes;
  every field can be edited by hand (player: own character, GM: all), saved with conflict protection.
- **Appearance**: portrait (JPG/PNG/WebP, crop & reposition, private Supabase Storage, signed URLs), character tag, primary and
  accent colour, marker style (medallion, gem, hexagon, crest) – shown on the map and on character cards. Cosmetic only.

## 3b. World Management (v0.4)

GM: *Archive World*, *Create New World*, *Reset Current World*, *Restore Archived World* – atomic, idempotent, accounts/passwords/
character sheets/inventories are kept. Details: [`docs/WORLD_MANAGEMENT.md`](docs/WORLD_MANAGEMENT.md).

## 3a. New in v0.3

| Area | What changed |
|---|---|
| Sign-in | *Join Campaign* → *Who are you?* → password → *Enter the Arena*. Argon2id hashes, HttpOnly/Secure/SameSite=Strict session cookie (14 days idle, 30 days max), CSRF header + Origin check, rate limits (5 wrong passwords per profile / 20 per IP / 300 overall per 15 min). No email, OTP, magic link or SMTP. |
| GM bootstrap | `select apex_private.create_gm_setup_code();` in the Supabase SQL editor → one-time code (24 h) → *First-time setup*. Also the recovery path for a forgotten GM password. |
| GM administration | *Players & Access → Profiles*: set / reset / remove passwords, activate / deactivate, sign out devices, assign characters. Resetting or deactivating revokes all sessions of that profile immediately. |
| Character | Navigation *Map · Character · Inventory*. Will, movement and vision come from the game state; the sheet adds optional hit points, details, attributes, skills, custom resources, abilities and notes. Quick +/− buttons, edit mode, conflict handling. |
| PDF import | Fillable PDFs (e.g. the D&D 5e sheet) and text PDFs, read in the browser – the file is never uploaded. Review screen with *Recognized / Please check / Missing / Unknown field*, merge / replace / cancel, backup before saving, equipment lines → inventory. Scanned PDFs are reported as unreadable (no OCR). |
| Inventory | Free-text entries with quantity, description and notes; containers Backpack, Pockets, Side Pouch, Equipped / Worn, Other + custom ones (rename, delete when empty), move between containers. Stored in the existing game state; inventories are private to the owner and the GM. Stale edits from another device are rejected instead of overwriting. |

## 3. Rules and rule changes in v0.2

All rules live in `src/game/` and are covered by tests. Changes compared with v0.1:

| Topic | v0.1 | v0.2 | Where |
|---|---|---|---|
| Default arena | radius 12, 469 hexes | **radius 39, 4,681 hexes** (configurable 4–78; see “Arena size” below) | `src/data/demo.ts` |
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
├─ online/      Login screens, Realtime client, API client, useOnlineGame (realtime sync)
├─ state/       GameApi interface, local demo backend, local storage
└─ components/  UI; map/ = layered renderer (Canvas terrain, lights, SVG overlay)
api/apex.ts     Vercel Function → /api/apex
supabase/       migrations/ (schema + RLS + seed), tests/ (RLS checks), verify_security.sql
dev/            Local mock Supabase harness and E2E script (never deployed)
tests/          Vitest: rules, map generation, visibility/secrecy, day/night, server security
```

Data flow (online): click → `POST /api/apex?op=command` → session cookie verified → role from DB → `executeCommand()`
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
Jerba/Javi) → password → *Enter the Arena*. No email is needed or sent. Profiles without a password are locked. The GM
sets passwords in *Players & Access → Profiles* and sees who is online. German step-by-step guide: [`docs/SETUP_DE.md`](docs/SETUP_DE.md).

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
- Rival strategies are stored but not automated. Will vessels (charge) are displayed but not yet playable.
- PDF import: no OCR for scanned sheets; Aurora's own character files are not supported yet (use its PDF export).
- Tree crowns do not sway (water glints, flickering lights and arcane motes are animated).
- Performance was measured in headless Chromium without GPU; real laptops should be faster, but a check on the
  players' actual devices is recommended (especially Safari and touch devices).
- Rate limiting covers sign-in and setup; other endpoints rely on authentication and Vercel's defaults. No undo (use backups).

## 8. Roadmap

| Phase | Content | Status |
|---|---|---|
| 0.1 | Demo harness: map, movement, days, fog, roles, local saves | ✅ |
| 0.2 | Accounts, secure multiplayer, large world, true exploration fog, day/night, new visuals | ✅ (pending live verification) |
| 0.3 | Password login without email, character sheets with PDF import, free-text inventory | ✅ (this release) |
| 0.4 | Line of sight, terrain/site/event editors, weather, landmark events, Voluntas mechanics, rival automation | planned |
