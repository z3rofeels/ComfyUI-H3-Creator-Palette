import * as S from "./z3_h3_state.js";
import { castMentionRanges } from "./h3_prompt_tokens.js";
import { H3_SCENE_SLOT_ORDER, categoryMeta } from "./h3_prompt_categories.js";

const clean=(value)=>String(value??"").trim();
const array=(value)=>Array.isArray(value)?value:[];
const object=(value)=>value&&typeof value==="object"&&!Array.isArray(value)?value:{};
const escRe=(value)=>String(value??"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&");

function mention(source,handle){
  const key=clean(handle).replace(/^@/,"");
  return !!key&&new RegExp(`@${escRe(key)}(?![A-Za-z0-9_-])`).test(String(source||""));
}

export function shotIndexFor(body,index=null){
  const max=Math.max(0,(body?.data?.segments?.length||1)-1);
  const raw=index==null?(body?.target==="global"?0:Number(body?.target)||0):Number(index)||0;
  return Math.max(0,Math.min(max,Math.trunc(raw)));
}

export function shotText(body,index=null){
  const i=shotIndexFor(body,index),seg=body?.data?.segments?.[i];
  return [body?.data?.prompt,seg?.prompt,seg?.director_prompt,seg?.soundscape,seg?.music].map((value)=>String(value||"")).join("\n");
}

export function referencedSubjectsForShot(body,index=null){
  const text=shotText(body,index),handles=array(body?.data?.subjects).map((row)=>clean(row?.handle)).filter(Boolean);
  const explicit=new Set(castMentionRanges(text,handles).map((row)=>row.handle));
  return array(body?.data?.subjects).filter((subject)=>subject?.handle&&explicit.has(subject.handle));
}

export function effectiveAssetsForShot(body,index=null){
  const i=shotIndexFor(body,index),seg=body?.data?.segments?.[i];if(!seg)return [];
  const text=shotText(body,i),subjectSources=new Set(referencedSubjectsForShot(body,i).flatMap((subject)=>[
    ...array(subject?.from),subject?.motion,subject?.voice,subject?.replaces,
  ].map((value)=>clean(value).replace(/^@/,"")).filter(Boolean)));
  const rows=[];
  for(const asset of array(body?.data?.assets)){
    if(!asset?.handle)continue;
    if(asset.role!=="reference"||asset.global_active===true||mention(text,asset.handle)||subjectSources.has(asset.handle))rows.push({...asset,_scope:"Shared",_owner:"global"});
  }
  for(const asset of array(seg?.assets))if(asset?.handle)rows.push({...asset,_scope:`Shot ${i+1}`,_owner:"shot",_shot:i});
  return rows;
}

export function referenceCounts(body,index=null){
  const assets=effectiveAssetsForShot(body,index),refs=assets.filter((row)=>row.role==="reference");
  const images=refs.filter((row)=>row.kind==="image").length;
  const videosRows=refs.filter((row)=>row.kind==="video");
  const videos=videosRows.length;
  const audios=refs.filter((row)=>row.kind==="audio").length+videosRows.filter((row)=>row.track==="picture+sound"||row.track==="sound").length;
  return {
    images,videos,audios,files:refs.length,
    first:assets.some((row)=>row.role==="first_frame"),
    last:assets.some((row)=>row.role==="last_frame"),
    rows:assets,
  };
}

export function inferShotMode(body,index=null){
  const i=shotIndexFor(body,index),seg=body?.data?.segments?.[i];if(!seg)return "T2VA";if(seg.kind==="clip")return "CLIP";
  const refs=referenceCounts(body,i);
  if(refs.files)return "REF2VA";
  const first=refs.first||!!seg.continue,last=refs.last;
  if(first&&last)return "FL2VA";if(first)return "I2VA";if(last)return "L2VA";return "T2VA";
}

