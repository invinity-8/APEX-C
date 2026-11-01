-- ============================================================================
-- APEX – authoritative database baseline (schema version 1)
--
-- This single migration defines the complete APEX backend. It replaces the
-- never-deployed v0.2 drafts and retires the legacy allow-list
-- (migration 20261101094428, marked "reverted" in the history; see
-- docs/MIGRATIONS_DE.md). It contains NO email addresses or secrets –
-- accounts are linked by the Game Master in the app.
--
-- Security model
--   * Browsers never access campaign data through PostgREST. All reads/writes go
--     through the Vercel Function /api/apex (secret key, server-side only).
--   * RLS is enabled on every APEX table. Clients may only read
--       - their own membership rows (apex_campaign_members)
--       - the version counter of their campaign (apex_campaign_heads, Realtime ping)
--   * Helper functions live in the non-exposed schema apex_private.
--
-- apex:destructive-reviewed – the only destructive statements remove the
-- legacy allow-list objects (backed up before deployment, see docs/MIGRATIONS_DE.md).
-- ============================================================================

create schema if not exists apex_private;
revoke all on schema apex_private from public;

-- ---------------------------------------------------------------- retire legacy allow-list
-- The legacy trigger on auth.users ran on every sign-up; it is no longer needed.
drop trigger if exists apex_auth_user_access on auth.users;
drop function if exists apex_private.sync_access_from_invites();
drop table if exists public.apex_access;
drop table if exists public.apex_invites;

-- ---------------------------------------------------------------- schema version
-- The server refuses to run against an older schema (see REQUIRED_SCHEMA_VERSION in src/server).
create table if not exists public.apex_schema_info (
  id             boolean primary key default true check (id),
  schema_version integer not null,
  updated_at     timestamptz not null default now()
);
insert into public.apex_schema_info (id, schema_version) values (true, 1)
on conflict (id) do update set schema_version = greatest(public.apex_schema_info.schema_version, excluded.schema_version), updated_at = now();

