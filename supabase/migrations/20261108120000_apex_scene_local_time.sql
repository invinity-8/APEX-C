-- APEX scene-local time, movement budgets and vision (schema version 7). Additive only.
--
-- Before: scene movement budgets (apex_scene_budgets) and interval clocks (apex_scene_clocks) were
-- campaign-wide, so advancing one scene's round reset every scene, and the Arena's "sneaking" flag
-- halved movement on battle maps. Now every (scene, character) has its own ledger keyed by an
-- "epoch" the server derives from the scene's own state in apex_game_states.state:
--   free                 battle map outside initiative (unlimited)
--   t:<encounter>:<turn> battle map in initiative – only the active character, speed per turn
--   d:<day>              region map – travel per scene day
-- The epoch is re-checked here against the locked game state, so a turn change between the API's
-- check and this write can never be used to move out of turn. Old tables/functions stay untouched.

create table if not exists public.apex_scene_ledgers (
  campaign_id uuid not null, scene_id uuid not null, token_id text not null,
  epoch text not null, spent numeric not null default 0 check (spent >= 0),
  primary key (campaign_id, scene_id, token_id),
  foreign key (campaign_id, scene_id) references public.apex_scenes(campaign_id, id) on delete cascade
);
-- Hexes a player has seen on a scene (player maps only contain these + what is visible now).
create table if not exists public.apex_scene_vision (
  campaign_id uuid not null, scene_id uuid not null, user_id uuid not null,
  hexes text[] not null default '{}',
  primary key (campaign_id, scene_id, user_id),
  foreign key (campaign_id, scene_id) references public.apex_scenes(campaign_id, id) on delete cascade,
  foreign key (campaign_id, user_id) references public.apex_campaign_members(campaign_id, user_id) on delete cascade
);
alter table public.apex_scene_ledgers enable row level security;
alter table public.apex_scene_vision enable row level security;
revoke all on public.apex_scene_ledgers, public.apex_scene_vision from public, anon, authenticated;
grant select, insert, update, delete on public.apex_scene_ledgers, public.apex_scene_vision to service_role;

