-- ============================================================================
-- APEX – post-deployment checks (read-only, catalog metadata only).
-- Runs in GitHub Actions after the Supabase GitHub integration deployed the
-- migrations (scripts/verify-remote.sh). Needs NO access to campaign data, so it
-- works with the minimal read-only role apex_ci_readonly (docs/MIGRATIONS_DE.md).
-- Any failed check raises an error → the workflow fails with a clear message.
--
-- Target state = migration 20261101145653_apex_baseline (schema version 1).
-- ============================================================================
\set ON_ERROR_STOP 1

do $$
declare
  t text;
  problems text[] := '{}';
  apex_tables text[] := array['apex_schema_info','apex_campaigns','apex_campaign_members','apex_campaign_invites','apex_character_assignments',
    'apex_game_states','apex_campaign_heads','apex_state_snapshots','apex_command_log','apex_profiles'];
begin
  foreach t in array apex_tables loop
    if to_regclass('public.' || t) is null then
      problems := problems || format('table public.%s is missing', t);
      continue;
    end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || t)) then
      problems := problems || format('row level security is OFF on public.%s', t);
    end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') then
      problems := problems || format('role anon has privileges on public.%s', t);
    end if;
    if t not in ('apex_campaign_heads', 'apex_campaign_members')
       and has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') then
      problems := problems || format('role authenticated has privileges on public.%s (server-only table)', t);
    end if;
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT,UPDATE,DELETE') then
      problems := problems || format('role authenticated can write public.%s', t);
    end if;
  end loop;

  if not exists (select 1 from pg_attribute where attrelid = to_regclass('public.apex_campaign_members') and attname = 'last_seen_at' and not attisdropped) then
    problems := problems || 'presence column apex_campaign_members.last_seen_at is missing'::text;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'apex_campaign_members' and policyname = 'apex_members_read_own') then
    problems := problems || 'policy apex_members_read_own is missing'::text;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'apex_campaign_heads' and policyname = 'apex_heads_read_member') then
    problems := problems || 'policy apex_heads_read_member is missing'::text;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'apex\_%' escape '\'
             and tablename not in ('apex_access', 'apex_invites')
             and policyname not in ('apex_members_read_own', 'apex_heads_read_member')) then
    problems := problems || 'unexpected additional RLS policies on apex_ tables – review them'::text;
  end if;
  -- (the schema version itself is verified by /api/apex?op=health, which may read data)
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'apex_private' and p.proname in ('is_member', 'touch_head')) < 2 then
    problems := problems || 'helper functions in schema apex_private are missing'::text;
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in ('apex_is_member', 'apex_touch_head')) then
    problems := problems || 'obsolete helper functions are still exposed in schema public'::text;
  end if;
  if to_regclass('public.apex_access') is not null or to_regclass('public.apex_invites') is not null then
    problems := problems || 'legacy tables apex_access / apex_invites still exist'::text;
  end if;
  if exists (select 1 from pg_trigger where tgname = 'apex_auth_user_access') then
    problems := problems || 'legacy trigger apex_auth_user_access on auth.users still exists'::text;
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'apex_game_states_touch_head') then
    problems := problems || 'trigger apex_game_states_touch_head is missing'::text;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'apex_campaign_heads') then
    problems := problems || 'apex_campaign_heads is not in the supabase_realtime publication'::text;
  end if;

  if array_length(problems, 1) > 0 then
    raise exception E'APEX post-deploy check FAILED:\n - %', array_to_string(problems, E'\n - ');
  end if;
  raise notice 'APEX schema, RLS, grants, policies, trigger and realtime: OK';
end $$;

