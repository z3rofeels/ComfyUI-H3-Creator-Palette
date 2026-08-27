import * as H from "./z3_h3_api.js";
import * as S from "./z3_h3_state.js";

const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
const button=(text,fn,cls="z3h3-btn")=>{const node=el("button",cls,text);node.type="button";node.addEventListener("pointerdown",e=>e.stopPropagation());node.addEventListener("click",async e=>{e.preventDefault();e.stopPropagation();await fn?.(e);});return node;};
const fmt=(seconds)=>{const n=Math.max(0,Number(seconds)||0);return `${n.toFixed(n%1?2:1)}s`;};
const clean=(value)=>String(value??"").replace(/\s+/g," ").trim();

const CUE_RE=/\bAt\s+(?:(\d{1,3}):(\d{2}(?:\.\d{1,3})?)|(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds))\b\s*[,;:\-–—]?\s*/ig;
const LORA_RE=/\*([+-]?)(?:\{([^{}]+)\}|([A-Za-z0-9_./\\-]+))/g;
const QUOTE_RE=/["“]([^"”]+)["”]/g;

function cueSeconds(match){return match[3]!=null?Number(match[3]):Number(match[1])*60+Number(match[2]);}
function loraDirectives(text){const out=[];String(text||"").replace(LORA_RE,(_m,op,braced,plain)=>{out.push({name:(braced||plain||"").trim(),enabled:op!=="-"});return "";});return out;}
function stripLoras(text){return clean(String(text||"").replace(LORA_RE,""));}
function words(text){return clean(text).split(/\s+/).filter(Boolean).length;}
function speechSeconds(text){
  let seconds=0,match;QUOTE_RE.lastIndex=0;
  while((match=QUOTE_RE.exec(String(text||"")))){
    const phrase=match[1],count=words(phrase);seconds+=count/2.55;
    seconds+=(phrase.match(/[,;:]/g)||[]).length*.14+(phrase.match(/[.!?]/g)||[]).length*.24+(phrase.match(/…|\.\.\./g)||[]).length*.35;
  }
  return seconds;
}
function sentenceParts(text){
  const source=clean(text);if(!source)return [];
  const pieces=source.match(/[^.!?]+(?:[.!?]+|$)/g)||[source];return pieces.map(clean).filter(Boolean);
}
function weightedSeconds(text){
  const speech=speechSeconds(text),nonSpeech=String(text||"").replace(QUOTE_RE," "),actionWords=words(nonSpeech);
  return Math.max(.35,speech+Math.max(.25,actionWords/7.5));
}
function explicitBeats(text,duration){
  const source=String(text||""),matches=[...source.matchAll(CUE_RE)];if(!matches.length)return null;
  const beats=[];const firstAt=cueSeconds(matches[0]);const preamble=source.slice(0,matches[0].index).trim();
  if(preamble)beats.push({start:0,end:Math.min(duration,firstAt),text:preamble,loras:[]});
  for(let i=0;i<matches.length;i++){
    const start=cueSeconds(matches[i]),end=i+1<matches.length?cueSeconds(matches[i+1]):duration,raw=source.slice(matches[i].index+matches[i][0].length,i+1<matches.length?matches[i+1].index:source.length).trim();
    beats.push({start,end:Math.min(duration,end),text:stripLoras(raw),loras:loraDirectives(raw)});
  }
  return beats.filter(beat=>beat.end>beat.start);
}
function estimatedBeats(text,duration){
  const explicit=explicitBeats(text,duration);if(explicit)return explicit;
  const parts=sentenceParts(text);if(!parts.length)return [];
  const weights=parts.map(weightedSeconds),total=weights.reduce((a,b)=>a+b,0)||1;let at=0;
  return parts.map((part,index)=>{const remaining=duration-at;const slice=index===parts.length-1?remaining:duration*(weights[index]/total);const beat={start:at,end:Math.min(duration,at+slice),text:part,loras:loraDirectives(part)};at=beat.end;return beat;});
}
function activeSource(body){
  if(body.target==="global")return String(body.data.prompt||"");
  const shot=body.data.segments?.[body.target]||{};return [String(body.data.prompt||""),String(shot.prompt||"")].filter(Boolean).join("\n\n");
}
function activeDuration(body){
  if(body.target==="global")return (body.data.segments||[]).reduce((sum,seg)=>sum+Number(seg?.duration_s||0),0)||S.DEFAULT_DURATION_S;
  return Number(body.data.segments?.[body.target]?.duration_s||S.DEFAULT_DURATION_S);
}
function pieceBeats(body){
  const shared=String(body.data.prompt||""),segments=body.data.segments||[];let offset=0;const beats=[];
  segments.forEach((segment,index)=>{
    const duration=Number(segment?.duration_s||S.DEFAULT_DURATION_S);
    if(segment?.kind==="clip"){
      beats.push({start:offset,end:offset+duration,text:`Supplied clip · ${String(segment.filename||"footage").split(/[\\/]/).pop()}`,loras:[],shot:index+1,kind:"clip"});offset+=duration;return;
    }
    const source=[shared,String(segment?.prompt||"")].filter(Boolean).join("\n\n"),local=estimatedBeats(source,duration);
    if(local.length){for(const beat of local)beats.push({...beat,start:beat.start+offset,end:beat.end+offset,shot:index+1,kind:"generation"});}
    else beats.push({start:offset,end:offset+duration,text:`Shot ${index+1}`,loras:[],shot:index+1,kind:"generation"});
    offset+=duration;
  });
  return {duration:offset||S.DEFAULT_DURATION_S,beats};
}
function routeLabel(pass){return `${String(pass.checkpoint||"").toUpperCase()} · ${pass.mode||"H3"} · ${pass.final_width||pass.width}×${pass.final_height||pass.height}`;}

export function timingSummary(body){
  let duration,beats;
  if(body.target==="global")({duration,beats}=pieceBeats(body));
  else{duration=activeDuration(body);beats=estimatedBeats(activeSource(body),duration).map((beat)=>({...beat,shot:Number(body.target)+1,kind:"generation"}));}
  const speech=beats.reduce((sum,beat)=>sum+speechSeconds(beat.text),0),timedLoras=beats.flatMap(beat=>beat.loras||[]);
  return {duration,beats,speech,timedLoras};
}

export function openTimingInspector(body){
  const back=el("div","z3h3-backdrop"),box=el("div","z3h3-modal wide z3h3-timing-modal"),head=el("div","z3h3-modal-head"),content=el("div","z3h3-modal-body"),close=button("Close",()=>back.remove());
  const title=body.target==="global"?"Resolve + Timing · whole piece":`Resolve + Timing · Shot ${Number(body.target)+1}`;head.append(el("div",null,title),el("div","z3h3-spacer"),close);box.append(head,content);back.append(box);document.body.append(back);back.addEventListener("mousedown",e=>{if(e.target===back)back.remove();});
  const summary=timingSummary(body),intro=el("div","z3h3-timing-intro");intro.append(el("b",null,`${fmt(summary.duration)} authored duration`),el("small",null,`${summary.beats.length} estimated beat${summary.beats.length===1?"":"s"} · ${fmt(summary.speech)} estimated spoken dialogue${summary.timedLoras.length?` · ${summary.timedLoras.length} timed LoRA cue${summary.timedLoras.length===1?"":"s"}`:""}`));content.append(intro);
  const note=el("div","z3h3-note","Timing is an authoring estimate, not a promise that generated motion lands to the millisecond. Explicit “At 4 sec …” cues are honored as fixed boundaries. Quoted speech uses a natural speaking-rate estimate. Timed *LoRA cues are different: Creator compiles them into real chained passes so the adapter state actually changes at that boundary.");content.append(note);
  const timeline=el("div","z3h3-timing-list");
  for(const beat of summary.beats){const row=el("article",`z3h3-timing-beat${beat.kind==="clip"?" clip":""}`),time=el("div","z3h3-timing-time",`${fmt(beat.start)} → ${fmt(beat.end)}`),copy=el("div","z3h3-timing-copy"),meta=el("div","z3h3-timing-meta");const heading=el("div","z3h3-timing-beat-head");if(body.target==="global")heading.append(el("span","z3h3-timing-shot",beat.kind==="clip"?`CLIP ${beat.shot}`:`SHOT ${beat.shot}`));heading.append(el("b",null,beat.text||"(timing cue)"));copy.append(heading);const speak=beat.kind==="clip"?0:speechSeconds(beat.text),window=Math.max(0,beat.end-beat.start);meta.append(el("span",null,`${fmt(window)} window`));if(speak>.05)meta.append(el("span",speak>window?"timing-warn":"",`speech ≈ ${fmt(speak)}${speak>window?" · exceeds window":""}`));for(const lora of beat.loras||[])meta.append(el("span","timed-lora",`${lora.enabled?"LoRA on":"LoRA off"} · ${lora.name}`));copy.append(meta);row.append(time,copy);timeline.append(row);}content.append(timeline);
  const passes=el("section","z3h3-timing-passes");passes.append(el("h3",null,"Exact backend render plan"),el("div","z3h3-progress"));passes.lastChild.append(el("i"));content.append(passes);
  const seed=Number(body.widgets?.seed?.value);const safeSeed=Number.isFinite(seed)&&seed>=0?Math.trunc(seed):0;
  H.promptPreview(S.normalizeData(structuredClone(body.data)),safeSeed,String(body.widgets?.processing_mode?.value||"entire text as one"),body.currentVariationIndex?.()||0).then(result=>{
    passes.replaceChildren(el("h3",null,"Exact backend render plan"));const list=el("div","z3h3-render-pass-list");let at=0;
    for(const pass of result.passes||[]){const sec=Number(pass?.seconds||0);if(pass?.kind==="clip"){const row=el("div","z3h3-render-pass-row clip"),copy=el("div"),name=String(pass.clip?.filename||"Supplied clip").split(/[\/]/).pop();copy.append(el("b",null,`Clip ${Number(pass.index)+1} · ${fmt(at)} → ${fmt(at+sec)}`),el("small",null,`${name} · supplied footage`));row.append(copy,el("span","z3h3-route",`${Number(pass.frames||0)}f`));list.append(row);at+=sec;continue;}if(pass?.kind!=="generation")continue;const row=el("div","z3h3-render-pass-row"),copy=el("div"),details=[routeLabel(pass)];if(pass.timed_from_shot)details.push(`timed split from Shot ${pass.timed_from_shot}${pass.timed_at_s!=null?` @ ${fmt(pass.timed_at_s)}`:""}`);if((pass.loras||[]).length)details.push(`LoRAs: ${(pass.loras||[]).map(row=>`${String(row.name||"").split(/[\/]/).pop()} ${Number(row.strength??1).toFixed(2)}`).join(", ")}`);copy.append(el("b",null,`Pass ${Number(pass.index)+1} · ${fmt(at)} → ${fmt(at+sec)}`),el("small",null,details.join(" · ")));row.append(copy,el("span","z3h3-route",`${Number(pass.frames||0)}f`));list.append(row);at+=sec;}if(!list.children.length)list.append(el("div","z3h3-note","No render passes in the current selection."));passes.append(list);
  }).catch(error=>{passes.replaceChildren(el("h3",null,"Exact backend render plan"),el("div","z3h3-error",error.message||String(error)));});
  return back;
}
