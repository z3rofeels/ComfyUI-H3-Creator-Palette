import * as H from "./z3_h3_api.js";
import * as S from "./z3_h3_state.js";
import { H3PackAPI } from "./h3_pack_api.js";
import { replaceCastMention } from "./h3_prompt_tokens.js";
import { findAvailableCastHandle, findCastDuplicateCandidates } from "./h3_cast_identity.js";
import { activeCastRoleHandles, castCardIntent } from "./h3_cast_swap.js";

let livePresetCache=[];
let castPresetCacheReady=false;
function presetIdentity(preset){
  const id=String(preset?.id||"").trim();
  const handle=S.normalizeSubjectHandle(preset?.handle||preset?.name||"Character");
  return id?`id:${id}`:`handle:${handle}`;
}
function dedupePresetRows(rows){
  const out=[],byIdentity=new Map(),byHandle=new Map();
  for(const raw of Array.isArray(rows)?rows:[]){
    if(!raw||typeof raw!=="object")continue;
    const preset={...raw},handle=S.normalizeSubjectHandle(preset.handle||preset.name||"Character");
    preset.handle=handle;
    const key=presetIdentity(preset),existing=byIdentity.get(key);
    if(existing){Object.assign(existing,preset);continue;}
    const handleKey=handle.toLowerCase(),handleExisting=byHandle.get(handleKey);
    if(handleExisting){
      // A reusable @handle must resolve to one record in the prompt editor. Keep
      // one visible card and merge richer fields; the server integrity checker
      // still reports the underlying conflict so Repair can make it permanent.
      for(const [field,value] of Object.entries(preset))if((handleExisting[field]===undefined||handleExisting[field]==="")&&value!==undefined&&value!=="")handleExisting[field]=value;
      continue;
    }
    byIdentity.set(key,preset);byHandle.set(handleKey,preset);out.push(preset);
  }
  return out;
}
const CAST_HISTORY_KEY="z3.minimaxCreator.castHistory.v1";
const CAST_STUDIO_PREFS_KEY="z3.minimaxCreator.castStudio.v2";

function readCastHistory(){try{const rows=JSON.parse(localStorage.getItem(CAST_HISTORY_KEY)||"[]");return Array.isArray(rows)?rows:[];}catch{return [];}}
function readStudioPrefs(){try{const value=JSON.parse(localStorage.getItem(CAST_STUDIO_PREFS_KEY)||"{}");return value&&typeof value==="object"?value:{};}catch{return {};}}
function saveStudioPrefs(patch){try{localStorage.setItem(CAST_STUDIO_PREFS_KEY,JSON.stringify({...readStudioPrefs(),...patch}));}catch{}}
function noteCastHistory(item){
  const handle=S.normalizeSubjectHandle(item?.handle||item?.name||"Character"),group=String(item?.group||item?.preset_group||"Custom / My Cast"),name=String(item?.name||item?.display_name||handle).replaceAll("_"," ");
  if(!handle)return;const rows=[{handle,group,name,usedAt:Date.now()},...readCastHistory().filter(row=>String(row?.handle)!==handle)].slice(0,20);
  try{localStorage.setItem(CAST_HISTORY_KEY,JSON.stringify(rows));}catch{}
}
function isMentioned(body,handle){const clean=String(handle||"").replace(/^@/,"");return !!clean&&new RegExp(`@${clean}(?!-[0-9])(?![A-Za-z0-9_])`).test(String(S.activePrompt(body?.data,body?.target)||""));}
export function castDuplicateCandidates(body,{displayName="",handle="",current=null,presets=livePresetCache}={}){
  return findCastDuplicateCandidates({subjects:body?.data?.subjects||[],presets,displayName,handle,current});
}

export function setCastPresetCache(presets){
  livePresetCache=dedupePresetRows(Array.isArray(presets)?presets:[]);
  castPresetCacheReady=true;
  return livePresetCache;
}
export function castPresetLibrary(){return [...(livePresetCache||[])];}
export function isCastPresetCacheReady(){return castPresetCacheReady;}
export async function refreshCastPresetCache(){
  try{return setCastPresetCache((await H3PackAPI.load()).cast||[]);}
  catch(error){
    // Never resurrect the shipped starter array after a user deletes/replaces a
    // Cast pack. A failed disk/API read should mean “library unavailable”, not
    // “show ghost characters that are no longer in the live pack”.
    castPresetCacheReady=true;livePresetCache=[];throw error;
  }
}
function presetKey(preset){return String(preset?.handle||preset?.id||"").trim();}
export function castPresetForSubject(subject,presets=livePresetCache){
  if(!subject)return null;
  const rows=Array.isArray(presets)?presets:[],linked=String(subject.preset_id||"").trim(),handle=S.normalizeSubjectHandle(subject.handle||subject.display_name||"Character");
  if(linked){
    const exact=rows.find((preset)=>String(preset?.id||"").trim()===linked||String(preset?.handle||"").trim()===linked);
    // preset_id is an explicit library link. If it is stale, keep the workflow
    // copy local and unlinked instead of silently attaching it to a different
    // character that happens to reuse the same @handle later.
    return exact||null;
  }
  return rows.find((preset)=>S.normalizeSubjectHandle(preset?.handle||preset?.name||"Character")===handle)||null;
}
function copyPresetFields(subject,preset){
  if(!subject||!preset)return false;
  let changed=false;
  const set=(key,value)=>{const next=String(value??"");if(String(subject[key]??"")!==next){subject[key]=next;changed=true;}};
  const setValue=(key,value)=>{
    if(value===undefined)return;
    const clone=Array.isArray(value)?[...value]:(value&&typeof value==="object"?{...value}:value);
    if(JSON.stringify(subject[key]??null)!==JSON.stringify(clone??null)){subject[key]=clone;changed=true;}
  };
  set("display_name",preset.name||preset.handle||subject.handle||"Character");
  set("description",preset.description||"");
  set("clothing",preset.clothing||"");
  set("preset_group",preset.group||"Custom");
  set("preset_note",preset.note||"");
  set("variant_of",preset.variant_of||"");
  set("takes",preset.subject_type||preset.takes||subject.takes||"person");
  for(const key of ["prompt_base","identity_anchor","physical_traits","consistency_notes","permanent_look","positive_anchors","negative_notes","source_pack","created_at","modified_at"])set(key,preset[key]??subject[key]??"");
  for(const key of ["use_scene_clothing","tags","reference_images","reference_roles","reference_ids","reference_roles_by_id"])if(preset[key]!==undefined)setValue(key,preset[key]);
  const pid=String(preset.id||preset.handle||subject.handle||"");if(String(subject.preset_id||"")!==pid){subject.preset_id=pid;changed=true;}
  const thumb=String(preset.thumbnail||"");if(thumb){if(String(subject.pack_thumbnail||"")!==thumb){subject.pack_thumbnail=thumb;changed=true;}}else if(subject.pack_thumbnail){delete subject.pack_thumbnail;changed=true;}
  // v3.7.0/3.7.1 copied reusable pack thumbnail paths into the workflow-level
  // override field. Migrate those strings away so removing/replacing a pack
  // thumbnail cannot resurrect a stale image from an old workflow snapshot.
  if(typeof subject.thumbnail==="string"&&subject.thumbnail.replaceAll("\\","/").startsWith("thumbs/")){delete subject.thumbnail;changed=true;}
  return changed;
}
export function syncBodyFromCastPresets(body,presets=livePresetCache,{commit=true}={}){
  if(!body?.data)return false;setCastPresetCache(presets);
  let changed=false;
  const rows=Array.isArray(body.data.subjects)?body.data.subjects:(body.data.subjects=[]),seenRecords=new Map(),seenLinks=new Map(),seenHandles=new Map(),kept=[];
  const sameWorkflowCharacter=(left,right)=>{
    if(!left||!right)return false;
    const name=(value)=>String(value?.display_name||value?.handle||"").trim().toLowerCase();
    const description=(value)=>String(value?.description||"").trim().toLowerCase();
    const clothing=(value)=>String(value?.clothing||"").trim().toLowerCase();
    return name(left)===name(right)&&((description(left)&&description(left)===description(right))||(clothing(left)&&clothing(left)===clothing(right)));
  };
  const mergeMissing=(target,source)=>{
    for(const field of ["display_name","description","clothing","thumbnail","thumbnail_handle","pack_thumbnail","motion","voice","replaces","replaces_what","relationship","variant_of","preset_group","preset_note","prompt_base","identity_anchor","physical_traits","consistency_notes","permanent_look","positive_anchors","negative_notes","source_pack","created_at","modified_at"]){if((target[field]===undefined||target[field]==="")&&source[field]!==undefined&&source[field]!=="")target[field]=source[field];}
    for(const field of ["use_scene_clothing","tags","reference_images","reference_roles","reference_ids","reference_roles_by_id"]){if(target[field]===undefined&&source[field]!==undefined)target[field]=Array.isArray(source[field])?[...source[field]]:(source[field]&&typeof source[field]==="object"?{...source[field]}:source[field]);}
    if((!target.from||!target.from.length)&&Array.isArray(source.from))target.from=[...source.from];
  };
  for(const subject of rows){
    if(!subject||typeof subject!=="object"){changed=true;continue;}
    const linkedBefore=String(subject.preset_id||"").trim();
    const preset=castPresetForSubject(subject,presets);
    if(linkedBefore&&!preset){
      // Deleted/replaced packs leave a perfectly usable workflow-local copy.
      // Remove only the dead library link so it cannot render as a zombie or
      // collide with a future preset that reuses the same handle.
      delete subject.preset_id;delete subject.pack_thumbnail;delete subject.preset_note;
      if(!subject.preset_group)subject.preset_group="Workflow Cast";changed=true;
    }
    if(preset){
      const presetHandle=S.normalizeSubjectHandle(preset.handle||preset.name||"Character");
      const linkedId=String(subject.preset_id||"").trim(),presetId=String(preset.id||preset.handle||"").trim();
      if(presetHandle&&linkedId&&(linkedId===presetId||linkedId===String(preset.handle||""))&&String(subject.handle||"")!==presetHandle){
        const oldHandle=String(subject.handle||"");
        const conflicts=rows.some((candidate)=>candidate!==subject&&S.normalizeSubjectHandle(candidate?.handle||"")===presetHandle);
        if(!conflicts&&(oldHandle==="Character"||!oldHandle)){
          if(oldHandle&&oldHandle!==presetHandle){
            const swap=(value)=>replaceCastMention(value,oldHandle,presetHandle);
            body.data.prompt=swap(body.data.prompt);body.data.soundscape=swap(body.data.soundscape);body.data.music=swap(body.data.music);
            for(const segment of body.data.segments||[]){segment.prompt=swap(segment.prompt);segment.soundscape=swap(segment.soundscape);segment.music=swap(segment.music);}
          }
          subject.handle=presetHandle;changed=true;
        }
      }
      changed=copyPresetFields(subject,preset)||changed;
    }
    subject.record_id=S.normalizeSubjectRecordId(subject.record_id||"",`${subject.preset_id||""}|${subject.handle||subject.display_name||"Character"}`);
    const recordKey=String(subject.record_id||"").trim();
    const linkKey=String(subject.preset_id||"").trim();
    let handleKey=S.normalizeSubjectHandle(subject.handle||subject.display_name||"Character").toLowerCase();
    let target=recordKey?seenRecords.get(recordKey):null;
    if(!target&&linkKey)target=seenLinks.get(linkKey)||null;
    const handleTarget=!target?seenHandles.get(handleKey)||null:null;
    if(!target&&handleTarget&&sameWorkflowCharacter(handleTarget,subject))target=handleTarget;
    if(target){mergeMissing(target,subject);changed=true;continue;}
    if(handleTarget){
      // Two genuinely different workflow characters cannot share one @handle.
      // Preserve both records and make the later one uniquely addressable
      // instead of deleting one merely because a legacy workflow collided.
      const next=findAvailableCastHandle({value:subject.handle||subject.display_name||"Character",subjects:kept,presets,current:subject});
      if(next&&next!==subject.handle){subject.handle=next;handleKey=next.toLowerCase();changed=true;}
    }
    if(recordKey)seenRecords.set(recordKey,subject);if(linkKey)seenLinks.set(linkKey,subject);seenHandles.set(handleKey,subject);kept.push(subject);
  }
  if(kept.length!==rows.length){body.data.subjects=kept;changed=true;}
  if(changed&&commit)body.commitData?.(false,{skipHistory:true});
  return changed;
}

