import * as H from "./z3_h3_api.js";
import * as S from "./z3_h3_state.js";
import { H3_CATEGORY_META, H3_SCENE_SLOT_ORDER } from "./h3_prompt_categories.js";
import { sceneVariationDirection, castMentionRanges } from "./h3_prompt_tokens.js";

const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
const button=(text,fn,cls="z3h3-btn")=>{const node=el("button",cls,text);node.type="button";node.addEventListener("pointerdown",(event)=>event.stopPropagation());node.addEventListener("click",async(event)=>{event.stopPropagation();try{await fn?.(event);}catch(error){console.error("MiniMax Creator prompt action failed",error);node.dataset.error="1";node.title=error?.message||String(error);setTimeout(()=>delete node.dataset.error,1600);}});return node;};

async function copyText(text){const value=String(text||"");if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(value);return true;}catch{/* fallback below */}}const area=document.createElement("textarea");area.value=value;area.setAttribute("readonly","");area.style.position="absolute";area.style.left="-9999px";document.body.append(area);area.select();let ok=false;try{ok=document.execCommand?.("copy")===true;}catch{}area.remove();return ok;}

function coverage(body){
  const text=S.activePrompt(body.data,body.target),seg=body.target==="global"?body.data.segments?.[0]:body.data.segments?.[body.target],shared=body.data.scene_palette||{},own=body.target==="global"?{}:(body.data.segments?.[body.target]?.scene_palette||{}),scene={...shared,...own},has=(re)=>re.test(text);
  const castHandles=(body.data.subjects||[]).map((row)=>row?.handle).filter(Boolean),hasCast=castMentionRanges(text,castHandles).length>0;
  return [["cast","Cast",hasCast],["action","Action",!!scene.action||/\b(walk|run|turn|look|reach|pick|hold|open|close|sit|stand|move|enter|exit|smile|laugh|speak|say|says|gesture|dance|drive|lift|drop|push|pull|react)\b/i.test(text)],["camera","Camera",!!scene.camera||has(/\b(camera|shot|close[- ]?up|medium shot|wide shot|dolly|pan|tilt|tracking|handheld|tripod|lens|rack focus|zoom|over[- ]the[- ]shoulder)\b/i)],["lighting","Light",!!scene.lighting||has(/\b(light|lighting|sunlight|daylight|tungsten|fluorescent|neon|rim light|softbox|shadow|golden hour|moonlight)\b/i)],["dialogue","Dialogue",!!scene.dialogue||/[“"'][^“"']{2,}[”"']|\b(says|asks|replies|whispers|shouts|speaks)\b/i.test(text)],["ambience","Audio",!!scene.ambience||!!scene.music||!!String(seg?.soundscape||body.data.soundscape||"").trim()||!!String(seg?.music||body.data.music||"").trim()||has(/\b(sound|audio|ambience|music|foley|footsteps|room tone)\b/i)]];
}

function setFormatMode(body,mode){const on=mode==="h3";if((body.data?.h3_auto_format===true)===on)return;body.data.h3_auto_format=on;body.commitData(true,{historyLabel:`Use ${on?"H3 Format":"RAW"} output`});}
function formatSwitch(body){const wrap=el("div","z3h3-format-switch"),raw=button("RAW",()=>setFormatMode(body,"raw"),`z3h3-format-option${body.data?.h3_auto_format===true?"":" active"}`),h3=button("H3 FORMAT",()=>setFormatMode(body,"h3"),`z3h3-format-option${body.data?.h3_auto_format===true?" active":""}`);raw.setAttribute("aria-pressed",body.data?.h3_auto_format===true?"false":"true");h3.setAttribute("aria-pressed",body.data?.h3_auto_format===true?"true":"false");raw.title="Canonical authored RAW source stays untouched; send resolved source order to H3.";h3.title="Transform the runtime RAW copy into structured H3 Context-IR. Authored RAW is never overwritten.";wrap.append(raw,h3);return wrap;}

