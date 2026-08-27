import { app } from "../../scripts/app.js";
import * as H from "./z3_h3_api.js";
import * as S from "./z3_h3_state.js";
import { createSubjectAvatar, subjectDisplayName } from "./h3_cast_studio.js";
import { renderCanonicalShotInspector } from "./h3_shot_inspector.js";

const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
const button=(text,fn,cls="z3h3-story-btn",title="")=>{
  const n=el("button",cls,text);n.type="button";if(title)n.title=title;let pointerHandled=false;
  const invoke=async(event)=>{event?.preventDefault?.();event?.stopPropagation?.();try{await fn?.(event);}catch(err){console.error("H3 Storyboard action failed",err);n.dataset.error="1";n.title=err?.message||String(err);setTimeout(()=>delete n.dataset.error,1800);}};
  n.addEventListener("pointerdown",event=>event.stopPropagation());
  n.addEventListener("pointerup",async event=>{if(event.button!==0)return;pointerHandled=true;await invoke(event);setTimeout(()=>{pointerHandled=false;},0);});
  n.addEventListener("click",async event=>{if(pointerHandled||event.detail>0){event.preventDefault();event.stopPropagation();return;}await invoke(event);});
  return n;
};
const activate=(node,fn)=>{
  if(!node)return node;let pointerHandled=false;
  const invoke=async(event)=>{event?.preventDefault?.();event?.stopPropagation?.();try{await fn?.(event);}catch(error){console.error("MiniMax Director interactive surface failed",error);node.dataset.error="1";node.title=error?.message||String(error);setTimeout(()=>delete node.dataset.error,1500);}};
  node.addEventListener("pointerdown",event=>event.stopPropagation());
  node.addEventListener("pointerup",async event=>{if(event.button!==0)return;pointerHandled=true;await invoke(event);setTimeout(()=>{pointerHandled=false;},0);});
  node.addEventListener("click",async event=>{if(pointerHandled||event.detail>0){event.preventDefault();event.stopPropagation();return;}await invoke(event);});
  return node;
};
const wireDetails=(details)=>{
  const summary=details?.querySelector?.(":scope > summary");if(!summary)return details;let pointerHandled=false;
  summary.addEventListener("pointerdown",event=>event.stopPropagation());
  summary.addEventListener("pointerup",event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();pointerHandled=true;details.open=!details.open;setTimeout(()=>{pointerHandled=false;},0);});
  summary.addEventListener("click",event=>{if(pointerHandled||event.detail>0){event.preventDefault();event.stopPropagation();}});
  return details;
};
const input=(type,value="")=>{const n=document.createElement("input");n.type=type;if(type==="checkbox")n.checked=!!value;else n.value=value??"";return n;};
const select=(options,value)=>{const n=document.createElement("select");for(const raw of options){const [v,label]=Array.isArray(raw)?raw:[raw,raw],o=document.createElement("option");o.value=v;o.textContent=label;if(String(v)===String(value))o.selected=true;n.append(o);}return n;};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
const fmt=v=>`${Math.max(0,Number(v)||0).toFixed(Number(v)%1?2:1)}s`;
const mediaRoleLabel=asset=>asset?.role==="first_frame"?"START":asset?.role==="last_frame"?"END":asset?.kind==="image"?"REF":asset?.kind==="video"&&asset?.track==="sound"?"AUDIO":"VIDEO";
function activeLoras(body,index){
  const rows=[];for(const lora of body.data.loras||[])if(lora?.enabled!==false)rows.push({...lora,_scope:"Shared"});
  for(const lora of body.data.segments?.[index]?.loras||[])if(lora?.enabled!==false)rows.push({...lora,_scope:"Shot"});
  const map=new Map();for(const row of rows)map.set(String(row.name||""),row);return [...map.values()].filter(row=>row.name);
}
function basename(value){return String(value||"").split(/[\\/]/).pop()||String(value||"");}
function shotSnapshot(body,index,helpers){
  const seg=body.data.segments?.[index],director=helpers.directorFor(seg),refs=helpers.counts(body,index),cast=helpers.subjectsForShot(body,index),loras=activeLoras(body,index),assets=helpers.assetsForShot(body,index);
  return {seg,director,refs,cast,loras,assets,mode:helpers.inferMode(body,index),route:helpers.routeText(body,index),duration:Number(seg?.duration_s||S.DEFAULT_DURATION_S),beats:director?.beats?.length||0,camera:director?.camera_points?.length||0};
}
function preflight(body,helpers){const checks=helpers.localChecks?.(body)||[];return {checks,errors:checks.filter(row=>row.level==="error"),warnings:checks.filter(row=>row.level==="warn")};}
const MODE_TONE={T2VA:"#8e99aa",I2VA:"#6d9fd1",L2VA:"#9186cb",FL2VA:"#d69b62",REF2VA:"#66b7aa",CLIP:"#6f7784"};
const TRACKS=[
  {id:"shots",label:"Storyboard",hint:"Drag shot cards to reorder. Drag boundaries to retime."},
  {id:"visual",label:"Pictures",hint:"START/END are anchors. References can optionally add an H3 Pin at their block start."},
  {id:"video",label:"Reference video",hint:"Drag to place or trim; H3 Pin optionally anchors the clip at its block start."},
  {id:"audio",label:"Audio / music",hint:"Drag and trim references; H3 Pin optionally anchors sound at its block start."},
  {id:"beats",label:"Action + dialogue",hint:"Double-click to add a timed beat."},
  {id:"camera",label:"Camera",hint:"Camera points from the visual camera planner appear here."},
];

