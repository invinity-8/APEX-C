-- The legacy scene points at the campaign's live Arena state. Existing commands,
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