const PIPELINE_LABELS={authored_raw:"Authored RAW",semantic_variation_selection:"Cast/Scene variation · auditions · +/− selection",category_record_resolution:"Category full-prompt selection",wildcard_resolution:"Wildcard resolution",optional_h3_format:"Optional H3 format",compiler_semantic_resolution:"Semantic tokens · Cast · reference compiler resolution"};
function generationPasses(result,mode){return (result?.[mode]?.passes||[]).filter((pass)=>pass?.kind!=="clip");}
function passText(result,mode,index){return String(generationPasses(result,mode)[index]?.prompt||"");}

async function renderResolvedPanel(body,panel){
  panel.replaceChildren();const loading=el("div","z3h3-resolved-loading","Resolving through the exact queue compiler…");panel.append(loading);
  try{
    const result=await H.promptPreview(S.normalizeData(structuredClone(body.data)),Number(body.widgets?.seed?.value||0),String(body.widgets?.processing_mode?.value||"entire text as one"),Number(body.currentVariationIndex?.()??body.widgets?.variation_index?.value??0));
    if(!panel.isConnected)return;
    const rawPasses=generationPasses(result,"raw"),h3Passes=generationPasses(result,"h3"),count=Math.max(rawPasses.length,h3Passes.length,1);let passIndex=Math.min(Number(body._resolvedOutputPass)||0,count-1),view=String(body._resolvedOutputView||"active");
    const draw=()=>{
      body._resolvedOutputPass=passIndex;body._resolvedOutputView=view;panel.replaceChildren();
      const head=el("div","z3h3-resolved-head"),copy=el("div","z3h3-resolved-title");copy.append(el("b",null,"Resolved Output"),el("small",null,"Exact compiler preview · RAW source is never rewritten"));const close=button("×",()=>{body._resolvedOutputOpen=false;const parent=panel.parentElement;if(parent?.classList?.contains("z3h3-guidebar"))renderPromptGuide(body,parent);else panel.remove();},"z3h3-resolved-close");head.append(copy,close);panel.append(head);
      const pipeline=el("div","z3h3-resolved-pipeline");for(const stage of result.resolution_order||[]){pipeline.append(el("span",null,PIPELINE_LABELS[stage]||String(stage).replaceAll("_"," ")));}panel.append(pipeline);
      if(count>1){const passes=el("div","z3h3-resolved-pass-tabs");for(let i=0;i<count;i++){const tab=button(`Pass ${i+1}`,()=>{passIndex=i;draw();},`z3h3-resolved-tab${i===passIndex?" active":""}`);passes.append(tab);}panel.append(passes);}
      const tabs=el("div","z3h3-resolved-view-tabs");const modes=[["source","AUTHORED RAW"],["raw","RESOLVED RAW"],["h3","RESOLVED H3"]];const activeView=view==="active"?(result.active_mode==="h3"?"h3":"raw"):view;for(const [id,label] of modes){tabs.append(button(label,()=>{view=id;draw();},`z3h3-resolved-tab${activeView===id?" active":""}`));}panel.append(tabs);
      const authored=String(S.activePrompt(body.data,body.target)||""),text=activeView==="source"?authored:passText(result,activeView,passIndex),pre=el("pre","z3h3-resolved-pre",text||"(empty)");panel.append(pre);
      const foot=el("div","z3h3-resolved-foot");const status=activeView==="source"?"Canonical editor source — saved exactly as authored.":activeView==="raw"?"Exact resolved RAW compiler prompt. Categories, Cast, wildcards, auditions and +/- have already resolved.":"Exact resolved H3 compiler prompt after the optional H3 transformation.";foot.append(el("span",null,status));if(activeView!=="source"&&result.wildcards?.length)foot.append(el("span",null,`Wildcards: ${result.wildcards.join(", ")}`));const copyButton=button("Copy",async()=>{const ok=await copyText(text);copyButton.textContent=ok?"✓":"Copy";setTimeout(()=>copyButton.textContent="Copy",1000);},"z3h3-mini");foot.append(copyButton);panel.append(foot);
    };draw();
  }catch(error){panel.replaceChildren(el("div","z3h3-error",error.message||String(error)));}
}