create or replace function public.apex_scene_motion_state_v2(p_campaign uuid, p_scene uuid, p_user uuid, p_tokens text[])
returns jsonb language sql stable set search_path = '' as $$
select jsonb_build_object(
  'tokens', coalesce((select jsonb_agg(jsonb_build_object('tokenId', t.token_id, 'x', t.x, 'y', t.y, 'version', t.version,
      'epoch', l.epoch, 'spent', coalesce(l.spent, 0)))
    from public.apex_scene_tokens t left join public.apex_scene_ledgers l using (campaign_id, scene_id, token_id)
    where t.campaign_id = p_campaign and t.scene_id = p_scene and t.token_id = any(p_tokens)), '[]'::jsonb),
  'known', coalesce((select jsonb_agg(value) from public.apex_scene_exploration e cross join lateral jsonb_each(e.known_nodes)
    where e.campaign_id = p_campaign and e.scene_id = p_scene and e.user_id = p_user), '[]'::jsonb),
  'seen', coalesce((select to_jsonb(v.hexes) from public.apex_scene_vision v where v.campaign_id = p_campaign and v.scene_id = p_scene and v.user_id = p_user), '[]'::jsonb)
);
$$;
revoke all on function public.apex_scene_motion_state_v2(uuid, uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.apex_scene_motion_state_v2(uuid, uuid, uuid, text[]) to service_role;

create or replace function public.apex_write_scene_motion_v2(
  p_campaign uuid, p_actor uuid, p_input jsonb, p_cost numeric, p_allowance numeric, p_epoch text, p_discovered jsonb, p_seen text[]
) returns jsonb language plpgsql set search_path = '' as $$
declare
  profile public.apex_profiles%rowtype; destination public.apex_scenes%rowtype;
  assignment public.apex_scene_assignments%rowtype; old_token public.apex_scene_tokens%rowtype;
  previous public.apex_scene_actions%rowtype; ledger public.apex_scene_ledgers%rowtype;
  state_doc jsonb; v_encounter jsonb; v_active jsonb;
  v_scene uuid := (p_input->>'sceneId')::uuid; v_token text := p_input->>'tokenId';
  v_request uuid := (p_input->>'requestId')::uuid; v_spent numeric; owner_id uuid; observations jsonb;
begin
  select * into profile from public.apex_profiles where campaign_id = p_campaign and user_id = p_actor and active;
  if not found then return jsonb_build_object('ok', false, 'error', 'Profile unavailable.'); end if;
  select state into state_doc from public.apex_game_states where campaign_id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Campaign unavailable.'); end if;
  select * into previous from public.apex_scene_actions where campaign_id = p_campaign and request_id = v_request;
  if found then return jsonb_build_object('ok', previous.actor_id = p_actor and previous.payload = p_input, 'error', case when previous.actor_id = p_actor and previous.payload = p_input then null else 'Request ID already used.' end); end if;
  if not (state_doc->'tokens' ? v_token) then return jsonb_build_object('ok', false, 'error', 'Character unavailable.'); end if;
  if profile.role <> 'gm' and (not v_token = any(profile.token_ids) or p_input->>'action' <> 'move') then return jsonb_build_object('ok', false, 'error', 'Character is not controlled by you.'); end if;
  select * into destination from public.apex_scenes where campaign_id = p_campaign and id = v_scene for share;
  if not found or destination.is_legacy_arena or destination.archived or destination.is_draft or destination.category not in ('battle','region') or destination.published_revision <> (p_input->>'sceneRevision')::integer then return jsonb_build_object('ok', false, 'error', 'Scene changed.'); end if;
  if profile.role <> 'gm' then
    select * into assignment from public.apex_scene_assignments where campaign_id = p_campaign and user_id = p_actor;
    if not found or assignment.scene_id is distinct from v_scene or assignment.revision <> (p_input->>'assignmentRevision')::integer then return jsonb_build_object('ok', false, 'error', 'Assignment changed.'); end if;
  end if;
  if (p_input->>'x')::numeric not between 0 and (destination.published_metadata->>'width')::numeric or (p_input->>'y')::numeric not between 0 and (destination.published_metadata->>'height')::numeric then return jsonb_build_object('ok', false, 'error', 'Invalid position.'); end if;
  select * into old_token from public.apex_scene_tokens where campaign_id = p_campaign and scene_id = v_scene and token_id = v_token;
  if coalesce(old_token.version, 0) <> (p_input->>'tokenVersion')::integer then return jsonb_build_object('ok', false, 'error', 'Token changed.'); end if;

  if p_input->>'action' <> 'place' then
    -- Re-derive the movement epoch from the locked scene state.
    v_encounter := state_doc->'sceneEncounters'->(v_scene::text);
    if destination.category = 'region' then
      if p_epoch is distinct from 'd:' || coalesce(state_doc->'sceneClocks'->(v_scene::text)->>'day', '1') then return jsonb_build_object('ok', false, 'error', 'The scene day changed. Refresh before moving.'); end if;
    elsif p_epoch = 'free' then
      if v_encounter->>'status' = 'active' then return jsonb_build_object('ok', false, 'error', 'Initiative started. Wait for your turn.'); end if;
    else
      if v_encounter->>'status' is distinct from 'active' or p_epoch is distinct from 't:' || (v_encounter->>'id') || ':' || coalesce(v_encounter->>'turnSerial', '0') then return jsonb_build_object('ok', false, 'error', 'The turn changed. Refresh before moving.'); end if;
      v_active := v_encounter->'participants'->((v_encounter->>'turnIndex')::integer);
      if profile.role <> 'gm' and v_active->>'tokenId' is distinct from v_token then return jsonb_build_object('ok', false, 'error', 'It is not your turn.'); end if;
    end if;
    select * into ledger from public.apex_scene_ledgers where campaign_id = p_campaign and scene_id = v_scene and token_id = v_token;
    v_spent := case when found and ledger.epoch = p_epoch then ledger.spent else 0 end;
    if p_cost <= 0 or p_cost > 1000000 or p_allowance < 0 or v_spent + p_cost > p_allowance + 0.000001 then return jsonb_build_object('ok', false, 'error', 'Movement exceeds what is left this turn or day.'); end if;
    insert into public.apex_scene_ledgers(campaign_id, scene_id, token_id, epoch, spent) values (p_campaign, v_scene, v_token, p_epoch, v_spent + p_cost)
      on conflict (campaign_id, scene_id, token_id) do update set epoch = excluded.epoch, spent = excluded.spent;
  end if;

  insert into public.apex_scene_tokens(campaign_id, scene_id, token_id, x, y, version)
    values (p_campaign, v_scene, v_token, (p_input->>'x')::double precision, (p_input->>'y')::double precision, 1)
    on conflict (campaign_id, scene_id, token_id) do update set x = excluded.x, y = excluded.y, version = public.apex_scene_tokens.version + 1;

  select user_id into owner_id from public.apex_profiles where campaign_id = p_campaign and role = 'player' and v_token = any(token_ids) limit 1;
  if owner_id is not null and exists (select 1 from public.apex_campaign_members where campaign_id = p_campaign and user_id = owner_id) then
    select coalesce(jsonb_object_agg(value->>'id', value), '{}'::jsonb) into observations from jsonb_array_elements(coalesce(p_discovered, '[]'::jsonb));
    insert into public.apex_scene_exploration(campaign_id, scene_id, user_id, known_nodes) values (p_campaign, v_scene, owner_id, observations)
      on conflict (campaign_id, scene_id, user_id) do update set known_nodes = public.apex_scene_exploration.known_nodes || excluded.known_nodes;
    insert into public.apex_scene_vision(campaign_id, scene_id, user_id, hexes)
      values (p_campaign, v_scene, owner_id, (select coalesce(array_agg(distinct h), '{}') from unnest(coalesce(p_seen, '{}')) h limit 1))
      on conflict (campaign_id, scene_id, user_id) do update set hexes = (
        select coalesce(array_agg(distinct h), '{}') from (select unnest(public.apex_scene_vision.hexes) h union select unnest(coalesce(p_seen, '{}'))) u
      );
  end if;
  insert into public.apex_scene_actions(campaign_id, request_id, actor_id, payload) values (p_campaign, v_request, p_actor, p_input);
  update public.apex_game_states set version = version + 1, updated_at = now(), updated_by = p_actor where campaign_id = p_campaign;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.apex_write_scene_motion_v2(uuid, uuid, jsonb, numeric, numeric, text, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.apex_write_scene_motion_v2(uuid, uuid, jsonb, numeric, numeric, text, jsonb, text[]) to service_role;

update public.apex_schema_info set schema_version = greatest(schema_version, 7), updated_at = now() where id;