function dmeta(seg, directorFor){
  const d=directorFor(seg);if(!d)return null;
  const t=d.timeline&&typeof d.timeline==="object"&&!Array.isArray(d.timeline)?d.timeline:{};
  t.media=t.media&&typeof t.media==="object"&&!Array.isArray(t.media)?t.media:{};
  t.collapsed=t.collapsed&&typeof t.collapsed==="object"&&!Array.isArray(t.collapsed)?t.collapsed:{};
  d.timeline=t;return t;
}
function segmentStarts(segments){let at=0;return segments.map(seg=>{const start=at,d=Math.max(.2,Number(seg?.duration_s||S.DEFAULT_DURATION_S));at+=d;return {start,end:at,duration:d};});}
function segmentAtTime(segments,time){const starts=segmentStarts(segments);let idx=starts.findIndex(row=>time>=row.start&&time<row.end);if(idx<0)idx=Math.max(0,segments.length-1);const row=starts[idx]||{start:0,end:1,duration:1};return {index:idx,local:clamp(time-row.start,0,row.duration),...row};}
function trackForAsset(asset){if(asset?.kind==="audio"||asset?.track==="sound")return "audio";if(asset?.kind==="video")return "video";return "visual";}
export function storyboardMediaWindow(asset,existing={},durationRaw=S.DEFAULT_DURATION_S,sourceDuration=0){
  const duration=Math.max(.2,Number(durationRaw)||S.DEFAULT_DURATION_S),role=String(asset?.role||"reference"),kind=String(asset?.kind||"image"),guessed=Math.max(0,Number(sourceDuration)||Number(existing.source_duration)||0),visualWindow=Math.min(duration,Math.max(.5,Math.min(2,duration*.3)));
  let start=Number(existing.start),end=Number(existing.end);
  if(kind==="image"){
    if(role==="first_frame"){start=0;if(!Number.isFinite(end)||end<=0)end=visualWindow;}
    else if(role==="last_frame"){end=duration;if(!Number.isFinite(start)||start>=duration)start=Math.max(0,duration-visualWindow);}
    else{if(!Number.isFinite(start))start=0;if(!Number.isFinite(end)||end<=start)end=Math.min(duration,start+visualWindow);if(end-start<.2)start=Math.max(0,end-.2);}
  }else{
    if(!Number.isFinite(start))start=0;
    if(!Number.isFinite(end)||end<=start)end=Math.min(duration,start+Math.max(.4,guessed||duration));
  }
  start=clamp(start,0,duration);end=clamp(end,0,duration);if(end<start)[start,end]=[end,start];
  if(end-start<.2){if(end>=duration)start=Math.max(0,duration-.2);else end=Math.min(duration,start+.2);}
  return {track:existing.track||trackForAsset(asset),start,end,source_in:Math.max(0,Number(existing.source_in??asset?.trim?.start??0)||0),source_out:Number(existing.source_out??asset?.trim?.end??guessed)||guessed||duration,source_duration:guessed||0,pin:asset?.role==="reference"&&existing.pin===true};
}
export function placeStoryboardMedia(record,asset,localTime,durationRaw,sourceDuration=0){
  const duration=Math.max(.2,Number(durationRaw)||S.DEFAULT_DURATION_S),role=String(asset?.role||"reference"),kind=String(asset?.kind||"image"),span=Math.max(.2,Math.min(duration,kind==="image"?Math.max(.5,Math.min(2,duration*.3)):Number(sourceDuration)||duration));
  if(role==="first_frame"){record.start=0;record.end=Math.min(duration,span);}
  else if(role==="last_frame"){record.end=duration;record.start=Math.max(0,duration-span);}
  else{record.start=clamp(localTime,0,Math.max(0,duration-.2));record.end=Math.min(duration,record.start+span);if(record.end-record.start<.2)record.start=Math.max(0,record.end-.2);}
  if(kind!=="image"){record.source_out=Math.min(Number(sourceDuration)||span,record.source_in+(record.end-record.start));}
  return record;
}
function mediaRecord(seg,asset,directorFor,sourceDuration=0){
  const meta=dmeta(seg,directorFor),duration=Math.max(.2,Number(seg.duration_s||S.DEFAULT_DURATION_S)),key=String(asset?.handle||"");
  if(!key)return null;
  const existing=meta.media[key]&&typeof meta.media[key]==="object"?meta.media[key]:{};
  const out=storyboardMediaWindow(asset,existing,duration,sourceDuration);
  meta.media[key]=out;return out;
}
function updateMediaPrompt(body,index,directorFor,updateDirectorPrompt){
  const seg=body.data.segments?.[index],meta=dmeta(seg,directorFor);if(!seg||!meta)return;
  // buildDirectorPrompt consumes this metadata. Keep the records normalized here.
  for(const asset of [...(body.data.assets||[]),...(seg.assets||[])])if(asset?.handle&&meta.media?.[asset.handle])mediaRecord(seg,asset,directorFor,meta.media[asset.handle].source_duration);
  updateDirectorPrompt(body,index);
}
function globalMedia(body,index,asset,helpers){
  const seg=body.data.segments[index],starts=segmentStarts(body.data.segments),rec=mediaRecord(seg,asset,helpers.directorFor),base=starts[index]?.start||0;
  return {rec,globalStart:base+rec.start,globalEnd:base+rec.end};
}
function renderCast(body,index,host,helpers){
  const rows=helpers.subjectsForShot(body,index);if(!rows.length){host.append(el("span","z3h3-story-cast-empty","No Cast"));return;}
  for(const subject of rows){const chip=el("span","z3h3-story-cast");chip.append(createSubjectAvatar(body,subject),el("span",null,subjectDisplayName(subject)));chip.title=`@${subject.handle}`;host.append(chip);}
}
function renderRuler(canvas,total,zoom){
  const step=zoom>=105?.5:1,major=zoom>=70?1:2;
  for(let t=0;t<=total+.001;t+=step){const tick=el("i",`z3h3-story-tick${Math.abs((t/major)-Math.round(t/major))<.001?" major":""}`);tick.style.left=`${t*zoom}px`;canvas.append(tick);if(t===0||Math.abs((t/major)-Math.round(t/major))<.001){const label=el("span","z3h3-story-ruler-label",`${t.toFixed(step<1?1:0)}s`);label.style.left=`${t*zoom+3}px`;canvas.append(label);}}
}
function pointerDrag(startEvent,onMove,onEnd){
  startEvent.preventDefault();startEvent.stopPropagation();
  const move=e=>{e.preventDefault();onMove?.(e);};const end=e=>{document.removeEventListener("pointermove",move,true);document.removeEventListener("pointerup",end,true);onEnd?.(e);};
  document.addEventListener("pointermove",move,true);document.addEventListener("pointerup",end,true);
}
function snapTime(value,state){const mode=state.snap||"seconds";if(mode==="frames")return Math.round(value*24)/24;if(mode==="off")return value;return Math.round(value*10)/10;}
function mediaThumb(body,asset){const n=el("span","z3h3-story-media-thumb"),url=body.assetPreviewUrl?.(asset)||body.thumbnailUrl?.(asset)||"";if(url){const image=document.createElement("img");image.src=url;image.alt=basename(asset.filename||asset.handle||"Storyboard media");image.draggable=false;n.append(image);n.classList.add("has-image");}else n.textContent=asset.kind==="audio"?"♪":asset.kind==="video"?"▶":"▧";return n;}
function waveformCanvas(asset){const c=document.createElement("canvas");c.className="z3h3-story-wave";c.width=180;c.height=36;const ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);ctx.strokeStyle="rgba(255,255,255,.32)";ctx.beginPath();for(let x=0;x<c.width;x+=4){const y=c.height/2+(Math.sin(x*.31)+Math.sin(x*.073)*.7)*5;ctx.moveTo(x,c.height/2-(y-c.height/2));ctx.lineTo(x,y);}ctx.stroke();return c;}
function clipBlock(body,index,asset,trackCanvas,zoom,helpers,state,render,scope="shot"){
  const {rec,globalStart,globalEnd}=globalMedia(body,index,asset,helpers),starts=segmentStarts(body.data.segments),seg=body.data.segments[index],block=el("div",`z3h3-story-clip ${asset.kind||"media"}`);block.style.left=`${globalStart*zoom}px`;block.style.width=`${Math.max(52,(globalEnd-globalStart)*zoom)}px`;block.dataset.handle=asset.handle;block.dataset.role=String(asset.role||"reference");block.dataset.pinned=rec.pin?"1":"0";block.title=`@${asset.handle} · ${asset.kind} · ${String(asset.role||"reference").replaceAll('_',' ')}${rec.pin?" · H3 Pin active":""}\nDrag to reposition · drag edges to resize${asset.kind!=="image"?"/trim":" its guidance window"} · double-click to inspect`;
  const copy=el("div","z3h3-story-clip-copy"),filename=basename(asset.filename||"");copy.append(el("b",null,filename||`@${asset.handle}`),el("small",null,`@${asset.handle} · ${fmt(rec.start)}–${fmt(rec.end)}`));
  const roleEditable=asset.kind==="image"&&scope!=="global",badge=el(roleEditable?"button":"span","z3h3-story-role-badge",mediaRoleLabel(asset));if(roleEditable){badge.type="button";badge.title="Change this shot's H3 role: Reference → Start frame → End frame";badge.addEventListener("pointerdown",event=>event.stopPropagation());badge.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();const duration=Math.max(.2,Number(seg.duration_s||S.DEFAULT_DURATION_S)),span=Math.max(.2,rec.end-rec.start),next=asset.role==="reference"?"first_frame":asset.role==="first_frame"?"last_frame":"reference";if(next!=="reference")for(const other of seg.assets||[]){if(other!==asset&&other?.kind==="image"&&other.role===next)other.role="reference";}asset.role=next;if(asset.role!=="reference")rec.pin=false;if(asset.role==="first_frame"){rec.start=0;rec.end=Math.min(duration,span);}else if(asset.role==="last_frame"){rec.end=duration;rec.start=Math.max(0,duration-span);}badge.textContent=mediaRoleLabel(asset);block.dataset.role=asset.role;updateMediaPrompt(body,index,helpers.directorFor,helpers.updateDirectorPrompt);body.checkpointHistory?.("Change storyboard image role");render();});}else if(asset.kind==="image"){badge.title="Shared images stay references. Drag this source onto the shot to make a separate Start or End frame.";}
  const pinButton=asset.role==="reference"?button(rec.pin?"H3 PIN ✓":"H3 PIN",()=>{rec.pin=!rec.pin;updateMediaPrompt(body,index,helpers.directorFor,helpers.updateDirectorPrompt);body.checkpointHistory?.(rec.pin?"Pin H3 timeline guide":"Unpin H3 timeline guide");render();},`z3h3-story-pin-badge${rec.pin?" active":""}`,rec.pin?`This reference is also anchored at ${fmt(rec.start)}. Click to keep it as a normal reference only.`:`Keep this reference and additionally anchor it at ${fmt(rec.start)} on H3's target timeline.`):null;
  block.append(mediaThumb(body,asset),copy,badge);if(pinButton)block.append(pinButton);if(asset.kind==="audio"||asset.track==="sound")block.append(waveformCanvas(asset));const left=el("i","z3h3-story-trim left"),right=el("i","z3h3-story-trim right");block.append(left,right);
    const resize=(side,e)=>{const startX=e.clientX,orig={...rec},shot=starts[index],max=shot.duration;pointerDrag(e,move=>{const delta=snapTime((move.clientX-startX)/zoom,state);if(side==="left"){const next=asset.role==="first_frame"?0:clamp(orig.start+delta,0,orig.end-.2);rec.start=next;if(asset.kind!=="image")rec.source_in=Math.max(0,orig.source_in+(next-orig.start));}else{const next=asset.role==="last_frame"?max:clamp(orig.end+delta,orig.start+.2,max);rec.end=next;if(asset.kind!=="image"&&rec.source_duration)rec.source_out=clamp(orig.source_out+(next-orig.end),rec.source_in+.1,rec.source_duration);}block.style.left=`${(shot.start+rec.start)*zoom}px`;block.style.width=`${Math.max(52,(rec.end-rec.start)*zoom)}px`;},()=>{if(asset.kind!=="image"&&rec.source_out>rec.source_in)asset.trim={start:rec.source_in,end:rec.source_out};updateMediaPrompt(body,index,helpers.directorFor,helpers.updateDirectorPrompt);render();});};
    left.addEventListener("pointerdown",e=>resize("left",e));right.addEventListener("pointerdown",e=>resize("right",e));
  block.addEventListener("pointerdown",e=>{if(e.button!==0||e.target?.closest?.(".z3h3-story-trim,.z3h3-story-role-badge,.z3h3-story-pin-badge"))return;const startX=e.clientX,orig={...rec},shot=starts[index],length=Math.max(.2,orig.end-orig.start);pointerDrag(e,move=>{const delta=snapTime((move.clientX-startX)/zoom,state),next=clamp(orig.start+delta,0,Math.max(0,shot.duration-length));rec.start=next;rec.end=next+length;block.style.left=`${(shot.start+rec.start)*zoom}px`;},()=>{if(asset.role==="first_frame"&&rec.start>.1)asset.role="reference";if(asset.role==="last_frame"&&rec.end<shot.duration-.1)asset.role="reference";updateMediaPrompt(body,index,helpers.directorFor,helpers.updateDirectorPrompt);render();});});
  block.addEventListener("dblclick",e=>{e.preventDefault();e.stopPropagation();body.openAsset?.(body.assetByHandle?.(asset.handle)||asset);});trackCanvas.append(block);
}
async function addExistingMedia(body,index,track,row,localTime,helpers){
  const kind=String(row?.kind||H.kindFromName(row?.path||row?.filename||""));if(!["image","video","audio"].includes(kind))throw new Error("That media type cannot be placed on the H3 timeline.");
  if(track==="video"&&kind!=="video")throw new Error("Reference Video track accepts video files.");if(track==="audio"&&!(["audio","video"].includes(kind)))throw new Error("Audio track accepts audio or video files.");
  const normalized={path:row.path||row.filename,name:String(row.path||row.filename||"").split(/[\/]/).pop(),subfolder:row.subfolder||"",kind};const previous=body.target;body.target=index;const seg=body.data.segments[index],duration=Number(seg.duration_s||S.DEFAULT_DURATION_S);let role="reference";if(track==="visual"&&kind==="image"){if(localTime<=Math.min(.75,duration*.12))role="first_frame";else if(localTime>=duration-Math.min(.75,duration*.12))role="last_frame";}
  const linked=row.handle?body.assetByHandle?.(row.handle):null,isShared=!!linked&&(body.data.assets||[]).includes(linked),isOnShot=!!linked&&(seg.assets||[]).includes(linked),reuse=!!linked&&(isOnShot||(isShared&&role==="reference"));let asset=reuse?linked:body.attach?.(normalized,role);body.target=previous;if(!asset)return null;if(reuse&&kind==="image"&&!isShared)asset.role=role;if(track==="audio"&&asset.kind==="video")asset.track="sound";else if(asset.kind==="video")asset.track="picture";let sourceDuration=0;if(kind!=="image")try{const probe=await H.probe(normalized.path);sourceDuration=Number(probe.duration||0)||0;}catch{}
  const rec=mediaRecord(seg,asset,helpers.directorFor,sourceDuration);rec.track=track;placeStoryboardMedia(rec,asset,localTime,duration,sourceDuration);updateMediaPrompt(body,index,helpers.directorFor,helpers.updateDirectorPrompt);return asset;
}