export function castStateIntegrity(body,presets=livePresetCache){
  const rows=Array.isArray(body?.data?.subjects)?body.data.subjects:[],library=Array.isArray(presets)?presets:[];
  const presetIds=new Set(),presetHandles=new Set();
  for(const preset of library){
    const id=String(preset?.id||"").trim();if(id)presetIds.add(id);
    const handle=String(preset?.handle||"").trim();if(handle)presetHandles.add(handle);
  }
  const issues=[],recordIds=new Map(),links=new Map(),handles=new Map();
  const pushDuplicate=(kind,key,index,map)=>{if(!key)return;const first=map.get(key);if(first==null)map.set(key,index);else issues.push({kind,key,index,first});};
  rows.forEach((subject,index)=>{
    if(!subject||typeof subject!=="object"){issues.push({kind:"invalid_workflow_cast",index});return;}
    const recordId=String(subject.record_id||"").trim();
    if(!recordId)issues.push({kind:"missing_record_id",index,handle:String(subject.handle||"")});
    else pushDuplicate("duplicate_record_id",recordId,index,recordIds);
    const link=String(subject.preset_id||"").trim();
    if(link){
      if(!presetIds.has(link)&&!presetHandles.has(link))issues.push({kind:"stale_library_link",key:link,index,handle:String(subject.handle||"")});
      pushDuplicate("duplicate_library_link",link,index,links);
    }
    const handle=S.normalizeSubjectHandle(subject.handle||subject.display_name||"Character").toLowerCase();
    pushDuplicate("duplicate_workflow_handle",handle,index,handles);
  });
  return {ok:!issues.length,repairable:!!issues.length,issues,counts:{subjects:rows.length,library:library.length,issues:issues.length}};
}
export function syncLinkedSubjectFromPreset(body,preset,{oldHandle="",commit=true}={}){
  if(!body?.data||!preset)return null;
  const old=String(oldHandle||"").trim(),next=S.normalizeSubjectHandle(preset.handle||preset.name||"Character");
  let subject=(body.data.subjects||[]).find((row)=>row&&(String(row.preset_id||"")===old||String(row.handle||"")===old));
  if(!subject)subject=(body.data.subjects||[]).find((row)=>castPresetForSubject(row,[preset]));
  if(!subject)return null;
  const previous=String(subject.handle||"");
  if(previous&&previous!==next){
    const swap=(value)=>replaceCastMention(value,previous,next);
    body.data.prompt=swap(body.data.prompt);body.data.soundscape=swap(body.data.soundscape);body.data.music=swap(body.data.music);
    for(const segment of body.data.segments||[]){segment.prompt=swap(segment.prompt);segment.soundscape=swap(segment.soundscape);segment.music=swap(segment.music);}
    subject.handle=next;
  }
  copyPresetFields(subject,preset);
  if(commit)body.commitData?.(true,{historyLabel:"Edited Character"});
  return subject;
}
function updatePresetCache(saved,oldHandle=""){
  const old=String(oldHandle||"").trim(),nextHandle=String(saved?.handle||"").trim(),nextId=String(saved?.id||"").trim();
  const rows=[...(livePresetCache||[])].filter((preset)=>{
    const id=String(preset?.id||"").trim(),handle=String(preset?.handle||"").trim();
    return !(old&&(handle===old||id===old))&&!(nextHandle&&handle===nextHandle)&&!(nextId&&id===nextId);
  });
  if(saved)rows.push(saved);setCastPresetCache(rows);
}
export async function persistSubjectToCastPack(body,subject,{oldPresetHandle=""}={}){
  if(!subject)throw new Error("Cast subject is missing");
  const linked=castPresetForSubject(subject),old=String(oldPresetHandle||linked?.handle||subject.preset_id||"").trim();
  const item={
    ...(linked||{}),
    id:String(linked?.id||subject.preset_id||`cast_${S.normalizeSubjectRecordId(subject.record_id||"",subject.handle||subject.display_name||"Character")}`),
    handle:S.normalizeSubjectHandle(subject.handle||subject.display_name||"Character"),
    name:subjectDisplayName(subject),
    group:String(subject.preset_group||linked?.group||"Custom / My Cast"),
    description:String(subject.description||""),
    clothing:String(subject.clothing||""),
    note:String(subject.preset_note||linked?.note||"Custom Cast entry."),
    subject_type:String(subject.takes||linked?.subject_type||linked?.takes||"person"),
    prompt_base:String(subject.prompt_base??linked?.prompt_base??subject.description??""),
    identity_anchor:String(subject.identity_anchor??linked?.identity_anchor??""),
    physical_traits:String(subject.physical_traits??linked?.physical_traits??""),
    consistency_notes:String(subject.consistency_notes??linked?.consistency_notes??""),
    permanent_look:String(subject.permanent_look??linked?.permanent_look??subject.clothing??""),
    use_scene_clothing:subject.use_scene_clothing!==undefined?!!subject.use_scene_clothing:!String(subject.clothing||"").trim(),
    positive_anchors:String(subject.positive_anchors??linked?.positive_anchors??""),
    negative_notes:String(subject.negative_notes??linked?.negative_notes??""),
    tags:Array.isArray(subject.tags)?subject.tags:(Array.isArray(linked?.tags)?linked.tags:[]),
    reference_images:Array.isArray(subject.reference_images)?subject.reference_images:(Array.isArray(linked?.reference_images)?linked.reference_images:[]),
    reference_roles:subject.reference_roles&&typeof subject.reference_roles==="object"?subject.reference_roles:(linked?.reference_roles&&typeof linked.reference_roles==="object"?linked.reference_roles:{}),
    reference_ids:Array.isArray(subject.reference_ids)?subject.reference_ids:(Array.isArray(linked?.reference_ids)?linked.reference_ids:[]),
    reference_roles_by_id:subject.reference_roles_by_id&&typeof subject.reference_roles_by_id==="object"?subject.reference_roles_by_id:(linked?.reference_roles_by_id&&typeof linked.reference_roles_by_id==="object"?linked.reference_roles_by_id:{}),
    source_pack:String(subject.source_pack??linked?.source_pack??""),
    created_at:String(subject.created_at??linked?.created_at??""),
    modified_at:String(subject.modified_at??linked?.modified_at??""),
  };
  if(subject.variant_of||linked?.variant_of)item.variant_of=String(subject.variant_of||linked.variant_of).replace(/^@/,"");
  const reusableThumb=String(linked?.thumbnail||subject.pack_thumbnail||"");if(reusableThumb.startsWith("thumbs/"))item.thumbnail=reusableThumb;
  const saved=await H3PackAPI.saveCast(item);
  if(old&&old!==saved.handle){try{await H3PackAPI.deleteCast(old,{permanent:true});}catch(error){console.warn("MiniMax Creator could not remove renamed Cast preset",error);}}
  subject.preset_id=String(saved.id||saved.handle);subject.preset_group=saved.group||item.group;subject.preset_note=saved.note||item.note;
  if(saved.thumbnail)subject.pack_thumbnail=saved.thumbnail;else delete subject.pack_thumbnail;
  updatePresetCache(saved,old);
  body.commitData?.(true,{historyLabel:"Edited Character"});
  window.dispatchEvent?.(new CustomEvent("z3-h3-pack-changed",{detail:{kind:"cast",item:saved,oldHandle:old,source:"cast-studio"}}));
  return saved;
}

