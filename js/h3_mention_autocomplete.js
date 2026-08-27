import { castPresetLibrary, isCastPresetCacheReady, openCastStudio } from "./h3_cast_studio.js";
import * as S from "./z3_h3_state.js";
import { createSemanticAutocomplete } from "./h3_semantic_autocomplete.js";

function mentionContext(text,caret){
  const source=String(text??""),end=Math.max(0,Math.min(Number(caret)||0,source.length)),before=source.slice(0,end);
  const match=before.match(/(?:^|[\s([{])@([A-Za-z0-9_ .'-]{0,48}?)([+-])?$/);if(!match)return null;
  const query=match[1]||"",suffix=match[2]||"",start=end-query.length-suffix.length-1;
  // Compiler media handles such as @img-1 / @vid-2 / @aud-3 / legacy @ref-1 are never Cast calls.
  // Once the numeric suffix exists, Cast autocomplete must stand down entirely
  // so it cannot offer a fake character over a real reference citation.
  if(/^[A-Za-z]+-\d+$/.test(query))return null;
  return {start,end,query,direction:suffix==="+"?1:suffix==="-"?-1:0};
}
function norm(value){return String(value||"").trim().toLowerCase().replaceAll("_"," ").replace(/\s+/g," ");}
function score(label,handle,extra,query){const q=norm(query);if(!q)return 0;const name=norm(label),key=norm(handle),hay=norm(`${label||""} ${handle||""} ${extra||""}`);if(name===q||key===q)return 150;if(name.startsWith(q)||key.startsWith(q))return 120;if(name.includes(q)||key.includes(q))return 90;return hay.includes(q)?60:-1;}
function itemsFor(body,query){
  const q=norm(query),rows=[],activeHandles=new Set();
  for(const subject of body?.data?.subjects||[]){const handle=S.normalizeSubjectHandle(subject.handle||subject.display_name||"Subject"),display=subject.display_name||handle.replaceAll("_"," "),rank=score(display,handle,subject.description||"",query);activeHandles.add(handle);if(q&&rank<0)continue;rows.push({key:`cast:${handle}`,kind:"active",handle,label:display,description:subject.description||"Cast subject",meta:`@${handle} · In Creator Cast`,image:body.subjectThumbnail?.(subject)||"",score:rank+12,exact:rank>=150,icon:"@"});}
  for(const preset of castPresetLibrary?.()||[]){const handle=S.normalizeSubjectHandle(preset.handle||preset.name);if(activeHandles.has(handle))continue;const rank=score(preset.name,handle,`${preset.group||""} ${preset.note||""} ${preset.description||""}`,query);if(q&&rank<0)continue;rows.push({key:`cast:${handle}`,kind:"preset",handle,label:preset.name,description:preset.note||preset.description||"Character preset",meta:`@${handle} · ${preset.group||"Character pack"}`,preset,image:body.thumbnailUrl?.(preset.thumbnail)||"",score:rank,exact:rank>=150,icon:"@"});}
  const createLabel=String(query||"").trim().replaceAll("_"," ").trim(),createHandle=S.normalizeSubjectHandle(createLabel||"Character"),exact=rows.some((row)=>row.handle.toLowerCase()===createHandle.toLowerCase()||norm(row.label)===norm(createLabel));
  if(!exact)rows.push({key:`create:${createHandle}`,kind:"create",handle:createHandle,label:createLabel?`Create ${createLabel}`:"Create original character",description:"Open Cast Studio, save a reusable character, and insert its @mention.",meta:"NEW CHARACTER",seedName:createLabel,score:-10,favoriteable:false,alwaysVisible:true,icon:"+"});
  return rows;
}
function ensurePresetInCast(body,item){if(!body||item?.kind!=="preset"||!item.preset)return;body.data.subjects||=[];let subject=body.data.subjects.find((candidate)=>candidate.handle===item.handle);if(!subject){subject={handle:item.handle,record_id:S.normalizeSubjectRecordId("",`preset:${item.preset.id||item.handle}`),takes:item.preset.subject_type||"person",from:[]};body.data.subjects.push(subject);}subject.display_name=item.preset.name;subject.description=item.preset.description;subject.clothing=item.preset.clothing||"";subject.preset_group=item.preset.group||"Custom";subject.preset_note=item.preset.note||"";subject.takes=item.preset.subject_type||"person";subject.preset_id=item.preset.id||item.handle;if(item.preset.thumbnail)subject.pack_thumbnail=item.preset.thumbnail;for(const key of ["prompt_base","identity_anchor","physical_traits","consistency_notes","permanent_look","positive_anchors","negative_notes","source_pack","created_at","modified_at"])if(item.preset[key]!==undefined)subject[key]=item.preset[key];for(const key of ["use_scene_clothing","tags","reference_images","reference_roles"])if(item.preset[key]!==undefined)subject[key]=Array.isArray(item.preset[key])?[...item.preset[key]]:(item.preset[key]&&typeof item.preset[key]==="object"?{...item.preset[key]}:item.preset[key]);}

let cleanup=null;
export function installMentionAutocomplete(body,editor){
  cleanup?.();cleanup=createSemanticAutocomplete({domain:"cast",prefix:"@",title:"@ Cast",subtitle:!isCastPresetCacheReady?.()?"Loading reusable Cast…":"Search Cast · favorites · recent · Enter/Tab insert",body,editor,getContext:mentionContext,getItems:itemsFor,emptyText:"No matching Cast character",maxItems:15,onCommit:async({snapshot,item,direction})=>{const {editor,start,end}=snapshot,replacement=`@${item.handle}${direction>0?"+":direction<0?"-":""}`;if(item.kind==="create"){editor.setRangeText("",start,end,"end");editor.dispatchEvent(new Event("input",{bubbles:true}));editor.focus?.({preventScroll:true});openCastStudio(snapshot.body,{create:true,seedName:item.seedName||"",createDirection:direction});return;}ensurePresetInCast(snapshot.body,item);editor.setRangeText(replacement,start,end,"end");editor.dispatchEvent(new Event("input",{bubbles:true}));editor.focus?.({preventScroll:true});if(item.kind==="preset")snapshot.body?.commitData?.();}});return()=>{cleanup?.();cleanup=null;};
}
export function cleanupMentionAutocomplete(){cleanup?.();cleanup=null;}
