# APEX 0.2 – Deployment & Go-Live Guide

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

The repository contains two idempotent migrations. They are safe to run twice and do **not**
touch the manually created `apex_invites` / `apex_access` tables.

1. Open Supabase → **SQL Editor** → *New query*.
2. Paste and run `supabase/migrations/20261101000100_apex_online.sql`.
3. Paste and run `supabase/migrations/20261101000200_apex_seed_main_campaign.sql`
   (creates the campaign *APEX – Arena of the Eternal Will* and the first three invitations;
   it also imports rows from `apex_access` if that table has `email` and `role` columns).
4. Run `supabase/verify_security.sql` and compare with the expected results in its comments:
   - RLS enabled on every `apex_` table → 0 rows
   - client grants → only `SELECT` on `apex_campaign_heads` and `apex_campaign_members` for `authenticated`
   - realtime publication contains `apex_campaign_heads` → 1 row

> Using the Supabase CLI instead? `supabase db push` applies the same files. The old v0.1 draft was
> moved to `supabase/drafts/` so it is **never** executed.

Local verification (any machine with PostgreSQL): `npm run verify:db` runs both migrations twice
against a throw-away database with a Supabase stub and checks the RLS behaviour.

---

## 2. Supabase Auth settings

Authentication → **Providers → Email**:

- **Enable email provider**: on
- **Confirm email**: **on** (invitations are only redeemed for confirmed addresses)
- **Allow new users to sign up**: **off** recommended – create accounts by invitation (below).

Authentication → **URL Configuration**:

- **Site URL**: `https://apex-gray-eta.vercel.app`
- **Redirect URLs**: add `https://apex-gray-eta.vercel.app/**` and your preview pattern,
  e.g. `https://*-invinity-8.vercel.app/**` (needed for password-reset and invite links).

Create the accounts (Authentication → **Users → Invite user**) for:

| Email | Role (from the seed migration) |
|---|---|
| felixbecker924@gmail.com | Game Master |
| hannah.hartmann@unitybox.de | Player |
| beckerjean21@gmail.com | Player |

Each person clicks the invitation email, chooses a password in APEX, and is then let in.
The role is resolved **on the server** from `apex_campaign_invites` / `apex_campaign_members` –
never from user metadata or anything the browser sends.

---

## 3. Vercel environment variables

Vercel → Project → **Settings → Environment Variables**. Add them for **Preview** first.

| Name | Value | Scope | Public? |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `https://xqkyaqxuoaxadpkcdhch.supabase.co` | Preview (later Production) | yes (browser) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API Keys → *publishable* (or legacy *anon*) | Preview (later Production) | yes (browser) |
| `SUPABASE_URL` | same URL | Preview (later Production) | **server only** |
| `SUPABASE_SECRET_KEY` | Supabase → Settings → API Keys → *secret* (or legacy *service_role*) | Preview (later Production) | **server only – never VITE_** |
| `VITE_APEX_ALLOW_DEMO` | `true` on Preview if you want `/?demo`; leave unset on Production | optional | yes |
| `VITE_APEX_ALLOW_SIGNUP` | leave unset (invite-only) | optional | yes |

Redeploy the preview after changing variables (Deployments → ⋯ → *Redeploy*).

> **Why production is safe in the meantime:** without `VITE_SUPABASE_URL` and the publishable key the
> client stays in demo mode, and without `SUPABASE_SECRET_KEY` the API answers `503 not configured`.

---

## 4. Test on the Vercel Preview (required before go-live)

Use three different browsers / private windows.

| # | Check | Expected |
|---|---|---|
| 1 | Open the preview URL signed out | Login page only; `/api/apex?op=state` returns 401 |
| 2 | Sign in as the GM | “Open the arena” → generate (radius 39) → full map with golden arena wall |
| 3 | GM → *Players & Access → Characters* | assign Livia to Hannah, Marcus to Jean (example) |
| 4 | Sign in as Player 1 | only the area around the eagle; no outline, no hidden sites; “Live” indicator green |
| 5 | Player 1 moves their character | GM and Player 2 see the change within ~1 s without reloading |
| 6 | Player 1 tries to move Player 2’s character | refused (“only characters assigned to you”) |
| 7 | GM clicks *Begin Night 1* | both players switch to night within ~1 s; vision shrinks |
| 8 | Reload any browser | same shared state is restored |
| 9 | GM → *Backups* → create / restore | works; a dawn backup appears after *Begin Day 2* |

The same scenarios run automatically against a local mock: `npm run dev:mock` then
`node dev/e2e-online.cjs` (21 checks).

---

## 5. Go-live

1. Merge the reviewed pull request into `main`.
2. Copy the four Supabase variables to the **Production** scope and redeploy.
3. Repeat checks 1, 4, 5 and 7 on `https://apex-gray-eta.vercel.app`.

**Rollback:** remove `VITE_SUPABASE_URL` from Production and redeploy → the site falls back to the
local demo. The shared campaign stays untouched in Supabase (and in the snapshot table).

---

## 6. Operations

- **Backups:** automatic snapshot at every dawn and before every new arena / import / restore
  (last 60 kept, table `apex_state_snapshots`). GM: *Players & Access → Backups*. The GM can also
  export the full campaign as JSON from the header.
- **Audit log:** every command attempt (accepted or rejected) is stored in `apex_command_log`.
- **New players:** GM → *Players & Access → Accounts → Invite a person* (optionally with characters),
  then invite the email address in Supabase Auth.
- **Key rotation:** rotate the secret key in Supabase, update `SUPABASE_SECRET_KEY` in Vercel, redeploy.
