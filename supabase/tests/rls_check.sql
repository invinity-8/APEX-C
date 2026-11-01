-- RLS behaviour test. Run by scripts/verify-db-local.sh after the migrations.
-- Every "expect error" block must fail with "permission denied"; counts are asserted.
\set ON_ERROR_STOP 1
insert into auth.users values ('11111111-1111-1111-1111-111111111111','gm@example.com'),('22222222-2222-2222-2222-222222222222','player@example.com'),('33333333-3333-3333-3333-333333333333','stranger@example.com');
insert into apex_campaign_members select id,'11111111-1111-1111-1111-111111111111','gm@example.com','gm' from apex_campaigns where slug='main';
insert into apex_campaign_members select id,'22222222-2222-2222-2222-222222222222','player@example.com','player' from apex_campaigns where slug='main';
insert into apex_game_states select id, '{"secret":"Templum Oblitum"}'::jsonb, 1 from apex_campaigns where slug='main';
update apex_game_states set version = 2;
do $$ begin assert (select version from apex_campaign_heads limit 1) = 2, 'head trigger'; end $$;

create function pg_temp.expect_denied(sql text, who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
  execute 'set local role authenticated';
  begin
    execute sql;
    raise exception 'NOT DENIED: %', sql;
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
end $$;

begin;
select pg_temp.expect_denied('select * from apex_game_states', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied('update apex_game_states set state = ''{}''', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied('update apex_campaign_members set role = ''gm''', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied('insert into apex_campaign_invites (campaign_id, email, role) select id, ''x@y.z'', ''gm'' from apex_campaigns', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied('select * from apex_character_assignments', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied('select * from apex_state_snapshots', '11111111-1111-1111-1111-111111111111');
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
do $$ begin assert (select count(*) from apex_campaign_members) = 1, 'player sees only own membership'; end $$;
do $$ begin assert (select count(*) from apex_campaign_heads) = 1, 'member sees head'; end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
do $$ begin assert (select count(*) from apex_campaign_members) = 0, 'stranger sees no membership'; end $$;
do $$ begin assert (select count(*) from apex_campaign_heads) = 0, 'stranger sees no head'; end $$;
rollback;

\echo 'RLS checks passed.'

-- Presence column (migration 20261102000100) exists and is not readable for other members.
do $$ begin
  assert exists (select 1 from information_schema.columns where table_name = 'apex_campaign_members' and column_name = 'last_seen_at'), 'last_seen_at missing';
end $$;
\echo 'Presence migration checks passed.'
