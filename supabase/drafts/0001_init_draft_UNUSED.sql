-- SUPERSEDED (APEX 0.2): this was the v0.1 design draft and is NOT used by the app.
-- It was moved out of supabase/migrations/ so that `supabase db push` never runs it.
-- The real schema lives in supabase/migrations/20261101100000_apex_online.sql.

-- ============================================================================
-- APEX – Entwurf für den Online-Modus (Phase 2)
-- STATUS: ENTWURF, NOCH NICHT AKTIV UND NICHT GEGEN EINE ECHTE DATENBANK GETESTET.
-- Die App nutzt diese Tabellen in Version 0.1 noch nicht.
--
-- Grundidee (siehe docs/SUPABASE.md):
--   * Der volle Spielstand (mit allen Geheimnissen) liegt in game_states und ist
--     ausschließlich für den GM lesbar.
--   * Jeder Spieler liest NUR seine eigene, serverseitig gefilterte Ansicht aus
--     player_views. Diese Zeilen schreibt ausschließlich der Server (Edge Function
--     mit Service-Role-Key), niemals der Browser.
--   * Spieler ändern nichts direkt, sondern legen Commands an. Eine Edge Function
--     prüft sie mit derselben Spiellogik (src/game/commands.ts) und wendet sie an.
-- ============================================================================

create table public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now()
);

create table public.campaign_members (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('gm', 'player')),
  token_id    text,               -- welche Spielfigur gehört diesem Spieler?
  primary key (campaign_id, user_id)
);

-- Voller Spielstand – enthält Geheimnisse!
create table public.game_states (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  state       jsonb not null,
  version     integer not null default 1,   -- für optimistisches Sperren
  updated_at  timestamptz not null default now()
);

-- Gefilterte Ansicht pro Spieler (Ergebnis von buildPlayerView()).
create table public.player_views (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  view        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

-- Warteschlange der Spieleraktionen.
create table public.commands (
  id          bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id     uuid not null references auth.users(id),
  command     jsonb not null,
  status      text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  error       text,
  created_at  timestamptz not null default now()
);

-- Automatische Sicherungen (z. B. einmal pro Arenatag).
create table public.state_snapshots (
  id          bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  day         integer not null,
  state       jsonb not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen (security definer, damit RLS-Policies sich nicht gegenseitig
-- rekursiv aufrufen).
-- ---------------------------------------------------------------------------
create or replace function public.is_member(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from campaign_members where campaign_id = c and user_id = auth.uid());
$$;

create or replace function public.is_gm(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from campaign_members where campaign_id = c and user_id = auth.uid() and role = 'gm');
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.campaigns        enable row level security;
alter table public.campaign_members enable row level security;
alter table public.game_states      enable row level security;
alter table public.player_views     enable row level security;
alter table public.commands         enable row level security;
alter table public.state_snapshots  enable row level security;

-- Kampagnen: Mitglieder sehen ihre Kampagne.
create policy campaigns_select on public.campaigns for select using (public.is_member(id));
create policy campaigns_insert on public.campaigns for insert with check (created_by = auth.uid());

-- Mitglieder: jeder sieht die Mitgliederliste seiner Kampagne, nur der GM verwaltet sie.
create policy members_select on public.campaign_members for select using (public.is_member(campaign_id));
create policy members_gm_all on public.campaign_members for all using (public.is_gm(campaign_id)) with check (public.is_gm(campaign_id));

-- Voller Spielstand: NUR der GM.
create policy state_gm_select on public.game_states for select using (public.is_gm(campaign_id));
create policy state_gm_write  on public.game_states for update using (public.is_gm(campaign_id));
-- Kein Insert/Delete für Clients – das übernimmt die Edge Function (Service Role umgeht RLS).

-- Spieleransicht: jeder liest ausschließlich seine eigene Zeile. Keine Schreibrechte für Clients.
create policy views_own_select on public.player_views for select using (user_id = auth.uid());

-- Commands: eigene anlegen und lesen.
create policy commands_insert on public.commands for insert
  with check (user_id = auth.uid() and public.is_member(campaign_id) and status = 'pending');
create policy commands_select on public.commands for select
  using (user_id = auth.uid() or public.is_gm(campaign_id));

-- Sicherungen: nur GM.
create policy snapshots_gm on public.state_snapshots for select using (public.is_gm(campaign_id));

-- Live-Synchronisierung: Realtime respektiert RLS – jeder Spieler bekommt nur
-- Änderungen an seiner eigenen player_views-Zeile.
alter publication supabase_realtime add table public.player_views;
alter publication supabase_realtime add table public.game_states;
alter publication supabase_realtime add table public.commands;
