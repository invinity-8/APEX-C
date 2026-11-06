import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/data/demo';
import { executeCommand } from '../src/game/commands';
import { buildPlayerView } from '../src/game/visibility';
import { parseCommand } from '../src/server/validate';

const sceneId='11111111-1111-4111-8111-111111111111';
const initial=()=>createDemoState({radius:12,seed:5});

describe('scene live announcements and encounter controls',()=>{
  it('validates scene operations strictly at the API boundary',()=>{
    expect(parseCommand({type:'sceneAnnounce',sceneId,publishedRevision:1,announcementId:'notice-1',title:'Bell',text:'The bell rings.'}).ok).toBe(true);
    expect(parseCommand({type:'sceneAnnounce',sceneId:'not-a-uuid',publishedRevision:1,announcementId:'notice-1',title:'Bell',text:'The bell rings.'}).ok).toBe(false);
    expect(parseCommand({type:'sceneEncounterStart',sceneId:'11111111-1111-4111-8111-111111111111',publishedRevision:1,encounterId:'e1',title:'Fight',participants:[{id:'pc-sinna',tokenId:'sinna',name:'Sinna',initiative:1001,visible:true}]}).ok).toBe(false);
    expect(parseCommand({type:'sceneEncounterAdvance',sceneId:'11111111-1111-4111-8111-111111111111',publishedRevision:1,encounterId:'e1',expectedVersion:-1}).ok).toBe(false);
  });

  it('orders ties deterministically, preserves the active participant and rejects stale versions',()=>{
    let state=initial();
    const start=executeCommand(state,{role:'gm'},{type:'sceneEncounterStart',sceneId,publishedRevision:1,encounterId:'e1',title:'Ambush',participants:[
      {id:'pc-sinna',tokenId:'sinna',name:'Sinna',initiative:12,visible:true},
      {id:'npc-guard',name:'Guard',initiative:12,visible:false},
      {id:'npc-wolf',name:'Wolf',initiative:3,visible:true},
    ]});
    expect(start.ok).toBe(true); if(!start.ok)return; state=start.state;
    expect(state.sceneEncounters?.[sceneId].participants.map(p=>p.id)).toEqual(['npc-guard','pc-sinna','npc-wolf']);
    const edit=executeCommand(state,{role:'gm'},{type:'sceneEncounterInitiative',sceneId,publishedRevision:1,encounterId:'e1',expectedVersion:1,participantId:'pc-sinna',initiative:20});
    expect(edit.ok).toBe(true); if(!edit.ok)return; state=edit.state;
    expect(state.sceneEncounters?.[sceneId].participants[0].id).toBe('pc-sinna');
    expect(state.sceneEncounters?.[sceneId].turnIndex).toBe(1);
    const stale=executeCommand(state,{role:'gm'},{type:'sceneEncounterAdvance',sceneId,publishedRevision:1,encounterId:'e1',expectedVersion:1});
    expect(stale.ok).toBe(false);
    const advance=executeCommand(state,{role:'gm'},{type:'sceneEncounterAdvance',sceneId,publishedRevision:1,encounterId:'e1',expectedVersion:2});
    expect(advance.ok).toBe(true); if(!advance.ok)return; state=advance.state;
    expect(state.sceneEncounters?.[sceneId].participants[state.sceneEncounters[sceneId].turnIndex].id).toBe('npc-wolf');
  });

  it('returns live scene data only for that scene and hides unpublished encounter participants',()=>{
    const state=initial();
    state.sceneAnnouncements=[{id:'a1',sceneId,title:'Gate',text:'The gate opens.',createdAt:'2026-01-01T00:00:00Z'}];
    state.sceneEncounters={[sceneId]:{id:'e1',sceneId,title:'Guardians',round:1,turnIndex:0,version:1,status:'active',participants:[
      {id:'npc-hidden',name:'Hidden guard',initiative:19,visible:false},
      {id:'pc-sinna',tokenId:'sinna',name:'Sinna',initiative:15,visible:true},
    ]}};
    const assigned=buildPlayerView(state,'sinna',sceneId);
    expect(assigned.sceneAnnouncements.map(a=>a.id)).toEqual(['a1']);
    expect(assigned.sceneEncounter?.participants.map(p=>p.id)).toEqual(['pc-sinna']);
    expect(assigned.sceneEncounter?.turnIndex).toBe(-1);
    const elsewhere=buildPlayerView(state,'aster','other-scene');
    expect(elsewhere.sceneAnnouncements).toEqual([]);
    expect(elsewhere.sceneEncounter).toBeNull();
  });
});
