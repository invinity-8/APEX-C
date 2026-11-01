-- ============================================================================
-- APEX 0.2 – manual security verification (run in the Supabase SQL editor
-- AFTER the migrations). Every query should return the documented result.
-- ============================================================================

-- 1) RLS must be enabled on every apex_ table → expect 0 rows.
select tablename from pg_tables
where schemaname = 'public' and tablename like 'apex\_%' escape '\'
  and tablename not in ('apex_invites', 'apex_access')
  and not rowsecurity;

-- 2) Client roles may only SELECT the two public tables → expect exactly:
--    apex_campaign_heads/authenticated/SELECT and apex_campaign_members/authenticated/SELECT
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'apex\_%' escape '\'
  and table_name not in ('apex_invites', 'apex_access')
  and grantee in ('anon', 'authenticated')
order by 1, 2, 3;

-- 3) Simulate a signed-in player and try to read the game state → expect an error
--    ("permission denied") or 0 rows.
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<player-user-uuid>","role":"authenticated"}';
--   select count(*) from public.apex_game_states;
-- rollback;

-- 4) Realtime publication contains the head table → expect 1 row.
select * from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'apex_campaign_heads';
