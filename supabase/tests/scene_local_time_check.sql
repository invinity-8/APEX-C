-- Scene-local movement (schema 7): budgets per scene and per turn/day, epoch re-checked against the
-- locked game state, turn order enforced, explored hexes stored per player. Rollback-only fixture.
-- Isolated rollback-only fixture. Does not exercise Supabase Storage or Realtime delivery.
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
  cid uuid; gm uuid; p1 uuid; p2 uuid; s1 uuid; s2 uuid; r1 uuid;
  input jsonb; result jsonb; doc jsonb;
begin
  select id into strict cid from public.apex_campaigns where slug = 'main';
  update public.apex_profiles set active = true where campaign_id = cid;
  insert into public.apex_campaign_members(campaign_id, user_id, email, role) select campaign_id, user_id, '', role from public.apex_profiles where campaign_id = cid on conflict(campaign_id, user_id) do update set role = excluded.role;
  select user_id into strict gm from public.apex_profiles where campaign_id = cid and role = 'gm';
  select user_id into strict p1 from public.apex_profiles where campaign_id = cid and profile_key = 'hannah';
  select user_id into strict p2 from public.apex_profiles where campaign_id = cid and profile_key = 'jean';
  insert into public.apex_scenes(campaign_id,name,category,is_draft,published_metadata,published_revision) values(cid,'Battle A','battle',false,'{"width":1200,"height":800,"nodes":[{"id":"entry","kind":"spawn","x":100,"y":100}]}',1) returning id into s1;
  insert into public.apex_scenes(campaign_id,name,category,is_draft,published_metadata,published_revision) values(cid,'Battle B','battle',false,'{"width":1200,"height":800,"nodes":[{"id":"entry","kind":"spawn","x":100,"y":100}]}',1) returning id into s2;
  insert into public.apex_scenes(campaign_id,name,category,is_draft,published_metadata,published_revision) values(cid,'Region','region',false,'{"width":1200,"height":800,"nodes":[{"id":"entry","kind":"spawn","x":100,"y":100}]}',1) returning id into r1;
  -- Arena flag "sneaking" must not matter on scenes; initiative on A: sinna first, then aster.
  doc := jsonb_build_object('tokens', jsonb_build_object('sinna', jsonb_build_object('id','sinna','speedFt',30,'sneaking',true), 'aster', jsonb_build_object('id','aster','speedFt',30)),
    'sceneEncounters', jsonb_build_object(s1::text, jsonb_build_object('id','enc1','status','active','turnIndex',0,'turnSerial',1,
      'participants', jsonb_build_array(jsonb_build_object('id','pc-sinna','tokenId','sinna'), jsonb_build_object('id','pc-aster','tokenId','aster')))));
  update public.apex_game_states set state = doc where campaign_id = cid;
  result := public.apex_assign_scene(cid,gm,s1,jsonb_build_array(jsonb_build_object('userId',p1,'revision',0),jsonb_build_object('userId',p2,'revision',0)),gen_random_uuid());
  assert (result->>'ok')::boolean, result::text;

  -- Hannah (sinna) moves on her turn: 30 ft allowance despite the Arena sneak flag.
  input := jsonb_build_object('action','move','requestId',gen_random_uuid(),'sceneId',s1,'sceneRevision',1,'tokenId','sinna','tokenVersion',0,'assignmentRevision',1,'epoch',0,'x',150,'y',100);
  result := public.apex_write_scene_motion_v2(cid,p1,input,30,30,'t:enc1:1','[]',array['0,0','1,0']);
  assert (result->>'ok')::boolean, result::text;
  input := input || jsonb_build_object('requestId',gen_random_uuid(),'tokenVersion',1,'x',200);
  result := public.apex_write_scene_motion_v2(cid,p1,input,5,30,'t:enc1:1','[]',array['2,0']);
  assert not (result->>'ok')::boolean, 'turn budget is spent';
  -- Jean (aster) cannot move out of turn, even with a forged epoch.
  input := jsonb_build_object('action','move','requestId',gen_random_uuid(),'sceneId',s1,'sceneRevision',1,'tokenId','aster','tokenVersion',0,'assignmentRevision',1,'epoch',0,'x',150,'y',100);
  result := public.apex_write_scene_motion_v2(cid,p2,input,5,30,'t:enc1:1','[]','{}');
  assert not (result->>'ok')::boolean and result->>'error' = 'It is not your turn.', result::text;
  result := public.apex_write_scene_motion_v2(cid,p2,input,5,1000000,'free','[]','{}');
  assert not (result->>'ok')::boolean, 'free movement is refused while initiative runs';
  -- Next turn (serial 2, aster active): Jean may move; Hannah's stale epoch is refused.
  update public.apex_game_states set state = jsonb_set(jsonb_set(state, array['sceneEncounters', s1::text, 'turnIndex'], '1'), array['sceneEncounters', s1::text, 'turnSerial'], '2') where campaign_id = cid;
  input := input || jsonb_build_object('requestId',gen_random_uuid());
  result := public.apex_write_scene_motion_v2(cid,p2,input,10,30,'t:enc1:2','[]','{}');
  assert (result->>'ok')::boolean, result::text;
  input := jsonb_build_object('action','move','requestId',gen_random_uuid(),'sceneId',s1,'sceneRevision',1,'tokenId','sinna','tokenVersion',1,'assignmentRevision',1,'epoch',0,'x',100,'y',100);
  result := public.apex_write_scene_motion_v2(cid,p1,input,5,30,'t:enc1:1','[]','{}');
  assert not (result->>'ok')::boolean, 'stale turn epoch refused';
  -- Initiative ended: free, unlimited movement.
  update public.apex_game_states set state = jsonb_set(state, array['sceneEncounters', s1::text, 'status'], '"ended"') where campaign_id = cid;
  input := input || jsonb_build_object('requestId',gen_random_uuid());
  result := public.apex_write_scene_motion_v2(cid,p1,input,500,1000000,'free','[]',array['5,5']);
  assert (result->>'ok')::boolean, result::text;

  -- Budgets are per scene: on battle B Hannah starts fresh (no initiative there).
  result := public.apex_assign_scene(cid,gm,s2,jsonb_build_array(jsonb_build_object('userId',p1,'revision',1)),gen_random_uuid());
  assert (result->>'ok')::boolean, result::text;
  input := jsonb_build_object('action','move','requestId',gen_random_uuid(),'sceneId',s2,'sceneRevision',1,'tokenId','sinna','tokenVersion',0,'assignmentRevision',2,'epoch',0,'x',150,'y',100);
  result := public.apex_write_scene_motion_v2(cid,p1,input,30,1000000,'free','[]','{}');
  assert (result->>'ok')::boolean, result::text;
  assert (select spent from public.apex_scene_ledgers where campaign_id = cid and scene_id = s1 and token_id = 'sinna') = 500, 'scene A ledger untouched';

  -- Region: the epoch is the scene day; a new day resets the budget.
  result := public.apex_assign_scene(cid,gm,r1,jsonb_build_array(jsonb_build_object('userId',p1,'revision',2)),gen_random_uuid());
  assert (result->>'ok')::boolean, result::text;
  input := jsonb_build_object('action','move','requestId',gen_random_uuid(),'sceneId',r1,'sceneRevision',1,'tokenId','sinna','tokenVersion',0,'assignmentRevision',3,'epoch',0,'x',150,'y',100);
  result := public.apex_write_scene_motion_v2(cid,p1,input,24,24,'d:1','[]','{}');
  assert (result->>'ok')::boolean, result::text;
  input := input || jsonb_build_object('requestId',gen_random_uuid(),'tokenVersion',1,'x',160);
  result := public.apex_write_scene_motion_v2(cid,p1,input,3,24,'d:1','[]','{}');
  assert not (result->>'ok')::boolean, 'day budget spent';
  result := public.apex_write_scene_motion_v2(cid,p1,input,3,24,'d:2','[]','{}');
  assert not (result->>'ok')::boolean, 'a future day cannot be claimed';
  update public.apex_game_states set state = jsonb_set(state, '{sceneClocks}', jsonb_build_object(r1::text, jsonb_build_object('day',2))) where campaign_id = cid;
  result := public.apex_write_scene_motion_v2(cid,p1,input,3,24,'d:2','[]','{}');
  assert (result->>'ok')::boolean, result::text;

  -- Explored hexes are stored per player and merged.
  assert (select hexes @> array['0,0','1,0','5,5'] from public.apex_scene_vision where campaign_id = cid and scene_id = s1 and user_id = p1), 'seen hexes merged';
  assert public.apex_scene_motion_state_v2(cid,s1,p2,array['aster'])->'seen' = '[]'::jsonb, 'other players see nothing of it';
  assert (public.apex_scene_motion_state_v2(cid,s1,p1,array['sinna'])->'tokens'->0->>'spent')::numeric = 500;
  raise notice 'Scene-local time, turn order and vision: OK';
end $$;
select pg_temp.expect_denied_anon('select * from public.apex_scene_ledgers');
select pg_temp.expect_denied('select * from public.apex_scene_vision', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied_anon('select public.apex_write_scene_motion_v2(gen_random_uuid(),gen_random_uuid(),''{}''::jsonb,1,1,''free'',''[]''::jsonb,array[]::text[])');
rollback;
