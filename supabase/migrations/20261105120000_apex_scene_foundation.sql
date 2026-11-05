-- The legacy scene points at the campaign's live Arena state. Existing commands,
-- PRE-RELEASE migration: neither this file nor its journal addition is deployed.
-- snapshots and archives continue to use their original tables and world IDs.
create table if not exists public.apex_scenes (
  campaign_id uuid not null references public.apex_campaigns(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  category text not null check (category in ('celestial', 'world', 'region', 'battle')),
  name text not null check (length(btrim(name)) between 1 and 120),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  is_draft boolean not null default true,
  is_legacy_arena boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  archived boolean not null default false,
  published_metadata jsonb,
  primary key (campaign_id, id),
  check (not is_legacy_arena or (category = 'region' and not is_draft))
);

create unique index if not exists apex_scenes_legacy_arena_idx
  on public.apex_scenes (campaign_id) where is_legacy_arena;

create table if not exists public.apex_scene_assignments (
  campaign_id uuid not null,
  user_id uuid not null,
  -- An explicit null is Sanctuary. A missing row inherits the legacy Arena.
  scene_id uuid,
  revision integer not null default 1 check (revision > 0),
  spawn_x double precision,
  spawn_y double precision,
  updated_at timestamptz not null default now(),
  primary key (campaign_id, user_id),
  foreign key (campaign_id, user_id)
    references public.apex_campaign_members (campaign_id, user_id) on delete cascade,
  foreign key (campaign_id, scene_id)
    references public.apex_scenes (campaign_id, id) on delete set null (scene_id)
);

create index if not exists apex_scene_assignments_scene_idx
  on public.apex_scene_assignments (campaign_id, scene_id);

alter table public.apex_scenes enable row level security;
alter table public.apex_scene_assignments enable row level security;
revoke all on public.apex_scenes, public.apex_scene_assignments from public, anon, authenticated;
grant select, insert, update, delete on public.apex_scenes, public.apex_scene_assignments to service_role;

-- Register new campaigns through the same route as the historical backfill.
create or replace function public.apex_register_legacy_arena()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.apex_scenes (campaign_id, category, name, is_draft, is_legacy_arena)
  values (new.id, 'region', 'Arena', false, true)
  on conflict (campaign_id) where is_legacy_arena do nothing;
  return new;
end;
$$;

revoke all on function public.apex_register_legacy_arena() from public, anon, authenticated;
grant execute on function public.apex_register_legacy_arena() to service_role;

create or replace trigger apex_register_legacy_arena
  after insert on public.apex_campaigns
  for each row execute function public.apex_register_legacy_arena();

insert into public.apex_scenes (campaign_id, category, name, is_draft, is_legacy_arena)
select id, 'region', 'Arena', false, true from public.apex_campaigns
on conflict (campaign_id) where is_legacy_arena do nothing;

update public.apex_schema_info
set schema_version = greatest(schema_version, 6), updated_at = now()
where id and schema_version < 6;

create table if not exists public.apex_journals (
  campaign_id uuid not null,
  owner_id uuid not null,
  id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null default '' check (length(body) <= 100000),
  category text not null default 'Personal Notes' check (length(btrim(category)) between 1 and 80),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  pinned boolean not null default false,
  sharing text not null default 'private' check (sharing in ('private', 'gm', 'party')),
  scene_id uuid,
  game_date text not null default '' check (length(game_date) <= 120),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, id),
  foreign key (campaign_id, owner_id) references public.apex_campaign_members(campaign_id, user_id) on delete cascade,
  foreign key (campaign_id, scene_id) references public.apex_scenes(campaign_id, id) on delete set null (scene_id)
);
create index if not exists apex_journals_owner_idx on public.apex_journals(campaign_id, owner_id, pinned desc, created_at desc, id);
create index if not exists apex_journals_sharing_idx on public.apex_journals(campaign_id, sharing, pinned desc, created_at desc, id);
alter table public.apex_journals enable row level security;
revoke all on public.apex_journals from public, anon, authenticated;
grant select, insert, update, delete on public.apex_journals to service_role;

