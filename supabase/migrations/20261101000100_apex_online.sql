-- ============================================================================
-- APEX 0.2 – online multiplayer schema
--
-- Idempotent: safe to run more than once, and safe whether or not the old draft
-- (supabase/drafts/0001_init_draft_UNUSED.sql) or the manually created
-- apex_invites / apex_access tables exist. Those tables are NOT modified.
--
-- Security model
--   * Browsers never read or write campaign data through PostgREST.
--     All reads/writes go through the Vercel Function /api/apex, which verifies the
--     user's access token and uses the secret key (bypasses RLS).
--   * RLS is enabled on every table. The only client-visible rows are:
--       - apex_campaign_members: a user may read their own membership rows
--       - apex_campaign_heads:   members may read the version counter of their
--                                campaign (used as a Supabase Realtime "something changed" ping)
--   * The full game state (with GM secrets) is never exposed to clients.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table if not exists public.apex_campaigns (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.apex_campaign_members (
  campaign_id uuid not null references public.apex_campaigns(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  email       text not null,
  role        text not null check (role in ('gm', 'player')),
  created_at  timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

-- Invitations by email. Redeemed server-side on first login (confirmed email only).
create table if not exists public.apex_campaign_invites (
  campaign_id uuid not null references public.apex_campaigns(id) on delete cascade,
  email       text not null check (email = lower(email)),
  role        text not null check (role in ('gm', 'player')),
  token_ids   text[] not null default '{}',
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  primary key (campaign_id, email)
);

-- Which account controls which character token. One owner per character;
-- a user may own several characters.
create table if not exists public.apex_character_assignments (
  campaign_id uuid not null,
  token_id    text not null,
  user_id     uuid not null,
  created_at  timestamptz not null default now(),
  primary key (campaign_id, token_id),
  foreign key (campaign_id, user_id) references public.apex_campaign_members(campaign_id, user_id) on delete cascade
);

-- Authoritative game state (contains GM secrets!). Server access only.
create table if not exists public.apex_game_states (
  campaign_id uuid primary key references public.apex_campaigns(id) on delete cascade,
  state       jsonb not null,
  version     bigint not null default 1,
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- Tiny public "version counter" per campaign, broadcast via Realtime.
create table if not exists public.apex_campaign_heads (
  campaign_id uuid primary key references public.apex_campaigns(id) on delete cascade,
  version     bigint not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.apex_state_snapshots (
  id          bigint generated always as identity primary key,
  campaign_id uuid not null references public.apex_campaigns(id) on delete cascade,
  version     bigint not null,
  label       text not null,
  state       jsonb not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists apex_state_snapshots_campaign_idx on public.apex_state_snapshots (campaign_id, id desc);

create table if not exists public.apex_command_log (
  id          bigint generated always as identity primary key,
  campaign_id uuid not null references public.apex_campaigns(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  role        text not null,
  command     jsonb not null,
  ok          boolean not null,
  error       text,
  version     bigint,
  created_at  timestamptz not null default now()
);
create index if not exists apex_command_log_campaign_idx on public.apex_command_log (campaign_id, id desc);

-- ---------------------------------------------------------------- head trigger

create or replace function public.apex_touch_head() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.apex_campaign_heads (campaign_id, version, updated_at)
  values (new.campaign_id, new.version, now())
  on conflict (campaign_id) do update set version = excluded.version, updated_at = excluded.updated_at;
  return new;
end;
$$;

drop trigger if exists apex_game_states_touch_head on public.apex_game_states;
create trigger apex_game_states_touch_head
  after insert or update of version on public.apex_game_states
  for each row execute function public.apex_touch_head();

-- ---------------------------------------------------------------- helpers

create or replace function public.apex_is_member(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.apex_campaign_members where campaign_id = c and user_id = auth.uid());
$$;
revoke all on function public.apex_is_member(uuid) from public;
grant execute on function public.apex_is_member(uuid) to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.apex_campaigns             enable row level security;
alter table public.apex_campaign_members      enable row level security;
alter table public.apex_campaign_invites      enable row level security;
alter table public.apex_character_assignments enable row level security;
alter table public.apex_game_states           enable row level security;
alter table public.apex_campaign_heads        enable row level security;
alter table public.apex_state_snapshots       enable row level security;
alter table public.apex_command_log           enable row level security;

-- Clients get no table privileges except the two read-only views below.
revoke all on table
  public.apex_campaigns, public.apex_campaign_members, public.apex_campaign_invites,
  public.apex_character_assignments, public.apex_game_states, public.apex_campaign_heads,
  public.apex_state_snapshots, public.apex_command_log
from anon, authenticated;

grant select on public.apex_campaign_members to authenticated;
grant select on public.apex_campaign_heads   to authenticated;

drop policy if exists apex_members_read_own on public.apex_campaign_members;
create policy apex_members_read_own on public.apex_campaign_members
  for select to authenticated using (user_id = auth.uid());

drop policy if exists apex_heads_read_member on public.apex_campaign_heads;
create policy apex_heads_read_member on public.apex_campaign_heads
  for select to authenticated using (public.apex_is_member(campaign_id));

-- ---------------------------------------------------------------- Realtime

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'apex_campaign_heads'
     ) then
    alter publication supabase_realtime add table public.apex_campaign_heads;
  end if;
end $$;