async function addDroppedFile(body,index,track,file,localTime,helpers,state){
  const kind=H.kindFromName(file.name);if(!["image","video","audio"].includes(kind))throw new Error(`Unsupported media: ${file.name}`);
  if(track==="video"&&kind!=="video")throw new Error("Reference Video track accepts video files.");
  if(track==="audio"&&!(["audio","video"].includes(kind)))throw new Error("Audio track accepts audio or video files.");
  const uploaded=await H.uploadFile(file,"z3_minimax_creator/director");const previous=body.target;body.target=index;
  let role="reference";const seg=body.data.segments[index],duration=Number(seg.duration_s||S.DEFAULT_DURATION_S);if(track==="visual"&&kind==="image"){if(localTime<=Math.min(.75,duration*.12))role="first_frame";else if(localTime>=duration-Math.min(.75,duration*.12))role="last_frame";}
  const asset=body.attach?.(uploaded,role);body.target=previous;if(!asset)return null;if(track==="audio"&&asset.kind==="video")asset.track="sound";else if(asset.kind==="video")asset.track="picture";
  let sourceDuration=0;if(kind!=="image")try{const probe=await H.probe(uploaded.path);sourceDuration=Number(probe.duration||0)||0;}catch{}
  const rec=mediaRecord(seg,asset,helpers.directorFor,sourceDuration);rec.track=track;placeStoryboardMedia(rec,asset,localTime,duration,sourceDuration);
  updateMediaPrompt(body,index,helpers.directorFor,helpers.updateDirectorPrompt);return asset;
}
function makeLane(label,hint,id,timelineWidth,content,state,body,helpers,render){const row=el("div",`z3h3-story-lane lane-${id}`),lab=el("div","z3h3-story-lane-label"),canvas=el("div","z3h3-story-lane-canvas"),icon=el("span","z3h3-story-lane-icon",({shots:"▤",visual:"▧",video:"▶",audio:"♫",beats:"◆",camera:"◎"})[id]||"·"),copy=el("div","z3h3-story-lane-copy");copy.append(el("b",null,label),el("small",null,hint));lab.append(icon,copy);canvas.style.width=`${timelineWidth}px`;row.append(lab,canvas);content.append(row);if(["visual","video","audio"].includes(id)){canvas.addEventListener("dragover",e=>{e.preventDefault();e.stopPropagation();canvas.classList.add("drop-ready");});canvas.addEventListener("dragleave",()=>canvas.classList.remove("drop-ready"));canvas.addEventListener("drop",async e=>{e.preventDefault();e.stopPropagation();canvas.classList.remove("drop-ready");const rect=canvas.getBoundingClientRect(),global=clamp((e.clientX-rect.left)/state.zoom,0,99999),hit=segmentAtTime(body.data.segments,global),payload=e.dataTransfer?.getData("application/x-z3-media");if(payload){try{await addExistingMedia(body,hit.index,id,JSON.parse(payload),hit.local,helpers);}catch(error){console.error("Timeline media drop failed",error);}}for(const file of [...(e.dataTransfer?.files||[])])await addDroppedFile(body,hit.index,id,file,hit.local,helpers,state);render();});}
  return canvas;}