export function renderPromptGuide(body,host){
  if(!host)return;host.replaceChildren();const autoFormat=body.data?.h3_auto_format===true,source=S.activePrompt(body.data,body.target),varying=H3_SCENE_SLOT_ORDER.filter((slot)=>sceneVariationDirection(source,slot)),container=S.activeContainer(body.data,body.target)||{},auditionRoles=Object.entries(container.cast_auditions||{}).filter(([,config])=>Array.isArray(config?.candidates)&&config.candidates.length).map(([role])=>role),sceneAuditionSlots=Object.entries(container.scene_auditions||{}).filter(([,config])=>Array.isArray(config?.candidates)&&config.candidates.length).map(([slot])=>slot),sceneVarying=[...new Set([...varying,...sceneAuditionSlots])],castMarkers=castMentionRanges(source,(body.data.subjects||[]).map((row)=>row?.handle).filter(Boolean)).filter((row)=>row.direction!==0).map((row)=>row.handle),castVarying=[...new Set([...auditionRoles,...castMarkers])],variationLabels=[...sceneVarying.map((slot)=>slot.toUpperCase()),...castVarying.map((role)=>`CAST @${role}`)];
  const copy=el("div","z3h3-guide-copy");copy.append(el("b",null,autoFormat?"H3 FORMAT · runtime transformation of RAW":"RAW · canonical authored source"),el("small",null,variationLabels.length?`Batch variation: ${variationLabels.join(", ")} · source remains untouched.`:autoFormat?"Categories, Cast and wildcards resolve first; the runtime copy is then structured for H3.":"Categories, Cast, wildcards and batch choices resolve without reordering your authored source."));
  const chips=el("div","z3h3-guide-chips");for(const [kind,label,on] of coverage(body)){const chip=el("span",`z3h3-guide-chip tone-${kind}${on?" on":""}`,`${on?"✓":"○"} ${label}`);chip.style.setProperty("--guide-tone",H3_CATEGORY_META[kind]?.color||H3_CATEGORY_META.guide.color);chips.append(chip);}if(variationLabels.length){const step=body.currentVariationIndex?.()??Number(body.widgets?.variation_index?.value||0),chip=button(`↕ VAR ${step+1}`,()=>{body.resetVariationIndex?.();},"z3h3-guide-chip on");chip.style.setProperty("--guide-tone",H3_CATEGORY_META.builder.color);chip.title=`${variationLabels.length} scene/cast variation target${variationLabels.length===1?"":"s"}. Click to restart from the authored base.`;chips.append(chip);}
  const resolved=button(`${body._resolvedOutputOpen?"▾":"▸"} Resolved Output`,()=>{body._resolvedOutputOpen=!body._resolvedOutputOpen;renderPromptGuide(body,host);},"z3h3-mini z3h3-resolved-toggle");resolved.title="Compare canonical RAW, exact resolved RAW, and exact resolved H3 output from the same queue pipeline.";
  host.append(formatSwitch(body),copy,chips,resolved);
  if(body._resolvedOutputOpen){const panel=el("div","z3h3-resolved-panel");host.append(panel);renderResolvedPanel(body,panel);}
}

export async function openCompiledPrompt(body){
  const back=el("div","z3h3-backdrop"),box=el("div","z3h3-modal wide"),head=el("div","z3h3-modal-head"),content=el("div","z3h3-modal-body"),close=button("Close",()=>back.remove());head.append(el("div",null,"Exact Prompt Resolution Inspector"),el("div","z3h3-spacer"),close);box.append(head,content);back.append(box);document.body.append(back);back.addEventListener("mousedown",(event)=>{if(event.target===back)back.remove();});
  content.append(el("div","z3h3-guide-explainer","RAW is the canonical authored source. The two resolved views below are compiled from one immutable variation/library snapshot using the same pipeline as Queue."));
  const panel=el("div","z3h3-resolved-panel modal");content.append(panel);await renderResolvedPanel(body,panel);
}
