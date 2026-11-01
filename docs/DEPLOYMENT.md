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

## 1. Database migrations (Supabase → SQL Editor)

The repository contains three idempotent, additive migrations. They are safe to run twice, never delete data and
do **not** touch the manually created `apex_invites` / `apex_access` tables.

1. Open Supabase → **SQL Editor** → *New query*.
2. Paste and run `supabase/migrations/20261101000100_apex_online.sql`.
3. Paste and run `supabase/migrations/20261101000200_apex_seed_main_campaign.sql`
   (creates the campaign *APEX – Arena of the Eternal Will* and the first three invitations;
   it also imports rows from `apex_access` if that table has `email` and `role` columns).
4. Run `supabase/migrations/20261102000100_apex_presence_and_grants.sql` (presence column + explicit server grants).
5. Run `supabase/verify_security.sql` and compare with the expected results in its comments:
   - RLS enabled on every `apex_` table → 0 rows
   - client grants → only `SELECT` on `apex_campaign_heads` and `apex_campaign_members` for `authenticated`
   - realtime publication contains `apex_campaign_heads` → 1 row

> Using the Supabase CLI instead? `supabase db push` applies the same files. The old v0.1 draft was
> moved to `supabase/drafts/` so it is **never** executed.

Local verification (any machine with PostgreSQL): `npm run verify:db` runs both migrations twice
against a throw-away database with a Supabase stub and checks the RLS behaviour.

---

## 2. Supabase Auth settings (email-code login)

- Authentication → Sign In / Providers: **Allow new users to sign up = off**; Email provider on;
  **Email OTP Length = 6**; **Email OTP Expiration = 600 s**.
- Authentication → Emails → templates **Magic Link** and **Confirm signup**: include `{{ .Token }}` (this makes Supabase
  send a numeric code instead of a link). Example body in `SETUP_DE.md`, part C2.
- Authentication → Emails → **SMTP Settings**: configure a custom SMTP provider. The built-in sender is meant for
  testing only (very low hourly limit and, to my knowledge, delivery only to project team members).
- Authentication → URL Configuration: Site URL `https://apex-gray-eta.vercel.app`.

Accounts are created automatically by the server the first time an **invited** address requests a code.
The role is resolved on the server from `apex_campaign_invites` / `apex_campaign_members`.

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
| 2 | Sign in as the GM with the emailed code | “Open the arena” → generate (radius 39) → full map with golden arena wall |
| 3 | GM → *Players & Access → Characters* | assign Livia to Hannah, Marcus to Jean (example) |
| 4 | Sign in as Player 1 | only the area around the eagle; no outline, no hidden sites; “Live” indicator green |
| 5 | Player 1 moves their character | GM and Player 2 see the change within ~1 s without reloading |
| 6 | Player 1 tries to move Player 2’s character | refused (“only characters assigned to you”) |
| 7 | GM clicks *Begin Night 1* | both players switch to night within ~1 s; vision shrinks |
| 8 | Reload any browser | same shared state is restored |
| 9 | GM → *Backups* → create / restore | works; a dawn backup appears after *Begin Day 2* |

The same scenarios run automatically against a local mock: `npm run dev:mock` then
`node dev/e2e-online.cjs` (20 checks). A mock run does **not** prove the real configuration.

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
- **New players:** GM → *Players & Access → Accounts → Invite a person* (optionally with characters). The person
  then signs in with an emailed code – no dashboard step needed.
- **Key rotation:** rotate the secret key in Supabase, update `SUPABASE_SECRET_KEY` in Vercel, redeploy.
