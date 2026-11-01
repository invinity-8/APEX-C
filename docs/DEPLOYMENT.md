# APEX – Deployment & Go-Live Guide

> **Deutsch / step-by-step for beginners: [SETUP_DE.md](SETUP_DE.md).** This page is the short English reference.

This guide takes the online multiplayer mode from the feature branch to production **without
risking the current live site**. Until the environment variables below are set, every build –
including production – keeps running in the local **demo mode** exactly like v0.1.

---

## 0. Overview

| Piece | Where | Who sets it up |
|---|---|---|
| Static React app | Vercel (`dist/`) | automatic on every push |
| Secure command server | Vercel Function `api/apex.ts` → `/api/apex` | automatic on every push |
| Auth, database, realtime | Supabase project **APEX MAIN** | you, once (steps 1–3) |

Nothing in the browser can write campaign data directly. All writes go through `/api/apex`,
which verifies the Supabase session and runs the game rules on the server.

---

## 1. Database migrations (automatic)

Production was rebuilt on 2026-11-01 (see [MIGRATIONS_DE.md](MIGRATIONS_DE.md)): the legacy allow-list migration was
marked reverted (backup in schema `apex_backup_20261101`) and `20261101145653_apex_baseline.sql` – identical to the file in
this repository – is the single baseline (schema version 1). Later migrations are applied by the **Supabase GitHub
integration** ("Deploy to production", branch `main`). Never run schema SQL manually in the dashboard.

- `npm run check:migrations` / workflow check: complete, ordered, no unreviewed destructive SQL.
- `src/server/schema.ts` (`REQUIRED_SCHEMA_VERSION`, `EXPECTED_MIGRATIONS`) must match the migration files (tested).
- After every push to `main` the workflow waits until `https://4pex.online/api/apex?op=health` serves the pushed commit,
  reports all migrations, the schema version and no security problems – otherwise it fails.
- `npm run verify:db` replays the migrations on a local PostgreSQL that mimics the legacy production state.

---

## 2. Sign-in (profile + password) – no Supabase Auth, no email

APEX 0.3 does not use Supabase Auth or any email service. The server verifies profile passwords (Argon2id) and
issues its own HttpOnly session cookie.

- **First GM password:** Supabase → SQL Editor → `select apex_private.create_gm_setup_code();` → copy the code →
  APEX → *Join Campaign* → *GM* → *First-time setup*. The code works once and expires after 24 h
  (`create_gm_setup_code(2)` = 2 h). The same procedure resets a forgotten GM password.
- **Players:** GM → *Players & Access → Profiles* → *Set password* (initialise) / *Reset password*, *Activate* /
  *Deactivate*, *Sign out devices*, character selection.
- **Obsolete settings** (can be cleaned up once 0.3 runs in production): Vercel variables `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (and `APEX_LOGIN_INTERVAL_SEC` if set); Supabase Auth custom SMTP, OTP
  e-mail templates, and the Auth email provider. Table `apex_login_requests` and `apex_campaign_invites` are no longer
  used (kept until the transition is verified). The three accounts in `auth.users` are untouched and unused.

---

## 3. Vercel environment variables

Vercel → Project → **Settings → Environment Variables**. Add them for **Preview** first.

| Name | Value | Scope | Public? |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `https://xqkyaqxuoaxadpkcdhch.supabase.co` | Preview (later Production) | yes (browser) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API Keys → *publishable* (or legacy *anon*) | Preview (later Production) | yes (browser) |
| `SUPABASE_URL` | same URL | Preview (later Production) | **server only** |
| `SUPABASE_SECRET_KEY` | Supabase → Settings → API Keys → *secret* (or legacy *service_role*) | Preview (later Production) | **server only – never VITE_** |
| `VITE_APEX_ALLOW_DEMO` | leave unset; `true` only makes `/?demo` reachable | optional | yes |

Redeploy the preview after changing variables (Deployments → ⋯ → *Redeploy*).

> `VITE_` variables are compiled into the bundle: **redeploy after every change**. Without them, production shows
> “APEX is not connected yet” (no local game). Check the server side at `/api/apex?op=health`
> (`serverConfigured`, `database`, `authAdmin`, `campaignSeeded`, `presenceColumn`, deployed `commit`).

---

## 4. Test on the Vercel Preview (required before go-live)

Use three different browsers / private windows.

| # | Check | Expected |
|---|---|---|
| 0 | Open `/api/apex?op=health` | all `true`, `errors: []`, `commit` = PR head |
| 1 | Open the preview URL signed out | Login page only; `/api/apex?op=state` returns 401 |
| 2 | GM: first-time setup with the setup code, then sign in with profile + password | “Open the arena” → generate (radius 39) → full map |
| 3 | GM → *Players & Access → Profiles* | set passwords for Hannah and Jean; characters Sinna / Aster |
| 4 | Sign in as Player 1 | only the area around the eagle; no outline, no hidden sites; “Live” indicator green |
| 5 | Player 1 moves their character | GM and Player 2 see the change within ~1 s without reloading |
| 6 | Player 1 tries to move Player 2’s character | refused (“only characters assigned to you”) |
| 7 | GM clicks *Begin Night 1* | both players switch to night within ~1 s; vision shrinks |
| 8 | Reload any browser | same shared state is restored |
| 9 | GM → *Backups* → create / restore | works; a dawn backup appears after *Begin Day 2* |

The same scenarios (plus character sheets, PDF import, inventory, privacy and conflicts) run automatically:
`npm run dev:mock` then `node dev/e2e-online.cjs` (43 checks). Against a real deployment:
`APEX_URL=… APEX_GM_PASSWORD=… APEX_HANNAH_PASSWORD=… APEX_JEAN_PASSWORD=… node dev/e2e-online.cjs`.

---

## 5. Go-live

1. Merge the reviewed pull request into `main`.
2. Copy the four Supabase variables to the **Production** scope and redeploy.
3. Repeat checks 1, 4, 5 and 7 on `https://apex-gray-eta.vercel.app`.

**Rollback:** Vercel → Deployments → an older *Ready* deployment → ⋯ → *Promote to Production*. The shared
campaign stays untouched in Supabase (and in the snapshot table).

---

## 6. Operations

- **Backups:** automatic snapshot at every dawn and before every new arena / import / restore
  (last 60 kept, table `apex_state_snapshots`). GM: *Players & Access → Backups*. The GM can also
  export the full campaign as JSON from the header.
- **Audit log:** every command attempt (accepted or rejected) is stored in `apex_command_log`.
- **Players:** GM → *Players & Access → Profiles* – set/reset passwords, activate/deactivate, sign out devices,
  assign characters. Passwords are stored only as Argon2id hashes.
- **Character sheets:** table `apex_character_sheets`; imports back up the previous sheet in
  `apex_character_sheet_backups`. Inventories live in the game state and are covered by the state snapshots.
- **Key rotation:** rotate the secret key in Supabase, update `SUPABASE_SECRET_KEY` in Vercel, redeploy.
