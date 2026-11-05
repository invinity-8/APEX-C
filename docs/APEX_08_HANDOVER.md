# APEX 0.8 Handover – from the Arena to the Campaign Engine

State after the APEX 0.7 finalization (PRs #30–#38). This document describes what exists, what can be reused,
and how the current Arena can later become a **Region Map** without losing saved data. It does **not** implement
the Campaign Engine.

## 1. Architecture in one page

```
Browser (React 19 + Vite)                     Vercel function api/apex.ts            Supabase (Postgres)
┌──────────────────────────────┐   HTTPS     ┌──────────────────────────────┐       ┌──────────────────────────┐
│ App.tsx – pages + workspace  │ ──────────▶ │ handleApi (src/server/api.ts) │ ────▶ │ apex_game_states (JSONB, │
│ useGame / onlineGame         │  op=state   │  auth, CSRF, rate limits      │       │   CAS version)           │
│ ViewModel (never GameState   │  op=command │  parseCommand (validate.ts)   │       │ apex_character_sheets    │
│ for players)                 │  op=sheet … │  executeCommand (pure rules)  │       │ apex_state_snapshots     │
└──────────────────────────────┘ ◀────────── │  buildPlayerView / GmView     │       │ apex_world_archives …    │
        ▲   realtime "ping" (topic)          └──────────────────────────────┘       └──────────────────────────┘
        └──────────── Supabase broadcast trigger: "state changed" → client refetches op=state (no polling)
```

- **One authoritative state per campaign:** `GameState` (src/game/types.ts) is a single JSONB document in
  `apex_game_states`, written with optimistic locking (`saveState(…, expectedVersion)`); a conflict re-runs the
  command against the fresh state (`MAX_RETRIES`). Character sheets live separately (`apex_character_sheets`,
  own version) because they are large and edited often.
- **Pure rules:** `executeCommand(state, actor, command)` (src/game/commands.ts) never touches I/O. Feature
  modules plug in by command family: `executeLoot` (items/loot.ts), `executePartyLoot` (items/partyLoot.ts),
  `executeMerchant` (items/merchant.ts), inventory, equipment.
- **Server-only inputs:** randomness (`seed`, crypto, `SEEDED_COMMANDS` / `PARTY_LOOT_SEEDED`), server time (`now`,
  `PARTY_LOOT_TIMED`) and derived data (e.g. `partyLevel` from the sheets) are injected in `runCommand`; the
  validator rebuilds every command from known fields, so clients can never supply them.
- **Visibility:** `buildPlayerView(state, viewerId)` is the single place that decides what a player sees (fog of
  war, own inventory, redaction of unidentified modifiers and quest GM notes, hidden loot-roll choices, merchant
  only while open). The GM gets `buildGmView` plus the raw state.
- **Legacy reader:** `withLegacyReader` (api.ts) runs `stripLegacy()` (migrate.ts) on every state, snapshot and
  archive the server reads – this is how Willpower was removed and how rough item weights were back-filled without
  a destructive migration. It is the place for future read-time normalisation.
- **Idempotency:** commands carry a `requestId` (apex_command_log) – a retried request returns the first result.

## 2. Reusable building blocks

| Area | Where | Reuse in 0.8 |
| --- | --- | --- |
| Hex math (axial, rings, distance, pixel) | `src/game/hex.ts` | Any hex map, any radius |
| Procedural terrain | `src/game/mapgen.ts`, `terrain.ts` | Region generation (seeded) |
| Movement & reach | `movement.ts`, `viewRules.ts` | Travel on region maps |
| Fog of war / knowledge | `visibility.ts` (`knowledge`, `refreshAllKnowledge`) | Per-region exploration |
| Day/night, phases | `day.ts`, `GameConfig.phases` | Campaign calendar |
| Shrinking zone | `zone.ts` | Arena-only rule – keep switchable |
| Sites, events, announcements | `types.ts`, `events.ts` | Points of interest, story beats |
| Items, rarity, modifiers, loot | `src/game/items/*` | Unchanged (campaign-wide) |
| Party loot rolls, merchant | `partyLoot.ts`, `merchant.ts` | Towns / shops per region |
| Character sheets, abilities | `sheet.ts`, `abilities.ts`, `progression.ts` | Unchanged |
| World archive / restore | `world.ts`, `apex_world_archives` | Pattern for region snapshots |
| Workspace widgets with tabs | `src/workspace/*` (`WidgetTabs`) | New campaign panels |

## 3. Important APIs

All under `/api/apex` (POST needs `x-apex-csrf: 1` and the session cookie):

- `GET op=state` – `{ campaignId, version, view | state }` for the caller's role.
- `POST op=command` – `{ campaignId, command, requestId?, worldId? }`; 403 for GM commands from players, 422 for
  rule refusals, 409 for world changes/conflicts.
- `GET/POST op=sheet` – character sheets (version-checked actions: save, wildShape, damage, heal, tempHp, sorcery).
- `POST op=admin` – GM world management (create / reset / restore / archive), players & access.
- `GET op=version` – build info (version, commit, branch, PR) – shown in the footer; verified to match the deployed
  commit.
- `GET op=health` – DB / schema / realtime checks (`requireCompatibleSchema`, schema version 5).

## 4. Extension points

- **New command family:** add a module with its command union, `XXX_COMMANDS` set and `executeXxx`, register it in
  `Command`, the dispatcher in `executeCommand`, `CHARACTER_COMMANDS` (player-usable ones) and `parseCommand`.
  Server-only inputs go into `runCommand` (seed/now/derived).
- **New state field:** optional field on `GameState` (old saves stay valid), deep-copy only what the command
  touches, expose it in both view builders (redact for players), normalise old data in `stripLegacy` if needed.
- **New widget:** `widgets.push({ id, title, icon, render })` in `App.tsx`; group related panels with `WidgetTabs`
  instead of adding widgets. Add it to the role's `defaultLayout`.
- **Bounded lists:** every growing list is capped (log, announcements 50, audit 300, roll history 20, merchant
  stock 40) – keep doing that; the state document is ~170 kB today.

## 5. From Arena to Region Map without losing saved state

Today a campaign has exactly one active world (`GameState.world`, one `hexes` map, `config.mapRadius`). Archives
(`apex_world_archives`) already store complete previous worlds. The safe path:

1. **Introduce regions as data, not as a rewrite.** Add an optional `regions?: Record<RegionId, RegionMeta>` and an
   `activeRegionId?` to `GameState`. A state without `regions` is read as *one* region – the current Arena – by a
   read-time adapter (`stripLegacy`-style normaliser), e.g. `{ id: 'arena', name: world.name, kind: 'arena' }`.
   No stored row has to be rewritten; the first write after the upgrade persists the normalised form.
2. **Keep hex keys stable.** `HexKey` ("q,r") stays unique *within* a region. Region-specific data (`hexes`,
   `knowledge`, `sites`, `events`, `config.mapRadius/shrink`) moves under the region in a later, additive step;
   until then the top-level fields *are* the active region. Tokens get an optional `regionId` (missing = active
   region), so every existing token position remains valid.
3. **Per-region rules.** The shrinking zone and the arena-specific day rules become region properties (`kind:
   'arena'` keeps them; `kind: 'region'` disables the zone). Global systems – items, currency, sheets, cosmetics,
   loot rolls, merchant – stay campaign-wide and need no change.
4. **Snapshots and archives keep working** because they store whole `GameState` documents; restoring an old
   Arena archive simply yields a single-region campaign through the same adapter.
5. **Size:** a radius-39 arena is ~4,700 hexes. Several regions in one JSONB document will grow it; plan to store
   inactive regions in their own table (e.g. `apex_regions`, additive migration) and keep only the active region
   in `apex_game_states`, with the same optimistic-locking pattern.
6. **Tests to write first:** "an unchanged 0.7 state loads as one region with identical player views" and
   "a 0.7 archive restores into a region campaign" – the same pattern as the Willpower legacy tests in
   `tests/day.test.ts` and `tests/world.test.ts`.

## 6. Known limitations carried into 0.8

- No time/rest system: Wild Shape duration, rest recovery and Sorcery Point refresh are manual.
- Loot-roll deadlines are enforced lazily (resolution when everyone chose, by the GM, or by an eligible player
  after the deadline) – there is no server-side scheduler.
- No player-to-player trading; "cannot be transferred" is stored and respected by salvage and the merchant.
- Weights of free-text items are rough name-based estimates (editable).
- No ESLint configuration; strict `tsc -b` (incl. unused-symbol checks) is the static check.
