-- ============================================================================
-- APEX – campaign profiles ("Who are you?") – idempotent and additive.
--
-- A profile (GM, Hannah, Jean, Simon, Jerba) is linked by the Game Master to ONE
-- account via email. Choosing a profile on the welcome screen grants nothing:
-- the server only sends a sign-in code / opens the campaign when the verified
-- email belongs to the account linked to that profile.
--
-- No email addresses are stored in this file. The GM links them in APEX
-- (Players & Access → Profiles). Profiles without a linked account stay inactive.
-- ============================================================================

create table if not exists public.apex_profiles (
  campaign_id    uuid not null references public.apex_campaigns(id) on delete cascade,
  profile_key    text not null check (profile_key ~ '^[a-z0-9_-]{1,32}$'),
  display_name   text not null,
  character_name text not null,
  role           text not null check (role in ('gm', 'player')),
  token_ids      text[] not null default '{}',
  -- Linked account: email set by the GM (lower-case); user_id filled on first verified sign-in.
  email          text check (email is null or email = lower(email)),
  user_id        uuid references auth.users(id) on delete set null,
  sort           integer not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (campaign_id, profile_key)
);
create unique index if not exists apex_profiles_email_uq on public.apex_profiles (campaign_id, email) where email is not null;

alter table public.apex_profiles enable row level security;
-- Browsers have no direct access at all; the server (/api/apex) uses the secret key.
revoke all on table public.apex_profiles from anon, authenticated;
grant all on table public.apex_profiles to service_role;

-- Seed the five profiles of the main campaign. Existing rows (and their linked
-- accounts) are left untouched.
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
