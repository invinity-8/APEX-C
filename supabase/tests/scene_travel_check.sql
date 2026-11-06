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
  cid uuid; gm uuid; player uuid; sid uuid; proposal uuid := gen_random_uuid(); progress_id uuid := gen_random_uuid();
  input jsonb; result jsonb; before_doc jsonb;
begin
  select id into strict cid from public.apex_campaigns where slug = 'main';
  update public.apex_profiles set active = true where campaign_id = cid;
  insert into public.apex_campaign_members(campaign_id,user_id,email,role) select campaign_id,user_id,'',role from public.apex_profiles where campaign_id = cid on conflict(campaign_id,user_id) do update set role = excluded.role;
  select user_id into strict gm from public.apex_profiles where campaign_id = cid and role = 'gm';
  select user_id into strict player from public.apex_profiles where campaign_id = cid and profile_key = 'hannah';
  select state into before_doc from public.apex_game_states where campaign_id = cid;
  insert into public.apex_scenes(campaign_id,name,category,is_draft,published_metadata,published_revision) values(cid,'Travel fixture','world',false,
    '{"nodes":[{"id":"entry","kind":"spawn","x":100,"y":100},{"id":"town","kind":"location","visible":true},{"id":"hill","kind":"location","visible":true},{"id":"secret","kind":"location","visible":false}],"routes":[{"id":"road","from":"town","to":"hill","visible":true,"hours":4},{"id":"secret-road","from":"town","to":"secret","visible":true,"hours":1}]}',1) returning id into sid;
  result := public.apex_assign_scene(cid,gm,sid,jsonb_build_array(jsonb_build_object('userId',player,'revision',0)),gen_random_uuid()); assert (result->>'ok')::boolean;
  input := jsonb_build_object('action','locate','requestId',gen_random_uuid(),'sceneRevision',1,'partyRevision',0,'nodeId','town');
  result := public.apex_world_travel_action(cid,gm,sid,input); assert (result->>'ok')::boolean, result::text;
  input := jsonb_build_object('action','propose','requestId',gen_random_uuid(),'sceneRevision',1,'partyRevision',1,'assignmentRevision',1,'routeId','secret-road');
  result := public.apex_world_travel_action(cid,player,sid,input); assert not (result->>'ok')::boolean, 'unrevealed destination rejected despite visible route';
  input := input || jsonb_build_object('requestId',proposal,'routeId','road');
  result := public.apex_world_travel_action(cid,player,sid,input); assert (result->>'ok')::boolean, result::text;
  assert (select node_id from public.apex_party_locations where campaign_id = cid and scene_id = sid) = 'town', 'proposal never teleports party';
  input := jsonb_build_object('action','confirm','requestId',gen_random_uuid(),'sceneRevision',1,'proposalId',proposal,'version',1);
  result := public.apex_world_travel_action(cid,player,sid,input); assert not (result->>'ok')::boolean, 'only GM confirms';
  result := public.apex_world_travel_action(cid,gm,sid,input); assert (result->>'ok')::boolean, result::text;
  assert (select status from public.apex_scene_travel where campaign_id = cid and id = proposal) = 'traveling';
  input := jsonb_build_object('action','progress','requestId',progress_id,'sceneRevision',1,'proposalId',proposal,'version',2,'hours',1);
  result := public.apex_world_travel_action(cid,gm,sid,input); assert (result->>'ok')::boolean, result::text;
  result := public.apex_world_travel_action(cid,gm,sid,input); assert (result->>'ok')::boolean, 'progress retry acknowledged';
  assert (select elapsed_hours from public.apex_scene_travel where campaign_id = cid and id = proposal) = 1, 'retry advances once';
  assert (select node_id from public.apex_party_locations where campaign_id = cid and scene_id = sid) = 'town', 'partial travel keeps valid origin';
  result := public.apex_world_travel_action(cid,gm,sid,input || jsonb_build_object('requestId',gen_random_uuid())); assert not (result->>'ok')::boolean, 'stale progress revision rejected';
  result := public.apex_world_travel_action(cid,gm,sid,input || jsonb_build_object('requestId',gen_random_uuid(),'version',3,'hours',3)); assert (result->>'ok')::boolean;
  assert (select status = 'complete' and elapsed_hours = 4 from public.apex_scene_travel where campaign_id = cid and id = proposal), 'journey completes';
  assert (select node_id = 'hill' and revision = 2 from public.apex_party_locations where campaign_id = cid and scene_id = sid), 'arrival changes party location atomically';
  assert (select state from public.apex_game_states where campaign_id = cid) = before_doc, 'world travel preserves legacy state';
end $$;
select pg_temp.expect_denied_anon('select * from public.apex_party_locations');
select pg_temp.expect_denied('select * from public.apex_scene_travel', '22222222-2222-2222-2222-222222222222');
rollback;
