# APEX 0.3 – Architecture & Security Model

```
Browser (React)                         Vercel Function /api/apex                 Supabase (secret key, server only)
───────────────                         ─────────────────────────                 ──────────────────────────────────
"Who are you?" → password
LoginPage ── POST ?op=login ────────▶  rate limit (profile / IP / global) ◀──▶ apex_login_attempts
                                        Argon2id verify ◀──────────────────── apex_profile_credentials (hash only)
          ◀── Set-Cookie __Host-apex_session (HttpOnly, Secure, SameSite=Strict)
                                        session row (SHA-256 of token) ──────▶ apex_sessions
useOnlineGame ── GET  ?op=state ─────▶  cookie → session → profile (role, characters) ◀── apex_profiles
              ── POST ?op=command ───▶  CSRF header + Origin check
                                         parseCommand()  (strict shape check)
                                         executeCommand() (same rules as the demo)
                                         save with version check ───────────▶ apex_game_states (RLS: no client access)
                                         buildPlayerView() for the caller      ─▶ trigger → apex_campaign_heads
              ◀── filtered view ───────                                                      │ realtime.send
supabase-js Realtime ◀──────── "version N" on the secret campaign topic ◀────────────────────┘
   → refetch own filtered view
CharacterPanel ── GET/POST ?op=sheet ▶  own character (GM: all) ─────────────▶ apex_character_sheets (+ backups)
```

## Principles

1. **One rule engine.** `src/game/` is pure TypeScript without React. The demo runs it in the browser;
   the online mode runs exactly the same code on the server (`src/server/api.ts`).
2. **Identity only from the server-side session.** The browser holds an opaque random token in an HttpOnly cookie;
   the database stores only its SHA-256 hash. Any `userId`, `actor`, `role` or `profile` field in a request is ignored.
3. **Roles only from the database.** Role and characters come from `apex_profiles`. Selecting the GM card grants
   nothing without the GM password.
4. **Players never receive the GameState.** They get `buildPlayerView()` output for their own character: only
   explored/visible hexes, no map radius, no seed, no hidden sites, no GM notes, no rivals out of sight, no future
   events, no GM log entries. Since 0.3 they also never receive other characters' inventories.
5. **Players can only move and manage their own character.** Allowed player commands: `move` (own or granted
   characters), `inv*` (own inventory), equipment and item actions. Everything else is GM-only.
6. **No lost updates.** Game state: optimistic locking on `apex_game_states.version`, re-validation and retry; item edits
   carry the item revision (`rev`) so a stale edit is rejected. Sheets: per-sheet version, conflicts return the current
   sheet; `+/-` adjustments are re-applied atomically.
7. **Realtime carries no secrets.** Only `{version}` / `{sheet:true}` pings on a secret topic (`apex_campaigns.sync_topic`,
   handed out only to signed-in profiles, rotated when the GM revokes someone). Each client then fetches its own view.
8. **Defence in depth.** RLS is enabled on every table; browsers have no privileges on any APEX table that matters
   (credentials, sessions, sheets, state). The secret key exists only in Vercel's server environment.

## Login (profile + password)

1. `GET op=profiles` (public) returns only `{ key, active, needsSetup? }` per profile.
2. `POST op=login {profile, password}` – the server checks the rate limits **before** verifying (5 failures per profile,
   20 per IP, 300 overall within 15 minutes), verifies the Argon2id hash (m=19 MiB, t=2, p=1) and creates a session.
   Locked profiles (no password, or deactivated) cannot sign in.
3. Sessions expire after 14 days without use and 30 days after sign-in at the latest. They are revoked on logout,
   password change/reset, password removal and deactivation (checked on every request).
4. CSRF: every POST must carry `X-APEX-CSRF: 1` and, if the browser sends an `Origin`, it must be this site.
5. GM first-time setup / recovery: `select apex_private.create_gm_setup_code();` in the Supabase SQL editor (database
   owners only) returns a single-use code (24 h, only its hash is stored). `POST op=setup {code, password}` sets the GM
   password. There is no master password and no environment variable that grants access.

## Character sheets & inventory