const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
const input=(type,value="")=>{const node=document.createElement("input");node.type=type;if(type!=="checkbox")node.value=value??"";return node;};
const textarea=(value="",rows=4)=>{const node=document.createElement("textarea");node.value=value??"";node.rows=rows;return node;};
const select=(options,value)=>{const node=document.createElement("select");for(const raw of options){const [v,label]=Array.isArray(raw)?raw:[raw,raw];const option=document.createElement("option");option.value=v;option.textContent=label;if(String(v)===String(value))option.selected=true;node.append(option);}return node;};
const field=(label,control,hint="")=>{const wrap=el("label","z3h3-field");wrap.append(el("span",null,label),control);if(hint)wrap.append(el("small","z3h3-note",hint));return wrap;};

const SEMANTIC_FAVORITES_KEY="z3.minimaxCreator.semanticAutocomplete.favorites.v1";
function readJsonStorage(key,fallback){try{const value=JSON.parse(localStorage.getItem(key)||"");return value??fallback;}catch{return fallback;}}
function writeJsonStorage(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
function favoriteKey(handle){return `cast:${S.normalizeSubjectHandle(handle||"Character")}`;}
function isFavorite(handle){const map=readJsonStorage(SEMANTIC_FAVORITES_KEY,{}),rows=Array.isArray(map?.cast)?map.cast:[];return rows.includes(favoriteKey(handle));}
function toggleFavorite(handle){const map=readJsonStorage(SEMANTIC_FAVORITES_KEY,{}),rows=new Set(Array.isArray(map?.cast)?map.cast:[]),key=favoriteKey(handle);rows.has(key)?rows.delete(key):rows.add(key);map.cast=[...rows].slice(0,100);writeJsonStorage(SEMANTIC_FAVORITES_KEY,map);return rows.has(key);}
function stopUiEvent(event){event.stopPropagation();}
function installStudioKeyboardBoundary(root){
  const editable="input,textarea,select,[contenteditable=true],[contenteditable=plaintext-only]";
  const stop=(event)=>{if(event.target?.closest?.(editable))event.stopPropagation();};
  for(const name of ["keydown","keyup","keypress","beforeinput","input","compositionstart","compositionend"])root.addEventListener(name,stop,false);
  return()=>{for(const name of ["keydown","keyup","keypress","beforeinput","input","compositionstart","compositionend"])root.removeEventListener(name,stop,false);};
}
function button(text,fn,cls="z3h3-btn",title=""){
  const node=el("button",cls,text);node.type="button";if(title)node.title=title;
  node.addEventListener("pointerdown",stopUiEvent);
  node.addEventListener("click",async(event)=>{stopUiEvent(event);try{await fn?.(event);}catch(error){console.error("MiniMax Creator Cast action failed",error);node.dataset.error="1";node.title=error?.message||String(error);setTimeout(()=>delete node.dataset.error,1400);}});
  return node;
}
function initials(label){return String(label||"?").split(/[\s_]+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()||"").join("")||"?";}
function safeBg(url){return String(url||"").replaceAll('"','%22');}
function pickLocalImage(onFile){const picker=input("file");picker.accept="image/png,image/jpeg,image/webp,image/gif";picker.addEventListener("change",()=>{const file=picker.files?.[0];if(file)onFile?.(file);},{once:true});picker.click();}
export function subjectDisplayName(subject){return String(subject?.display_name||subject?.name||subject?.handle||"Character").replaceAll("_"," ");}

export function findSubjectImage(body,subject){
  const workflowThumb=subject?.thumbnail&&typeof subject.thumbnail==="object"?subject.thumbnail:null;
  const workflowDirect=body?.thumbnailUrl?.(workflowThumb);if(workflowDirect)return workflowDirect;
  const linked=castPresetForSubject(subject);const thumb=linked?.thumbnail||subject?.pack_thumbnail||(typeof subject?.thumbnail==="string"?subject.thumbnail:"");
  const direct=body?.thumbnailUrl?.(thumb);if(direct)return direct;
  const handles=[subject?.thumbnail_handle,...(subject?.from||[])].map((value)=>String(value||"").replace(/^@/,"")).filter(Boolean);
  for(const handle of handles){const asset=(body?.data?.assets||[]).find((candidate)=>candidate?.handle===handle);if(asset?.kind==="image"){const url=H.inputViewUrl(asset.filename);if(url)return url;}}
  return "";
}
export function createSubjectAvatar(body,subject,{large=false}={}){
  const avatar=el("div",`z3h3-cast-avatar${large?" large":""}`),image=findSubjectImage(body,subject);avatar.textContent=initials(subjectDisplayName(subject));
  if(image){avatar.classList.add("has-image");avatar.style.backgroundImage=`url("${safeBg(image)}")`;avatar.textContent="";}
  avatar.title=image?`Thumbnail for ${subjectDisplayName(subject)}`:`${subjectDisplayName(subject)} — no thumbnail assigned`;return avatar;
}
function createPresetAvatar(preset,{large=true}={}){const avatar=el("div",`z3h3-cast-avatar${large?" large":""}`,initials(preset?.name||preset?.handle));if(preset?.thumbnail){avatar.classList.add("has-image");avatar.style.backgroundImage=`url("${safeBg(H3PackAPI.thumbUrl(preset.thumbnail,`&v=${encodeURIComponent(preset.modified_at||"")}`))}")`;avatar.textContent="";}return avatar;}
function normalizeSources(value){return Array.isArray(value)?value.map((item)=>String(item||"").trim().replace(/^@/,"")).filter(Boolean):String(value||"").split(",").map((item)=>item.trim().replace(/^@/,"")).filter(Boolean);}
function uniqueHandle(body,value,current=null){return findAvailableCastHandle({value,subjects:body?.data?.subjects||[],presets:livePresetCache,current});}
function removeSubject(body,subject){if(!body?.data||!subject)return false;body.removeSubjectMention?.(subject);const rows=body.data.subjects||[],index=rows.indexOf(subject);if(index>=0)rows.splice(index,1);body.commitData?.(true,{historyLabel:"Removed Character from Workflow"});return index>=0;}
function addPreset(body,preset,{insert=false}={}){if(!body?.data||!preset)return null;body.data.subjects||=[];const handle=S.normalizeSubjectHandle(preset.handle||preset.name),pid=String(preset.id||preset.handle||handle);let subject=body.data.subjects.find((candidate)=>String(candidate.preset_id||"")===pid||S.normalizeSubjectHandle(candidate.handle||"")===handle);if(!subject){subject={handle,record_id:S.normalizeSubjectRecordId("",`preset:${pid}`),takes:preset.subject_type||"person",from:[]};body.data.subjects.push(subject);}copyPresetFields(subject,preset);body.commitData?.(true,{historyLabel:"Added Character to Workflow"});if(insert)body.insertText?.(`@${subject.handle}`);noteCastHistory(preset);return subject;}
function replaceMentionInActivePrompt(body,oldHandle,newHandle){const old=String(oldHandle||"").replace(/^@/,""),next=String(newHandle||"").replace(/^@/,"");if(!old||!next||old===next)return false;const before=S.activePrompt(body?.data,body?.target),after=replaceCastMention(before,old,next);if(before===after)return false;const auditions=S.activeContainer?.(body.data,body.target)?.cast_auditions;if(auditions&&typeof auditions==="object"&&auditions[old]){const config=auditions[old];delete auditions[old];const candidates=(Array.isArray(config?.candidates)?config.candidates:[]).map((value)=>String(value||"").replace(/^@/,"")===old?next:value);auditions[next]={...config,candidates};}body.setPromptText?.(after,{notify:true,reconcile:true,historyLabel:`Swapped @${old} → @${next}`});return true;}
function replaceMentionsEverywhere(body,oldHandle,newHandle){if(!oldHandle||!newHandle||oldHandle===newHandle)return;const swap=(value)=>replaceCastMention(value,oldHandle,newHandle);const migrateAuditions=(container)=>{const source=container?.cast_auditions;if(!source||typeof source!=="object")return;const next={};for(const [role,config] of Object.entries(source)){const key=role===oldHandle?newHandle:role;next[key]={...config,candidates:Array.isArray(config?.candidates)?config.candidates.map((value)=>String(value||"").replace(/^@/,"")===oldHandle?newHandle:value):[]};}container.cast_auditions=next;};body.data.prompt=swap(body.data.prompt);body.data.soundscape=swap(body.data.soundscape);body.data.music=swap(body.data.music);migrateAuditions(body.data);for(const segment of body.data.segments||[]){segment.prompt=swap(segment.prompt);segment.soundscape=swap(segment.soundscape);segment.music=swap(segment.music);migrateAuditions(segment);}}

function overlay(title){
  const backdrop=el("div","z3h3-studio-backdrop"),panel=el("div","z3h3-cast-studio v2"),head=el("header","z3h3-studio-head"),copy=el("div"),status=el("div","z3h3-studio-status","Ready");
  const close=()=>{backdrop.dispatchEvent(new CustomEvent("z3-cast-studio-close"));backdrop.remove();};
  copy.append(el("strong",null,title),el("small",null,"Groups · Character Gallery · Character Inspector"));
  head.append(copy,status,button("Close",close,"z3h3-btn","Close Cast Studio"));panel.append(head);backdrop.append(panel);document.body.append(backdrop);
  const prefs=readStudioPrefs();if(Number(prefs.width)>0)panel.style.width=`${Math.max(860,Math.min(window.innerWidth-40,Number(prefs.width)))}px`;if(Number(prefs.height)>0)panel.style.height=`${Math.max(560,Math.min(window.innerHeight-40,Number(prefs.height)))}px`;
  backdrop.addEventListener("pointerdown",(event)=>{if(event.target===backdrop)close();});panel.addEventListener("pointerdown",(event)=>event.stopPropagation());
  const cleanupKeyboard=installStudioKeyboardBoundary(panel),observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(()=>{const rect=panel.getBoundingClientRect();if(rect.width>0&&rect.height>0)saveStudioPrefs({width:Math.round(rect.width),height:Math.round(rect.height)});}):null;observer?.observe(panel);
  backdrop.addEventListener("z3-cast-studio-close",()=>{cleanupKeyboard();observer?.disconnect();},{once:true});
  return {backdrop,panel,status,close,setStatus(message,kind=""){status.textContent=message;status.dataset.kind=kind;}};
}
function entityKey(subject,preset){return String(preset?.id||subject?.preset_id||subject?.record_id||`handle:${S.normalizeSubjectHandle(subject?.handle||preset?.handle||preset?.name||"Character")}`);}
function mergedEntities(body){
  const out=[],seenIds=new Set(),seenHandles=new Set(),subjects=body?.data?.subjects||[];
  for(const subject of subjects){const preset=castPresetForSubject(subject),key=entityKey(subject,preset),handle=S.normalizeSubjectHandle(subject.handle||preset?.handle||preset?.name);out.push({key,subject,preset,handle});if(preset?.id)seenIds.add(String(preset.id));seenHandles.add(handle.toLowerCase());}
  for(const preset of livePresetCache){const handle=S.normalizeSubjectHandle(preset.handle||preset.name),id=String(preset.id||"");if((id&&seenIds.has(id))||seenHandles.has(handle.toLowerCase()))continue;out.push({key:entityKey(null,preset),subject:null,preset,handle});}
  return out;
}
function entityName(entity){return subjectDisplayName(entity?.subject||entity?.preset||{handle:entity?.handle});}
function entityGroup(entity){return String(entity?.subject?.preset_group||entity?.preset?.group||"Workflow Cast");}
function entityDescription(entity){return String(entity?.subject?.prompt_base||entity?.preset?.prompt_base||entity?.subject?.description||entity?.preset?.description||entity?.preset?.note||"");}
function entityAvatar(body,entity){return entity.subject?createSubjectAvatar(body,entity.subject,{large:true}):createPresetAvatar(entity.preset,{large:true});}
function downloadCastPreset(preset){if(!preset)return;const a=document.createElement("a");a.href=H3PackAPI.exportUrl({scope:"cast_item",id:preset.handle});a.download="";a.rel="noopener";document.body.append(a);a.click();a.remove();}
function createSection(title,subtitle="",open=true){const details=document.createElement("details");details.className="z3h3-cast-inspector-section";const prefs=readStudioPrefs(),sections=prefs.sections&&typeof prefs.sections==="object"?prefs.sections:{};details.open=Object.prototype.hasOwnProperty.call(sections,title)?sections[title]!==false:open;details.addEventListener("toggle",()=>{const current=readStudioPrefs(),next={...(current.sections||{}),[title]:details.open};saveStudioPrefs({sections:next});});const summary=document.createElement("summary");const copy=el("span");copy.append(el("b",null,title));if(subtitle)copy.append(el("small",null,subtitle));summary.append(copy);details.append(summary);return details;}
function createTextareaField(label,value,hint="",rows=3){return field(label,textarea(value,rows),hint);}
function csv(value){return Array.isArray(value)?value.join(", "):String(value||"");}
function tagsFrom(value){return String(value||"").split(",").map((part)=>part.trim()).filter(Boolean).slice(0,32);}
function normalizedRole(value){const roles=new Set(["reference","face","body","appearance","style"]);return roles.has(String(value||""))?String(value):"reference";}
function runtimeDescription(draft){
  const pieces=[];const push=(label,value)=>{const clean=String(value||"").trim();if(clean)pieces.push(label?`${label}: ${clean}`:clean);};
  push("",draft.prompt_base);push("Identity",draft.identity_anchor);push("Physical traits",draft.physical_traits);push("Consistency",draft.consistency_notes);push("Positive anchors",draft.positive_anchors);push("Exclude",draft.negative_notes);return pieces.join(". ").replace(/\.\s*\./g,".").trim();
}
function draftFromEntity(entity){
  const subject=entity?.subject||{},preset=entity?.preset||{},now=new Date().toISOString(),description=String(subject.prompt_base??preset.prompt_base??subject.description??preset.description??"");
  return {
    id:String(preset.id||subject.preset_id||""),display_name:subjectDisplayName(subject?.handle?subject:preset),handle:S.normalizeSubjectHandle(subject.handle||preset.handle||preset.name||"Character"),subject_type:String(subject.takes||preset.subject_type||"person"),
    preset_group:String(subject.preset_group||preset.group||"Custom / My Cast"),prompt_base:description,identity_anchor:String(subject.identity_anchor??preset.identity_anchor??""),physical_traits:String(subject.physical_traits??preset.physical_traits??""),consistency_notes:String(subject.consistency_notes??preset.consistency_notes??""),
    permanent_look:String(subject.permanent_look??preset.permanent_look??subject.clothing??preset.clothing??""),use_scene_clothing:subject.use_scene_clothing!==undefined?!!subject.use_scene_clothing:(preset.use_scene_clothing!==undefined?!!preset.use_scene_clothing:!String(subject.clothing??preset.clothing??"").trim()),
    positive_anchors:String(subject.positive_anchors??preset.positive_anchors??""),negative_notes:String(subject.negative_notes??preset.negative_notes??""),note:String(subject.preset_note||preset.note||"Custom Cast entry."),tags:Array.isArray(subject.tags)?[...subject.tags]:(Array.isArray(preset.tags)?[...preset.tags]:[]),source_pack:String(subject.source_pack??preset.source_pack??""),created_at:String(subject.created_at??preset.created_at??now),modified_at:String(subject.modified_at??preset.modified_at??""),
    from:Array.isArray(subject.from)?[...subject.from]:(Array.isArray(preset.reference_images)?[...preset.reference_images]:[]),reference_roles:{...(preset.reference_roles||{}),...(subject.reference_roles||{})},reference_ids:Array.isArray(subject.reference_ids)?[...subject.reference_ids]:(Array.isArray(preset.reference_ids)?[...preset.reference_ids]:[]),reference_roles_by_id:{...(preset.reference_roles_by_id||{}),...(subject.reference_roles_by_id||{})},motion:String(subject.motion||""),voice:String(subject.voice||""),replaces:String(subject.replaces||""),replaces_what:String(subject.replaces_what||""),relationship:String(subject.relationship||""),variant_of:String(subject.variant_of||preset.variant_of||""),thumbnail:String(preset.thumbnail||subject.pack_thumbnail||"")
  };
}
function persistDraftToSubject(subject,draft){
  subject.display_name=draft.display_name;subject.handle=draft.handle;subject.takes=draft.subject_type;subject.preset_group=draft.preset_group;subject.prompt_base=draft.prompt_base;subject.identity_anchor=draft.identity_anchor;subject.physical_traits=draft.physical_traits;subject.consistency_notes=draft.consistency_notes;subject.permanent_look=draft.permanent_look;subject.use_scene_clothing=!!draft.use_scene_clothing;subject.positive_anchors=draft.positive_anchors;subject.negative_notes=draft.negative_notes;subject.tags=[...draft.tags];subject.source_pack=draft.source_pack;subject.created_at=draft.created_at;subject.modified_at=draft.modified_at;subject.reference_images=[...draft.from];subject.reference_roles={...draft.reference_roles};subject.reference_ids=[...(draft.reference_ids||[])];subject.reference_roles_by_id={...(draft.reference_roles_by_id||{})};subject.description=runtimeDescription(draft);subject.clothing=draft.use_scene_clothing?"":draft.permanent_look;subject.from=[...draft.from];subject.preset_note=draft.note;
  for(const key of ["motion","voice","replaces","replaces_what","relationship","variant_of"]){if(draft[key])subject[key]=draft[key];else delete subject[key];}
}
function draftPackItem(draft,entity){
  const preset=entity?.preset||{},subject=entity?.subject||{},id=String(preset.id||subject.preset_id||draft.id||`cast_${S.normalizeSubjectRecordId(subject.record_id||"",draft.handle)}`),now=new Date().toISOString();
  return {...preset,id,handle:draft.handle,name:draft.display_name,group:draft.preset_group,subject_type:draft.subject_type,description:runtimeDescription(draft),prompt_base:draft.prompt_base,identity_anchor:draft.identity_anchor,physical_traits:draft.physical_traits,consistency_notes:draft.consistency_notes,clothing:draft.use_scene_clothing?"":draft.permanent_look,permanent_look:draft.permanent_look,use_scene_clothing:!!draft.use_scene_clothing,positive_anchors:draft.positive_anchors,negative_notes:draft.negative_notes,note:draft.note,tags:[...draft.tags],reference_images:[...draft.from],reference_roles:{...draft.reference_roles},reference_ids:[...(draft.reference_ids||[])],reference_roles_by_id:{...(draft.reference_roles_by_id||{})},source_pack:draft.source_pack,created_at:draft.created_at||now,modified_at:now,variant_of:draft.variant_of||preset.variant_of||"",thumbnail:preset.thumbnail||draft.thumbnail||""};
}
function compareDraft(draft){const stable={...draft};delete stable.modified_at;return JSON.stringify(stable);}

function contextMenu(items,x,y){
  document.querySelectorAll(".z3h3-cast-context-menu").forEach((node)=>node.remove());const menu=el("div","z3h3-cast-context-menu");menu.style.left=`${Math.min(x,window.innerWidth-260)}px`;menu.style.top=`${Math.min(y,window.innerHeight-360)}px`;
  let outside=null;const close=()=>{menu.remove();if(outside){document.removeEventListener("pointerdown",outside,true);outside=null;}};for(const item of items){if(item.separator){menu.append(el("div","sep"));continue;}const row=button(item.label,async()=>{close();await item.action?.();},`z3h3-cast-menu-item${item.danger?" danger":""}`,item.hint||"");if(item.disabled)row.disabled=true;menu.append(row);}document.body.append(menu);queueMicrotask(()=>{outside=(event)=>{if(menu.contains(event.target))return;close();};document.addEventListener("pointerdown",outside,true);});return menu;
}
async function moveEntityToGroup(body,entity,setStatus,onRefresh){
  const current=entityGroup(entity),groups=[...new Set(livePresetCache.map((preset)=>String(preset.group||"")).filter(Boolean))],suggest=groups.join("\n");const next=prompt(`Move ${entityName(entity)} to which group?\n\nExisting groups:\n${suggest}`,current);if(next==null)return;const clean=String(next).trim();if(!clean)return;
  if(entity.subject){entity.subject.preset_group=clean;entity.subject.modified_at=new Date().toISOString();body.commitData?.(true,{historyLabel:"Edited Character"});await persistSubjectToCastPack(body,entity.subject,{oldPresetHandle:entity.preset?.handle||""});}
  else if(entity.preset){const saved=await H3PackAPI.saveCast({...entity.preset,group:clean,modified_at:new Date().toISOString()});updatePresetCache(saved,entity.preset.handle);window.dispatchEvent?.(new CustomEvent("z3-h3-pack-changed",{detail:{kind:"cast",item:saved,source:"cast-studio-external"}}));}
  setStatus(`${entityName(entity)} moved to ${clean}`,"good");await onRefresh?.();
}
async function duplicateEntity(body,entity,setStatus,onRefresh){
  const source=draftFromEntity(entity),name=`${source.display_name} Copy`,handle=uniqueHandle(body,`${source.handle}_Copy`,null),now=new Date().toISOString(),draft={...source,id:"",display_name:name,handle,created_at:now,modified_at:now};
  const item=draftPackItem(draft,{subject:null,preset:null});delete item.id;item.id=`cast_${S.normalizeSubjectRecordId("",`duplicate:${handle}:${Date.now()}`)}`;const saved=await H3PackAPI.saveCast(item);updatePresetCache(saved);setStatus(`${name} duplicated as @${saved.handle}`,"good");await onRefresh?.(saved);return saved;
}
async function unlinkWorkflowPreset(body,entity){if(entity?.subject){delete entity.subject.preset_id;delete entity.subject.pack_thumbnail;delete entity.subject.preset_note;entity.subject.preset_group=entity.subject.preset_group||"Workflow Cast";body.commitData?.(true,{historyLabel:"Deleted Character"});}}
async function trashEntity(body,entity,setStatus,onRefresh){
  const preset=entity.preset||castPresetForSubject(entity.subject);if(!preset){if(entity.subject&&confirm(`Remove ${entityName(entity)} from this workflow?`)){removeSubject(body,entity.subject);setStatus(`${entityName(entity)} removed from workflow`,"good");await onRefresh?.();}return;}
  if(!confirm(`Move ${entityName(entity)} (@${entity.handle}) to Library Trash?\n\nAny workflow copy stays usable and is unlinked from the reusable Library.`))return;
  await H3PackAPI.deleteCast(preset.handle,{id:preset.id||""});await unlinkWorkflowPreset(body,entity);await refreshCastPresetCache();setStatus(`${entityName(entity)} moved to Trash; workflow copy kept`,"good");window.dispatchEvent?.(new CustomEvent("z3-h3-pack-changed",{detail:{kind:"cast",trashed:preset.handle,source:"cast-studio-external"}}));await onRefresh?.();
}
async function permanentlyDeleteEntity(body,entity,setStatus,onRefresh){
  const preset=entity.preset||castPresetForSubject(entity.subject);if(!preset){if(entity.subject&&confirm(`Remove ${entityName(entity)} from this workflow?`)){removeSubject(body,entity.subject);setStatus(`${entityName(entity)} removed from workflow`,"good");await onRefresh?.();}return;}
  if(!confirm(`Permanently delete ${entityName(entity)} (@${entity.handle}) from the reusable Cast Library?\n\nAny workflow copy will be kept and unlinked.`))return;const typed=prompt(`Type DELETE to permanently remove ${entityName(entity)} from the reusable Library.`);if(typed!=="DELETE")return;
  await H3PackAPI.deleteCast(preset.handle,{id:preset.id||"",permanent:true});await unlinkWorkflowPreset(body,entity);await refreshCastPresetCache();setStatus(`${entityName(entity)} permanently deleted from reusable Cast; workflow copy kept`,"good");window.dispatchEvent?.(new CustomEvent("z3-h3-pack-changed",{detail:{kind:"cast",deleted:preset.handle,source:"cast-studio-external"}}));await onRefresh?.();
}

function inspectorView(body,entity,{setStatus,onSaved,onDeleted,onDuplicate,onDirtyChange,onUse,useLabel="Use in current shot",onAudition,auditionLabel="Audition role"}={}){
  const mount=el("div","z3h3-cast-inspector"),draft=draftFromEntity(entity),originalHandle=draft.handle;let baseline=compareDraft(draft),pendingThumb=null,clearThumb=false,objectUrl="";
  const head=el("div","z3h3-cast-inspector-head"),title=el("div"),dirty=el("span","z3h3-cast-dirty","Saved");title.append(el("strong",null,entity?.subject||entity?.preset?entityName(entity):"New character"),el("small",null,`@${draft.handle}`));head.append(title,dirty);mount.append(head);
  const controls={};const track=(name,control,read=()=>control.type==="checkbox"?!!control.checked:control.value)=>{controls[name]={control,read};return control;};
  const display=track("display_name",input("text",draft.display_name)),handle=track("handle",input("text",draft.handle)),subjectType=track("subject_type",select([["person","Person"],["object","Object"],["scene","Scene"],["style","Style"]],draft.subject_type));
  const promptBase=track("prompt_base",textarea(draft.prompt_base,4)),identity=track("identity_anchor",textarea(draft.identity_anchor,3)),physical=track("physical_traits",textarea(draft.physical_traits,3)),consistency=track("consistency_notes",textarea(draft.consistency_notes,3));
  const permanent=track("permanent_look",textarea(draft.permanent_look,3)),sceneClothing=track("use_scene_clothing",input("checkbox"),()=>sceneClothing.checked);sceneClothing.checked=!!draft.use_scene_clothing;
  const positives=track("positive_anchors",textarea(draft.positive_anchors,3)),negatives=track("negative_notes",textarea(draft.negative_notes,3));
  const group=track("preset_group",input("text",draft.preset_group)),tagControl=track("tags",input("text",csv(draft.tags)),()=>tagsFrom(tagControl.value)),sourcePack=track("source_pack",input("text",draft.source_pack));
  const avatarWrap=el("div","z3h3-cast-thumb-editor"),avatar=entityAvatar(body,entity||{subject:draft,preset:null}),thumbCopy=el("div");thumbCopy.append(el("b",null,"Character thumbnail"),el("small",null,"Stored with the reusable Cast entry and included in Cast exports."));const thumbButtons=el("div","z3h3-cast-thumb-actions");thumbButtons.append(button(draft.thumbnail||findSubjectImage(body,entity?.subject)?"Change thumbnail…":"Set thumbnail…",()=>pickLocalImage((file)=>{pendingThumb=file;clearThumb=false;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(file);avatar.style.backgroundImage=`url("${safeBg(objectUrl)}")`;avatar.classList.add("has-image");avatar.textContent="";markDirty();}),"z3h3-btn primary"),button("Clear",()=>{pendingThumb=null;clearThumb=true;if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl="";}avatar.style.backgroundImage="";avatar.classList.remove("has-image");avatar.textContent=initials(display.value);markDirty();},"z3h3-btn"));thumbCopy.append(thumbButtons);avatarWrap.append(avatar,thumbCopy);
  const refList=el("div","z3h3-cast-reference-list"),known=(body.data.assets||[]).filter((asset)=>asset?.role==="reference"),selected=new Set(draft.from),roles={...draft.reference_roles};
  const renderReferences=()=>{refList.replaceChildren();if(!known.length){refList.append(el("div","z3h3-cast-empty","No Global reference media attached. Add reference images to Creator, then assign them here."));return;}for(const asset of known){const row=el("label","z3h3-cast-reference-row"),check=input("checkbox");check.checked=selected.has(asset.handle);const thumb=el("div","z3h3-cast-reference-thumb",asset.kind==="image"?"":"REF");if(asset.kind==="image")thumb.style.backgroundImage=`url("${safeBg(H.inputViewUrl(asset.filename))}")`;const copy=el("span");copy.append(el("b",null,`@${asset.handle}`),el("small",null,String(asset.filename||"").split(/[\\/]/).pop()));const role=select([["reference","Reference"],["face","Face"],["body","Body"],["appearance","Appearance"],["style","Style"]],normalizedRole(roles[asset.handle]));check.addEventListener("change",()=>{check.checked?selected.add(asset.handle):selected.delete(asset.handle);markDirty();});role.addEventListener("change",()=>{roles[asset.handle]=role.value;markDirty();});row.append(check,thumb,copy,role);refList.append(row);}};renderReferences();
  const legacy=el("div","z3h3-cast-legacy-reference");const motion=input("text",draft.motion?`@${draft.motion}`:""),voice=input("text",draft.voice?`@${draft.voice}`:""),replaces=input("text",draft.replaces?`@${draft.replaces}`:""),replacesWhat=input("text",draft.replaces_what),retention=select([["","Default"],["fully_preserved","Fully preserved"],["partially_preserved","Partially preserved"],["transferred","Transferred"],["reused","Reused"]],draft.relationship);for(const [name,control] of [["motion",motion],["voice",voice],["replaces",replaces],["replaces_what",replacesWhat],["relationship",retention]])track(name,control,()=>String(control.value||"").trim().replace(/^@/,""));legacy.append(field("Motion source",motion),field("Voice source",voice),field("Replacement video",replaces),field("Who is replaced",replacesWhat),field("Retention",retention));
  const makeSection=(titleText,subtitle,content,open=true)=>{const section=createSection(titleText,subtitle,open);section.append(content);mount.append(section);};
  const identityBody=el("div","z3h3-cast-inspector-fields");identityBody.append(field("Display Name",display),field("Handle",handle,"Compiler-safe @ syntax; letters, digits and underscores."),field("Subject Type",subjectType),avatarWrap);makeSection("Identity","Name, handle, subject type and thumbnail",identityBody,true);
  const appearanceBody=el("div","z3h3-cast-inspector-fields");appearanceBody.append(field("Identity anchor",identity),field("Physical traits",physical),field("Consistency notes",consistency));makeSection("Appearance","Stable visual identity across shots",appearanceBody,true);
  const wardrobeBody=el("div","z3h3-cast-inspector-fields");const sceneToggle=el("label","z3h3-cast-toggle");sceneToggle.append(sceneClothing,el("span",null,"Use scene clothing"));wardrobeBody.append(field("Permanent look",permanent,"Preserved even when scene clothing is disabled."),sceneToggle);makeSection("Wardrobe","Permanent look or scene-controlled clothing",wardrobeBody,true);
  const promptingBody=el("div","z3h3-cast-inspector-fields");promptingBody.append(field("Base description",promptBase),field("Positive anchors",positives),field("Negative / exclusion notes",negatives));makeSection("Prompting","Canonical character prompt components",promptingBody,true);
  const referenceBody=el("div","z3h3-cast-inspector-fields");const referenceTools=el("div","z3h3-cast-thumb-actions");referenceTools.append(button("Open Reference Workspace",()=>body.openReferences?.(),"z3h3-btn","Create reusable stable-ID references and attach them to this Cast identity without editing RAW."));referenceBody.append(referenceTools,refList,legacy);makeSection("Reference","Canonical reusable references + legacy workflow sources",referenceBody,false);
  const metadataBody=el("div","z3h3-cast-inspector-fields");metadataBody.append(field("Group",group),field("Tags",tagControl,"Comma-separated"),field("Source pack",sourcePack,"Optional provenance label."));const metaRead=el("div","z3h3-cast-meta-read");metaRead.append(el("small",null,`Created: ${draft.created_at||"—"}`),el("small",null,`Modified: ${draft.modified_at||"—"}`));metadataBody.append(metaRead);makeSection("Metadata","Organization and provenance",metadataBody,false);
  const deleteSheet=el("div","z3h3-cast-delete-sheet");deleteSheet.hidden=true;const actionBar=el("div","z3h3-cast-inspector-actions"),saveButton=button("Save",async()=>save(),"z3h3-btn primary"),useButton=button(useLabel,async()=>{await onUse?.(entity);},"z3h3-btn primary"),auditionButton=button(auditionLabel,async()=>{await onAudition?.();},"z3h3-btn"),duplicateButton=button("Duplicate",async()=>{await onDuplicate?.(entity);},"z3h3-btn"),deleteButton=button("Delete",()=>{deleteSheet.hidden=!deleteSheet.hidden;},"z3h3-btn danger");if(onUse)actionBar.append(useButton);if(onAudition)actionBar.append(auditionButton);actionBar.append(saveButton,duplicateButton,deleteButton,dirty);mount.append(deleteSheet,actionBar);
  const readDraft=()=>{for(const [name,entry] of Object.entries(controls))draft[name]=entry.read();draft.handle=S.normalizeSubjectHandle(draft.handle||draft.display_name);draft.from=[...selected];draft.reference_roles={...roles};return draft;};
  function markDirty(){readDraft();const changed=compareDraft(draft)!==baseline||!!pendingThumb||clearThumb;dirty.textContent=changed?"Unsaved changes":"Saved";dirty.classList.toggle("active",changed);saveButton.disabled=!changed;onDirtyChange?.(changed);}
  for(const {control} of Object.values(controls)){control.addEventListener("input",markDirty);control.addEventListener("change",markDirty);}display.addEventListener("input",()=>{if(!handle.dataset.edited){handle.value=S.normalizeSubjectHandle(display.value||"Character");markDirty();}});handle.addEventListener("input",()=>{handle.dataset.edited="1";});
  async function save(){
    readDraft();const currentIdentity=entity?.subject||(entity?.preset?{preset_id:entity.preset.id||entity.preset.handle,handle:entity.preset.handle}:null);draft.handle=uniqueHandle(body,draft.handle||draft.display_name,currentIdentity);handle.value=draft.handle;draft.modified_at=new Date().toISOString();if(!draft.created_at)draft.created_at=draft.modified_at;
    const duplicates=castDuplicateCandidates(body,{displayName:draft.display_name,handle:draft.handle,current:entity?.subject||null}).filter((row)=>row.item!==entity?.preset);if(duplicates.length&&draft.handle.toLowerCase()===S.normalizeSubjectHandle(duplicates[0].handle).toLowerCase()){setStatus(`@${draft.handle} already belongs to another character. Choose a unique handle.`,"warn");return;}
    let subject=entity?.subject||null,preset=entity?.preset||null,oldHandle=entity?.handle||originalHandle;
    if(subject){if(subject.handle!==draft.handle)replaceMentionsEverywhere(body,subject.handle,draft.handle);persistDraftToSubject(subject,draft);body.commitData?.(true,{historyLabel:"Edited Character"});}
    const item=draftPackItem(draft,{subject,preset});const saved=await H3PackAPI.saveCast(item);if(preset?.handle&&preset.handle!==saved.handle){try{await H3PackAPI.deleteCast(preset.handle,{permanent:true});}catch{}}
    updatePresetCache(saved,preset?.handle||"");if(subject){subject.preset_id=String(saved.id||saved.handle);subject.pack_thumbnail=saved.thumbnail||subject.pack_thumbnail;copyPresetFields(subject,saved);body.commitData?.(true,{historyLabel:"Edited Character"});}else{preset=saved;}
    if(pendingThumb){await H3PackAPI.setThumbnail({kind:"cast",category:"",id:saved.handle,file:pendingThumb});pendingThumb=null;}else if(clearThumb&&saved.thumbnail){await H3PackAPI.removeThumbnail({kind:"cast",category:"",id:saved.handle});clearThumb=false;}
    await refreshCastPresetCache();const latest=livePresetCache.find((row)=>String(row.id||"")===String(saved.id||"")||row.handle===saved.handle)||saved;if(subject)copyPresetFields(subject,latest);body.commitData?.(true,{historyLabel:"Edited Character"});entity={key:entityKey(subject,latest),subject,preset:latest,handle:latest.handle};draft.thumbnail=latest.thumbnail||"";draft.modified_at=latest.modified_at||draft.modified_at;baseline=compareDraft(draft);markDirty();noteCastHistory(latest);setStatus(`${draft.display_name} saved to Creator Cast + reusable Library`,"good");window.dispatchEvent?.(new CustomEvent("z3-h3-pack-changed",{detail:{kind:"cast",item:latest,source:"cast-studio-external"}}));onSaved?.(entity);
  }
  const rebuildDeleteSheet=()=>{deleteSheet.replaceChildren(el("b",null,"Delete options"));if(entity?.subject)deleteSheet.append(button("Remove from this workflow",async()=>{if(!confirm(`Remove ${entityName(entity)} from this workflow and erase its prompt mentions? The reusable Library entry will remain.`))return;removeSubject(body,entity.subject);setStatus(`${entityName(entity)} removed from workflow; Library entry kept`,"good");onDeleted?.();},"z3h3-btn"));if(entity?.preset||castPresetForSubject(entity?.subject)){deleteSheet.append(button("Move reusable character to Trash",async()=>{await trashEntity(body,entity,setStatus,onDeleted);},"z3h3-btn danger"),button("Permanently delete reusable character…",async()=>{await permanentlyDeleteEntity(body,entity,setStatus,onDeleted);},"z3h3-btn danger"));}deleteSheet.append(button("Cancel",()=>{deleteSheet.hidden=true;},"z3h3-btn"));};rebuildDeleteSheet();
  saveButton.disabled=true;return mount;
}

