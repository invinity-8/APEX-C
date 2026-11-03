-- ============================================================================
-- APEX 0.7 – player feedback (bug reports, feature requests, improvements).
-- Schema version 5. Additive only.
--
-- * apex_feedback: one small row per report – never a copy of the game world.
--   Optional screenshots live in the existing PRIVATE bucket "apex-portraits"
--   under <campaign>/feedback/… (validated by the server, signed URLs only).
-- * Character snapshots reuse apex_character_sheet_backups (jsonb "data" with
--   kind = 'apex-character-snapshot'); no schema change needed for them.
-- Server only (service_role); browsers have no access.
-- ============================================================================

create table if not exists public.apex_feedback (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.apex_campaigns(id) on delete cascade,
  user_id          uuid,
  profile_key      text,
  token_id         text,
  kind             text not null check (kind in ('bug', 'feature', 'improvement')),
  category         text not null default 'other' check (length(category) <= 40),
  title            text not null check (length(title) between 1 and 140),
  description      text not null default '' check (length(description) <= 5000),
  steps            text not null default '' check (length(steps) <= 3000),
  page             text not null default '' check (length(page) <= 120),
  app_version      text not null default '' check (length(app_version) <= 40),
  screenshot_path  text,
  status           text not null default 'new' check (status in ('new', 'acknowledged', 'in_progress', 'resolved', 'rejected')),
  gm_notes         text not null default '' check (length(gm_notes) <= 3000),
  shared           boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  status_changed_at timestamptz
);
create index if not exists apex_feedback_campaign_idx on public.apex_feedback (campaign_id, created_at desc);
create index if not exists apex_feedback_user_idx on public.apex_feedback (campaign_id, user_id, created_at desc);

alter table public.apex_feedback enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.apex_feedback from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table public.apex_feedback to service_role;
  end if;
end $$;

update public.apex_schema_info set schema_version = greatest(schema_version, 5), updated_at = now() where id;
