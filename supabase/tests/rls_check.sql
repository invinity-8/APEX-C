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

-- Profiles (migration 20261103000100): seeded, no emails, invisible to clients.
do $$ begin
  assert (select count(*) from apex_profiles) = 5, 'five profiles seeded';
  assert (select count(*) from apex_profiles where email is not null) = 0, 'no emails in seed';
end $$;
begin;
select pg_temp.expect_denied('select * from apex_profiles', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied('update apex_profiles set email = ''x@y.z''', '22222222-2222-2222-2222-222222222222');
commit;
\echo 'Profile checks passed.'

-- APEX 0.3 (migration 20261101173039): credentials, sessions, setup codes and character sheets
-- are server-only. Browsers (anon / authenticated) can neither read nor write them.
create function pg_temp.expect_denied_anon(sql text) returns void language plpgsql as $$
begin
  execute 'set local role anon';
  begin
    execute sql;
    raise exception 'NOT DENIED (anon): %', sql;
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
end $$;
begin;
select pg_temp.expect_denied('select * from apex_profile_credentials', '11111111-1111-1111-1111-111111111111');
select pg_temp.expect_denied('select * from apex_sessions', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied('insert into apex_sessions (token_hash, campaign_id, profile_key, user_id, expires_at) select repeat(''a'',64), id, ''gm'', gen_random_uuid(), now() + interval ''1 day'' from apex_campaigns', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied('select * from apex_setup_codes', '11111111-1111-1111-1111-111111111111');
select pg_temp.expect_denied('select * from apex_character_sheets', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied('update apex_character_sheets set data = ''{}''', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied('select * from apex_character_sheet_backups', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied('select * from apex_login_attempts', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied('select sync_topic from apex_campaigns', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied('select apex_private.create_gm_setup_code()', '11111111-1111-1111-1111-111111111111');
select pg_temp.expect_denied_anon('select * from apex_profile_credentials');
select pg_temp.expect_denied_anon('select * from apex_sessions');
select pg_temp.expect_denied_anon('select * from apex_character_sheets');
select pg_temp.expect_denied_anon('select apex_private.create_gm_setup_code()');
commit;
do $$ begin
  assert (select count(*) from apex_profiles where user_id is null) = 0, 'every profile has its own id';
  assert (select count(*) from apex_profiles where active) = 0, 'profiles stay locked until the GM sets a password';
  assert (select count(*) from apex_campaigns where sync_topic is null or length(sync_topic) < 64) = 0, 'secret sync topic';
end $$;
-- A setup code is single-use: creating a new one invalidates the previous one.
do $$ declare a text; b text; begin
  a := apex_private.create_gm_setup_code(1);
  b := apex_private.create_gm_setup_code(1);
  assert a <> b and a ~ '^[0-9A-F]{4}(-[0-9A-F]{4}){5}$', 'code format';
  assert (select count(*) from apex_setup_codes where used_at is null) = 1, 'only the newest code is valid';
  assert not exists (select 1 from apex_setup_codes where code_hash = a or code_hash = b), 'only hashes are stored';
  delete from apex_setup_codes;
end $$;
\echo 'APEX 0.3 credential/session/sheet checks passed.'

-- Migration 20261101200504: apex_authenticate is server-only; request ids are unique per campaign.
begin;
select pg_temp.expect_denied('select public.apex_authenticate(repeat(''a'',64))', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied_anon('select public.apex_authenticate(repeat(''a'',64))');
commit;
do $$ declare cid uuid; r jsonb; begin
  select id into cid from apex_campaigns where slug = 'main';
  assert public.apex_authenticate(repeat('b', 64)) is null, 'unknown session → null';
  insert into apex_sessions (token_hash, campaign_id, profile_key, user_id, expires_at, last_seen_at)
    select repeat('c', 64), cid, 'hannah', p.user_id, now() + interval '1 day', now() - interval '5 minutes' from apex_profiles p where p.campaign_id = cid and p.profile_key = 'hannah';
  r := public.apex_authenticate(repeat('c', 64));
  assert r->'profile'->>'profile_key' = 'hannah' and (r->>'password_set')::boolean = false and r->'campaign'->>'sync_topic' is not null, 'bundle content';
  assert (select last_seen_at > now() - interval '1 minute' from apex_sessions where token_hash = repeat('c', 64)), 'presence touched';
  update apex_sessions set revoked_at = now() where token_hash = repeat('c', 64);
  assert public.apex_authenticate(repeat('c', 64)) is null, 'revoked → null';
  delete from apex_sessions where token_hash = repeat('c', 64);
  insert into apex_command_log (campaign_id, role, command, ok, request_id) values (cid, 'gm', '{}', false, 'req-unique-1');
  begin
    insert into apex_command_log (campaign_id, role, command, ok, request_id) values (cid, 'gm', '{}', false, 'req-unique-1');
    raise exception 'duplicate request id accepted';
  exception when unique_violation then null;
  end;
  delete from apex_command_log where request_id = 'req-unique-1';
end $$;
\echo 'Request-efficiency checks passed.'

-- Migration 20261101202637: world archives are server-only; transitions are atomic.
begin;
select pg_temp.expect_denied('select * from apex_world_archives', '11111111-1111-1111-1111-111111111111');
select pg_temp.expect_denied_anon('select * from apex_world_archives');
select pg_temp.expect_denied('select public.apex_world_transition(gen_random_uuid(), 1, null, ''x'', '''', ''manual'', null)', '11111111-1111-1111-1111-111111111111');
commit;
do $$ declare cid uuid; v bigint; r jsonb; n int; begin
  select id into cid from apex_campaigns where slug = 'main';
  select version into v from apex_game_states where campaign_id = cid;
  -- archive only: state and version unchanged, archive holds a copy
  r := public.apex_world_transition(cid, null, null, 'Manual', 'desc', 'manual', null);
  assert (r->>'version')::bigint = v, 'archive-only keeps the version';
  assert (select state from apex_world_archives where id = (r->>'archive_id')::uuid) = (select state from apex_game_states where campaign_id = cid), 'archive is a full copy';
  -- replace with the correct expected version
  r := public.apex_world_transition(cid, v, '{"secret":"new world"}'::jsonb, 'Before reset', '', 'before-reset', null);
  assert (r->>'version')::bigint = v + 1 and (select state->>'secret' from apex_game_states where campaign_id = cid) = 'new world', 'world replaced';
  assert (select state->>'secret' from apex_world_archives where id = (r->>'archive_id')::uuid) = 'Templum Oblitum', 'old world archived';
  -- stale expected version: nothing changes, no archive is written
  select count(*) into n from apex_world_archives;
  begin
    perform public.apex_world_transition(cid, v, '{"secret":"stale"}'::jsonb, 'x', '', 'before-reset', null);
    raise exception 'stale transition accepted';
  exception when raise_exception then
    assert sqlerrm = 'apex:version_conflict', sqlerrm;
  end;
  assert (select state->>'secret' from apex_game_states where campaign_id = cid) = 'new world', 'failed transition leaves the world intact';
  assert (select count(*) from apex_world_archives) = n, 'failed transition writes no archive';
  delete from apex_world_archives;
end $$;
\echo 'World archive checks passed.'

-- Campaign scenes are private to the server, including unpublished drafts.
begin;
select pg_temp.expect_denied('select * from public.apex_scenes', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied('select * from public.apex_scene_assignments', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied_anon('select * from public.apex_scenes');
select pg_temp.expect_denied_anon('select * from public.apex_scene_assignments');

do $$
declare
  main_id uuid;
  other_id uuid;
  other_scene_id uuid;
  player_id uuid;
begin
  select id into strict main_id from public.apex_campaigns where slug = 'main';
  assert (select count(*) from public.apex_scenes
          where campaign_id = main_id and is_legacy_arena and category = 'region' and not is_draft) = 1,
         'migration registers one Region Map for the existing Arena';

  insert into public.apex_campaigns (slug, name)
  values ('scene-check', 'Scene test') returning id into other_id;
  select id into strict other_scene_id from public.apex_scenes
    where campaign_id = other_id and is_legacy_arena and category = 'region';

  select user_id into strict player_id from public.apex_campaign_members
    where campaign_id = main_id and role = 'player' limit 1;
  begin
    insert into public.apex_scene_assignments (campaign_id, user_id, scene_id)
    values (main_id, player_id, other_scene_id);
    raise exception 'cross-campaign scene assignment accepted';
  exception when foreign_key_violation then null;
  end;

  insert into public.apex_scene_assignments (campaign_id, user_id, scene_id)
  values (main_id, player_id, null);
  assert exists (select 1 from public.apex_scene_assignments
                 where campaign_id = main_id and user_id = player_id and scene_id is null),
         'Sanctuary is persisted separately from the inherited Arena';
end $$;
rollback;
\echo 'Campaign scene foundation checks passed.'
