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
  cid uuid; gm uuid; p1 uuid; p2 uuid; s1 uuid; s2 uuid;
  input jsonb; result jsonb; before_doc jsonb; advance_id uuid := gen_random_uuid();
begin
  select id into strict cid from public.apex_campaigns where slug = 'main';
  update public.apex_profiles set active = true where campaign_id = cid;
  insert into public.apex_campaign_members(campaign_id, user_id, email, role) select campaign_id, user_id, '', role from public.apex_profiles where campaign_id = cid on conflict(campaign_id, user_id) do update set role = excluded.role;
  select user_id into strict gm from public.apex_profiles where campaign_id = cid and role = 'gm';
  select user_id into strict p1 from public.apex_profiles where campaign_id = cid and profile_key = 'hannah';
  select user_id into strict p2 from public.apex_profiles where campaign_id = cid and profile_key = 'jean';
  before_doc := '{"world":{"seed":123},"tokens":{"sinna":{"id":"sinna","speedFt":30,"movePoints":4,"inventory":[{"id":"precious"}]}}}';
  update public.apex_game_states set state = before_doc where campaign_id = cid;
  insert into public.apex_scenes(campaign_id,name,category,is_draft,published_metadata,published_revision) values(cid,'First battle','battle',false,'{"width":1200,"height":800,"nodes":[{"id":"entry","kind":"spawn","x":100,"y":100}]}',1) returning id into s1;
  insert into public.apex_scenes(campaign_id,name,category,is_draft,published_metadata,published_revision) values(cid,'Second battle','battle',false,'{"width":1200,"height":800,"nodes":[{"id":"entry","kind":"spawn","x":100,"y":100}]}',1) returning id into s2;
  result := public.apex_assign_scene(cid,gm,s1,jsonb_build_array(jsonb_build_object('userId',p1,'revision',0)),gen_random_uuid());
  assert (result->>'ok')::boolean, result::text;
  input := jsonb_build_object('action','move','requestId',gen_random_uuid(),'sceneId',s1,'sceneRevision',1,'tokenId','sinna','tokenVersion',0,'assignmentRevision',1,'epoch',0,'x',150,'y',100);
  result := public.apex_write_scene_motion(cid,p1,input,5,'[{"id":"discovery","kind":"location","label":"Known to Hannah"}]');
  assert (result->>'ok')::boolean, result::text;
  result := public.apex_write_scene_motion(cid,p1,input,5,'[]');
  assert (result->>'ok')::boolean, 'repeated move is acknowledged';
  assert (select tactical_spent from public.apex_scene_budgets where campaign_id = cid and token_id = 'sinna') = 5, 'retry charged once';
  input := input || jsonb_build_object('requestId',gen_random_uuid(),'tokenVersion',1,'x',400);
  result := public.apex_write_scene_motion(cid,p1,input,25,'[]');
  assert (result->>'ok')::boolean, 'remaining movement can be spent';
  result := public.apex_assign_scene(cid,gm,s2,jsonb_build_array(jsonb_build_object('userId',p1,'revision',1)),gen_random_uuid());
  assert (result->>'ok')::boolean, 'second scene transition';
  input := input || jsonb_build_object('requestId',gen_random_uuid(),'sceneId',s2,'assignmentRevision',2,'tokenVersion',0,'x',150);
  result := public.apex_write_scene_motion(cid,p1,input,5,'[]');
  assert not (result->>'ok')::boolean, 'scene switching never refills tactical budget';
  result := public.apex_assign_scene(cid,gm,s1,jsonb_build_array(jsonb_build_object('userId',p1,'revision',2)),gen_random_uuid());
  assert (result->>'ok')::boolean;
  assert (select x = 400 and version = 2 from public.apex_scene_tokens where campaign_id = cid and scene_id = s1 and token_id = 'sinna'), 'scene position preserved';
  assert jsonb_array_length(public.apex_scene_motion_state(cid,s1,p1,array['sinna'])->'known') = 1, 'own scene exploration preserved';
  assert jsonb_array_length(public.apex_scene_motion_state(cid,s1,p2,array['aster'])->'known') = 0, 'other player exploration stays private';
  result := public.apex_advance_scene_interval(cid,p1,'round',0,gen_random_uuid());
  assert not (result->>'ok')::boolean, 'players cannot refresh movement';
  result := public.apex_advance_scene_interval(cid,gm,'round',0,advance_id);
  assert (result->>'ok')::boolean;
  result := public.apex_advance_scene_interval(cid,gm,'round',0,advance_id);
  assert (result->>'ok')::boolean, 'interval advance is idempotent';
  assert (select round_epoch from public.apex_scene_clocks where campaign_id = cid) = 1;
  input := input || jsonb_build_object('requestId',gen_random_uuid(),'sceneId',s1,'assignmentRevision',3,'tokenVersion',2,'epoch',0,'x',450);
  result := public.apex_write_scene_motion(cid,p1,input,5,'[]');
  assert not (result->>'ok')::boolean, 'stale interval rejected';
  input := input || jsonb_build_object('requestId',gen_random_uuid(),'epoch',1);
  result := public.apex_write_scene_motion(cid,p1,input,5,'[]');
  assert (result->>'ok')::boolean, 'new round movement available after explicit GM advance';
  input := input || jsonb_build_object('requestId',gen_random_uuid(),'tokenVersion',3,'x',500);
  result := public.apex_write_scene_motion(cid,p2,input,5,'[]');
  assert not (result->>'ok')::boolean, 'foreign token move denied in database';
  assert (select state from public.apex_game_states where campaign_id = cid) = before_doc, 'scene movement never changes legacy MP, inventory or world';
end $$;
select pg_temp.expect_denied_anon('select * from public.apex_scene_tokens');
select pg_temp.expect_denied('select * from public.apex_scene_exploration', '22222222-2222-2222-2222-222222222222');
select pg_temp.expect_denied_anon('select public.apex_scene_motion_state(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),array[]::text[])');
rollback;
