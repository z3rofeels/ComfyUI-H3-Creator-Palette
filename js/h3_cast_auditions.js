import { setCastVariationMarker, castMentionRanges } from "./h3_prompt_tokens.js";
import * as S from "./z3_h3_state.js";

const clean=(value)=>String(value??"").trim().replace(/^@/,"");
const valid=(value)=>/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(clean(value));
const unique=(values)=>[...new Set((values||[]).map(clean).filter((value)=>value&&valid(value)))];

export function castMentionHandles(body){
  if(!body?.data)return [];
  const source=String(S.activePrompt(body.data,body.target)||"");
  const known=new Set((body.data.subjects||[]).map((subject)=>clean(subject?.handle)));
  const out=[];
  for(const row of castMentionRanges(source,[...known])){const handle=clean(row.handle);if(known.has(handle)&&!out.includes(handle))out.push(handle);}
  return out;
}

export function normalizeAuditionMap(value,subjects=[]){
  const known=new Set((subjects||[]).map((subject)=>clean(subject?.handle)).filter(Boolean));
  const source=value&&typeof value==="object"&&!Array.isArray(value)?value:{};const out={};
  for(const [rawRole,raw] of Object.entries(source)){
    const role=clean(rawRole);if(!role||!known.has(role)||!raw||typeof raw!=="object"||Array.isArray(raw))continue;
    // Candidates may live only in the reusable Cast pack. The backend resolves
    // them against the current live Cast library at queue time.
    const candidates=unique(raw.candidates).filter((handle)=>handle!==role);
    if(!candidates.length)continue;
    out[role]={candidates,direction:Number(raw.direction)<0?-1:1};
  }
  return out;
}

export function auditionMap(body){
  const container=S.activeContainer(body?.data,body?.target);if(!container)return {};
  container.cast_auditions=normalizeAuditionMap(container.cast_auditions,body.data.subjects||[]);
  return container.cast_auditions;
}

export function auditionFor(body,role){return auditionMap(body)[clean(role)]||null;}

export function setAudition(body,role,candidates,direction=1){
  const container=S.activeContainer(body?.data,body?.target);if(!container)return false;
  const key=clean(role),known=new Set((body.data.subjects||[]).map((subject)=>clean(subject?.handle)));if(!key||!known.has(key))return false;
  const list=unique(candidates).filter((handle)=>handle!==key);
  const map=normalizeAuditionMap(container.cast_auditions,body.data.subjects||[]);
  if(list.length)map[key]={candidates:list,direction:Number(direction)<0?-1:1};else delete map[key];
  container.cast_auditions=map;body.resetVariationIndex?.(false);body.commitData?.(true,{historyLabel:`Changed @${key} audition`});return true;
}

export function toggleAuditionCandidate(body,role,candidate){
  const key=clean(role),handle=clean(candidate);if(!key||!handle||key===handle)return false;
  const current=auditionFor(body,key)||{candidates:[],direction:1};const list=[...current.candidates];const index=list.indexOf(handle);
  if(index>=0)list.splice(index,1);else list.push(handle);
  return setAudition(body,key,list,current.direction);
}

export function setAuditionDirection(body,role,direction){
  const current=auditionFor(body,role);if(!current)return false;return setAudition(body,role,current.candidates,direction);
}

export function clearAudition(body,role){return setAudition(body,role,[],1);}

export function activateAuditionShortlist(body,role,direction=1){
  const current=auditionFor(body,role);if(!current?.candidates?.length)return false;
  // Explicit @Role+/- means FULL Cast pool. Switching to a shortlist must
  // therefore clear that marker first; the saved shortlist itself is retained.
  clearAllCastMarker(body,role);
  return setAuditionDirection(body,role,direction);
}

export function setAllCastMarker(body,role,direction=1){
  if(!body?.data)return false;const key=clean(role);if(!key)return false;
  const source=String(S.activePrompt(body.data,body.target)||""),next=setCastVariationMarker(source,key,Number(direction)<0?-1:1);
  if(next===source)return false;body.setPromptText?.(next,{historyLabel:`Changed @${key} variation`});body.resetVariationIndex?.();return true;
}

export function clearAllCastMarker(body,role){
  if(!body?.data)return false;const key=clean(role),source=String(S.activePrompt(body.data,body.target)||"");
  const next=setCastVariationMarker(source,key,0);if(next===source)return false;
  body.setPromptText?.(next,{historyLabel:`Changed @${key} variation`});body.resetVariationIndex?.();return true;
}
