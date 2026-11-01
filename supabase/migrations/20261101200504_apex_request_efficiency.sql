-- ============================================================================
-- APEX – request efficiency and idempotent commands (schema version 3). Additive.
--
-- * apex_authenticate(): validates a session and returns session + profile + password flag
--   + campaign name/topic in ONE round trip, and refreshes the session's last contact at most
--   every p_touch_after_seconds (presence). Replaces 4–5 sequential REST calls per request.
--   Server only (service_role); browsers cannot execute it.
-- * apex_command_log.request_id: client-generated id of a state-changing request. A unique
--   index makes the reservation atomic, so a repeated or retried request is never applied twice.
-- ============================================================================

alter table public.apex_command_log add column if not exists request_id text
  check (request_id is null or request_id ~ '^[A-Za-z0-9_-]{8,64}$');
create unique index if not exists apex_command_log_request_uq
  on public.apex_command_log (campaign_id, request_id) where request_id is not null;

create or replace function public.apex_authenticate(
  p_token_hash text,
  p_touch_after_seconds integer default 30,
  p_idle_seconds integer default 1209600,
  p_absolute_seconds integer default 2592000
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.apex_sessions%rowtype;
  p public.apex_profiles%rowtype;
  c public.apex_campaigns%rowtype;
  pw boolean;
begin
  select * into s from public.apex_sessions where token_hash = p_token_hash;
  if not found or s.revoked_at is not null or s.expires_at <= now()
     or s.created_at + make_interval(secs => p_absolute_seconds) <= now() then
    return null;
  end if;
  select * into p from public.apex_profiles where campaign_id = s.campaign_id and profile_key = s.profile_key;
  select * into c from public.apex_campaigns where id = s.campaign_id;
  pw := exists (select 1 from public.apex_profile_credentials where campaign_id = s.campaign_id and profile_key = s.profile_key);
  if s.last_seen_at < now() - make_interval(secs => p_touch_after_seconds) then
    update public.apex_sessions
       set last_seen_at = now(),
           expires_at = least(now() + make_interval(secs => p_idle_seconds), s.created_at + make_interval(secs => p_absolute_seconds))
     where token_hash = p_token_hash;
  end if;
  return jsonb_build_object(
    'session', jsonb_build_object(
      'token_hash', s.token_hash, 'campaign_id', s.campaign_id, 'profile_key', s.profile_key, 'user_id', s.user_id,
      'created_at', s.created_at, 'last_seen_at', s.last_seen_at, 'expires_at', s.expires_at, 'revoked_at', s.revoked_at),
    'profile', case when p.profile_key is null then null else jsonb_build_object(
      'campaign_id', p.campaign_id, 'profile_key', p.profile_key, 'display_name', p.display_name,
      'character_name', p.character_name, 'role', p.role, 'token_ids', p.token_ids, 'user_id', p.user_id, 'active', p.active) end,
    'password_set', pw,
    'campaign', jsonb_build_object('name', c.name, 'sync_topic', c.sync_topic)
  );
end;
$$;
revoke all on function public.apex_authenticate(text, integer, integer, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.apex_authenticate(text, integer, integer, integer) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.apex_authenticate(text, integer, integer, integer) to service_role;
  end if;
end $$;

update public.apex_schema_info set schema_version = greatest(schema_version, 3), updated_at = now() where id;
