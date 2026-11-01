-- ============================================================================
-- APEX – World Management: durable world archives and safe world transitions
-- (schema version 4). Additive.
--
-- * apex_world_archives: complete, restorable copies of a world (the whole game state:
--   seed, map, hexes, day/night, shrinking, positions, Fog-of-War knowledge, events, log,
--   character resources and inventories) with name, description and reason. Never pruned.
-- * apex_world_transition(): ONE transaction that
--     1. locks the campaign's game state row,
--     2. checks the expected version (nobody changed the world in the meantime),
--     3. copies the CURRENT world into an archive (server-side, no round trip of the data),
--     4. optionally replaces the world with a new state and bumps the version.
--   If any step fails, nothing changes – the previous world stays active and loadable.
--   With p_new_state = null it only archives (Archive World).
-- * Accounts, passwords, profiles, permissions, character sheets are in other tables and are
--   never touched by a world transition.
-- Server only (service_role); browsers have no access.
-- ============================================================================

create table if not exists public.apex_world_archives (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.apex_campaigns(id) on delete cascade,
  name          text not null check (length(name) between 1 and 120),
  description   text not null default '' check (length(description) <= 2000),
  kind          text not null check (kind in ('manual', 'before-create', 'before-reset', 'before-restore')),
  state         jsonb not null,
  state_version bigint not null,
  world_id      text,
  world_name    text,
  seed          bigint,
  radius        integer,
  day           integer,
  phase         text,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists apex_world_archives_campaign_idx on public.apex_world_archives (campaign_id, created_at desc);

alter table public.apex_world_archives enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.apex_world_archives from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table public.apex_world_archives to service_role;
  end if;
end $$;

create or replace function public.apex_world_transition(
  p_campaign uuid,
  p_expected_version bigint,
  p_new_state jsonb,
  p_archive_name text,
  p_archive_description text,
  p_archive_kind text,
  p_user uuid
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  cur public.apex_game_states%rowtype;
  archive_id uuid;
  new_version bigint;
begin
  select * into cur from public.apex_game_states where campaign_id = p_campaign for update;
  if not found then
    raise exception 'apex:no_world' using errcode = 'P0001';
  end if;
  if p_expected_version is not null and cur.version <> p_expected_version then
    raise exception 'apex:version_conflict' using errcode = 'P0001';
  end if;

  insert into public.apex_world_archives (campaign_id, name, description, kind, state, state_version, world_id, world_name, seed, radius, day, phase, created_by)
  values (
    p_campaign,
    left(coalesce(nullif(trim(p_archive_name), ''), 'Archived world'), 120),
    left(coalesce(p_archive_description, ''), 2000),
    p_archive_kind,
    cur.state,
    cur.version,
    cur.state #>> '{world,id}',
    cur.state #>> '{world,name}',
    (cur.state #>> '{config,seed}')::bigint,
    (cur.state #>> '{config,mapRadius}')::integer,
    (cur.state ->> 'day')::integer,
    cur.state ->> 'phase',
    p_user
  )
  returning id into archive_id;

  new_version := cur.version;
  if p_new_state is not null then
    new_version := cur.version + 1;
    update public.apex_game_states
       set state = p_new_state, version = new_version, updated_by = p_user, updated_at = now()
     where campaign_id = p_campaign;
  end if;

  return jsonb_build_object('archive_id', archive_id, 'version', new_version, 'archived_version', cur.version);
end;
$$;
revoke all on function public.apex_world_transition(uuid, bigint, jsonb, text, text, text, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.apex_world_transition(uuid, bigint, jsonb, text, text, text, uuid) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.apex_world_transition(uuid, bigint, jsonb, text, text, text, uuid) to service_role;
  end if;
end $$;

update public.apex_schema_info set schema_version = greatest(schema_version, 4), updated_at = now() where id;