function renderShotReadout(body,state,host,helpers,render){
  const snap=shotSnapshot(body,state.index,helpers),bar=el("div","z3h3-story-readout");
  const pill=(label,value,fn=null,cls="")=>{const node=el(fn?"button":"span",`z3h3-story-readout-pill ${cls}`.trim());if(fn){node.type="button";activate(node,fn);}node.append(el("small",null,label),el("b",null,value));return node;};
  bar.append(pill("Route",snap.route,null,"route"),pill("Length",`${snap.duration.toFixed(1)}s · ${S.durationFrames(snap.duration)}f`));
  bar.append(pill("Cast",String(snap.cast.length),()=>body.openCast?.()));
  const refLabel=[snap.refs.images?`${snap.refs.images} img`:"",snap.refs.videos?`${snap.refs.videos} vid`:"",snap.refs.audios?`${snap.refs.audios} aud`:"",snap.refs.first?"start":"",snap.refs.last?"end":""].filter(Boolean).join(" · ")||"none";
  bar.append(pill("Refs",refLabel,()=>{state.tab="references";render();}));
  bar.append(pill("LoRAs",snap.loras.length?`${snap.loras.length} · ${snap.loras.slice(0,2).map(row=>basename(row.name)).join(", ")}${snap.loras.length>2?"…":""}`:"none",()=>body.openLoras?.()));
  bar.append(pill("Beats",String(snap.beats),()=>{if(!snap.beats){const hit=segmentAtTime(body.data.segments,state.playhead);helpers.openBeatEditor(body,state.index,null,render,hit.index===state.index?hit.local:Math.min(snap.duration/2,snap.duration-.2));return;}state.inspector=true;render();(globalThis.requestAnimationFrame||((fn)=>setTimeout(fn,0)))(()=>document.querySelector?.(".z3h3-story-beat-deck")?.scrollIntoView?.({block:"nearest",behavior:"smooth"}));}),pill("Camera",snap.camera?`${snap.camera} point${snap.camera===1?"":"s"}`:"none",()=>{state.tab="camera";render();}));
  if(snap.seg?.continue)bar.append(pill("Continuity","continue",()=>body.openShotOptions?.(state.index),"active"));
  if(String(snap.seg?.soundscape||"").trim()||String(snap.seg?.music||"").trim())bar.append(pill("Audio","authored",()=>body.openShotOptions?.(state.index),"active"));
  host.append(bar);
}
function renderSourceShelf(body,state,host,helpers,render){
  const shell=el("section","z3h3-story-source-shelf"),head=el("div","z3h3-story-source-head"),copy=el("div"),tools=el("div","z3h3-story-source-tools"),strip=el("div","z3h3-story-source-strip"),assets=helpers.assetsForShot(body,state.index);
  copy.append(el("b",null,`Shot ${state.index+1} source shelf`),el("small",null,"Drag attached media onto Pictures, Video, or Audio. Timeline placement never duplicates the file."));
  tools.append(button("Add media",()=>{body.switchTarget?.(state.index);body.openMedia?.("input");},"z3h3-story-btn primary"),button("Manage refs",()=>{state.tab="references";render();},"z3h3-story-btn"));head.append(copy,tools);shell.append(head);
  for(const listed of assets){const asset=body.assetByHandle?.(listed.handle)||listed,card=el("article",`z3h3-story-source-card kind-${asset.kind||"media"}`),cardCopy=el("div");card.draggable=true;card.dataset.handle=asset.handle;card.title=`Drag @${asset.handle} to a compatible timeline track · click to inspect`;card.addEventListener("dragstart",event=>{event.dataTransfer?.setData("application/x-z3-media",JSON.stringify({handle:asset.handle,path:asset.filename,filename:asset.filename,kind:asset.kind,role:asset.role,track:asset.track||""}));if(event.dataTransfer)event.dataTransfer.effectAllowed="copy";});card.addEventListener("click",()=>body.openAsset?.(asset));cardCopy.append(el("b",null,basename(asset.filename)||`@${asset.handle}`),el("small",null,`@${asset.handle} · ${String(asset.role||"reference").replaceAll("_"," ")}`));card.append(mediaThumb(body,asset),cardCopy,el("span","z3h3-story-source-kind",mediaRoleLabel(asset)));strip.append(card);}
  if(!assets.length)strip.append(el("div","z3h3-story-source-empty","No media attached to this shot yet. Add a source, then drag it onto the ruler."));shell.append(strip);host.append(shell);
}

