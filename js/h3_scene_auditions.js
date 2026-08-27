import * as S from "./z3_h3_state.js";
import { H3_SCENE_SLOT_ORDER } from "./h3_prompt_categories.js";

const SLOTS=new Set(H3_SCENE_SLOT_ORDER);
const clean=(value)=>String(value??"").trim();
const unique=(values)=>[...new Set((values||[]).map(clean).filter(Boolean))];

export function normalizeSceneAuditionMap(value,selections={}){
  const source=value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  const palette=selections&&typeof selections==="object"&&!Array.isArray(selections)?selections:{};
  const out={};
  for(const [rawSlot,raw] of Object.entries(source)){
    const slot=clean(rawSlot);if(!SLOTS.has(slot)||!raw||typeof raw!=="object"||Array.isArray(raw))continue;
    const currentId=clean(palette?.[slot]?.id);
    const candidates=unique(raw.candidates).filter((id)=>id!==currentId);
    if(!candidates.length)continue;
    const mode=raw.mode==="prepared"?"prepared":"shortlist";
    out[slot]={candidates,direction:Number(raw.direction)<0?-1:1,mode};
  }
  return out;
}

export function sceneAuditionMap(body){
  const container=S.activeContainer(body?.data,body?.target);if(!container)return {};
  container.scene_auditions=normalizeSceneAuditionMap(container.scene_auditions,container.scene_palette||{});
  return container.scene_auditions;
}

export function sceneAuditionFor(body,slot){return sceneAuditionMap(body)[clean(slot)]||null;}

export function setSceneAudition(body,slot,candidates,direction=1,mode=null){
  let container=S.activeContainer(body?.data,body?.target);if(!container)return false;
  const key=clean(slot);if(!SLOTS.has(key))return false;
  body.ensureScenePreset?.(key);container=S.activeContainer(body?.data,body?.target);if(!container)return false;
  const inherited=body?.target!=="global"?body?.data?.scene_palette?.[key]:null;
  const selected=container.scene_palette?.[key]||inherited;if(!selected)return false;
  container.scene_palette ||= {};if(!container.scene_palette[key])container.scene_palette[key]=structuredClone(selected);
  const currentId=clean(container.scene_palette[key]?.id);
  const list=unique(candidates).filter((id)=>id&&id!==currentId);
  const map=normalizeSceneAuditionMap(container.scene_auditions,container.scene_palette||{});
  const nextMode=mode==="shortlist"?"shortlist":mode==="prepared"?"prepared":map[key]?.mode||"prepared";
  if(list.length)map[key]={candidates:list,direction:Number(direction)<0?-1:1,mode:nextMode};else delete map[key];
  container.scene_auditions=map;body.resetVariationIndex?.(false);body.commitData?.(true,{historyLabel:`Changed ${key} audition`});return true;
}

export function toggleSceneAuditionCandidate(body,slot,presetId){
  const key=clean(slot),id=clean(presetId);if(!SLOTS.has(key)||!id)return false;
  const current=sceneAuditionFor(body,key)||{candidates:[],direction:1};const list=[...current.candidates];const index=list.indexOf(id);
  if(index>=0)list.splice(index,1);else list.push(id);
  return setSceneAudition(body,key,list,current.direction,current.mode||"prepared");
}

export function setSceneAuditionDirection(body,slot,direction){
  const current=sceneAuditionFor(body,slot);if(!current)return false;
  return setSceneAudition(body,slot,current.candidates,direction,"shortlist");
}

export function clearSceneAudition(body,slot){return setSceneAudition(body,slot,[],1);}

export function activateSceneAuditionShortlist(body,slot,direction=1){
  const current=sceneAuditionFor(body,slot);if(!current?.candidates?.length)return false;
  // CATEGORY+/- always means the complete live category. A shortlist is a
  // separate mode, so explicitly leave full-pool mode before enabling it.
  const marker=body?.sceneVariation?.(slot)||0;if(marker)body.setSceneVariation?.(slot,marker);
  return setSceneAuditionDirection(body,slot,direction);
}
