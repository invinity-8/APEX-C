-- ============================================================================
-- APEX 0.3 – profile + password login, server-side sessions, character sheets
-- (schema version 2).
--
-- * Identity is the "Who are you?" profile. Every profile gets its own stable id
--   (apex_profiles.user_id). APEX no longer uses Supabase Auth (email codes), so the
--   foreign keys from APEX tables to auth.users are detached. No rows are deleted;
--   auth.users and the legacy email columns are left untouched.
-- * Passwords are stored ONLY as Argon2id hashes (PHC string, created by the server)
--   in apex_profile_credentials. Sessions are random tokens stored as SHA-256 hashes.
-- * The first GM password is set with a one-time setup code that only a database
--   owner can create (apex_private.create_gm_setup_code(), Supabase SQL editor).
-- * Character sheets live in apex_character_sheets (optimistic version per sheet);
--   backups are written before an import replaces a sheet.
-- * Live updates: a trigger broadcasts the campaign version on a secret topic
--   (realtime.send, public channel). The topic is handed out only to signed-in profiles.
--
-- Every APEX table keeps RLS on and grants nothing to anon/authenticated.
-- No passwords, hashes, codes or email addresses are contained in this file.
--
-- apex:destructive-reviewed – no DROP TABLE/COLUMN/DELETE. Only foreign-key
-- constraints to auth.users are dropped (the APEX tables are empty in production).
-- ============================================================================

-- ---------------------------------------------------------------- identity: profiles own their id
alter table public.apex_profiles drop constraint if exists apex_profiles_user_id_fkey;
alter table public.apex_campaign_members drop constraint if exists apex_campaign_members_user_id_fkey;
alter table public.apex_campaign_invites drop constraint if exists apex_campaign_invites_accepted_by_fkey;
alter table public.apex_game_states drop constraint if exists apex_game_states_updated_by_fkey;
alter table public.apex_state_snapshots drop constraint if exists apex_state_snapshots_created_by_fkey;
alter table public.apex_command_log drop constraint if exists apex_command_log_user_id_fkey;

alter table public.apex_campaign_members alter column email drop not null;

alter table public.apex_profiles add column if not exists active boolean not null default false;
update public.apex_profiles set user_id = gen_random_uuid() where user_id is null;
alter table public.apex_profiles alter column user_id set default gen_random_uuid();
alter table public.apex_profiles alter column user_id set not null;
create unique index if not exists apex_profiles_user_uq on public.apex_profiles (user_id);

-- Secret Realtime topic per campaign (never readable by browsers).
alter table public.apex_campaigns add column if not exists sync_topic text;
update public.apex_campaigns
   set sync_topic = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
 where sync_topic is null;
alter table public.apex_campaigns
  alter column sync_topic set default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
alter table public.apex_campaigns alter column sync_topic set not null;

-- ---------------------------------------------------------------- credentials, sessions, rate limits
create table if not exists public.apex_profile_credentials (
  campaign_id   uuid not null,
  profile_key   text not null,
  password_hash text not null check (password_hash like '$argon2id$%'),
  updated_by    uuid,
  updated_at    timestamptz not null default now(),
  primary key (campaign_id, profile_key),
  foreign key (campaign_id, profile_key) references public.apex_profiles(campaign_id, profile_key) on delete cascade
);

create table if not exists public.apex_sessions (
  token_hash   text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  campaign_id  uuid not null,
  profile_key  text not null,
  user_id      uuid not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  user_agent   text,
  foreign key (campaign_id, profile_key) references public.apex_profiles(campaign_id, profile_key) on delete cascade
);
create index if not exists apex_sessions_profile_idx on public.apex_sessions (campaign_id, profile_key) where revoked_at is null;

create table if not exists public.apex_login_attempts (
  id          bigint generated always as identity primary key,
  profile_key text not null,
  ip_hash     text not null,
  ok          boolean not null,
  created_at  timestamptz not null default now()
);
create index if not exists apex_login_attempts_profile_idx on public.apex_login_attempts (profile_key, created_at desc);
create index if not exists apex_login_attempts_ip_idx on public.apex_login_attempts (ip_hash, created_at desc);
create index if not exists apex_login_attempts_time_idx on public.apex_login_attempts (created_at desc);