export function renderCastGallery(body,host){
  if(!host)return;host.replaceChildren();const head=el("div","z3h3-cast-gallery-head"),title=el("div");title.append(el("b",null,"Creator Cast"),el("small",null,"Visual Cast Studio keeps reusable characters and workflow usage synchronized without touching authored prompt text unless you explicitly mention a character."));head.append(title,button("Open Cast Studio",()=>openCastStudio(body),"z3h3-btn primary"));host.append(head);const track=el("div","z3h3-cast-track");for(const subject of body.data.subjects||[]){const card=el("div","z3h3-cast-mini-wrap"),open=button("",()=>openCastStudio(body,{edit:subject.handle}),"z3h3-cast-mini",`Open ${subjectDisplayName(subject)} in Cast Studio`);open.replaceChildren(createSubjectAvatar(body,subject),el("span",null,subjectDisplayName(subject)),el("small",null,`@${subject.handle}`));card.append(open);track.append(card);}track.append(button("＋ Add character",()=>openCastStudio(body,{create:true}),"z3h3-cast-add"));host.append(track);
}

export async function openCastStudio(body,{edit="",create=false,swap="",seedName="",createDirection=0}={}){
  if(!body?.data)throw new Error("No active MiniMax Creator is connected to Cast Studio.");await refreshCastPresetCache();syncBodyFromCastPresets(body,livePresetCache);
  const {backdrop,panel,setStatus}=overlay("Cast Studio 2"),shell=el("div","z3h3-cast-studio-shell v2"),groupsPane=el("aside","z3h3-cast-groups-pane"),galleryPane=el("main","z3h3-cast-gallery-pane"),inspectorPane=el("aside","z3h3-cast-inspector-pane");shell.append(groupsPane,galleryPane,inspectorPane);panel.append(shell);
  const prefs=readStudioPrefs();let selectedGroup=String(prefs.group||"All"),query=String(prefs.query||""),galleryView=prefs.view==="list"?"list":"gallery",selectedKey="",swapHandle=String(swap||"").replace(/^@/,""),activeRole=String(swap||"").replace(/^@/,"");
  const search=input("search",query);search.placeholder="Search characters, handles, groups or tags…";const groupList=el("div","z3h3-cast-group-list"),galleryHead=el("div","z3h3-cast-gallery-toolbar"),workflowBar=el("div","z3h3-cast-workflow-bar"),gallery=el("div",`z3h3-cast-gallery-grid ${galleryView}`),galleryTitle=el("div"),galleryHint=el("small",null,"Click a character to open the Inspector. Use ⋯ for contextual actions."),viewToggle=button(galleryView==="list"?"▦ Gallery":"☷ List",()=>{galleryView=galleryView==="list"?"gallery":"list";saveStudioPrefs({view:galleryView});gallery.classList.toggle("list",galleryView==="list");gallery.classList.toggle("gallery",galleryView!=="list");viewToggle.textContent=galleryView==="list"?"▦ Gallery":"☷ List";},"z3h3-btn","Switch gallery/list view");galleryTitle.append(el("b",null,"Character Gallery"),galleryHint);galleryHead.append(galleryTitle,search,viewToggle);galleryPane.append(galleryHead,workflowBar,gallery);
  const showInspectorEmpty=()=>{selectedKey="";inspectorPane.replaceChildren();const empty=el("div","z3h3-cast-inspector-empty");empty.append(el("b",null,"Character Inspector"),el("p",null,"Select a character from the gallery to author identity, appearance, wardrobe, prompting, references and metadata."));inspectorPane.append(empty);};
  const refreshAll=async(select=null)=>{await refreshCastPresetCache();syncBodyFromCastPresets(body,livePresetCache);renderGroups();renderWorkflowBar();renderGallery();if(select){const entity=mergedEntities(body).find((row)=>String(row.preset?.id||row.handle)===String(select.id||select.handle));if(entity)openInspector(entity);}else if(selectedKey){const entity=mergedEntities(body).find((row)=>row.key===selectedKey);if(entity)openInspector(entity);else showInspectorEmpty();}};
  const activeRoles=()=>activeCastRoleHandles(S.activePrompt(body.data,body.target),body.data.subjects||[]);
  const normalizeActiveRole=()=>{const roles=activeRoles();if(swapHandle&&roles.includes(swapHandle))activeRole=swapHandle;else if(!roles.includes(activeRole))activeRole=roles[0]||"";return roles;};
  const openAudition=async(role=activeRole)=>{const key=String(role||"").replace(/^@/,"");if(!key){setStatus("Add or choose a Cast role in the current shot before auditioning.","warn");return;}const {openCastAuditionGallery}=await import("./h3_quick_actions.js");openCastAuditionGallery(body,key,{roles:activeRoles(),onRoleChange:(handle)=>{activeRole=handle;renderWorkflowBar();}});};
  const beginSwap=(role=activeRole)=>{const key=String(role||"").replace(/^@/,"");if(!key){setStatus("Choose a current-shot role to swap first.","warn");return;}swapHandle=key;activeRole=key;setStatus(`Swap mode: click any other character to replace @${key}.`,"good");renderWorkflowBar();renderGallery();};
  const cancelSwap=()=>{const from=swapHandle;swapHandle="";setStatus(from?`Swap for @${from} cancelled.`:"Swap mode is off.","good");renderWorkflowBar();renderGallery();};
  const ensureSubject=(entity)=>entity.subject||addPreset(body,entity.preset,{insert:false});
  const useInShot=(entity,{role=""}={})=>{const subject=ensureSubject(entity),from=String(role||swapHandle||"").replace(/^@/,"");if(from&&subject.handle!==from){if(replaceMentionInActivePrompt(body,from,subject.handle)){activeRole=subject.handle;swapHandle="";setStatus(`Swapped @${from} → @${subject.handle} in the current shot`,"good");}else{body.insertText?.(`@${subject.handle}`);activeRole=subject.handle;swapHandle="";setStatus(`@${subject.handle} added; @${from} was no longer present in the active prompt`,"warn");}}else if(!isMentioned(body,subject.handle)){body.insertText?.(`@${subject.handle}`);activeRole=subject.handle;swapHandle="";setStatus(`@${subject.handle} is used in the current shot`,"good");}else{activeRole=subject.handle;if(from===subject.handle)swapHandle="";setStatus(`@${subject.handle} is already used in the current shot`,"good");}noteCastHistory(subject);renderWorkflowBar();renderGallery();return subject;};
  const mention=(entity)=>{const subject=ensureSubject(entity);body.insertText?.(`@${subject.handle}`);noteCastHistory(subject);setStatus(`@${subject.handle} inserted in the Prompt Editor`,"good");renderGallery();};
  const exportEntity=async(entity)=>{let preset=entity.preset;if(!preset&&entity.subject)preset=await persistSubjectToCastPack(body,entity.subject);downloadCastPreset(preset);setStatus(`${entityName(entity)} export started`,"good");};
  const openInspector=(entity)=>{selectedKey=entity.key;normalizeActiveRole();const role=swapHandle||activeRole,useLabel=role?(entity.handle===role?`@${role} is in shot`:`Swap @${role} → @${entity.handle}`):(isMentioned(body,entity.handle)?"Used in current shot ✓":"Use in current shot");inspectorPane.replaceChildren(inspectorView(body,entity,{setStatus,useLabel,onUse:()=>{const target=role&&role!==entity.handle?role:"";useInShot(entity,{role:target});const latest=mergedEntities(body).find((row)=>row.handle===entity.handle)||entity;openInspector(latest);},auditionLabel:role?`Audition @${role}`:"",onAudition:role?()=>openAudition(role):null,onSaved:async(saved)=>{selectedKey=saved.key;renderGroups();renderWorkflowBar();renderGallery();},onDuplicate:async(source)=>{const saved=await duplicateEntity(body,source,setStatus,async(next)=>{await refreshAll(next);});},onDeleted:async()=>{await refreshAll();showInspectorEmpty();}}));renderWorkflowBar();renderGallery();};
  const menuFor=(entity,event)=>{event.preventDefault();event.stopPropagation();const subject=entity.subject,preset=entity.preset;contextMenu([
    {label:isMentioned(body,entity.handle)?"Used in current shot ✓":"Use in current shot",action:()=>useInShot(entity)},
    {label:"Mention in editor",action:()=>mention(entity)},
    {separator:true},{label:"Duplicate",action:async()=>{const saved=await duplicateEntity(body,entity,setStatus,async(next)=>refreshAll(next));}},
    {label:"Move to group…",action:()=>moveEntityToGroup(body,entity,setStatus,refreshAll)},
    {label:"Export",action:()=>exportEntity(entity)},
    {separator:true},...(subject?[{label:"Remove from workflow…",danger:true,action:async()=>{if(!confirm(`Remove ${entityName(entity)} from this workflow? Reusable Library entry remains.`))return;removeSubject(body,subject);await refreshAll();setStatus(`${entityName(entity)} removed from workflow`,"good");}}]:[]),...(preset||castPresetForSubject(subject)?[{label:"Move reusable to Trash",danger:true,action:()=>trashEntity(body,entity,setStatus,refreshAll)},{label:"Permanently delete reusable…",danger:true,action:()=>permanentlyDeleteEntity(body,entity,setStatus,refreshAll)}]:[])
  ],event.clientX,event.clientY);};
  function renderWorkflowBar(){const roles=normalizeActiveRole();workflowBar.replaceChildren();workflowBar.dataset.mode=swapHandle?"swap":"edit";galleryHint.textContent=swapHandle?`Swap mode is active for @${swapHandle}. Click another character to replace it immediately.`:"Click a character to open the Inspector. Swap and Audition stay available above and inside the Inspector.";const copy=el("div","z3h3-cast-workflow-copy");copy.append(el("b",null,swapHandle?`Choose a replacement for @${swapHandle}`:"Current shot Cast"),el("small",null,roles.length?`${roles.length} active role${roles.length===1?"":"s"} · select a role, then swap or audition without leaving Cast Studio.`:"No @character is used in this shot yet. Select a character and use “Use in current shot” in the Inspector."));workflowBar.append(copy);if(!roles.length)return;const roleSelect=select(roles.map((handle)=>[handle,`@${handle}`]),activeRole||roles[0]);roleSelect.title="Current-shot Cast role";roleSelect.addEventListener("change",()=>{activeRole=roleSelect.value;if(swapHandle)swapHandle=activeRole;renderWorkflowBar();renderGallery();if(selectedKey){const entity=mergedEntities(body).find((row)=>row.key===selectedKey);if(entity)openInspector(entity);}});const actions=el("div","z3h3-cast-workflow-actions");actions.append(roleSelect,swapHandle?button("Cancel swap",cancelSwap,"z3h3-btn danger"):button("Swap role…",()=>beginSwap(activeRole),"z3h3-btn primary"),button(`Audition @${activeRole||roles[0]}`,()=>openAudition(activeRole||roles[0]),"z3h3-btn"));workflowBar.append(actions);}
  function renderGroups(){const entities=mergedEntities(body),actual=[...new Set(entities.map(entityGroup).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),recent=new Set(readCastHistory().map((row)=>row.handle));const rows=[{id:"All",label:"All Characters",count:entities.length},{id:"Workflow",label:"Used in Workflow",count:entities.filter((e)=>!!e.subject).length},{id:"Favorites",label:"Favorites",count:entities.filter((e)=>isFavorite(e.handle)).length},{id:"Recent",label:"Recent",count:entities.filter((e)=>recent.has(e.handle)).length},...actual.map((name)=>({id:name,label:name,count:entities.filter((e)=>entityGroup(e)===name).length}))];if(!rows.some((row)=>row.id===selectedGroup))selectedGroup="All";groupList.replaceChildren();for(const row of rows){const item=button("",()=>{selectedGroup=row.id;saveStudioPrefs({group:selectedGroup});renderGroups();renderGallery();},`z3h3-cast-group-row${selectedGroup===row.id?" active":""}`);item.replaceChildren(el("span",null,row.label),el("small",null,String(row.count)));groupList.append(item);} }
  function renderGallery(){const recent=new Set(readCastHistory().map((row)=>row.handle)),q=query.trim().toLowerCase();let entities=mergedEntities(body).filter((entity)=>{if(selectedGroup==="Workflow"&&!entity.subject)return false;if(selectedGroup==="Favorites"&&!isFavorite(entity.handle))return false;if(selectedGroup==="Recent"&&!recent.has(entity.handle))return false;if(!["All","Workflow","Favorites","Recent"].includes(selectedGroup)&&entityGroup(entity)!==selectedGroup)return false;if(!q)return true;return `${entityName(entity)} ${entity.handle} ${entityGroup(entity)} ${entityDescription(entity)} ${(entity.subject?.tags||entity.preset?.tags||[]).join(" ")}`.toLowerCase().includes(q);});gallery.replaceChildren();gallery.classList.toggle("swap-mode",!!swapHandle);if(!entities.length){gallery.append(el("div","z3h3-cast-empty","No characters match this view."));return;}for(const entity of entities){const usedShot=isMentioned(body,entity.handle),usedWorkflow=!!entity.subject,intent=castCardIntent(swapHandle,entity.handle),card=el("article",`z3h3-cast-gallery-card${selectedKey===entity.key?" selected":""}${usedShot?" used-shot":""}${intent==="swap"?" swap-target":""}${intent==="current"?" swap-current":""}`);card.tabIndex=0;card.setAttribute("role","button");card.title=intent==="swap"?`Replace @${swapHandle} with @${entity.handle}`:intent==="current"?`@${entity.handle} is already assigned to this role`:"Open character Inspector";const visual=entityAvatar(body,entity),copy=el("div","z3h3-cast-gallery-copy"),nameRow=el("div","z3h3-cast-gallery-name"),name=el("b",null,entityName(entity)),fav=button(isFavorite(entity.handle)?"★":"☆",()=>{toggleFavorite(entity.handle);renderGroups();renderGallery();},"z3h3-cast-favorite",isFavorite(entity.handle)?"Remove favorite":"Favorite character"),more=button("⋯",(event)=>menuFor(entity,event),"z3h3-cast-more","Character actions");nameRow.append(name,fav,more);copy.append(nameRow,el("small","handle",`@${entity.handle}`),el("small","group",entityGroup(entity)));const badges=el("div","z3h3-cast-card-badges");if(intent==="swap")badges.append(el("span","swap","CLICK TO SWAP"));if(intent==="current")badges.append(el("span","current","CURRENT ROLE"));if(usedShot)badges.append(el("span","shot","USED IN SHOT"));if(usedWorkflow)badges.append(el("span","workflow","USED IN WORKFLOW"));if(entity.preset)badges.append(el("span","library","LIBRARY"));copy.append(badges);const desc=entityDescription(entity);if(desc)copy.append(el("p",null,desc));card.append(visual,copy);const activateCard=()=>{const action=castCardIntent(swapHandle,entity.handle);if(action==="swap"){useInShot(entity,{role:swapHandle});openInspector(mergedEntities(body).find((row)=>row.handle===entity.handle)||entity);return;}if(action==="current")setStatus(`@${entity.handle} is the current role. Choose another character to swap, or edit this one.`,"good");openInspector(entity);};card.addEventListener("click",(event)=>{if(event.target.closest("button"))return;activateCard();});card.addEventListener("keydown",(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();activateCard();}});gallery.append(card);}}
  const groupHead=el("div","z3h3-cast-groups-head");groupHead.append(el("div",null,"GROUPS"),button("＋ New",()=>openNewInspector(),"z3h3-side-primary"));const groupTools=el("div","z3h3-cast-group-tools");
  const selectedReusableGroup=()=>!["All","Workflow","Favorites","Recent"].includes(selectedGroup)?selectedGroup:"";
  const unlinkGroupSubjects=(rows)=>{for(const subject of body.data.subjects||[]){if(rows.some((preset)=>String(subject.preset_id||"")===String(preset.id||preset.handle||""))){delete subject.preset_id;delete subject.pack_thumbnail;delete subject.preset_note;subject.preset_group=subject.preset_group||"Workflow Cast";}}body.commitData?.(true,{historyLabel:`Deleted Cast Group "${selectedGroup}"`});};
  groupTools.append(button("↻ Refresh",async()=>{setStatus("Refreshing Cast Library…");await refreshAll();setStatus(`Cast Library refreshed · ${livePresetCache.length} reusable characters`,"good");},"z3h3-btn"),button("Trash group…",async()=>{const group=selectedReusableGroup();if(!group){setStatus("Choose a reusable Cast group first.","warn");return;}const rows=livePresetCache.filter((preset)=>String(preset.group||"")===group);if(!rows.length)return;if(!confirm(`Move group “${group}” and all ${rows.length} reusable character${rows.length===1?"":"s"} to Trash? Workflow copies remain.`))return;await H3PackAPI.deleteCastGroup(group);unlinkGroupSubjects(rows);selectedGroup="All";await refreshAll();window.dispatchEvent?.(new CustomEvent("z3-h3-pack-changed",{detail:{kind:"cast-group",trashed:group,source:"cast-studio-external"}}));setStatus("Reusable Cast group moved to Trash; workflow copies kept","good");},"z3h3-btn danger"),button("Delete group permanently…",async()=>{const group=selectedReusableGroup();if(!group){setStatus("Choose a reusable Cast group first.","warn");return;}const rows=livePresetCache.filter((preset)=>String(preset.group||"")===group);if(!rows.length)return;if(!confirm(`Permanently delete group “${group}” and all ${rows.length} reusable character${rows.length===1?"":"s"}? Workflow copies remain.`))return;const typed=prompt(`Type DELETE GROUP to permanently remove “${group}”.`);if(typed!=="DELETE GROUP")return;await H3PackAPI.deleteCastGroup(group,{permanent:true});unlinkGroupSubjects(rows);selectedGroup="All";await refreshAll();window.dispatchEvent?.(new CustomEvent("z3-h3-pack-changed",{detail:{kind:"cast-group",deleted:group,source:"cast-studio-external"}}));setStatus("Reusable Cast group permanently deleted; workflow copies kept","good");},"z3h3-btn danger"));groupsPane.append(groupHead,groupList,groupTools,el("div","z3h3-cast-help","Normal reusable deletes go to Trash. Stable IDs keep workflow-local copies usable without resurrecting deleted Library records."));
  function openNewInspector(){const now=new Date().toISOString(),handle=uniqueHandle(body,S.normalizeSubjectHandle(seedName||"Character"),null),subject={handle,record_id:S.normalizeSubjectRecordId("",`original:${handle}:${Date.now()}`),display_name:seedName||handle.replaceAll("_"," "),takes:"person",description:"",prompt_base:"",clothing:"",permanent_look:"",use_scene_clothing:true,from:[],preset_group:"Custom / My Cast",created_at:now,modified_at:""};const entity={key:`new:${Date.now()}`,subject,preset:null,handle};selectedKey=entity.key;inspectorPane.replaceChildren(inspectorView(body,entity,{setStatus,onSaved:async(saved)=>{if(!(body.data.subjects||[]).includes(subject)){body.data.subjects.push(subject);body.commitData?.(true,{historyLabel:"Created Character"});if(swapHandle){const from=swapHandle;if(replaceMentionInActivePrompt(body,from,subject.handle))setStatus(`Created ${subjectDisplayName(subject)} and swapped @${from} → @${subject.handle}`,"good");else setStatus(`Created ${subjectDisplayName(subject)}; @${from} was not present in the active prompt`,"warn");swapHandle="";}else body.insertText?.(`@${subject.handle}${Number(createDirection)>0?"+":Number(createDirection)<0?"-":""}`);}selectedKey=saved.key;await refreshAll(saved.preset);},onDuplicate:async(source)=>{await duplicateEntity(body,source,setStatus,async(next)=>refreshAll(next));},onDeleted:()=>showInspectorEmpty()}));}
  search.addEventListener("input",()=>{query=search.value;saveStudioPrefs({query});renderGallery();});renderGroups();renderWorkflowBar();renderGallery();showInspectorEmpty();
  const onPackChanged=async(event)=>{if(!backdrop.isConnected){window.removeEventListener("z3-h3-pack-changed",onPackChanged);return;}if(String(event?.detail?.source||"").startsWith("cast-studio"))return;await refreshAll();};window.addEventListener("z3-h3-pack-changed",onPackChanged);backdrop.addEventListener("z3-cast-studio-close",()=>window.removeEventListener("z3-h3-pack-changed",onPackChanged),{once:true});
  if(create)openNewInspector();else if(edit){const target=mergedEntities(body).find((entity)=>entity.handle===String(edit).replace(/^@/,"")||String(entity.preset?.id||"")===String(edit));if(target)openInspector(target);}if(swapHandle)setStatus(`Swap mode: click any other character to replace @${swapHandle} immediately.`,"good");
}
