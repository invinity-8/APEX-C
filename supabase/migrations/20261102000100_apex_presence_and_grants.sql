-- ============================================================================
-- APEX 0.2.1 – presence timestamp and explicit server grants (idempotent, additive).
-- Safe on a database that already contains campaign data: nothing is deleted.
-- ============================================================================

-- When a member last talked to the server (shown to the GM as "online").
alter table public.apex_campaign_members add column if not exists last_seen_at timestamptz;

-- The server (secret key = service_role) must be able to read and write every APEX table.
-- Supabase usually grants this by default; it is made explicit here so a project with
-- stricter defaults cannot silently break the online mode.
grant usage on schema public to service_role;
grant all on table
  public.apex_campaigns, public.apex_campaign_members, public.apex_campaign_invites,
  public.apex_character_assignments, public.apex_game_states, public.apex_campaign_heads,
  public.apex_state_snapshots, public.apex_command_log
to service_role;
grant usage, select on all sequences in schema public to service_role;