-- ---------------------------------------------------------------- campaigns & accounts
create table if not exists public.apex_campaigns (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.apex_campaign_members (
  campaign_id  uuid not null references public.apex_campaigns(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  email        text not null,
  role         text not null check (role in ('gm', 'player')),
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

-- Invitations by email, redeemed server-side on the first verified sign-in.
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

-- "Who are you?" profiles. A profile only opens for the account linked to it.
create table if not exists public.apex_profiles (
  campaign_id    uuid not null references public.apex_campaigns(id) on delete cascade,
  profile_key    text not null check (profile_key ~ '^[a-z0-9_-]{1,32}$'),
  display_name   text not null,
  character_name text not null,
  role           text not null check (role in ('gm', 'player')),
  token_ids      text[] not null default '{}',
  email          text check (email is null or email = lower(email)),
  user_id        uuid references auth.users(id) on delete set null,
  sort           integer not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (campaign_id, profile_key)
);
create unique index if not exists apex_profiles_email_uq on public.apex_profiles (campaign_id, email) where email is not null;

-- Which account controls which character token (one owner per character).
create table if not exists public.apex_character_assignments (
  campaign_id uuid not null,
  token_id    text not null,
  user_id     uuid not null,
  created_at  timestamptz not null default now(),
  primary key (campaign_id, token_id),
  foreign key (campaign_id, user_id) references public.apex_campaign_members(campaign_id, user_id) on delete cascade
);

-- ---------------------------------------------------------------- game state, sync, backups, audit
create table if not exists public.apex_game_states (
  campaign_id uuid primary key references public.apex_campaigns(id) on delete cascade,
  state       jsonb not null,
  version     bigint not null default 1,
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

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

-- ---------------------------------------------------------------- functions (non-exposed schema)
create or replace function apex_private.touch_head() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.apex_campaign_heads (campaign_id, version, updated_at)
  values (new.campaign_id, new.version, now())
  on conflict (campaign_id) do update set version = excluded.version, updated_at = excluded.updated_at;
  return new;
end;
$$;
revoke all on function apex_private.touch_head() from public;

drop trigger if exists apex_game_states_touch_head on public.apex_game_states;
create trigger apex_game_states_touch_head
  after insert or update of version on public.apex_game_states
  for each row execute function apex_private.touch_head();

create or replace function apex_private.is_member(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.apex_campaign_members m where m.campaign_id = c and m.user_id = (select auth.uid()));
$$;
revoke all on function apex_private.is_member(uuid) from public;
grant usage on schema apex_private to authenticated;
grant execute on function apex_private.is_member(uuid) to authenticated;

-- Deployment status for /api/apex?op=health (server only: executable by service_role, not by browsers).
create or replace function public.apex_deploy_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  migrations jsonb := '[]'::jsonb;
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select coalesce(jsonb_agg(version order by version), ''[]''::jsonb) from supabase_migrations.schema_migrations' into migrations;
  end if;
  return jsonb_build_object(
    'schema_version', (select max(schema_version) from public.apex_schema_info),
    'migrations', migrations,
    'campaign_seeded', exists (select 1 from public.apex_campaigns where slug = 'main'),
    'profiles', (select count(*) from public.apex_profiles p join public.apex_campaigns c on c.id = p.campaign_id where c.slug = 'main'),
    'realtime', exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'apex_campaign_heads')
  );
end;
$$;
revoke all on function public.apex_deploy_status() from public, anon, authenticated;
grant execute on function public.apex_deploy_status() to service_role;

-- ---------------------------------------------------------------- RLS & privileges
alter table public.apex_schema_info           enable row level security;
alter table public.apex_campaigns             enable row level security;
alter table public.apex_campaign_members      enable row level security;
alter table public.apex_campaign_invites      enable row level security;
alter table public.apex_profiles              enable row level security;
alter table public.apex_character_assignments enable row level security;
alter table public.apex_game_states           enable row level security;
alter table public.apex_campaign_heads        enable row level security;
alter table public.apex_state_snapshots       enable row level security;
alter table public.apex_command_log           enable row level security;

revoke all on table
  public.apex_schema_info, public.apex_campaigns, public.apex_campaign_members, public.apex_campaign_invites,
  public.apex_profiles, public.apex_character_assignments, public.apex_game_states, public.apex_campaign_heads,
  public.apex_state_snapshots, public.apex_command_log
from anon, authenticated;

grant all on table
  public.apex_schema_info, public.apex_campaigns, public.apex_campaign_members, public.apex_campaign_invites,
  public.apex_profiles, public.apex_character_assignments, public.apex_game_states, public.apex_campaign_heads,
  public.apex_state_snapshots, public.apex_command_log
to service_role;
grant usage, select on all sequences in schema public to service_role;

grant select on public.apex_campaign_members to authenticated;
grant select on public.apex_campaign_heads   to authenticated;

drop policy if exists apex_members_read_own on public.apex_campaign_members;
create policy apex_members_read_own on public.apex_campaign_members
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists apex_heads_read_member on public.apex_campaign_heads;
create policy apex_heads_read_member on public.apex_campaign_heads
  for select to authenticated using (apex_private.is_member(campaign_id));

-- ---------------------------------------------------------------- Realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'apex_campaign_heads') then
    alter publication supabase_realtime add table public.apex_campaign_heads;
  end if;
end $$;

-- ---------------------------------------------------------------- seed: campaign + five profiles (no emails)
insert into public.apex_campaigns (slug, name)
values ('main', 'APEX – Arena of the Eternal Will')
on conflict (slug) do nothing;

insert into public.apex_profiles (campaign_id, profile_key, display_name, character_name, role, token_ids, sort)
select c.id, v.profile_key, v.display_name, v.character_name, v.role, v.token_ids, v.sort
from public.apex_campaigns c
cross join (values
  ('gm',     'GM',     'All characters', 'gm',     '{}'::text[],      0),
  ('hannah', 'Hannah', 'Sinna',          'player', '{sinna}'::text[], 1),
  ('jean',   'Jean',   'Aster',          'player', '{aster}'::text[], 2),
  ('simon',  'Simon',  'Elwin',          'player', '{elwin}'::text[], 3),
  ('jerba',  'Jerba',  'Javi',           'player', '{javi}'::text[],  4)
) as v(profile_key, display_name, character_name, role, token_ids, sort)
where c.slug = 'main'
on conflict (campaign_id, profile_key) do nothing;