async function compiledShotPrompt(body,index,host){
  const status=host.querySelector("[data-role=compiled]");if(!status)return;status.textContent="Compiling the current storyboard…";status.dataset.state="busy";
  try{const seed=Number(body.widgets?.seed?.value),safeSeed=Number.isFinite(seed)&&seed>=0?Math.trunc(seed):0,res=await H.promptPreview(S.normalizeData(structuredClone(body.data)),safeSeed,String(body.widgets?.processing_mode?.value||"entire text as one"),body.currentVariationIndex?.()||0),gens=(res.passes||[]).filter(p=>p?.kind==="generation"),genIndex=body.data.segments.slice(0,index).filter(s=>s?.kind!=="clip").length,prompt=String(gens[genIndex]?.prompt||gens[0]?.prompt||"");status.textContent=prompt||"No generation prompt compiled for this card.";status.dataset.state="ready";}catch(err){status.textContent=err?.message||String(err);status.dataset.state="error";}
}
function shotInspector(body,state,content,helpers,render){
  const seg=body.data.segments[state.index];if(!seg)return;const shell=el("section","z3h3-story-inspector");if(seg.kind==="clip"){shell.append(el("div","z3h3-story-inspector-title",`Clip ${state.index+1}`),el("div","z3h3-story-muted","Supplied footage card. Use Clip Options for source trim, sound and continuation."),button("Open Clip Options",()=>body.openShotOptions?.(state.index),"z3h3-story-btn primary"));content.append(shell);return;}
  const director=helpers.directorFor(seg),left=el("div","z3h3-story-inspector-main"),right=el("div","z3h3-story-model-prompt"),title=el("div","z3h3-story-inspector-title"),prompt=document.createElement("textarea");prompt.className="z3h3-story-shot-prompt";prompt.rows=5;prompt.value=seg.prompt||"";prompt.placeholder="Write what happens in this shot. Use Prompt Palette tokens, @Cast, or plain language…";title.append(el("div",null),el("span","z3h3-story-route",helpers.routeText(body,state.index)));title.firstChild.append(el("b",null,`Shot ${state.index+1}`),el("small",null,`${fmt(seg.duration_s||S.DEFAULT_DURATION_S)} · ${helpers.inferMode(body,state.index)} · ${helpers.subjectsForShot(body,state.index).length} Cast`));
  let compileTimer=null,historyTimer=null;
  const checkpointPromptHistory=(delay=520)=>{clearTimeout(historyTimer);historyTimer=setTimeout(()=>body.checkpointHistory?.("Edit storyboard shot prompt"),delay);};
  const persistPromptQuietly=()=>{
    seg.prompt=prompt.value;body.target=state.index;
    helpers.updateDirectorPrompt(body,state.index,{notify:false});
    const card=content.querySelector?.(`.z3h3-story-shot-block[data-index="${state.index}"] .z3h3-story-shot-copy`);
    if(card)card.textContent=String(prompt.value||"Click to write this shot…").replace(/\s+/g," ").trim();
    clearTimeout(compileTimer);compileTimer=setTimeout(()=>compiledShotPrompt(body,state.index,right),320);checkpointPromptHistory();
  };
  prompt.addEventListener("input",persistPromptQuietly);
  prompt.addEventListener("change",()=>{persistPromptQuietly();body.checkpointHistory?.("Edit storyboard shot prompt");body.syncPrompt?.(false);});
  const quick=el("div","z3h3-story-inspector-actions");quick.append(button("Add beat",()=>helpers.openBeatEditor(body,state.index,null,render,Math.min(Number(seg.duration_s||6)-.25,Number(seg.duration_s||6)/2)),"z3h3-story-btn primary"),button("Camera path",()=>{state.tab="camera";render();},"z3h3-story-btn"),button("References",()=>{state.tab="references";render();},"z3h3-story-btn"),button("Shot Inspector",()=>body.openShotOptions?.(state.index),"z3h3-story-btn"));const beatDeck=el("section","z3h3-story-beat-deck"),beatHead=el("div","z3h3-story-beat-deck-head"),beatList=el("div","z3h3-story-beat-deck-list");beatHead.append(el("div",null),button("+ Beat",()=>helpers.openBeatEditor(body,state.index,null,render,Math.min(Number(seg.duration_s||6)-.25,Number(seg.duration_s||6)/2)),"z3h3-story-btn mini primary"));beatHead.firstChild.append(el("b",null,"Timed events"),el("small",null,"Action, dialogue, sound, transitions, and LoRA boundaries"));for(const beat of director.beats||[]){const row=button("",()=>helpers.openBeatEditor(body,state.index,beat,render,beat.t),`z3h3-story-beat-deck-row type-${beat.type||"action"}`);row.replaceChildren(el("span","time",`${Number(beat.t||0).toFixed(2)}s`),el("span","type",String(beat.type||"action").replaceAll("_"," ")),el("b",null,String(beat.text||beat.lora||"Timed cue")));beatList.append(row);}if(!beatList.children.length)beatList.append(el("div","z3h3-story-beat-deck-empty","No timed events yet. Add one here, from the toolbar, or by double-clicking the Action + Dialogue lane."));beatDeck.append(beatHead,beatList);
  const details=document.createElement("details");details.className="z3h3-story-more";const summary=document.createElement("summary");summary.textContent="More shot controls";const controls=el("div","z3h3-story-more-grid"),duration=input("number",seg.duration_s||S.DEFAULT_DURATION_S),intent=select([["auto","Auto · infer from inputs"],["T2VA","T2VA"],["I2VA","I2VA"],["L2VA","L2VA"],["FL2VA","FL2VA"],["REF2VA","Ref2VA"]],director.mode_intent||"auto");duration.min=.2;duration.max=120;duration.step=.1;duration.addEventListener("change",()=>{seg.duration_s=Math.max(.2,Number(duration.value)||S.DEFAULT_DURATION_S);body.commitData?.(true,{historyLabel:"Change storyboard duration"});render();});intent.addEventListener("change",()=>{director.mode_intent=intent.value;body.commitData?.(true,{historyLabel:"Change storyboard route intent"});render();});const sound=document.createElement("textarea");sound.value=seg.soundscape||"";sound.rows=2;const music=document.createElement("textarea");music.value=seg.music||"";music.rows=2;let audioHistoryTimer=null;const saveAudio=()=>{seg.soundscape=sound.value;seg.music=music.value;helpers.updateDirectorPrompt(body,state.index,{notify:false});clearTimeout(audioHistoryTimer);audioHistoryTimer=setTimeout(()=>body.checkpointHistory?.("Edit storyboard audio"),520);};sound.addEventListener("input",saveAudio);music.addEventListener("input",saveAudio);sound.addEventListener("change",()=>body.checkpointHistory?.("Edit storyboard audio"));music.addEventListener("change",()=>body.checkpointHistory?.("Edit storyboard audio"));controls.innerHTML='';const mk=(label,node)=>{const f=el("label","z3h3-story-field");f.append(el("span",null,label),node);return f;};controls.append(mk("Duration",duration),mk("Mode intent",intent),mk("Soundscape / Foley",sound),mk("Music",music));const destructive=el("div","z3h3-story-more-actions");destructive.append(button("Duplicate shot",()=>{helpers.duplicateSegment(body,state.index);state.index=Number(body.target);render();},"z3h3-story-btn"),button("Move earlier",()=>{helpers.moveSegment(body,state.index,-1);state.index=Math.max(0,state.index-1);render();},"z3h3-story-btn"),button("Move later",()=>{helpers.moveSegment(body,state.index,1);state.index=Math.min(body.data.segments.length-1,state.index+1);render();},"z3h3-story-btn"),button("Delete shot",()=>{helpers.deleteSegment(body,state.index);state.index=Math.max(0,Math.min(state.index,body.data.segments.length-1));render();},"z3h3-story-btn danger"));details.append(summary,controls,destructive);wireDetails(details);
  left.append(title);const canonical=el("div","z3h3-story-canonical-inspector");renderCanonicalShotInspector(body,state.index,canonical,{compact:true,onNavigate:(target)=>{if(target==="references"){body.openReferences?.(state.index);return;}if(target==="timing"){helpers.openTimingInspector?.(body);return;}if(target==="camera"){state.tab="camera";render();}}});left.append(canonical,prompt,quick,beatDeck,details);
  const modelHead=el("div","z3h3-story-model-head");modelHead.append(el("div",null),button("Refresh",()=>compiledShotPrompt(body,state.index,right),"z3h3-story-btn mini"),button("Copy",async()=>{const txt=right.querySelector("[data-role=compiled]")?.textContent||"";await navigator.clipboard?.writeText?.(txt);},"z3h3-story-btn mini"));modelHead.firstChild.append(el("b",null,"Exact model prompt"),el("small",null,"Compiled from Global + this shot + Director + references"));const pre=el("pre","z3h3-story-compiled");pre.dataset.role="compiled";right.append(modelHead,pre);shell.append(left,right);content.append(shell);compiledShotPrompt(body,state.index,right);
}
function runCurrent(body,state,helpers,render){
  const gate=preflight(body,helpers);
  if(gate.errors.length){state.tab="checks";render();throw new Error(`${gate.errors.length} Director preflight error${gate.errors.length===1?"":"s"} must be fixed before Run.`);}
  if(typeof app?.queuePrompt==="function")return app.queuePrompt(0,1);
  throw new Error("ComfyUI queue action is unavailable in this frontend build.");
}