export function effectiveScenePalette(body,index=null){
  const i=shotIndexFor(body,index),shared=object(body?.data?.scene_palette),own=object(body?.data?.segments?.[i]?.scene_palette),out={};
  for(const slot of H3_SCENE_SLOT_ORDER){
    const preset=own[slot]||shared[slot];if(!preset)continue;
    out[slot]={...preset,_scope:own[slot]?`Shot ${i+1}`:"Shared",_meta:categoryMeta(slot)};
  }
  return out;
}

export function effectiveLorasForShot(body,index=null){
  const i=shotIndexFor(body,index),seg=body?.data?.segments?.[i],rows=[];
  for(const row of array(body?.data?.loras))if(row?.name)rows.push({...row,_scope:"Shared"});
  if(seg?.kind!=="clip")for(const row of array(seg?.loras))if(row?.name)rows.push({...row,_scope:`Shot ${i+1}`});
  return rows;
}

function directorSummary(seg){
  const director=object(seg?.director),beats=array(director.beats),camera=array(director.camera_points),timeline=object(director.timeline),media=object(timeline.media);
  return {beats,camera,media,edit:object(director.edit),modeIntent:clean(director.mode_intent)||"auto"};
}

export function canonicalShotSnapshot(body,index=null){
  const i=shotIndexFor(body,index),seg=body?.data?.segments?.[i]||{},route=inferShotMode(body,i),refs=referenceCounts(body,i),director=directorSummary(seg);
  const cast=referencedSubjectsForShot(body,i),scene=effectiveScenePalette(body,i),loras=effectiveLorasForShot(body,i),duration=Math.max(.2,Number(seg?.duration_s||S.DEFAULT_DURATION_S));
  return {
    index:i,shot:i+1,seg,route,duration,frames:S.durationFrames(duration),cast,scene,loras,refs,
    beats:director.beats,camera:director.camera,media:director.media,edit:director.edit,modeIntent:director.modeIntent,
    continuation:!!seg?.continue,continueAudio:!!seg?.continue_audio,
    soundscape:clean(seg?.soundscape),music:clean(seg?.music),
    prompt:clean(seg?.prompt),globalPrompt:clean(body?.data?.prompt),directorPrompt:clean(seg?.director_prompt),
  };
}

function referenceMentions(text){
  const out=[];const re=/@([A-Za-z]+-\d+)(?![A-Za-z0-9_-])/g;let match;while((match=re.exec(String(text||""))))out.push(match[1]);return [...new Set(out)];
}

function refinedText(refined){
  const row=object(refined),sections=object(row.sections);
  return [row.body,...Object.values(sections)].map((value)=>String(value||"")).join("\n");
}

export function missingReferenceMentionsForShot(body,index=null){
  const i=shotIndexFor(body,index),seg=body?.data?.segments?.[i]||{};
  // Media handles are scoped by the compiler. A handle living on another shot
  // must never make this shot look valid; only shared assets + this shot's
  // assets can satisfy the current prompt. Shared RAW is stricter still: it
  // must be backed by a shared asset because it is applied to every shot.
  const sharedAssets=new Set(array(body?.data?.assets).map((row)=>clean(row?.handle)).filter(Boolean));
  const shotAssets=new Set([...sharedAssets,...array(seg?.assets).map((row)=>clean(row?.handle)).filter(Boolean)]);
  const globalText=[body?.data?.prompt,body?.data?.soundscape,body?.data?.music,refinedText(body?.data?.refined)].map(value=>String(value||"")).join("\n");
  const shotOnly=[seg?.prompt,seg?.prompt_override,seg?.director_prompt,seg?.soundscape,seg?.music,refinedText(seg?.refined)].map(value=>String(value||"")).join("\n");
  const globalMissing=referenceMentions(globalText).filter(handle=>!sharedAssets.has(handle));
  const shotMissing=referenceMentions(shotOnly).filter(handle=>!shotAssets.has(handle));
  const rows=[];for(const handle of globalMissing)rows.push({handle,scope:"global",index:i});for(const handle of shotMissing)if(!globalMissing.includes(handle))rows.push({handle,scope:"shot",index:i});return rows;
}

