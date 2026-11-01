-- ============================================================================
-- APEX – extend the server-only deployment status with security checks.
-- Lets GitHub Actions verify RLS/privileges through /api/apex?op=health without
-- any database credential. Not destructive; schema version unchanged (1).
-- ============================================================================

create or replace function public.apex_deploy_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  migrations jsonb := '[]'::jsonb;
  problems text[] := '{}';
  t text;
  apex_tables text[] := array['apex_schema_info','apex_campaigns','apex_campaign_members','apex_campaign_invites',
    'apex_profiles','apex_character_assignments','apex_game_states','apex_campaign_heads','apex_state_snapshots','apex_command_log'];
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select coalesce(jsonb_agg(version order by version), ''[]''::jsonb) from supabase_migrations.schema_migrations' into migrations;
  end if;

  foreach t in array apex_tables loop
    if to_regclass('public.' || t) is null then
      problems := problems || format('table %s missing', t);
      continue;
    end if;
    if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = to_regclass('public.' || t)) then
      problems := problems || format('RLS off on %s', t);
    end if;
    if pg_catalog.has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') then
      problems := problems || format('anon has privileges on %s', t);
    end if;
    if pg_catalog.has_table_privilege('authenticated', 'public.' || t, 'INSERT,UPDATE,DELETE')
       or (t not in ('apex_campaign_members', 'apex_campaign_heads')
           and pg_catalog.has_table_privilege('authenticated', 'public.' || t, 'SELECT')) then
      problems := problems || format('browsers have too many privileges on %s', t);
    end if;
  end loop;
  if pg_catalog.has_function_privilege('anon', 'public.apex_deploy_status()', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.apex_deploy_status()', 'EXECUTE') then
    problems := problems || 'apex_deploy_status is callable by browsers'::text;
  end if;
  if to_regclass('public.apex_access') is not null or to_regclass('public.apex_invites') is not null
     or exists (select 1 from pg_catalog.pg_trigger where tgname = 'apex_auth_user_access') then
    problems := problems || 'legacy allow-list objects still exist'::text;
  end if;

  return jsonb_build_object(
    'schema_version', (select max(schema_version) from public.apex_schema_info),
    'migrations', migrations,
    'campaign_seeded', exists (select 1 from public.apex_campaigns where slug = 'main'),
    'profiles', (select count(*) from public.apex_profiles p join public.apex_campaigns c on c.id = p.campaign_id where c.slug = 'main'),
    'realtime', exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'apex_campaign_heads'),
    'security_problems', to_jsonb(problems)
  );
end;
$$;
revoke all on function public.apex_deploy_status() from public, anon, authenticated;
grant execute on function public.apex_deploy_status() to service_role;