-- One-time GM setup codes (only the SHA-256 hash is stored).
create table if not exists public.apex_setup_codes (
  id          bigint generated always as identity primary key,
  campaign_id uuid not null references public.apex_campaigns(id) on delete cascade,
  code_hash   text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- character sheets
create table if not exists public.apex_character_sheets (
  campaign_id uuid not null references public.apex_campaigns(id) on delete cascade,
  token_id    text not null check (token_id ~ '^[A-Za-z0-9_.-]{1,64}$'),
  data        jsonb not null,
  version     bigint not null default 1,
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  primary key (campaign_id, token_id),
  constraint apex_character_sheets_size check (pg_column_size(data) < 400000)
);

create table if not exists public.apex_character_sheet_backups (
  id          bigint generated always as identity primary key,
  campaign_id uuid not null references public.apex_campaigns(id) on delete cascade,
  token_id    text not null,
  data        jsonb not null,
  version     bigint not null,
  reason      text not null,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists apex_character_sheet_backups_idx on public.apex_character_sheet_backups (campaign_id, token_id, id desc);

-- ---------------------------------------------------------------- GM setup code (database owners only)
create or replace function apex_private.create_gm_setup_code(valid_hours integer default 24) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  raw text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  cid uuid;
begin
  select id into cid from public.apex_campaigns where slug = 'main';
  if cid is null then
    raise exception 'APEX campaign "main" is missing';
  end if;
  -- Only the newest code is valid.
  update public.apex_setup_codes set used_at = now() where used_at is null;
  insert into public.apex_setup_codes (campaign_id, code_hash, expires_at)
  values (cid, encode(sha256(convert_to(raw, 'UTF8')), 'hex'), now() + make_interval(hours => greatest(1, least(coalesce(valid_hours, 24), 168))));
  return substr(raw, 1, 4) || '-' || substr(raw, 5, 4) || '-' || substr(raw, 9, 4) || '-' ||
         substr(raw, 13, 4) || '-' || substr(raw, 17, 4) || '-' || substr(raw, 21, 4);
end;
$$;
revoke all on function apex_private.create_gm_setup_code(integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function apex_private.create_gm_setup_code(integer) from anon, authenticated;
  end if;
end $$;

-- ---------------------------------------------------------------- live updates (Realtime broadcast)
create or replace function apex_private.broadcast_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  topic text;
begin
  select 'apex-sync-' || c.sync_topic into topic from public.apex_campaigns c where c.id = new.campaign_id;
  if topic is null or to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null then
    return new;
  end if;
  begin
    if tg_table_name = 'apex_campaign_heads' then
      perform realtime.send(jsonb_build_object('version', new.version), 'version', topic, false);
    else
      perform realtime.send(jsonb_build_object('sheet', true), 'sheet', topic, false);
    end if;
  exception when others then
    -- Live updates are best effort; clients also poll. Never block a write.
    null;
  end;
  return new;
end;
$$;
revoke all on function apex_private.broadcast_change() from public;

drop trigger if exists apex_campaign_heads_broadcast on public.apex_campaign_heads;
create trigger apex_campaign_heads_broadcast
  after insert or update on public.apex_campaign_heads
  for each row execute function apex_private.broadcast_change();

drop trigger if exists apex_character_sheets_broadcast on public.apex_character_sheets;
create trigger apex_character_sheets_broadcast
  after insert or update on public.apex_character_sheets
  for each row execute function apex_private.broadcast_change();

-- ---------------------------------------------------------------- RLS & privileges
alter table public.apex_profile_credentials     enable row level security;
alter table public.apex_sessions                enable row level security;
alter table public.apex_login_attempts          enable row level security;
alter table public.apex_setup_codes             enable row level security;
alter table public.apex_character_sheets        enable row level security;
alter table public.apex_character_sheet_backups enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.apex_profile_credentials, public.apex_sessions, public.apex_login_attempts,
      public.apex_setup_codes, public.apex_character_sheets, public.apex_character_sheet_backups from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table public.apex_profile_credentials, public.apex_sessions, public.apex_login_attempts,
      public.apex_setup_codes, public.apex_character_sheets, public.apex_character_sheet_backups to service_role;
    grant usage, select on all sequences in schema public to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------- deployment status (schema version 2)
create or replace function public.apex_deploy_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  migrations jsonb := '[]'::jsonb;
  problems text[] := '{}';
  t text;
  apex_tables text[] := array['apex_schema_info','apex_campaigns','apex_campaign_members','apex_campaign_invites',
    'apex_profiles','apex_character_assignments','apex_game_states','apex_campaign_heads','apex_state_snapshots','apex_command_log',
    'apex_profile_credentials','apex_sessions','apex_login_attempts','apex_setup_codes','apex_character_sheets','apex_character_sheet_backups'];
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select coalesce(jsonb_agg(version order by version), ''[]''::jsonb) from supabase_migrations.schema_migrations' into migrations;
  end if;

  foreach t in array apex_tables loop
    if to_regclass('public.' || t) is null then
      problems := problems || format('table %s missing', t);
      continue;
    end if;
    if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = to_regclass('public.' || t)) then
      problems := problems || format('RLS off on %s', t);
    end if;
    if pg_catalog.has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') then
      problems := problems || format('anon has privileges on %s', t);
    end if;
    if pg_catalog.has_table_privilege('authenticated', 'public.' || t, 'INSERT,UPDATE,DELETE')
       or (t not in ('apex_campaign_members', 'apex_campaign_heads')
           and pg_catalog.has_table_privilege('authenticated', 'public.' || t, 'SELECT')) then
      problems := problems || format('browsers have too many privileges on %s', t);
    end if;
  end loop;
  if pg_catalog.has_function_privilege('anon', 'public.apex_deploy_status()', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.apex_deploy_status()', 'EXECUTE') then
    problems := problems || 'apex_deploy_status is callable by browsers'::text;
  end if;
  if pg_catalog.has_function_privilege('anon', 'apex_private.create_gm_setup_code(integer)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'apex_private.create_gm_setup_code(integer)', 'EXECUTE') then
    problems := problems || 'create_gm_setup_code is callable by browsers'::text;
  end if;
  if to_regclass('public.apex_access') is not null or to_regclass('public.apex_invites') is not null
     or exists (select 1 from pg_catalog.pg_trigger where tgname = 'apex_auth_user_access') then
    problems := problems || 'legacy allow-list objects still exist'::text;
  end if;

  return jsonb_build_object(
    'schema_version', (select max(schema_version) from public.apex_schema_info),
    'migrations', migrations,
    'campaign_seeded', exists (select 1 from public.apex_campaigns where slug = 'main'),
    'profiles', (select count(*) from public.apex_profiles p join public.apex_campaigns c on c.id = p.campaign_id where c.slug = 'main'),
    'realtime', exists (select 1 from pg_catalog.pg_trigger where tgname = 'apex_campaign_heads_broadcast'),
    'security_problems', to_jsonb(problems)
  );
end;
$$;
revoke all on function public.apex_deploy_status() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.apex_deploy_status() from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.apex_deploy_status() to service_role;
  end if;
end $$;

update public.apex_schema_info set schema_version = greatest(schema_version, 2), updated_at = now() where id;