export function validateShotSnapshot(body,index=null){
  const snap=canonicalShotSnapshot(body,index),checks=[];
  const add=(level,title,detail)=>checks.push({level,title,detail,index:snap.index});
  if(snap.seg?.kind==="clip")return checks;
  if(snap.refs.images>9)add("error","Too many reference images",`${snap.refs.images} active; Ref2VA supports up to 9 reference images.`);
  if(snap.refs.videos>3)add("error","Too many reference videos",`${snap.refs.videos} active; Ref2VA supports up to 3 reference videos.`);
  if(snap.refs.audios>3)add("error","Too many reference audio files",`${snap.refs.audios} active; Ref2VA supports up to 3 reference audio files.`);
  if(snap.refs.files>12)add("error","Too many reference files",`${snap.refs.files} references are active; the mixed reference limit is 12 files.`);
  if(snap.refs.audios&&!(snap.refs.images||snap.refs.videos))add("error","Standalone reference audio","Reference audio needs a reference image or video alongside it for Ref2VA.");
  for(const missing of missingReferenceMentionsForShot(body,snap.index))add("error",`Missing @${missing.handle}`,`The ${missing.scope==="global"?"shared":"shot"} prompt mentions this media handle, but no attached reference with that handle exists. Open Reference Workspace to relink it without rewriting RAW.`);
  for(const asset of snap.refs.rows){
    if(!clean(asset.filename))add("error",`Reference @${asset.handle||"unknown"} has no file`,`Remove or replace this ${asset.kind||"media"} reference.`);
    if(asset.role==="first_frame"&&asset.kind!=="image")add("error",`@${asset.handle} cannot be a start frame`,"Start/end frame roles require an image reference.");
    if(asset.role==="last_frame"&&asset.kind!=="image")add("error",`@${asset.handle} cannot be an end frame`,"Start/end frame roles require an image reference.");
  }
  const firstCount=snap.refs.rows.filter((row)=>row.role==="first_frame").length,lastCount=snap.refs.rows.filter((row)=>row.role==="last_frame").length;
  if(firstCount>1)add("warn","Multiple start frames",`${firstCount} images are marked as first frame. Keep one authoritative start frame unless the route explicitly supports the combination.`);
  if(lastCount>1)add("warn","Multiple end frames",`${lastCount} images are marked as last frame. Keep one authoritative end frame unless the route explicitly supports the combination.`);
  for(const beat of snap.beats){const t=Number(beat?.t);if(Number.isFinite(t)&&(t<0||t>snap.duration))add("error","Timed beat is outside the shot",`${String(beat?.type||"beat")} at ${t.toFixed(2)}s is outside this ${snap.duration.toFixed(2)}s shot.`);}
  for(const point of snap.camera){const t=Number(point?.t);if(Number.isFinite(t)&&(t<0||t>snap.duration))add("error","Camera point is outside the shot",`Camera point at ${t.toFixed(2)}s is outside this ${snap.duration.toFixed(2)}s shot.`);}
  if(snap.camera.length&&snap.scene.camera)add("warn","Two camera authors are active","The CAMERA scene slot and Storyboard camera path both contribute camera direction. Keep both only when they agree.");
  if(snap.modeIntent!=="auto"&&snap.modeIntent!==snap.route)add("warn","Planned route differs from actual route",`Director intent is ${snap.modeIntent}, while attached media currently resolves to ${snap.route}. Actual media routing remains authoritative.`);
  if(snap.continuation&&snap.index===0)add("warn","First shot is marked Continue","There is no earlier storyboard shot to continue from unless an explicit continuation source is configured.");
  return checks;
}

export function validateCreatorShots(body){
  const rows=[];for(let i=0;i<(body?.data?.segments?.length||0);i++)rows.push(...validateShotSnapshot(body,i));return rows;
}