export function renderStoryboardTimeline(body,state,content,helpers,render){
  state.zoom=clamp(state.zoom||74,38,160);state.snap=state.snap||"seconds";state.inspector=state.inspector!==false;state.trackVisibility=state.trackVisibility||{visual:true,video:true,audio:true,beats:true,camera:true};state.playhead=Number.isFinite(Number(state.playhead))?Math.max(0,Number(state.playhead)):0;
  const total=body.data.segments.reduce((sum,seg)=>sum+Math.max(.2,Number(seg?.duration_s||S.DEFAULT_DURATION_S)),0),gate=preflight(body,helpers);
  state.playhead=clamp(state.playhead,0,total);
  const toolbar=el("div","z3h3-story-toolbar"),leftTools=el("div","z3h3-story-toolbar-left"),rightTools=el("div","z3h3-story-toolbar-right"),zoom=input("range",state.zoom),snap=select([["seconds","Snap 0.1s"],["frames","Snap frames"],["off","Free"]],state.snap);zoom.min=38;zoom.max=160;zoom.step=2;zoom.title="Timeline zoom";zoom.addEventListener("change",()=>{state.zoom=Number(zoom.value);helpers.savePrefs?.(state);render();});snap.addEventListener("change",()=>{state.snap=snap.value;helpers.savePrefs?.(state);render();});
  const history=body.historyStatus?.()||{canUndo:false,canRedo:false};
  leftTools.append(button("↶",()=>{body.undo?.();render();},`z3h3-story-btn icon${history.canUndo?"":" disabled"}`,history.canUndo?`Undo ${history.undoLabel||"edit"}`:"Nothing to undo"),button("↷",()=>{body.redo?.();render();},`z3h3-story-btn icon${history.canRedo?"":" disabled"}`,history.canRedo?`Redo ${history.redoLabel||"edit"}`:"Nothing to redo"),button("＋ Shot",()=>{helpers.addGeneratedShot(body);state.index=Number(body.target);render();},"z3h3-story-btn primary","Add a generated storyboard shot"),button("＋ Media",()=>{body.switchTarget?.(state.index);body.openMedia?.("input");},"z3h3-story-btn","Open the existing local Media browser"),button("＋ Beat",()=>{const hit=segmentAtTime(body.data.segments,state.playhead);state.index=hit.index;body.switchTarget?.(hit.index);helpers.openBeatEditor(body,hit.index,null,render,hit.local);},"z3h3-story-btn","Add a timed beat at the playhead"),button("Resolve + Timing",()=>helpers.openTimingInspector(body),"z3h3-story-btn"));
  const trackMenu=document.createElement("details");trackMenu.className="z3h3-story-track-menu";const trackSummary=document.createElement("summary");trackSummary.textContent="Tracks";const trackOptions=el("div","z3h3-story-track-options");for(const spec of TRACKS.filter(row=>row.id!=="shots")){const label=document.createElement("label"),check=input("checkbox",state.trackVisibility[spec.id]!==false);label.append(check,document.createTextNode(spec.label));check.addEventListener("change",()=>{state.trackVisibility[spec.id]=check.checked;helpers.savePrefs?.(state);render();});trackOptions.append(label);}trackMenu.append(trackSummary,trackOptions);wireDetails(trackMenu);
  const preflightButton=button(gate.errors.length?`${gate.errors.length} error${gate.errors.length===1?"":"s"}`:gate.warnings.length?`${gate.warnings.length} warning${gate.warnings.length===1?"":"s"}`:"Ready",()=>{state.tab="checks";render();},`z3h3-story-btn preflight ${gate.errors.length?"error":gate.warnings.length?"warn":"ok"}`,"Open Director checks");
  const fit=button("Fit",()=>{const available=Math.max(520,(content.getBoundingClientRect?.().width||1100)-165);state.zoom=clamp(available/Math.max(total,1),38,160);state.scrollLeft=0;helpers.savePrefs?.(state);render();},"z3h3-story-btn","Zoom the full storyboard into the visible ruler");
  const timeReadout=el("span","z3h3-story-time-readout",`${state.playhead.toFixed(2)}s`);timeReadout.title="Playhead time · click the ruler to reposition";
  rightTools.append(timeReadout,preflightButton,el("span","z3h3-story-zoom-label","Zoom"),zoom,fit,snap,trackMenu,button(state.inspector?"Hide inspector":"Show inspector",()=>{state.inspector=!state.inspector;helpers.savePrefs?.(state);render();},"z3h3-story-btn"),button("▶ Run",()=>runCurrent(body,state,helpers,render),"z3h3-story-btn run","Preflight locally, then queue one render with the current Creator state"));toolbar.append(leftTools,rightTools);content.append(toolbar);
  renderShotReadout(body,state,content,helpers,render);renderSourceShelf(body,state,content,helpers,render);
  const timelineWidth=Math.max(820,total*state.zoom),scroll=el("div","z3h3-story-scroll"),inner=el("div","z3h3-story-lanes");scroll.append(inner);content.append(scroll);
  scroll.addEventListener("scroll",()=>{state.scrollLeft=scroll.scrollLeft;state.scrollTop=scroll.scrollTop;helpers.savePrefs?.(state);},{passive:true});
  (globalThis.requestAnimationFrame||((fn)=>setTimeout(fn,0)))(()=>{scroll.scrollLeft=Math.max(0,Number(state.scrollLeft)||0);scroll.scrollTop=Math.max(0,Number(state.scrollTop)||0);});
  // Ruler
  const ruler=el("div","z3h3-story-lane ruler"),rLabel=el("div","z3h3-story-lane-label");rLabel.append(el("b",null,"Time"),el("small",null,`${total.toFixed(2)} sec total · click to set playhead`));const rCanvas=el("div","z3h3-story-ruler");rCanvas.style.width=`${timelineWidth}px`;renderRuler(rCanvas,total,state.zoom);ruler.append(rLabel,rCanvas);inner.append(ruler);
  const setPlayheadFromEvent=(event)=>{const rect=rCanvas.getBoundingClientRect(),next=snapTime(clamp((event.clientX-rect.left)/state.zoom,0,total),state);state.playhead=clamp(next,0,total);const hit=segmentAtTime(body.data.segments,state.playhead);state.index=hit.index;body.switchTarget?.(hit.index);render();};
  rCanvas.addEventListener("pointerdown",event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();setPlayheadFromEvent(event);});
  const canvases={};for(const spec of TRACKS){if(spec.id!=="shots"&&state.trackVisibility[spec.id]===false)continue;canvases[spec.id]=makeLane(spec.label,spec.hint,spec.id,timelineWidth,inner,state,body,helpers,render);}
  const playhead=(canvas)=>{const line=el("i","z3h3-story-playhead");line.style.left=`${state.playhead*state.zoom}px`;line.title=`Playhead ${state.playhead.toFixed(2)}s`;canvas.append(line);};playhead(rCanvas);for(const canvas of Object.values(canvases))playhead(canvas);
  const starts=segmentStarts(body.data.segments);
  // Shot blocks
  body.data.segments.forEach((seg,index)=>{const geo=starts[index],mode=helpers.inferMode(body,index),block=el("div",`z3h3-story-shot-block${state.index===index?" active":""}${seg.kind==="clip"?" clip":""}`);block.style.left=`${geo.start*state.zoom}px`;block.style.width=`${Math.max(70,geo.duration*state.zoom)}px`;block.style.setProperty("--story-tone",MODE_TONE[mode]||MODE_TONE.T2VA);block.dataset.index=String(index);const top=el("div","z3h3-story-shot-top"),copy=el("div");copy.append(el("b",null,seg.kind==="clip"?`Clip ${index+1}`:`Shot ${index+1}`),el("small",null,`${fmt(geo.duration)} · ${mode}`));top.append(copy,el("span","z3h3-story-route",helpers.routeText(body,index)));const cast=el("div","z3h3-story-shot-cast");renderCast(body,index,cast,helpers);const p=el("div","z3h3-story-shot-copy",String(seg.prompt||seg.director_prompt||"Click to write this shot…").replace(/\s+/g," ").trim());block.append(top,cast,p);const right=el("i","z3h3-story-boundary right");block.append(right);if(index>0)block.append(el("i","z3h3-story-boundary left"));
    let shotDragged=false;
    block.addEventListener("pointerdown",event=>{
      if(event.button!==0||event.target?.classList?.contains("z3h3-story-boundary"))return;
      event.stopPropagation();const startX=event.clientX,startY=event.clientY,from=index;let dragging=false,targetIndex=index;
      const shotCanvas=canvases.shots;
      const move=moveEvent=>{
        const dx=moveEvent.clientX-startX,dy=moveEvent.clientY-startY;
        if(!dragging&&Math.hypot(dx,dy)<5)return;
        dragging=true;shotDragged=true;moveEvent.preventDefault();block.classList.add("dragging");block.style.transform=`translateX(${dx}px)`;block.style.zIndex="20";
        const rect=shotCanvas.getBoundingClientRect(),global=clamp((moveEvent.clientX-rect.left)/state.zoom,0,Math.max(0,total-.001)),hit=segmentAtTime(body.data.segments,global);targetIndex=hit.index;
        for(const candidate of shotCanvas.querySelectorAll(".z3h3-story-shot-block"))candidate.classList.toggle("reorder-target",Number(candidate.dataset.index)===targetIndex&&targetIndex!==from);
      };
      const up=upEvent=>{
        document.removeEventListener("pointermove",move,true);document.removeEventListener("pointerup",up,true);block.classList.remove("dragging");block.style.transform="";block.style.zIndex="";for(const candidate of shotCanvas.querySelectorAll(".z3h3-story-shot-block"))candidate.classList.remove("reorder-target");
        if(dragging&&targetIndex!==from){const [moved]=body.data.segments.splice(from,1);const target=targetIndex;body.data.segments.splice(Math.max(0,target),0,moved);state.index=Math.max(0,target);body.target=state.index;body.commitData?.(true,{historyLabel:"Reorder storyboard shot"});body.syncPrompt?.(false);render();return;}
        if(!dragging){state.index=index;state.playhead=geo.start;body.switchTarget?.(index);render();}
        setTimeout(()=>{shotDragged=false;},0);
      };
      document.addEventListener("pointermove",move,true);document.addEventListener("pointerup",up,true);
    });
    block.addEventListener("click",event=>{if(shotDragged){event.preventDefault();event.stopPropagation();}});
    block.addEventListener("dblclick",event=>{event.preventDefault();event.stopPropagation();state.index=index;state.playhead=geo.start;body.switchTarget?.(index);render();setTimeout(()=>document.querySelector('.z3h3-story-shot-prompt')?.focus(),0);});
    const resizeBoundary=(side,e)=>{const startX=e.clientX,origCur=geo.duration,prev=index>0?starts[index-1].duration:0;pointerDrag(e,move=>{const delta=snapTime((move.clientX-startX)/state.zoom,state);if(side==="right"){const next=Math.max(.4,origCur+delta);seg.duration_s=next;block.style.width=`${Math.max(70,next*state.zoom)}px`;}else if(index>0){const pseg=body.data.segments[index-1],sum=prev+origCur,nextPrev=clamp(prev+delta,.4,sum-.4),nextCur=sum-nextPrev;pseg.duration_s=nextPrev;seg.duration_s=nextCur;}},()=>{body.commitData?.(true,{historyLabel:"Resize storyboard timing"});render();});};right.addEventListener("pointerdown",e=>resizeBoundary("right",e));block.querySelector(".z3h3-story-boundary.left")?.addEventListener("pointerdown",e=>resizeBoundary("left",e));canvases.shots.append(block);
    // Existing media on relevant lanes
    const assets=helpers.assetsForShot(body,index);for(const listed of assets){const asset=body.assetByHandle?.(listed.handle)||listed,rec=mediaRecord(seg,asset,helpers.directorFor),track=rec?.track||trackForAsset(asset);if(canvases[track])clipBlock(body,index,asset,canvases[track],state.zoom,helpers,state,render,listed._owner||"shot");}
    // Beats
    const director=helpers.directorFor(seg);for(const beat of director?.beats||[]){const x=(geo.start+clamp(beat.t,0,geo.duration))*state.zoom,mark=el("button",`z3h3-story-beat-mark type-${beat.type||"action"}`);mark.type="button";mark.style.left=`${x}px`;mark.append(el("b",null,String(beat.type||"action").replaceAll("_"," ")),el("span",null,String(beat.text||beat.lora||"cue").slice(0,54)));mark.title=`${fmt(beat.t)} · drag to retime · click to edit`;
      mark.addEventListener("pointerdown",event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();const startX=event.clientX,original=Number(beat.t)||0;let dragging=false;const move=moveEvent=>{const dx=moveEvent.clientX-startX;if(!dragging&&Math.abs(dx)<4)return;dragging=true;moveEvent.preventDefault();beat.t=clamp(snapTime(original+dx/state.zoom,state),0,geo.duration);mark.style.left=`${(geo.start+beat.t)*state.zoom}px`;mark.classList.add("dragging");};const up=()=>{document.removeEventListener("pointermove",move,true);document.removeEventListener("pointerup",up,true);mark.classList.remove("dragging");if(dragging){helpers.updateDirectorPrompt(body,index);body.checkpointHistory?.("Move storyboard beat");render();}else helpers.openBeatEditor(body,index,beat,render,beat.t);};document.addEventListener("pointermove",move,true);document.addEventListener("pointerup",up,true);});canvases.beats?.append(mark);}
    for(const [cameraOrder,point] of (director?.camera_points||[]).entries()){const x=(geo.start+clamp(point.t,0,geo.duration))*state.zoom,mark=el("button","z3h3-story-camera-mark",String(cameraOrder+1));mark.type="button";mark.style.left=`${x}px`;mark.title=`${fmt(point.t)} · ${point.framing||"camera"} · ${point.move||"steady"} · drag to retime · click to edit`;
      mark.addEventListener("pointerdown",event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();const startX=event.clientX,original=Number(point.t)||0;let dragging=false;const move=moveEvent=>{const dx=moveEvent.clientX-startX;if(!dragging&&Math.abs(dx)<4)return;dragging=true;moveEvent.preventDefault();point.t=clamp(snapTime(original+dx/state.zoom,state),0,geo.duration);mark.style.left=`${(geo.start+point.t)*state.zoom}px`;mark.classList.add("dragging");};const up=()=>{document.removeEventListener("pointermove",move,true);document.removeEventListener("pointerup",up,true);mark.classList.remove("dragging");if(dragging){helpers.saveDirectorCameraPoint?.(body,index,point,{historyLabel:"Move storyboard camera point"});render();}else{state.index=index;state.cameraPointId=point.id;helpers.openCameraPointEditor?.(body,index,point,render);}};document.addEventListener("pointermove",move,true);document.addEventListener("pointerup",up,true);});canvases.camera?.append(mark);}
  });
  // Global cut lines and lane double-click behavior
  for(const geo of starts){for(const id of Object.keys(canvases)){const line=el("i","z3h3-story-cut-line");line.style.left=`${geo.start*state.zoom}px`;canvases[id].append(line);}}
  canvases.beats?.addEventListener("dblclick",e=>{const rect=canvases.beats.getBoundingClientRect(),global=(e.clientX-rect.left)/state.zoom,hit=segmentAtTime(body.data.segments,global);state.index=hit.index;body.switchTarget?.(hit.index);helpers.openBeatEditor(body,hit.index,null,render,hit.local);});
  canvases.camera?.addEventListener("dblclick",e=>{const rect=canvases.camera.getBoundingClientRect(),global=(e.clientX-rect.left)/state.zoom,hit=segmentAtTime(body.data.segments,global);state.index=hit.index;body.switchTarget?.(hit.index);helpers.openCameraPointEditor?.(body,hit.index,{t:hit.local,x:.5,y:.5,framing:"medium shot",move:"holds steady",amplitude:"small",speed:"slow"},render);});
  if(state.inspector)shotInspector(body,state,content,helpers,render);
}
