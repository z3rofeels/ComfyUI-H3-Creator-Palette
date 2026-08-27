import * as S from "./z3_h3_state.js";
import { H3_SCENE_SLOT_ORDER, categoryMeta } from "./h3_prompt_categories.js";
import { sceneSelectionFor } from "./h3_scene_state.js";
import { subjectDisplayName, createSubjectAvatar } from "./h3_cast_studio.js";
import { stripSceneTokens, castVariationDirection } from "./h3_prompt_tokens.js";
import { promptThumbnailSvg } from "./prompt_library.js";
import { openCastStudio } from "./h3_cast_studio.js";
import { auditionFor } from "./h3_cast_auditions.js";
import { sceneAuditionFor } from "./h3_scene_auditions.js";
import { openSceneSlotMenu, openCastRoleMenu, openAssetReferenceMenu } from "./h3_quick_actions.js";
import { openTimingInspector, timingSummary } from "./h3_timing_inspector.js";

const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
const escRe=(value)=>String(value??"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const clean=(value)=>String(value??"").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();

function button(text,fn,cls="z3h3-composer-btn",title=""){
  const node=el("button",cls,text);node.type="button";if(title)node.title=title;
  node.addEventListener("pointerdown",(event)=>event.stopPropagation());
  node.addEventListener("click",async(event)=>{event.preventDefault();event.stopPropagation();try{await fn?.(event);}catch(error){console.error("MiniMax Prompt Composer action failed",error);node.dataset.error="1";node.title=error?.message||String(error);setTimeout(()=>delete node.dataset.error,1600);}});return node;
}

function effectivePrompt(body){
  let global=String(body?.data?.prompt||"");
  if(body?.target==="global")return global;
  const shotContainer=body?.data?.segments?.[body.target]||{};
  const shared=body?.data?.scene_palette||{},own=shotContainer.scene_palette||{};
  for(const slot of Object.keys(own)){const chunk=shared?.[slot]?.prompt;if(chunk)global=global.split(String(chunk)).join(" ");}
  const shot=String(shotContainer.prompt||"");
  return clean([clean(global),shot].filter(Boolean).join("\n\n"));
}
function targetPrompt(body){return S.activePrompt(body.data,body.target);}
function targetSelections(body){return S.activeContainer(body.data,body.target)?.scene_palette||{};}
function effectiveSelection(body,slot){
  const own=sceneSelectionFor(targetSelections(body),slot);if(own)return {preset:own,scope:body.target==="global"?"Shared":"Shot",own:true};
  if(body.target!=="global"){
    const shared=sceneSelectionFor(body.data.scene_palette,slot);if(shared)return {preset:shared,scope:"Shared",own:false};
  }
  return null;
}
function mentioned(text,handle){return new RegExp(`@${escRe(handle)}(?!-[0-9])(?![A-Za-z0-9_])`).test(text);}
function effectiveAssets(body){return S.allAssets(body.data,body.target).filter((asset)=>asset?.handle);}
function effectiveLoras(body){
  const rows=[];
  for(const lora of body.data.loras||[])if(lora.enabled!==false)rows.push({...lora,_scope:"Shared"});
  if(body.target!=="global")for(const lora of body.data.segments?.[body.target]?.loras||[])if(lora.enabled!==false)rows.push({...lora,_scope:"Shot"});
  const map=new Map();for(const row of rows)map.set(`${row.name}|${(row.modes||[]).join(",")}`,row);return [...map.values()];
}
function castMarker(body,handle){
  return castVariationDirection(String(S.activePrompt(body.data,body.target)||""),handle);
}
function sceneThumb(body,slot,preset){
  const customUrl=body.thumbnailUrl?.(body.sceneThumbnail?.(slot,preset)||preset?.thumbnail)||body.thumbnailUrl?.(preset?.thumbnail_handle)||"";
  if(customUrl){
    const wrap=el("div","z3h3-scene-chip-visual custom");wrap.style.backgroundImage=`url("${String(customUrl).replaceAll('"','%22')}")`;return wrap;
  }
  const wrap=el("div","z3h3-scene-chip-visual");wrap.innerHTML=promptThumbnailSvg({id:preset?.id||slot,title:preset?.title||categoryMeta(slot).title,visual:preset?.visual||slot,accent:categoryMeta(slot).color,compact:true});return wrap;
}
function mediaThumb(body,asset){
  const wrap=el("div",`z3h3-scene-chip-visual media ${asset.kind||""}`),url=body.assetPreviewUrl?.(asset)||"";
  if(url)wrap.style.backgroundImage=`url("${String(url).replaceAll('"','%22')}")`;else wrap.textContent=asset.kind==="audio"?"♪":asset.kind==="video"?"▶":"▧";
  return wrap;
}
function statusPill(label,cls=""){
  const pill=el("span",`z3h3-chip-status ${cls}`.trim(),label);return pill;
}

export function buildPromptComposerModel(body){
  const prompt=effectivePrompt(body),active=targetPrompt(body),parts=[];
  const cast=(body.data.subjects||[]).filter((subject)=>subject?.handle&&mentioned(prompt,subject.handle));
  for(const subject of cast)parts.push({kind:"cast",title:subjectDisplayName(subject),detail:`@${subject.handle}`,subject,scope:mentioned(active,subject.handle)?(body.target==="global"?"Shared":"Shot"):"Shared"});
  for(const slot of H3_SCENE_SLOT_ORDER){const hit=effectiveSelection(body,slot);if(hit)parts.push({kind:slot,title:hit.preset.title||categoryMeta(slot).title,detail:hit.preset.prompt,preset:hit.preset,scope:hit.scope,own:hit.own});}
  for(const asset of effectiveAssets(body)){
    if(!mentioned(prompt,asset.handle)&&asset.role==="reference")continue;
    parts.push({kind:"media",title:`@${asset.handle}`,detail:asset.filename||asset.path||asset.kind,asset,scope:(body.data.assets||[]).includes(asset)?"Shared":"Shot"});
  }
  for(const lora of effectiveLoras(body))parts.push({kind:"lora",title:String(lora.name||"LoRA").split(/[\\/]/).pop(),detail:`${Number(lora.strength??1).toFixed(2)} · ${(lora.modes||[]).join(" + ")||"auto"}`,lora,scope:lora._scope||"Shared"});

  let residual=String(active||"");
  for(const slot of H3_SCENE_SLOT_ORDER){const own=sceneSelectionFor(targetSelections(body),slot);if(own?.prompt)residual=residual.split(own.prompt).join(" ");}
  for(const subject of body.data.subjects||[]){if(subject?.handle)residual=residual.replace(new RegExp(`@${escRe(subject.handle)}(?!-[0-9])(?![A-Za-z0-9_])`,"g")," ");}
  for(const asset of S.activeAssetList(body.data,body.target)||[]){if(asset?.handle)residual=residual.replace(new RegExp(`@${escRe(asset.handle)}(?![A-Za-z0-9_-])`,"g")," ");}
  residual=stripSceneTokens(clean(residual.replace(/[ \t]{2,}/g," ").replace(/\n[ \t]+/g,"\n")));
  const seg=body.target==="global"?null:body.data.segments?.[body.target];
  const duration=seg?Number(seg.duration_s||S.DEFAULT_DURATION_S):null;
  return {parts,residual,prompt,active,duration,frames:seg?S.durationFrames(duration):null};
}

function renderSceneSummary(body,shell){
  const clip=body.target!=="global"&&body.data.segments?.[body.target]?.kind==="clip";
  if(clip)return;
  const model=buildPromptComposerModel(body),strip=el("div","z3h3-composer-scene-strip"),head=el("div","z3h3-composer-scene-head"),count=model.parts.length+(model.residual?1:0);
  head.append(el("b",null,"Current scene at a glance"),el("small",null,count?`${count} active piece${count===1?"":"s"} · right-click any chip for quick actions`:`No structured scene pieces yet — click colored words in the editor or use the sidebar / Library`));
  strip.append(head);
  const timing=timingSummary(body),timingBar=el("div","z3h3-inline-timing");
  timingBar.append(el("span",null,`${timing.duration.toFixed(timing.duration%1?2:1)}s`),el("span",null,`${timing.beats.length} beat${timing.beats.length===1?"":"s"}`));
  if(timing.speech>.05)timingBar.append(el("span",null,`speech ≈ ${timing.speech.toFixed(2)}s`));
  if(timing.timedLoras.length)timingBar.append(el("span","timed-lora",`${timing.timedLoras.length} timed LoRA cue${timing.timedLoras.length===1?"":"s"}`));
  timingBar.append(button("Inspect timing",()=>openTimingInspector(body),"z3h3-inline-timing-btn","Show estimated beats and exact backend pass boundaries"));strip.append(timingBar);
  const chips=el("div","z3h3-scene-chip-grid");
  for(const part of model.parts){
    if(part.kind==="cast"){
      const chip=el("button",`z3h3-scene-chip tone-cast`);chip.type="button";chip.style.setProperty("--chip-tone",categoryMeta("cast").color);
      chip.append(createSubjectAvatar(body,part.subject),el("div","z3h3-scene-chip-copy"));
      const copy=chip.lastChild,metaRow=el("div","z3h3-scene-chip-meta");{const marker=castMarker(body,part.subject.handle),shortlist=auditionFor(body,part.subject.handle);metaRow.append(statusPill(part.scope),statusPill(marker>0?"ALL +":marker<0?"ALL −":shortlist?.candidates?.length?`Shortlist ${shortlist.direction<0?"−":"+"} · ${shortlist.candidates.length}`:"Fixed",marker||shortlist?.candidates?.length?"vary":"fixed"));}
      copy.append(el("small",null,"CAST"),el("b",null,part.title),metaRow);
      chip.title=`${part.title} · ${part.detail}`;
      chip.addEventListener("pointerdown",(event)=>event.stopPropagation());
      chip.addEventListener("click",(event)=>{event.preventDefault();event.stopPropagation();openCastStudio(body,{swap:part.subject.handle});});
      chip.addEventListener("contextmenu",(event)=>openCastRoleMenu(body,event,part.subject.handle));
      chips.append(chip);continue;
    }
    if(H3_SCENE_SLOT_ORDER.includes(part.kind)){
      const meta=categoryMeta(part.kind),chip=el("button",`z3h3-scene-chip tone-${part.kind}`);chip.type="button";chip.style.setProperty("--chip-tone",meta.color);
      chip.append(sceneThumb(body,part.kind,part.preset),el("div","z3h3-scene-chip-copy"));
      const variation=body.sceneVariation?.(part.kind)||0,sceneAudition=sceneAuditionFor(body,part.kind),metaRow=el("div","z3h3-scene-chip-meta");
      metaRow.append(statusPill(part.scope),statusPill(variation>0?"ALL +":variation<0?"ALL −":sceneAudition?.candidates?.length?`Shortlist ${sceneAudition.direction<0?"−":"+"} · ${sceneAudition.candidates.length}`:"Fixed",variation||sceneAudition?.candidates?.length?"vary":"fixed"));
      chip.lastChild.append(el("small",null,meta.label),el("b",null,part.title),metaRow);
      chip.title=part.detail||part.title;
      chip.addEventListener("pointerdown",(event)=>event.stopPropagation());
      chip.addEventListener("click",(event)=>{event.preventDefault();event.stopPropagation();body.openScenePicker?.(part.kind);});
      chip.addEventListener("contextmenu",(event)=>openSceneSlotMenu(body,event,part.kind));
      chips.append(chip);continue;
    }
    if(part.kind==="media"){
      const chip=el("button",`z3h3-scene-chip tone-media`);chip.type="button";chip.style.setProperty("--chip-tone",categoryMeta("media").color);
      chip.append(mediaThumb(body,part.asset),el("div","z3h3-scene-chip-copy"));
      chip.lastChild.append(el("small",null,"MEDIA"),el("b",null,part.title),el("div","z3h3-scene-chip-meta"));
      chip.lastChild.lastChild.append(statusPill(part.scope),statusPill(String(part.asset.role||"reference").replace(/_/g," ")));
      chip.title=part.detail||part.title;
      chip.addEventListener("pointerdown",(event)=>event.stopPropagation());
      chip.addEventListener("click",(event)=>{event.preventDefault();event.stopPropagation();body.openAsset?.(part.asset);});
      chip.addEventListener("contextmenu",(event)=>openAssetReferenceMenu(body,event,part.asset));
      chips.append(chip);continue;
    }
    if(part.kind==="lora"){
      const chip=el("button",`z3h3-scene-chip tone-lora`);chip.type="button";chip.style.setProperty("--chip-tone",categoryMeta("lora").color);
      const visual=el("div","z3h3-scene-chip-visual lora");visual.textContent="LoRA";chip.append(visual,el("div","z3h3-scene-chip-copy"));
      chip.lastChild.append(el("small",null,categoryMeta("lora").label),el("b",null,part.title),el("div","z3h3-scene-chip-meta"));
      chip.lastChild.lastChild.append(statusPill(part.scope),statusPill(part.detail));
      chip.title=`${part.title} · ${part.detail}`;
      chip.addEventListener("pointerdown",(event)=>event.stopPropagation());
      chip.addEventListener("click",(event)=>{event.preventDefault();event.stopPropagation();body.openLoras?.();});
      chip.addEventListener("contextmenu",(event)=>{event.preventDefault();event.stopPropagation();body.openTimedLoraCue?.(part.lora);});
      chip.title+=` · right-click to insert a timed LoRA cue`;
      chips.append(chip);continue;
    }
  }
  if(model.residual){
    const chip=el("div","z3h3-scene-chip tone-direction passive");chip.style.setProperty("--chip-tone",categoryMeta("direction").color);
    const visual=el("div","z3h3-scene-chip-visual lora");visual.textContent="TXT";chip.append(visual,el("div","z3h3-scene-chip-copy"));
    chip.lastChild.append(el("small",null,categoryMeta("direction").label),el("b",null,"Free direction"),el("div","z3h3-scene-chip-meta"));
    chip.lastChild.lastChild.append(statusPill(model.residual.length>72?`${model.residual.slice(0,72)}…`:model.residual));
    chip.title=model.residual;chips.append(chip);
  }
  if(!chips.children.length)chips.append(el("div","z3h3-note","Nothing structured is active yet. Add Cast, select categories, attach references or add LoRAs and they will appear here."));
  strip.append(chips);shell.append(strip);
}

export function renderPromptComposer(body,host){
  if(!host)return;host.replaceChildren();
  const shell=el("section","z3h3-prompt-composer compact-toolbar"),head=el("div","z3h3-prompt-composer-head"),copy=el("div");
  copy.append(
    el("b",null,"Visual Prompt Editor"),
    el("small",null,body.target==="global"
      ? "GLOBAL / SHARED · @ calls Cast · $ calls scene presets · colored words are live scene slots"
      : "Type @ for Cast or $ for Location / Clothing / Props / Actions / Camera / Lighting / Audio. Colored scene words stay live and editable.")
  );
  const tools=el("div","z3h3-prompt-composer-tools");
  const preview=button("Resolve + timing",()=>{
    const trigger=body.ppRoot?.querySelector?.('[data-el="btnResolve"]')||body.ppRoot?.querySelector?.('[data-act="resolve"]');
    if(!trigger)throw new Error("Prompt Palette preview control is unavailable");
    trigger.click();openTimingInspector(body);
  },"z3h3-composer-btn primary","Resolve the exact H3 prompt and show an estimated beat-by-beat timing plan plus the backend render passes");
  const stack=document.createElement("select");stack.className="z3h3-composer-stack-select";stack.title="Choose where the full Current Scene Stack is shown";
  for(const [value,label] of [["prompt","Scene details: compact"],["expanded","Scene details: expanded in node"],["sidebar","Scene details: sidebar only"]]){const o=document.createElement("option");o.value=value;o.textContent=label;o.selected=body.uiPrefs?.scene_stack_mode===value;stack.append(o);}
  stack.addEventListener("change",()=>body.setUIPref?.("scene_stack_mode",stack.value));
  tools.append(preview,stack,button("Fit node",()=>body.fitWorkspace?.(),"z3h3-composer-btn","Resize the node around the current layout"));
  head.append(copy,tools);shell.append(head);
  if(body.target!=="global"&&body.data.segments?.[body.target]?.kind==="clip"){
    const note=el("div","z3h3-prompt-editor-note","Supplied footage is active. Use Shot Options for trim, sound and continuity; generated-scene tokens apply to generated shots.");shell.append(note);
  }
  renderSceneSummary(body,shell);
  host.append(shell);
}
