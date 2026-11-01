# APEX 0.2 – Architecture & Security Model

```
Browser (React)                         Vercel Function /api/apex                 Supabase
───────────────                         ─────────────────────────                 ────────
LoginPage ── POST ?op=request-code ─▶ invited? → auth.signInWithOtp ──────────▶ Auth emails a 6-digit code
          ── supabase-js verifyOtp ──────────────────────────────────────────▶ Auth (single-use, expiring code)
                                                                                    │ access token (JWT)
useOnlineGame ── GET  ?op=state ─────▶  verify token (auth.getUser)                 │
              ── POST ?op=command ───▶  membership + role  ◀── apex_campaign_members / invites
                                         parseCommand()  (strict shape check)
                                         executeCommand() (same rules as the demo)
                                         save with version check ───────────▶ apex_game_states (RLS: no client access)
                                         buildPlayerView() for the caller      ─▶ trigger → apex_campaign_heads
              ◀── filtered view ───────                                                      │
supabase-js Realtime ◀──────────────── "version N" ping (RLS: members only) ◀─────────────────┘
   → refetch own filtered view
```

## Principles

1. **One rule engine.** `src/game/` is pure TypeScript without React. The demo runs it in the browser;
   the online mode runs exactly the same code on the server (`src/server/api.ts`).
2. **Identity only from the verified token.** User id and email come from Supabase Auth; any `userId`,
   `actor` or `role` field in a request body is ignored.
3. **Roles only from server-managed tables.** `apex_campaign_members` (created from
   `apex_campaign_invites` on first sign-in with a *confirmed* email). User metadata is never used.
4. **Players never receive the GameState.** They get `buildPlayerView()` output for a character assigned to
   them: only explored/visible hexes, no map radius, no seed, no hidden sites, no GM notes, no rivals out
   of sight, no future events, no GM log entries. Unknown hexes are not even listed, so the arena outline
   cannot be inferred.
5. **Players can only move.** The server allows players exactly one command type (`move`), and only for
   characters assigned to them (or characters that granted them control in-game).
6. **No lost updates.** Writes use optimistic locking on `apex_game_states.version`; on conflict the server
   reloads, re-validates the command against the new state and retries.
7. **Realtime carries no secrets.** Only the version counter is broadcast (`apex_campaign_heads`,
   readable by members). Each client then fetches its own filtered view.
8. **Defence in depth.** RLS is enabled on every table; clients have no table privileges except reading
   their own membership and their campaign's version counter. The secret key exists only in Vercel's
   server environment.

## Login (email code)

1. The browser sends the email to `POST /api/apex?op=request-code` (no session).
2. The server checks `apex_campaign_invites` / `apex_campaign_members`. Only for an authorised address it makes sure a
   confirmed Auth account exists and calls `auth.signInWithOtp({ shouldCreateUser: false })`. The answer is identical for
   authorised and unknown addresses (no account enumeration); rate limits and send failures are reported.
3. Supabase emails the code (template contains `{{ .Token }}`); the browser calls `auth.verifyOtp({ type: 'email' })`.
   Supabase generates, expires, rate-limits and verifies the code – APEX never stores codes.
4. A verified email alone grants nothing: membership comes only from a GM invitation.

## Profiles ("Who are you?")

- The welcome screen shows five profiles from `src/data/profiles.ts` (display only: names, characters, portraits).
- Authoritative data lives in `apex_profiles` (migration `20261103000100`): role, character token ids, and the linked
  account (email set by the GM, `user_id` bound on the first verified sign-in). No emails are in the repository.
- `request-code` with a profile only sends a code if the email is linked to that profile (GM profile: any GM account).
  The answer is identical either way.
- Every `state` / `ping` / `command` request carries the profile; the server answers `403 profile_mismatch` unless the
  signed-in account is linked to it. A profile can never widen permissions – roles and character assignments still come
  from `apex_campaign_members` and `apex_character_assignments`, which the GM's profile links keep in sync.
- `GET op=profiles` (public) returns only `{ key, active }` per profile.

## Sync & failure handling

- Realtime pings + a heartbeat (`op=ping`, 25 s; 8 s while realtime is down) that also records presence (`last_seen_at`).
- Connection states: *Live*, *Synced (polling)*, *Offline – retrying*. Failed saves say “NOT saved”.
- No local campaign copy exists in online mode; production builds without configuration show a setup notice
  instead of a demo.

## Files

| Path | Purpose |
|---|---|
| `api/apex.ts` | Vercel Function entry (Web `Request`/`Response`) |
| `src/server/api.ts` | Authorisation, command execution, GM administration |
| `src/server/validate.ts` | Strict runtime validation of incoming commands |
| `src/server/supabaseRepo.ts` | Database access with the secret key (server only) |
| `src/server/protocol.ts` | Wire types shared with the client (types only) |
| `src/online/*` | Login screens, Supabase client, API client, `useOnlineGame` |
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
