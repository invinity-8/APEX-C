import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRepo } from './memoryRepo';
import { activate, seedProfiles } from './seed';
import { createDemoState } from '../src/data/demo';
import { handleApi, resetSchemaCache } from '../src/server/api';
import type { AuthUser } from '../src/server/repo';
import type { PlayerPayload } from '../src/server/protocol';
import type { SceneDefinition } from '../src/server/scenes';
import type { SceneMap } from '../src/campaign/maps';
/** Centre of the hex `n` steps east of the scene's spawn (hex spacing = √3 × 30 px). */
const east=(scene:SceneDefinition,n:number)=>{ const spawn=(scene.metadata as unknown as SceneMap).nodes.find(x=>x.kind==='spawn')!; return { x: spawn.x+n*Math.sqrt(3)*30, y: spawn.y }; };
import { neighbors } from '../src/game/hex';
import { validateMove } from '../src/game/commands';
import { emptySheet } from '../src/game/sheet';
import { lbToKg } from '../src/game/items/weight';
import type { JournalEntry } from '../src/server/journals';

const cid='campaign-08'; let repo:MemoryRepo; let cookies:Record<string,string>;
const request=async (profile:string,op:string,body?:unknown,query:Record<string,string>={}) => handleApi({method:body===undefined?'GET':'POST',op,body:body??null,query,ip:'203.0.113.12',headers:{host:'apex.test',origin:'https://apex.test','x-apex-csrf':'1',cookie:cookies[profile]}},repo);
beforeEach(async()=>{
  resetSchemaCache(); repo=new MemoryRepo(); cookies={}; repo.campaigns.push({id:cid,slug:'main',name:'Campaign'}); seedProfiles(repo,cid);
  repo.states.set(cid,{state:createDemoState({radius:12,seed:5}),version:1});
  for(const key of ['gm','hannah','jean']) { await activate(repo,cid,key,`${key}-test-password`); const r=await request(key,'login',{profile:key,password:`${key}-test-password`}); expect(r.status).toBe(200); cookies[key]=r.cookies![0].split(';')[0]; }
});
const user=(key:string)=>repo.profileList.find(p=>p.key===key)!;
async function battle() {
  const created=(await request('gm','scenes',{name:'Encounter',category:'battle',template:'square-battle'})).body as {scene:SceneDefinition};
  // Hex battle map (Arena engine) with uniform grassland so movement costs are predictable.
  const meta=created.scene.metadata as unknown as SceneMap; const map={...meta,hex:{radius:meta.hex!.radius,terrain:'p'.repeat(meta.hex!.terrain.length)}};
  const published=await request('gm','scenes',{action:'publish',id:created.scene.id,revision:created.scene.revision,map});
  expect(published.status).toBe(200); return (published.body as {scene:SceneDefinition}).scene;
}
async function assign(id:string|null,revision:number) { const r=await request('gm','scene-runtime',{sceneId:id,targets:[{userId:user('hannah').userId,revision}],requestId:crypto.randomUUID()}); expect(r.status).toBe(200); }
async function assignPlayer(profile:string,id:string|null,revision:number) { const r=await request('gm','scene-runtime',{sceneId:id,targets:[{userId:user(profile).userId,revision}],requestId:crypto.randomUUID()}); expect(r.status).toBe(200); }

