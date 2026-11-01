# APEX 0.2 – Architecture & Security Model

```
Browser (React)                         Vercel Function /api/apex                 Supabase
───────────────                         ─────────────────────────                 ────────
LoginPage ── supabase-js Auth ───────────────────────────────────────────────▶ Auth (email/password)
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
