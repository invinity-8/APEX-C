-- APEX 1.2 (schema 8): consecutive characters in the initiative order act together; a character that ended its
-- part (blockDone) waits; a character after an NPC waits for its own turn.
begin;
do $$
declare
  cid uuid; gm uuid; p1 uuid; p2 uuid; s1 uuid; input jsonb; result jsonb; doc jsonb;
begin
  select id into strict cid from public.apex_campaigns where slug = 'main';
  update public.apex_profiles set active = true where campaign_id = cid;
  insert into public.apex_campaign_members(campaign_id, user_id, email, role) select campaign_id, user_id, '', role from public.apex_profiles where campaign_id = cid on conflict(campaign_id, user_id) do update set role = excluded.role;
  select user_id into strict gm from public.apex_profiles where campaign_id = cid and role = 'gm';
  select user_id into strict p1 from public.apex_profiles where campaign_id = cid and profile_key = 'hannah';
  select user_id into strict p2 from public.apex_profiles where campaign_id = cid and profile_key = 'jean';
  insert into public.apex_scenes(campaign_id,name,category,is_draft,published_metadata,published_revision) values(cid,'Block battle','battle',false,'{"width":1200,"height":800,"nodes":[{"id":"entry","kind":"spawn","x":100,"y":100}]}',1) returning id into s1;
  doc := jsonb_build_object('tokens', jsonb_build_object('sinna', jsonb_build_object('id','sinna','speedFt',30), 'aster', jsonb_build_object('id','aster','speedFt',30)),
    'sceneEncounters', jsonb_build_object(s1::text, jsonb_build_object('id','enc9','status','active','turnIndex',0,'turnSerial',1,
      'participants', jsonb_build_array(jsonb_build_object('id','pc-sinna','tokenId','sinna'), jsonb_build_object('id','pc-aster','tokenId','aster'), jsonb_build_object('id','npc-orc')))));
  update public.apex_game_states set state = doc where campaign_id = cid;
  result := public.apex_assign_scene(cid,gm,s1,jsonb_build_array(jsonb_build_object('userId',p1,'revision',0),jsonb_build_object('userId',p2,'revision',0)),gen_random_uuid());
  assert (result->>'ok')::boolean, result::text;
  -- both characters of the block move in the same turn
  input := jsonb_build_object('action','move','requestId',gen_random_uuid(),'sceneId',s1,'sceneRevision',1,'tokenId','sinna','tokenVersion',0,'assignmentRevision',1,'epoch',0,'x',150,'y',100);
  result := public.apex_write_scene_motion_v2(cid,p1,input,5,30,'t:enc9:1','[]','{}');
  assert (result->>'ok')::boolean, result::text;
  input := jsonb_build_object('action','move','requestId',gen_random_uuid(),'sceneId',s1,'sceneRevision',1,'tokenId','aster','tokenVersion',0,'assignmentRevision',1,'epoch',0,'x',250,'y',100);
  result := public.apex_write_scene_motion_v2(cid,p2,input,5,30,'t:enc9:1','[]','{}');
  assert (result->>'ok')::boolean, result::text;
  -- aster ended its part: no more movement this turn
  update public.apex_game_states set state = jsonb_set(state, array['sceneEncounters', s1::text, 'blockDone'], '["pc-aster"]') where campaign_id = cid;
  input := input || jsonb_build_object('requestId',gen_random_uuid(),'tokenVersion',1,'x',300);
  result := public.apex_write_scene_motion_v2(cid,p2,input,5,30,'t:enc9:1','[]','{}');
  assert not (result->>'ok')::boolean and result->>'error' = 'It is not your turn.', result::text;
  -- the orc's turn: nobody else moves
  update public.apex_game_states set state = jsonb_set(jsonb_set(state, array['sceneEncounters', s1::text, 'turnIndex'], '2'), array['sceneEncounters', s1::text, 'turnSerial'], '2') where campaign_id = cid;
  input := jsonb_build_object('action','move','requestId',gen_random_uuid(),'sceneId',s1,'sceneRevision',1,'tokenId','sinna','tokenVersion',1,'assignmentRevision',1,'epoch',0,'x',200,'y',100);
  result := public.apex_write_scene_motion_v2(cid,p1,input,5,30,'t:enc9:2','[]','{}');
  assert not (result->>'ok')::boolean and result->>'error' = 'It is not your turn.', result::text;
end $$;
rollback;