describe('campaign engine API integration',()=>{
  it('keeps GM drafts independent from the published movement revision',async()=>{
    const scene=await battle(); await assign(scene.id,0);
    const before=repo.states.get(cid)!.version;
    const changed={...scene.metadata,gmNotes:'Never send this draft to players'};
    const draft=await request('gm','scenes',{action:'save',id:scene.id,revision:scene.revision,map:changed}); expect(draft.status).toBe(200);
    expect(repo.states.get(cid)!.version).toBe(before);
    const p=(await request('hannah','state')).body as PlayerPayload;
    expect(p.scene?.scene?.revision).toBe(1); expect(JSON.stringify(p)).not.toContain('Never send this draft');
    const move=await request('hannah','scene-motion',{action:'move',sceneId:scene.id,sceneRevision:1,assignmentRevision:1,tokenId:'sinna',tokenVersion:0,epoch:0,...east(scene,1),requestId:crypto.randomUUID()}); expect(move.status).toBe(200);
  });
  it('scopes scene loot rolls to assigned players and rejects votes after leaving the scene',async()=>{
    const scene=await battle(); await assign(scene.id,0);
    const stored=repo.states.get(cid)!;
    stored.state.arsenal={staged:[{id:'scene-potion',name:'Potion',kind:'consumable',description:'Healing draught',quantity:1}]};
    const started=await request('gm','command',{campaignId:cid,requestId:crypto.randomUUID(),command:{type:'lootRollStart',rollId:'scene-roll',stagedIds:['scene-potion'],tokenIds:['sinna'],minutes:15,sceneId:scene.id}});
    expect(started.status).toBe(200);
    const roll=repo.states.get(cid)!.state.lootRolls?.find(item=>item.sceneId===scene.id); expect(roll?.status).toBe('open');
    const hannah=(await request('hannah','state')).body as PlayerPayload;
    expect(hannah.view?.lootRolls.map(item=>item.id)).toContain(roll!.id);
    const jean=(await request('jean','state')).body as PlayerPayload;
    expect(jean.view?.lootRolls.some(item=>item.id===roll!.id)).toBe(false);

    await assign(null,1);
    const vote=await request('hannah','command',{campaignId:cid,requestId:crypto.randomUUID(),command:{type:'lootRollChoose',rollId:roll!.id,tokenId:'sinna',choice:'need'}});
    expect(vote.status).toBe(409);
    expect(repo.states.get(cid)!.state.lootRolls?.find(item=>item.id===roll!.id)?.choices).toEqual({});
  });
  it('scopes live scene announcements and encounter information to assigned players',async()=>{
    const scene=await battle(), other=await battle(); await assign(scene.id,0); await assignPlayer('jean',other.id,0);
    const revision=scene.published_revision!;
    const announce=await request('gm','command',{campaignId:cid,requestId:crypto.randomUUID(),command:{type:'sceneAnnounce',sceneId:scene.id,publishedRevision:revision,announcementId:'notice-live',title:'The gate opens',text:'A herald steps into the torchlight.'}});
    expect(announce.status).toBe(200);
    let hannah=(await request('hannah','state')).body as PlayerPayload;
    let jean=(await request('jean','state')).body as PlayerPayload;
    expect(hannah.view?.sceneAnnouncements.map(a=>a.id)).toContain('notice-live');
    expect(jean.view?.sceneAnnouncements).toEqual([]);

    const participants=[
      {id:'pc-sinna',tokenId:'sinna',name:'Sinna',initiative:15,visible:true},
      {id:'npc-hidden',name:'Hidden guard',initiative:19,visible:false},
      {id:'npc-wolf',name:'Wolf',initiative:5,visible:true},
    ];
    const started=await request('gm','command',{campaignId:cid,requestId:crypto.randomUUID(),command:{type:'sceneEncounterStart',sceneId:scene.id,publishedRevision:revision,encounterId:'encounter-live',title:'Gate skirmish',participants}});
    expect(started.status).toBe(200);
    hannah=(await request('hannah','state')).body as PlayerPayload;
    jean=(await request('jean','state')).body as PlayerPayload;
    expect(hannah.view?.sceneEncounter?.participants.map(p=>p.id)).toEqual(['pc-sinna','npc-wolf']);
    expect(hannah.view?.sceneEncounter?.turnIndex).toBe(-1);
    expect(jean.view?.sceneEncounter).toBeNull();

    const advance=await request('gm','command',{campaignId:cid,requestId:crypto.randomUUID(),command:{type:'sceneEncounterAdvance',sceneId:scene.id,publishedRevision:revision,encounterId:'encounter-live',expectedVersion:1}});
    expect(advance.status).toBe(200);
    hannah=(await request('hannah','state')).body as PlayerPayload;
    expect(hannah.view?.sceneEncounter?.participants[hannah.view.sceneEncounter.turnIndex]?.id).toBe('pc-sinna');

    const unauthorized=await request('gm','command',{campaignId:cid,requestId:crypto.randomUUID(),command:{type:'sceneEncounterAdd',sceneId:scene.id,publishedRevision:revision,encounterId:'encounter-live',expectedVersion:2,participant:{id:`pc-${user('jean').tokenIds[0]}`,tokenId:user('jean').tokenIds[0],name:'Jean',initiative:10,visible:true}}});
    expect(unauthorized.status).toBe(409);
    const playerAction=await request('hannah','command',{campaignId:cid,requestId:crypto.randomUUID(),command:{type:'sceneAnnounce',sceneId:scene.id,publishedRevision:revision,announcementId:'forbidden-note',title:'No',text:'No'}});
    expect(playerAction.status).toBe(403);
    const stale=await request('gm','command',{campaignId:cid,requestId:crypto.randomUUID(),command:{type:'sceneAnnounce',sceneId:scene.id,publishedRevision:revision+5,announcementId:'stale-note',title:'Stale',text:'Should not appear'}});
    expect(stale.status).toBe(409);
    expect(repo.states.get(cid)!.state.sceneAnnouncements?.map(a=>a.id)).toEqual(['notice-live']);
  });
  it('revalidates assigned encounter participants after a concurrent scene transfer',async()=>{
    const scene=await battle(); await assign(scene.id,0);
    repo.beforeSave=()=>{ void repo.sceneRuntime.transition({id:user('gm').userId,campaignId:cid,role:'gm'} as AuthUser,null,[{userId:user('hannah').userId,revision:1}],crypto.randomUUID()); };
    const response=await request('gm','command',{campaignId:cid,requestId:crypto.randomUUID(),command:{
      type:'sceneEncounterStart',sceneId:scene.id,publishedRevision:scene.published_revision!,encounterId:'raced-assignment',title:'Assignment race',
      participants:[{id:'pc-sinna',tokenId:'sinna',name:'Sinna',initiative:12,visible:true}],
    }});
    expect(response.status).toBe(409);
    expect(repo.states.get(cid)!.state.sceneEncounters?.[scene.id]).toBeUndefined();
    const afterTransfer=(await request('hannah','state')).body as PlayerPayload;
    expect(afterTransfer.scene?.kind).toBe('sanctuary');
  });
  it('revalidates the published scene revision after a concurrent republish',async()=>{
    const scene=await battle(); await assign(scene.id,0);
    repo.beforeSave=()=>{
      const row=repo.sceneRows.find(item=>item.campaign_id===cid&&item.id===scene.id)!;
      void repo.sceneCatalog.update(cid,scene.id,row.revision,{published_metadata:row.published_metadata});
    };
    const response=await request('gm','command',{campaignId:cid,requestId:crypto.randomUUID(),command:{
      type:'sceneAnnounce',sceneId:scene.id,publishedRevision:scene.published_revision!,announcementId:'raced-publish',title:'Revision race',text:'This must not be posted against an outdated map.',
    }});
    expect(response.status).toBe(409);
    expect(repo.states.get(cid)!.state.sceneAnnouncements).toBeUndefined();
  });
  it('rejects an Arena move if a transition wins the optimistic write race',async()=>{
    const original=structuredClone(repo.states.get(cid)!.state), sinna=original.tokens.sinna;
    const destination=neighbors(sinna.pos).find(to=>validateMove(original,{role:'player',tokenId:'sinna'},'sinna',to).ok); expect(destination).toBeDefined();
    repo.beforeSave=()=>{ void repo.sceneRuntime.transition({id:user('gm').userId,campaignId:cid,role:'gm'} as AuthUser,null,[{userId:user('hannah').userId,revision:0}],crypto.randomUUID()); };
    const result=await request('hannah','command',{campaignId:cid,sceneRevision:0,command:{type:'move',tokenId:'sinna',to:destination}});
    expect(result.status).toBe(409); expect(repo.states.get(cid)!.state.tokens.sinna.pos).toEqual(sinna.pos);
    expect(((await request('hannah','state')).body as PlayerPayload).scene?.kind).toBe('sanctuary');
  });
  it('rejects an Arena move server-side when the character exceeds carrying capacity',async()=>{
    const stored=repo.states.get(cid)!;
    const sinna=stored.state.tokens.sinna;
    const originalPosition=structuredClone(sinna.pos);
    sinna.inventory=[{ id:'overload', name:'Stone crate', kind:'misc', description:'', quantity:1, weightKg:70 }];
    sinna.equipment=undefined;
    const sheet=emptySheet(); sheet.attributes.push({ id:'str', name:'Strength', value:'10', modifier:'0' });
    expect(await repo.saveSheet(cid,'sinna',sheet,0,user('gm').userId)).toBe(1);
    const destination=neighbors(sinna.pos).find(to=>validateMove(stored.state,{role:'player',tokenId:'sinna'},'sinna',to).ok);
    expect(destination).toBeDefined();
    const response=await request('hannah','command',{campaignId:cid,command:{type:'move',tokenId:'sinna',to:destination}});
    expect(response.status).toBe(422);
    expect((response.body as {error:string}).error).toMatch(/over carrying capacity/i);
    expect(repo.states.get(cid)!.state.tokens.sinna.pos).toEqual(originalPosition);
  });
  it('rejects a scene-map move server-side when the assigned character exceeds carrying capacity',async()=>{
    const scene=await battle(); await assign(scene.id,0);
    const stored=repo.states.get(cid)!;
    stored.state.tokens.sinna.inventory=[{ id:'overload', name:'Stone crate', kind:'misc', description:'', quantity:1, weightKg:70 }];
    const sheet=emptySheet(); sheet.attributes.push({ id:'str', name:'Strength', value:'10', modifier:'0' });
    expect(await repo.saveSheet(cid,'sinna',sheet,0,user('gm').userId)).toBe(1);
    const response=await request('hannah','scene-motion',{action:'move',sceneId:scene.id,sceneRevision:1,assignmentRevision:1,tokenId:'sinna',tokenVersion:0,epoch:0,...east(scene,1),requestId:crypto.randomUUID()});
    expect(response.status).toBe(422);
    expect((response.body as {error:string}).error).toMatch(/over carrying capacity/i);
    expect(repo.sceneTokenRows.get(`${cid}:${scene.id}:sinna`)).toBeUndefined();
  });
  it('enforces variant encumbrance speed limits for scene-map movement',async()=>{
    const scene=await battle(); await assign(scene.id,0);
    const stored=repo.states.get(cid)!;
    stored.state.itemRules={encumbranceVariant:1};
    stored.state.tokens.sinna.inventory=[{ id:'load', name:'Heavy pack', kind:'misc', description:'', quantity:1, weightKg:lbToKg(60) }];
    stored.state.tokens.sinna.speedFt=30;
    const sheet=emptySheet(); sheet.attributes.push({ id:'str', name:'Strength', value:'10', modifier:'0' });
    expect(await repo.saveSheet(cid,'sinna',sheet,0,user('gm').userId)).toBe(1);
    const response=await request('hannah','scene-motion',{action:'move',sceneId:scene.id,sceneRevision:1,assignmentRevision:1,tokenId:'sinna',tokenVersion:0,epoch:0,...east(scene,5),requestId:crypto.randomUUID()});
    expect(response.status).toBe(422);
    expect((response.body as {error:string}).error).toMatch(/encumbrance leaves 20/i);
    expect(repo.sceneTokenRows.get(`${cid}:${scene.id}:sinna`)).toBeUndefined();
  });
  it('falls back to Sanctuary for missing or invalid assignments',async()=>{
    repo.sceneAssignments=repo.sceneAssignments.filter(a=>a.user_id!==user('hannah').userId);
    let p=(await request('hannah','state')).body as PlayerPayload;
    expect(p.scene?.kind).toBe('sanctuary'); expect(p.view?.hexes).toEqual([]);
    repo.sceneAssignments.push({campaign_id:cid,user_id:user('hannah').userId,scene_id:crypto.randomUUID(),revision:9,spawn_x:null,spawn_y:null});
    p=(await request('hannah','state')).body as PlayerPayload; expect(p.scene?.kind).toBe('sanctuary');
  });
  it('enforces private journal-image visibility, including GM access and sharing revocation',async()=>{
    const id=crypto.randomUUID(), draft={title:'Private',body:'Secret',category:'Personal Notes',tags:[],pinned:false,sharing:'private',scene_id:null,game_date:''};
    expect((await request('hannah','journal',{action:'save',id,version:0,entry:draft})).status).toBe(200);
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==';
    const upload=await request('hannah','journal-images',{entryId:id,image:png,thumbnail:png}); expect(upload.status).toBe(201); const imageId=(upload.body as {id:string}).id;
    let saved=await request('hannah','journal',{action:'save',id,version:1,entry:{...draft,image_id:imageId}}); expect(saved.status).toBe(200);
    expect((await request('gm','journal-images',undefined,{id:imageId})).status).toBe(404); expect((await request('jean','journal-images',undefined,{id:imageId})).status).toBe(404);
    expect((await request('hannah','journal-images',undefined,{id:imageId})).status).toBe(200);
    saved=await request('hannah','journal',{action:'save',id,version:2,entry:{...draft,image_id:imageId,sharing:'gm'}}); expect(saved.status).toBe(200);
    expect((await request('gm','journal-images',undefined,{id:imageId})).status).toBe(200); expect((await request('jean','journal-images',undefined,{id:imageId})).status).toBe(404);
    expect((await request('gm','journal',{action:'save',id,version:3,entry:{...draft,title:'GM overwrite'}})).status).toBe(409);
    saved=await request('hannah','journal',{action:'save',id,version:3,entry:{...draft,image_id:imageId}}); expect(saved.status).toBe(200);
    expect((await request('gm','journal-images',undefined,{id:imageId})).status).toBe(404);
    expect(JSON.stringify((await request('jean','state')).body)).not.toContain('Secret');
  });
  it('allows owned historical scene references and rejects references to unassigned drafts',async()=>{
    const scene=await battle(); await assign(scene.id,0); const id=crypto.randomUUID();
    const draft={title:'Encounter notes',body:'Notes',category:'Places',tags:['place'],pinned:false,sharing:'private',scene_id:scene.id,game_date:''};
    const saved=await request('hannah','journal',{action:'save',id,version:0,entry:draft}); expect(saved.status).toBe(200);
    await assign(null,1);
    expect((await request('hannah','journal',{action:'save',id,version:1,entry:{...draft,body:'Remembered later'}})).status).toBe(200);
    const privateScene=(await request('gm','scenes',{name:'Secret',category:'world'})).body as {scene:SceneDefinition};
    expect((await request('hannah','journal',{action:'save',id,version:2,entry:{...draft,scene_id:privateScene.scene.id}})).status).toBe(400);
    const own=(await request('hannah','journal')).body as {entries:JournalEntry[]}; expect(own.entries[0].scene_id).toBe(scene.id);
  });
});
