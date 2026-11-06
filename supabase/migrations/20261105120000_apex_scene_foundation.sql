-- The legacy scene points at the campaign's live Arena state. Existing commands,
-- PRE-RELEASE migration: neither this file nor its journal addition is deployed.
-- snapshots and archives continue to use their original tables and world IDs.
create table if not exists public.apex_scenes (
  campaign_id uuid not null references public.apex_campaigns(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  category text not null check (category in ('celestial', 'world', 'region', 'battle')),
  name text not null check (length(btrim(name)) between 1 and 120),
  parent_scene_id uuid,
  thumbnail_asset_id uuid,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  is_draft boolean not null default true,
  is_legacy_arena boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  published_revision integer not null default 0 check(published_revision >= 0),
  archived boolean not null default false,
  published_metadata jsonb,
  primary key (campaign_id, id),
  foreign key(campaign_id, parent_scene_id) references public.apex_scenes(campaign_id, id) on delete set null (parent_scene_id),
  check (not is_legacy_arena or (category = 'region' and not is_draft))
);

create unique index if not exists apex_scenes_legacy_arena_idx
  on public.apex_scenes (campaign_id) where is_legacy_arena;
create index if not exists apex_scene_library_idx on public.apex_scenes(campaign_id,category,archived,updated_at desc,id);

create table if not exists public.apex_scene_assignments (
  campaign_id uuid not null,
  user_id uuid not null,
  -- Null or missing assignment is Sanctuary. Existing memberships are explicitly backfilled below.
  scene_id uuid,
  revision integer not null default 0 check (revision >= 0),
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

insert into public.apex_scene_assignments(campaign_id, user_id, scene_id, revision)
select m.campaign_id, m.user_id, s.id, 0 from public.apex_campaign_members m
join public.apex_scenes s on s.campaign_id = m.campaign_id and s.is_legacy_arena
where m.role = 'player'
on conflict(campaign_id, user_id) do nothing;

create or replace function public.apex_register_scene_membership() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.role = 'player' then
    insert into public.apex_scene_assignments(campaign_id, user_id, scene_id, revision) values(new.campaign_id, new.user_id, null, 0)
      on conflict(campaign_id, user_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.apex_register_scene_membership() from public, anon, authenticated;
grant execute on function public.apex_register_scene_membership() to service_role;
create or replace trigger apex_register_scene_membership after insert on public.apex_campaign_members for each row execute function public.apex_register_scene_membership();

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
  image_id uuid,
  scene_id uuid,
  game_date text not null default '' check (length(game_date) <= 120),
  search_document tsvector generated always as (to_tsvector('simple'::regconfig, title || ' ' || body || ' ' || category)) stored,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, id),
  foreign key (campaign_id, owner_id) references public.apex_campaign_members(campaign_id, user_id) on delete cascade,
  foreign key (campaign_id, scene_id) references public.apex_scenes(campaign_id, id) on delete set null (scene_id)
);
create index if not exists apex_journals_owner_idx on public.apex_journals(campaign_id, owner_id, pinned desc, created_at desc, id);
create index if not exists apex_journals_sharing_idx on public.apex_journals(campaign_id, sharing, pinned desc, created_at desc, id);
create index if not exists apex_journals_search_idx on public.apex_journals using gin(search_document);
create index if not exists apex_journals_tags_idx on public.apex_journals using gin(tags);
alter table public.apex_journals enable row level security;
revoke all on public.apex_journals from public, anon, authenticated;
grant select, insert, update, delete on public.apex_journals to service_role;

create table if not exists public.apex_scene_assets (
  campaign_id uuid not null,
  scene_id uuid not null,
  id uuid not null,
  audience text not null check (audience in ('gm', 'players')),
  source_path text not null,
  thumbnail_path text not null,
  width integer not null check (width between 1 and 4096),
  height integer not null check (height between 1 and 4096),
  created_at timestamptz not null default now(),
  primary key(campaign_id, id),
  foreign key(campaign_id, scene_id) references public.apex_scenes(campaign_id, id) on delete cascade
);
alter table public.apex_scene_assets enable row level security;
revoke all on public.apex_scene_assets from public, anon, authenticated;
grant select, insert, delete on public.apex_scene_assets to service_role;
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    values('apex-scene-maps', 'apex-scene-maps', false, 2600000, array['image/jpeg','image/png','image/webp'])
    on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

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

-- All scene edits acquire the campaign lock before the scene lock, matching movement/transitions.
-- Private draft writes do not invalidate the independently versioned published map.
create or replace function public.apex_update_scene(p_campaign uuid,p_scene uuid,p_revision integer,p_patch jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare result public.apex_scenes%rowtype;
begin
  perform 1 from public.apex_game_states where campaign_id = p_campaign for update;
  update public.apex_scenes set
    name = case when p_patch ? 'name' then p_patch->>'name' else name end,
    metadata = case when p_patch ? 'metadata' then p_patch->'metadata' else metadata end,
    published_metadata = case when p_patch ? 'published_metadata' then p_patch->'published_metadata' else published_metadata end,
    published_revision = case when p_patch ? 'published_metadata' then published_revision + 1 else published_revision end,
    is_draft = case when p_patch ? 'is_draft' then (p_patch->>'is_draft')::boolean else is_draft end,
    archived = case when p_patch ? 'archived' then (p_patch->>'archived')::boolean else archived end,
    parent_scene_id = case when p_patch ? 'parent_scene_id' then (p_patch->>'parent_scene_id')::uuid else parent_scene_id end,
    thumbnail_asset_id = case when p_patch ? 'thumbnail_asset_id' then (p_patch->>'thumbnail_asset_id')::uuid else thumbnail_asset_id end,
    revision = revision + 1, updated_at = now()
    where campaign_id = p_campaign and id = p_scene and revision = p_revision returning * into result;
  if not found then return null; end if;
  return to_jsonb(result);
end $$;
revoke all on function public.apex_update_scene(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.apex_update_scene(uuid,uuid,integer,jsonb) to service_role;

create or replace function public.apex_notify_scene_publication() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.published_revision <> old.published_revision or new.name <> old.name or new.archived <> old.archived then
    update public.apex_game_states set version = version + 1, updated_at = now() where campaign_id = new.campaign_id;
  end if;
  return new;
end $$;
revoke all on function public.apex_notify_scene_publication() from public,anon,authenticated;
grant execute on function public.apex_notify_scene_publication() to service_role;
create or replace trigger apex_notify_scene_publication after update on public.apex_scenes for each row execute function public.apex_notify_scene_publication();

create table if not exists public.apex_scene_tokens (
  campaign_id uuid not null, scene_id uuid not null, token_id text not null,
  x double precision not null, y double precision not null,
  version integer not null default 1,
  primary key(campaign_id, scene_id, token_id),
  foreign key(campaign_id, scene_id) references public.apex_scenes(campaign_id, id) on delete cascade
);
create table if not exists public.apex_scene_budgets (
  campaign_id uuid not null references public.apex_campaigns(id) on delete cascade,
  token_id text not null, tactical_spent numeric not null default 0, region_spent numeric not null default 0,
  primary key(campaign_id, token_id), check(tactical_spent >= 0 and region_spent >= 0)
);
create table if not exists public.apex_scene_clocks (
  campaign_id uuid primary key references public.apex_campaigns(id) on delete cascade,
  round_epoch integer not null default 0, hour_epoch integer not null default 0
);
create table if not exists public.apex_scene_exploration (
  campaign_id uuid not null, scene_id uuid not null, user_id uuid not null,
  known_nodes jsonb not null default '{}',
  primary key(campaign_id, scene_id, user_id),
  foreign key(campaign_id, scene_id) references public.apex_scenes(campaign_id, id) on delete cascade,
  foreign key(campaign_id, user_id) references public.apex_campaign_members(campaign_id, user_id) on delete cascade
);
create table if not exists public.apex_scene_actions (
  campaign_id uuid not null references public.apex_campaigns(id) on delete cascade,
  request_id uuid not null, actor_id uuid not null, payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key(campaign_id, request_id)
);
alter table public.apex_scene_tokens enable row level security;
alter table public.apex_scene_budgets enable row level security;
alter table public.apex_scene_clocks enable row level security;
alter table public.apex_scene_exploration enable row level security;
alter table public.apex_scene_actions enable row level security;
revoke all on public.apex_scene_tokens, public.apex_scene_budgets, public.apex_scene_clocks, public.apex_scene_exploration, public.apex_scene_actions from public, anon, authenticated;
grant select, insert, update, delete on public.apex_scene_tokens, public.apex_scene_budgets, public.apex_scene_clocks, public.apex_scene_exploration, public.apex_scene_actions to service_role;

create or replace function public.apex_scene_motion_state(p_campaign uuid, p_scene uuid, p_user uuid, p_tokens text[])
returns jsonb language sql stable set search_path = '' as $$
select jsonb_build_object(
  'tokens', coalesce((select jsonb_agg(jsonb_build_object('tokenId', t.token_id, 'x', t.x, 'y', t.y, 'version', t.version, 'tacticalSpent', coalesce(b.tactical_spent, 0), 'regionSpent', coalesce(b.region_spent, 0)))
    from public.apex_scene_tokens t left join public.apex_scene_budgets b using(campaign_id, token_id)
    where t.campaign_id = p_campaign and t.scene_id = p_scene and t.token_id = any(p_tokens)), '[]'::jsonb),
  'round', coalesce((select round_epoch from public.apex_scene_clocks where campaign_id = p_campaign), 0),
  'hour', coalesce((select hour_epoch from public.apex_scene_clocks where campaign_id = p_campaign), 0),
  'budgets', coalesce((select jsonb_object_agg(token_id, jsonb_build_object('tacticalSpent', tactical_spent, 'regionSpent', region_spent)) from public.apex_scene_budgets where campaign_id = p_campaign and token_id = any(p_tokens)), '{}'::jsonb),
  'known', coalesce((select jsonb_agg(value) from public.apex_scene_exploration e cross join lateral jsonb_each(e.known_nodes) where e.campaign_id = p_campaign and e.scene_id = p_scene and e.user_id = p_user), '[]'::jsonb)
);
$$;
revoke all on function public.apex_scene_motion_state(uuid, uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.apex_scene_motion_state(uuid, uuid, uuid, text[]) to service_role;

create or replace function public.apex_write_scene_motion(p_campaign uuid, p_actor uuid, p_input jsonb, p_cost numeric, p_discovered jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  profile public.apex_profiles%rowtype; destination public.apex_scenes%rowtype;
  assignment public.apex_scene_assignments%rowtype; old_token public.apex_scene_tokens%rowtype;
  previous public.apex_scene_actions%rowtype; ledger public.apex_scene_budgets%rowtype;
  state_doc jsonb; v_scene uuid := (p_input->>'sceneId')::uuid; v_token text := p_input->>'tokenId';
  v_request uuid := (p_input->>'requestId')::uuid; v_role text; v_epoch integer; speed numeric; allowance numeric; spent numeric;
  observations jsonb; owner_id uuid;
begin
  select * into profile from public.apex_profiles where campaign_id = p_campaign and user_id = p_actor and active;
  if not found then return jsonb_build_object('ok', false, 'error', 'Profile unavailable.'); end if;
  v_role := profile.role;
  select state into state_doc from public.apex_game_states where campaign_id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Campaign unavailable.'); end if;
  select * into previous from public.apex_scene_actions where campaign_id = p_campaign and request_id = v_request;
  if found then return jsonb_build_object('ok', previous.actor_id = p_actor and previous.payload = p_input, 'error', case when previous.actor_id = p_actor and previous.payload = p_input then null else 'Request ID already used.' end); end if;
  if not (state_doc->'tokens' ? v_token) then return jsonb_build_object('ok', false, 'error', 'Character unavailable.'); end if;
  if v_role <> 'gm' and (not v_token = any(profile.token_ids) or p_input->>'action' <> 'move') then return jsonb_build_object('ok', false, 'error', 'Character is not controlled by you.'); end if;
  select * into destination from public.apex_scenes where campaign_id = p_campaign and id = v_scene for share;
  if not found or destination.is_legacy_arena or destination.archived or destination.is_draft or destination.category not in ('battle','region') or destination.published_revision <> (p_input->>'sceneRevision')::integer then return jsonb_build_object('ok', false, 'error', 'Scene changed.'); end if;
  if v_role <> 'gm' then
    select * into assignment from public.apex_scene_assignments where campaign_id = p_campaign and user_id = p_actor;
    if not found or assignment.scene_id is distinct from v_scene or assignment.revision <> (p_input->>'assignmentRevision')::integer then return jsonb_build_object('ok', false, 'error', 'Assignment changed.'); end if;
  end if;
  if (p_input->>'x')::numeric not between 0 and (destination.published_metadata->>'width')::numeric or (p_input->>'y')::numeric not between 0 and (destination.published_metadata->>'height')::numeric then return jsonb_build_object('ok', false, 'error', 'Invalid position.'); end if;
  select * into old_token from public.apex_scene_tokens where campaign_id = p_campaign and scene_id = v_scene and token_id = v_token;
  if coalesce(old_token.version, 0) <> (p_input->>'tokenVersion')::integer then return jsonb_build_object('ok', false, 'error', 'Token changed.'); end if;
  insert into public.apex_scene_clocks(campaign_id) values(p_campaign) on conflict do nothing;
  insert into public.apex_scene_budgets(campaign_id, token_id) values(p_campaign, v_token) on conflict do nothing;
  select * into ledger from public.apex_scene_budgets where campaign_id = p_campaign and token_id = v_token;
  if destination.category = 'battle' then
    select round_epoch into v_epoch from public.apex_scene_clocks where campaign_id = p_campaign;
    allowance := coalesce((state_doc->'tokens'->v_token->>'speedFt')::numeric, 30) / case when coalesce((state_doc->'tokens'->v_token->>'sneaking')::boolean, false) then 2 else 1 end; spent := ledger.tactical_spent;
  else
    select hour_epoch into v_epoch from public.apex_scene_clocks where campaign_id = p_campaign;
    allowance := coalesce((state_doc->'tokens'->v_token->>'speedFt')::numeric, 30) * 600 / 5280 / case when coalesce((state_doc->'tokens'->v_token->>'sneaking')::boolean, false) then 2 else 1 end; spent := ledger.region_spent;
  end if;
  if p_input->>'action' <> 'place' and (v_epoch <> (p_input->>'epoch')::integer or p_cost <= 0 or p_cost > 1000000 or spent + p_cost > allowance + 0.000001) then return jsonb_build_object('ok', false, 'error', 'Movement exceeds the remaining interval budget or the interval changed.'); end if;
  insert into public.apex_scene_tokens(campaign_id, scene_id, token_id, x, y, version)
    values(p_campaign, v_scene, v_token, (p_input->>'x')::double precision, (p_input->>'y')::double precision, 1)
    on conflict(campaign_id, scene_id, token_id) do update set x = excluded.x, y = excluded.y, version = public.apex_scene_tokens.version + 1;
  if p_input->>'action' <> 'place' then
    if destination.category = 'battle' then update public.apex_scene_budgets set tactical_spent = tactical_spent + p_cost where campaign_id = p_campaign and token_id = v_token;
    else update public.apex_scene_budgets set region_spent = region_spent + p_cost where campaign_id = p_campaign and token_id = v_token; end if;
  end if;
  select user_id into owner_id from public.apex_profiles where campaign_id = p_campaign and role = 'player' and v_token = any(token_ids) limit 1;
  if owner_id is not null then
    select coalesce(jsonb_object_agg(value->>'id', value), '{}'::jsonb) into observations from jsonb_array_elements(p_discovered);
    insert into public.apex_scene_exploration(campaign_id, scene_id, user_id, known_nodes) values(p_campaign, v_scene, owner_id, observations)
      on conflict(campaign_id, scene_id, user_id) do update set known_nodes = public.apex_scene_exploration.known_nodes || excluded.known_nodes;
    -- Current map knowledge is retained first; bound historical snapshots of deleted/replaced markers.
    update public.apex_scene_exploration e set known_nodes = (
      select coalesce(jsonb_object_agg(k.key,k.value),'{}'::jsonb) from (
        select item.key,item.value from jsonb_each(e.known_nodes) item
        order by exists(select 1 from jsonb_array_elements(destination.published_metadata->'nodes') n where n->>'id'=item.key) desc,item.key limit 600
      ) k
    ) where e.campaign_id=p_campaign and e.scene_id=v_scene and e.user_id=owner_id;
  end if;
  insert into public.apex_scene_actions(campaign_id, request_id, actor_id, payload) values(p_campaign, v_request, p_actor, p_input);
  update public.apex_game_states set version = version + 1, updated_at = now(), updated_by = p_actor where campaign_id = p_campaign;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.apex_write_scene_motion(uuid, uuid, jsonb, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.apex_write_scene_motion(uuid, uuid, jsonb, numeric, jsonb) to service_role;

create or replace function public.apex_advance_scene_interval(p_campaign uuid, p_actor uuid, p_interval text, p_expected integer, p_request uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare previous public.apex_scene_actions%rowtype; v_epoch integer; v_payload jsonb := jsonb_build_object('action','advance','interval',p_interval,'expected',p_expected);
begin
  if not exists(select 1 from public.apex_profiles where campaign_id = p_campaign and user_id = p_actor and role = 'gm' and active) then return jsonb_build_object('ok', false, 'error', 'GM permission required.'); end if;
  perform 1 from public.apex_game_states where campaign_id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Campaign unavailable.'); end if;
  select * into previous from public.apex_scene_actions where campaign_id = p_campaign and request_id = p_request;
  if found then return jsonb_build_object('ok', previous.actor_id = p_actor and previous.payload = v_payload); end if;
  if p_interval not in ('round','hour') then return jsonb_build_object('ok', false, 'error', 'Invalid interval.'); end if;
  insert into public.apex_scene_clocks(campaign_id) values(p_campaign) on conflict do nothing;
  select case when p_interval = 'round' then round_epoch else hour_epoch end into v_epoch from public.apex_scene_clocks where campaign_id = p_campaign;
  if v_epoch <> p_expected then return jsonb_build_object('ok', false, 'error', 'Movement interval already advanced.'); end if;
  if p_interval = 'round' then
    update public.apex_scene_clocks set round_epoch = round_epoch + 1 where campaign_id = p_campaign;
    update public.apex_scene_budgets set tactical_spent = 0 where campaign_id = p_campaign;
  else
    update public.apex_scene_clocks set hour_epoch = hour_epoch + 1 where campaign_id = p_campaign;
    update public.apex_scene_budgets set region_spent = 0 where campaign_id = p_campaign;
  end if;
  insert into public.apex_scene_actions(campaign_id, request_id, actor_id, payload) values(p_campaign, p_request, p_actor, v_payload);
  update public.apex_game_states set version = version + 1, updated_at = now(), updated_by = p_actor where campaign_id = p_campaign;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.apex_advance_scene_interval(uuid, uuid, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.apex_advance_scene_interval(uuid, uuid, text, integer, uuid) to service_role;

create table if not exists public.apex_party_locations (
  campaign_id uuid not null, scene_id uuid not null, node_id text not null, revision integer not null default 1,
  primary key(campaign_id, scene_id),
  foreign key(campaign_id, scene_id) references public.apex_scenes(campaign_id, id) on delete cascade
);
create table if not exists public.apex_scene_travel (
  campaign_id uuid not null, scene_id uuid not null, id uuid not null, proposed_by uuid not null,
  from_node text not null, to_node text not null, route_id text not null,
  total_hours numeric not null check(total_hours >= 0), elapsed_hours numeric not null default 0 check(elapsed_hours >= 0),
  status text not null check(status in ('proposed','traveling','complete','cancelled')),
  version integer not null default 1, scene_revision integer not null,
  created_at timestamptz not null default now(),
  primary key(campaign_id, id),
  foreign key(campaign_id, scene_id) references public.apex_scenes(campaign_id, id) on delete cascade,
  foreign key(campaign_id, proposed_by) references public.apex_campaign_members(campaign_id, user_id) on delete cascade
);
create unique index if not exists apex_one_active_world_journey on public.apex_scene_travel(campaign_id,scene_id) where status = 'traveling';
create index if not exists apex_scene_travel_recent_idx on public.apex_scene_travel(campaign_id,scene_id,created_at desc);
alter table public.apex_party_locations enable row level security;
alter table public.apex_scene_travel enable row level security;
revoke all on public.apex_party_locations, public.apex_scene_travel from public, anon, authenticated;
grant select, insert, update, delete on public.apex_party_locations, public.apex_scene_travel to service_role;

create or replace function public.apex_world_travel_action(p_campaign uuid, p_actor uuid, p_scene uuid, p_input jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  profile public.apex_profiles%rowtype; scene public.apex_scenes%rowtype; location public.apex_party_locations%rowtype;
  journey public.apex_scene_travel%rowtype; previous public.apex_scene_actions%rowtype;
  action text := p_input->>'action'; v_request_id uuid := (p_input->>'requestId')::uuid;
  v_payload jsonb := p_input || jsonb_build_object('sceneId',p_scene);
  route jsonb; destination text; known jsonb; node_count integer; next_hours numeric; next_status text;
begin
  select * into profile from public.apex_profiles where campaign_id = p_campaign and user_id = p_actor and active;
  if not found then return jsonb_build_object('ok',false,'error','Profile unavailable.'); end if;
  if profile.role <> 'gm' and action <> 'propose' then return jsonb_build_object('ok',false,'error','GM permission required.'); end if;
  perform 1 from public.apex_game_states where campaign_id = p_campaign for update;
  if not found then return jsonb_build_object('ok',false,'error','Campaign unavailable.'); end if;
  select * into previous from public.apex_scene_actions where campaign_id = p_campaign and public.apex_scene_actions.request_id = v_request_id;
  if found then return jsonb_build_object('ok',previous.actor_id = p_actor and previous.payload = v_payload); end if;
  select * into scene from public.apex_scenes where campaign_id = p_campaign and id = p_scene for share;
  if not found or scene.category <> 'world' or scene.is_draft or scene.archived or scene.published_revision <> (p_input->>'sceneRevision')::integer then return jsonb_build_object('ok',false,'error','World scene changed.'); end if;
  if profile.role <> 'gm' and not exists(select 1 from public.apex_scene_assignments where campaign_id = p_campaign and user_id = p_actor and scene_id = p_scene and revision = (p_input->>'assignmentRevision')::integer) then return jsonb_build_object('ok',false,'error','Assignment changed.'); end if;
  select * into location from public.apex_party_locations where campaign_id = p_campaign and scene_id = p_scene;
  if action in ('locate','propose') and coalesce(location.revision,0) <> (p_input->>'partyRevision')::integer then return jsonb_build_object('ok',false,'error','Party location changed.'); end if;
  if action = 'locate' then
    if not exists(select 1 from jsonb_array_elements(scene.published_metadata->'nodes') where value->>'id' = p_input->>'nodeId' and value->>'kind' = 'location') then return jsonb_build_object('ok',false,'error','Choose a location node.'); end if;
    if exists(select 1 from public.apex_scene_travel where campaign_id = p_campaign and scene_id = p_scene and status = 'traveling') then return jsonb_build_object('ok',false,'error','Cancel or complete the current journey first.'); end if;
    insert into public.apex_party_locations(campaign_id,scene_id,node_id) values(p_campaign,p_scene,p_input->>'nodeId') on conflict(campaign_id,scene_id) do update set node_id = excluded.node_id, revision = public.apex_party_locations.revision + 1;
  elsif action = 'propose' then
    if location.node_id is null then return jsonb_build_object('ok',false,'error','The GM must set the party location first.'); end if;
    if exists(select 1 from public.apex_scene_travel where campaign_id = p_campaign and scene_id = p_scene and status = 'traveling') then return jsonb_build_object('ok',false,'error','The party is already traveling.'); end if;
    select value into route from jsonb_array_elements(scene.published_metadata->'routes') where value->>'id' = p_input->>'routeId' and (value->>'visible')::boolean;
    if route is null or location.node_id not in (route->>'from',route->>'to') then return jsonb_build_object('ok',false,'error','Route unavailable.'); end if;
    destination := case when location.node_id = route->>'from' then route->>'to' else route->>'from' end;
    select known_nodes into known from public.apex_scene_exploration where campaign_id = p_campaign and scene_id = p_scene and user_id = p_actor;
    select count(*) into node_count from jsonb_array_elements(scene.published_metadata->'nodes') where value->>'id' in (location.node_id,destination) and ((value->>'visible')::boolean or coalesce(known ? (value->>'id'),false));
    if node_count <> 2 then return jsonb_build_object('ok',false,'error','Destination is not known or accessible.'); end if;
    insert into public.apex_scene_travel(campaign_id,scene_id,id,proposed_by,from_node,to_node,route_id,total_hours,status,scene_revision)
      values(p_campaign,p_scene,v_request_id,p_actor,location.node_id,destination,route->>'id',(route->>'hours')::numeric,'proposed',scene.published_revision);
  elsif action in ('confirm','progress','cancel') then
    select * into journey from public.apex_scene_travel where campaign_id = p_campaign and scene_id = p_scene and id = (p_input->>'proposalId')::uuid;
    if not found or journey.version <> (p_input->>'version')::integer then return jsonb_build_object('ok',false,'error','Journey changed.'); end if;
    if action = 'confirm' then
      if journey.status <> 'proposed' or journey.scene_revision <> scene.published_revision or location.node_id is distinct from journey.from_node then return jsonb_build_object('ok',false,'error','Proposal is no longer valid.'); end if;
      if exists(select 1 from public.apex_scene_travel where campaign_id = p_campaign and scene_id = p_scene and status = 'traveling') then return jsonb_build_object('ok',false,'error','Another journey is already active.'); end if;
      update public.apex_scene_travel set status = case when total_hours = 0 then 'complete' else 'traveling' end, version = version + 1 where campaign_id = p_campaign and id = journey.id;
      if journey.total_hours = 0 then update public.apex_party_locations set node_id = journey.to_node, revision = revision + 1 where campaign_id = p_campaign and scene_id = p_scene; end if;
    elsif action = 'progress' then
      if journey.status <> 'traveling' or journey.scene_revision <> scene.published_revision or (p_input->>'hours')::numeric <= 0 then return jsonb_build_object('ok',false,'error','Journey is not active or the world map changed.'); end if;
      next_hours := least(journey.total_hours,journey.elapsed_hours + (p_input->>'hours')::numeric);
      next_status := case when next_hours >= journey.total_hours then 'complete' else 'traveling' end;
      update public.apex_scene_travel set elapsed_hours = next_hours, status = next_status, version = version + 1 where campaign_id = p_campaign and id = journey.id;
      if next_status = 'complete' then update public.apex_party_locations set node_id = journey.to_node, revision = revision + 1 where campaign_id = p_campaign and scene_id = p_scene; end if;
    else
      if journey.status not in ('proposed','traveling') then return jsonb_build_object('ok',false,'error','Journey already finished.'); end if;
      update public.apex_scene_travel set status = 'cancelled', version = version + 1 where campaign_id = p_campaign and id = journey.id;
    end if;
  else return jsonb_build_object('ok',false,'error','Unknown travel action.');
  end if;
  insert into public.apex_scene_actions(campaign_id,request_id,actor_id,payload) values(p_campaign,v_request_id,p_actor,v_payload);
  update public.apex_game_states set version = version + 1, updated_at = now(), updated_by = p_actor where campaign_id = p_campaign;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.apex_world_travel_action(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apex_world_travel_action(uuid,uuid,uuid,jsonb) to service_role;

create table if not exists public.apex_sanctuary_settings (
  campaign_id uuid primary key references public.apex_campaigns(id) on delete cascade,
  atmosphere text not null default 'hall' check(atmosphere in ('hall','campfire','starlight')),
  default_asset uuid,
  backgrounds jsonb not null default '[]' check(jsonb_typeof(backgrounds) = 'array' and jsonb_array_length(backgrounds) <= 20),
  revision integer not null default 1 check(revision > 0)
);
alter table public.apex_sanctuary_settings enable row level security;
revoke all on public.apex_sanctuary_settings from public,anon,authenticated;
grant select,insert,update on public.apex_sanctuary_settings to service_role;

create table if not exists public.apex_journal_images (
  campaign_id uuid not null, entry_id uuid not null, owner_id uuid not null, id uuid not null,
  source_path text not null, thumbnail_path text not null,
  mime text not null check(mime in ('image/jpeg','image/png','image/webp')),
  created_at timestamptz not null default now(),
  primary key(campaign_id,id),
  foreign key(campaign_id,entry_id) references public.apex_journals(campaign_id,id) on delete cascade,
  foreign key(campaign_id,owner_id) references public.apex_campaign_members(campaign_id,user_id) on delete cascade
);
alter table public.apex_journal_images enable row level security;
revoke all on public.apex_journal_images from public,anon,authenticated;
grant select,insert,delete on public.apex_journal_images to service_role;
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('apex-journal-images','apex-journal-images',false,2600000,array['image/jpeg','image/png','image/webp'])
    on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
