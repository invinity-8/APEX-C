-- Isolated test transaction only. Never run this fixture against the live campaign.
create or replace function pg_temp.expect_denied(sql text, who uuid) returns void language plpgsql as $$
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
create or replace function pg_temp.expect_denied_anon(sql text) returns void language plpgsql as $$
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
do $$
declare
  cid uuid; gm uuid; p1 uuid; p2 uuid; sid uuid;
  before_state jsonb; before_version bigint; request_id uuid := gen_random_uuid();
  targets jsonb; result jsonb;
begin
  select id into strict cid from public.apex_campaigns where slug = 'main';
  update public.apex_profiles set active = true where campaign_id = cid;
  insert into public.apex_campaign_members(campaign_id, user_id, email, role)
    select campaign_id, user_id, '', role from public.apex_profiles where campaign_id = cid
    on conflict(campaign_id, user_id) do update set role = excluded.role;
  select user_id into strict gm from public.apex_profiles where campaign_id = cid and role = 'gm';
  select user_id into p1 from public.apex_profiles where campaign_id = cid and role = 'player' order by user_id limit 1;
  select user_id into p2 from public.apex_profiles where campaign_id = cid and role = 'player' order by user_id offset 1 limit 1;
  select state, version into strict before_state, before_version from public.apex_game_states where campaign_id = cid;
  insert into public.apex_scenes(campaign_id, name, category, is_draft, metadata, published_metadata)
    values(cid, 'Isolated encounter', 'battle', false, '{}', '{"width":1200,"height":800,"grid":"square","cell":50,"unitsPerCell":5,"unit":"feet","interval":"round","nodes":[{"id":"entry","kind":"spawn","x":100,"y":100}],"routes":[],"gmNotes":"secret"}') returning id into sid;
  targets := jsonb_build_array(jsonb_build_object('userId', p1, 'revision', 0), jsonb_build_object('userId', p2, 'revision', 0));
  result := public.apex_assign_scene(cid, p1, sid, targets, gen_random_uuid());
  assert not (result->>'ok')::boolean, 'player cannot transfer party';
  result := public.apex_assign_scene(cid, gm, sid, targets, request_id);
  assert (result->>'ok')::boolean, result::text;
  assert (select count(*) from public.apex_scene_assignments where campaign_id = cid and scene_id = sid) = 2, 'party transferred together';
  assert (select state from public.apex_game_states where campaign_id = cid) = before_state, 'Arena JSON stays byte-for-byte equivalent';
  assert (select version from public.apex_game_states where campaign_id = cid) = before_version + 1, 'one sync update per transition';
  result := public.apex_assign_scene(cid, gm, sid, targets, request_id);
  assert (result->>'ok')::boolean, 'duplicate request acknowledged';
  assert (select version from public.apex_game_states where campaign_id = cid) = before_version + 1, 'retry does not refill or reapply';
  result := public.apex_assign_scene(cid, gm, null, targets, request_id);
  assert not (result->>'ok')::boolean, 'idempotency ID cannot be reused for a different transfer';
  result := public.apex_assign_scene(cid, gm, null, targets, gen_random_uuid());
  assert not (result->>'ok')::boolean, 'stale assignment revision rejected';
  assert (select count(*) from public.apex_scene_assignments where campaign_id = cid and scene_id = sid) = 2, 'failed transfer changes no players';
  result := public.apex_assign_scene(cid, gm, null, jsonb_build_array(jsonb_build_object('userId', p1, 'revision', 1)), gen_random_uuid());
  assert (result->>'ok')::boolean, 'one player returned to Sanctuary';
  assert (select scene_id is null and revision = 2 from public.apex_scene_assignments where campaign_id = cid and user_id = p1), 'Sanctuary authoritative';
  assert (select scene_id = sid and revision = 1 from public.apex_scene_assignments where campaign_id = cid and user_id = p2), 'other player remains in encounter';
  begin
    update public.apex_scenes set archived = true where campaign_id = cid and id = sid;
    raise exception 'assigned scene was archived';
  exception when raise_exception then
    assert sqlerrm like 'Return assigned players%', 'archival protected';
  end;
end $$;
select pg_temp.expect_denied('select public.apex_assign_scene(gen_random_uuid(), gen_random_uuid(), null, ''[]''::jsonb, gen_random_uuid())', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied_anon('select public.apex_assign_scene(gen_random_uuid(), gen_random_uuid(), null, ''[]''::jsonb, gen_random_uuid())');
rollback;