create table if not exists public.apex_scene_transitions (
  campaign_id uuid not null references public.apex_campaigns(id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (campaign_id, request_id)
);
alter table public.apex_scene_transitions enable row level security;
revoke all on public.apex_scene_transitions from public, anon, authenticated;
grant select, insert, delete on public.apex_scene_transitions to service_role;

-- One transaction for the whole selection. Lock the same row used by Arena CAS writes:
-- any command prepared before this transition loses its write race and must revalidate.
create or replace function public.apex_assign_scene(
  p_campaign uuid, p_actor uuid, p_scene uuid, p_targets jsonb, p_request uuid
) returns jsonb language plpgsql set search_path = '' as $$
declare
  previous public.apex_scene_transitions%rowtype;
  destination public.apex_scenes%rowtype;
  target jsonb;
  current_revision integer;
  payload jsonb := jsonb_build_object('scene', p_scene, 'targets', p_targets);
  sx double precision; sy double precision;
  spawn jsonb;
begin
  if not exists (select 1 from public.apex_profiles where campaign_id = p_campaign and user_id = p_actor and role = 'gm' and active) then
    return jsonb_build_object('ok', false, 'error', 'GM permission required.');
  end if;
  perform 1 from public.apex_game_states where campaign_id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Campaign is not initialized.'); end if;
  select * into previous from public.apex_scene_transitions where campaign_id = p_campaign and request_id = p_request;
  if found then
    if previous.actor_id <> p_actor or previous.payload <> payload then return jsonb_build_object('ok', false, 'error', 'Request ID already used.'); end if;
    return jsonb_build_object('ok', true);
  end if;
  if jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) not between 1 and 100 then return jsonb_build_object('ok', false, 'error', 'Invalid selection.'); end if;
  if (select count(*) from jsonb_array_elements(p_targets)) <> (select count(distinct value->>'userId') from jsonb_array_elements(p_targets)) then return jsonb_build_object('ok', false, 'error', 'Duplicate player.'); end if;
  if p_scene is not null then
    select * into destination from public.apex_scenes where campaign_id = p_campaign and id = p_scene for share;
    if not found or destination.is_draft or destination.archived then return jsonb_build_object('ok', false, 'error', 'Destination is unavailable.'); end if;
    if not destination.is_legacy_arena then
      if destination.published_metadata is null then return jsonb_build_object('ok', false, 'error', 'Destination has no published map.'); end if;
      select value into spawn from jsonb_array_elements(destination.published_metadata->'nodes') where value->>'kind' = 'spawn' limit 1;
      if spawn is null then return jsonb_build_object('ok', false, 'error', 'Publish a valid spawn point first.'); end if;
      sx := (spawn->>'x')::double precision; sy := (spawn->>'y')::double precision;
    end if;
  end if;
  -- Validate all targets before touching any assignment.
  for target in select value from jsonb_array_elements(p_targets) loop
    if not exists (select 1 from public.apex_profiles p join public.apex_campaign_members m on m.campaign_id = p.campaign_id and m.user_id = p.user_id
      where p.campaign_id = p_campaign and p.user_id = (target->>'userId')::uuid and p.role = 'player' and p.active and m.role = 'player') then
      return jsonb_build_object('ok', false, 'error', 'Player is not active in this campaign.');
    end if;
    select revision into current_revision from public.apex_scene_assignments where campaign_id = p_campaign and user_id = (target->>'userId')::uuid;
    if coalesce(current_revision, 0) <> (target->>'revision')::integer then return jsonb_build_object('ok', false, 'error', 'Player assignment changed. Refresh the selection.'); end if;
  end loop;
  for target in select value from jsonb_array_elements(p_targets) loop
    insert into public.apex_scene_assignments(campaign_id, user_id, scene_id, revision, spawn_x, spawn_y)
      values(p_campaign, (target->>'userId')::uuid, p_scene, 1, sx, sy)
      on conflict (campaign_id, user_id) do update set scene_id = excluded.scene_id, revision = public.apex_scene_assignments.revision + 1, spawn_x = excluded.spawn_x, spawn_y = excluded.spawn_y, updated_at = now();
  end loop;
  insert into public.apex_scene_transitions(campaign_id, request_id, actor_id, payload) values(p_campaign, p_request, p_actor, payload);
  -- Version-only update: character state, daily MP, inventory and Arena knowledge stay byte-for-byte intact.
  update public.apex_game_states set version = version + 1, updated_at = now(), updated_by = p_actor where campaign_id = p_campaign;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.apex_assign_scene(uuid, uuid, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.apex_assign_scene(uuid, uuid, uuid, jsonb, uuid) to service_role;

create or replace function public.apex_protect_assigned_scene() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.archived and not old.archived and exists(select 1 from public.apex_scene_assignments where campaign_id = old.campaign_id and scene_id = old.id) then
    raise exception 'Return assigned players to Sanctuary before archiving.';
  end if;
  return new;
end $$;
revoke all on function public.apex_protect_assigned_scene() from public, anon, authenticated;
grant execute on function public.apex_protect_assigned_scene() to service_role;
create or replace trigger apex_protect_assigned_scene before update on public.apex_scenes for each row execute function public.apex_protect_assigned_scene();