- **Authoritative resources** stay in the game state: movement and vision, inventory
  (`Token.inventory`, optional `Token.containers`). The Character panel shows them directly; no duplicate copies.
- **Sheets** (`apex_character_sheets`, one per player character) hold the rules-agnostic sheet: optional hit points,
  details, attributes, skills, custom resources, abilities, notes. Players read/write only their own sheet, the GM all.
- **PDF import** runs in the browser (pdf.js): form fields + page text → mapping (`src/sheetImport/map.ts`) → review →
  merge/replace. Only confirmed values are sent and validated again by the server (`parseSheet`). The PDF itself is never
  uploaded or stored. Imports back up the previous sheet (`apex_character_sheet_backups`).

## Sync & failure handling

See also [`INCIDENT_2026-11-01.md`](INCIDENT_2026-11-01.md).

- **Refresh** is single-flight and sends `since=<version>`; the server answers `{unchanged:true}` without loading the state.
- **Heartbeat** (`op=ping`, version only, 2 DB round trips): every 30 s (12 s without Realtime), one at a time, paused while the tab is
  hidden or the device is offline; after failures exponential backoff with ±25 % jitter up to 60 s.
- **Realtime** `version` pings trigger one refresh; `sheet` pings re-load the open sheet. Presence = `apex_sessions.last_seen_at`,
  refreshed by `apex_authenticate()` at most every 30 s.
- **Actions** carry a `requestId` (unique per campaign in `apex_command_log`, reserved before the change). A repeated id is never
  applied twice. After a lost response the client asks `op=command-status` – it never re-sends blindly. Only the conflicting
  action is pending; background sync never disables buttons.
- **Connection states:** Connected · Synchronizing · Saving action · Reconnecting · Server unavailable · Action outcome unknown;
  the Realtime websocket is shown separately (it does not prove the API is healthy).
- **Server limits:** 8 s timeout per database call, function `maxDuration` 30 s, region `dub1` next to the database.
  Every request logs `[apex-timing] op status ms db dbMs` (no data, no secrets).
- No local campaign copy exists in online mode.

## Files

| Path | Purpose |
|---|---|
| `api/apex.ts` | Vercel Function entry (Web `Request`/`Response`) |
| `src/server/api.ts` | Sign-in, sessions, authorisation, command execution, sheets, GM administration |
| `src/server/auth.ts` | Argon2id hashing, session tokens, cookies |
| `src/game/inventory.ts`, `src/game/sheet.ts` | Inventory containers, character sheet model and validation |
| `src/sheetImport/*` | PDF extraction (browser) and field mapping |
| `src/server/validate.ts` | Strict runtime validation of incoming commands |
| `src/server/supabaseRepo.ts` | Database access with the secret key (server only) |
| `src/server/protocol.ts` | Wire types shared with the client (types only) |
| `src/online/*` | Login screens, Realtime client, API client, `useOnlineGame` |
| `src/state/useGame.ts` | Local demo backend |
| `supabase/migrations/*` | Schema, RLS, realtime publication, seed |
| `tests/server.test.ts` | API security tests (in-memory repository) |
| `supabase/tests/rls_check.sql` | Database-level RLS tests |
| `dev/mockSupabase.ts`, `dev/e2e-online.cjs` | Local multi-browser end-to-end harness |

## Rendering

`src/components/map/` – the map is layered: an endless exploration background (CSS), a chunk-cached
Canvas terrain layer (`TerrainCanvas` + `painter.ts`), day/night CSS overlays, a screen-blended light
layer (`LightCanvas`), and a thin SVG overlay for interaction. Hexes are not DOM nodes; hit testing uses
pixel → hex math. Chunks (480×480 world px) are cached at four levels of detail and repainted only when
their content signature changes, within a 12 ms frame budget.

## Prepared extension points

- **Weather / time-dependent encounters:** `GameConfig.phases` holds per-phase rules (vision modifier today);
  events can trigger on `{ type: 'phase', day, phase }`. Weather can be added as another per-phase modifier.
- **Central landmark mechanics:** hexes carry `feature: 'eagle' | 'plaza' | 'labyrinth'`; the start site
  `meta-aurea` (*Aquila Aurea*) can receive events and interactions.
