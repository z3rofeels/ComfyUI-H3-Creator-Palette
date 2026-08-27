import * as H from "./z3_h3_api.js";
import * as S from "./z3_h3_state.js";
import { createSubjectAvatar, subjectDisplayName } from "./h3_cast_studio.js";
import { promptThumbnailSvg } from "./prompt_library.js";
import { H3_CATEGORY_META, scenePromptMatchesSlot } from "./h3_prompt_categories.js";
import { H3PackAPI } from "./h3_pack_api.js";
import { sceneAuditionFor, toggleSceneAuditionCandidate, activateSceneAuditionShortlist, clearSceneAudition } from "./h3_scene_auditions.js";
import { auditionMode, galleryRows } from "./h3_gallery_model.js";

const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
const button=(text,fn,cls="z3h3-stack-btn",title="")=>{const node=el("button",cls,text);node.type="button";if(title)node.title=title;node.addEventListener("pointerdown",(event)=>event.stopPropagation());node.addEventListener("click",async(event)=>{event.stopPropagation();try{await fn?.(event);}catch(error){console.error("MiniMax Creator Scene Stack action failed",error);node.dataset.error="1";node.title=error?.message||String(error);setTimeout(()=>delete node.dataset.error,1600);}});return node;};
const SLOT_SPECS={
  location:{label:"WHERE",title:"Location",category:"locations",tone:"location",visual:"location"},
  wardrobe:{label:"LOOK",title:"Clothing",category:"wardrobe-props",subcategory:"Wardrobe",tone:"wardrobe",visual:"fashion"},
  prop:{label:"WHAT",title:"Prop",category:"wardrobe-props",subcategory:"Prop",tone:"prop",visual:"stilllife"},
  action:{label:"DO",title:"Action",category:"actions",tone:"action",visual:"motion"},
  camera:{label:"HOW",title:"Camera",category:"camera",tone:"camera",visual:"camera"},
  lighting:{label:"LIGHT",title:"Lighting",category:"lighting",tone:"lighting",visual:"lighting"},
  dialogue:{label:"SAY",title:"Dialogue",category:"dialogue-performance",tone:"dialogue",visual:"dialogue"},
  ambience:{label:"HEAR",title:"Ambience / Foley",categories:["audio","foley"],tone:"ambience",visual:"audio",filter:(p)=>p.subcategory!=="Music"&&p.subcategory!=="Dialogue"},
  music:{label:"MUSIC",title:"Music",category:"audio",subcategory:"Music",tone:"music",visual:"audio"},
};
const TONAL={location:H3_CATEGORY_META.location.color,wardrobe:H3_CATEGORY_META.wardrobe.color,prop:H3_CATEGORY_META.prop.color,action:H3_CATEGORY_META.action.color,camera:H3_CATEGORY_META.camera.color,lighting:H3_CATEGORY_META.lighting.color,dialogue:H3_CATEGORY_META.dialogue.color,ambience:H3_CATEGORY_META.ambience.color,music:H3_CATEGORY_META.music.color};
let catalogPromise=null;
function catalog(){if(!catalogPromise)catalogPromise=H3PackAPI.load().then((pack)=>pack.catalog).catch((error)=>{catalogPromise=null;throw error;});return catalogPromise;}
function categories(data){const model=(data?.models||[]).find((item)=>item.id==="minimax-creator-h3")||data?.models?.[0];return Object.fromEntries((model?.categories||[]).map((category)=>[category.id,category]));}
function promptText(body){if(body.target==="global")return String(body.data.prompt||"");const shot=String(body.data.segments?.[body.target]?.prompt||"");return `${String(body.data.prompt||"")}\n${shot}`;}
function mentioned(body,handle){return new RegExp(`@${String(handle).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?!-[0-9])(?![A-Za-z0-9_])`).test(promptText(body));}
function currentOwn(body,slot){return body.scenePreset?.(slot)||null;}
function currentEffective(body,slot){const own=currentOwn(body,slot);if(own)return {preset:own,scope:body.target==="global"?"Shared":"Shot"};if(body.target!=="global"){const shared=body.data.scene_palette?.[slot];if(shared)return {preset:shared,scope:"Shared"};}return null;}
function safeBg(url){return String(url||"").replaceAll('"','%22');}
function assetThumb(asset){const wrap=el("div",`z3h3-stack-thumb media ${asset.kind||""}`);if(asset.kind==="image")wrap.style.backgroundImage=`url("${safeBg(H.inputViewUrl(asset.filename))}")`;else if(asset.kind==="video")wrap.style.backgroundImage=`url("${safeBg(H.thumbUrl(asset.filename,256))}")`;else wrap.append(el("span",null,"♪"));return wrap;}
function filename(path){const pieces=String(path||"").replace(/ \[output\]$/,'').split(/[\\/]/);return pieces[pieces.length-1]||"media";}
function tinyLabel(text){return String(text||"").replace(/\s+/g," ").trim();}
function sceneVisualKind(slot,preset){const value=String(preset?.visual||"").trim().toLowerCase();return !value||value==="concept"||value==="catalog"?SLOT_SPECS[slot]?.visual||slot:value;}
export function createScenePresetVisual(body,slot,preset,cls="z3h3-stack-slot-visual"){
  const visual=el("div",cls),custom=body?.thumbnailUrl?.(body?.sceneThumbnail?.(slot,preset)||preset?.thumbnail||preset?.thumbnail_handle)||"";
  if(custom){visual.classList.add("custom");visual.style.backgroundImage=`url("${safeBg(custom)}")`;}
  else visual.innerHTML=promptThumbnailSvg({id:preset?.id||slot,title:preset?.title||SLOT_SPECS[slot]?.title||slot,visual:sceneVisualKind(slot,preset),accent:TONAL[SLOT_SPECS[slot]?.tone]||"#8c96a8",compact:true});
  return visual;
}
function slotCard(body,slot){const spec=SLOT_SPECS[slot],effective=currentEffective(body,slot),card=el("article",`z3h3-stack-card slot tone-${spec.tone}${effective?" filled":" empty"}`);card.style.setProperty("--stack-tone",TONAL[spec.tone]||"#8c96a8");
  const head=el("header");head.append(el("small",null,spec.label),el("b",null,spec.title));card.append(head);
  if(effective){const selected=effective.preset,visual=createScenePresetVisual(body,slot,selected);card.append(visual);const copy=el("div","z3h3-stack-copy");copy.append(el("strong",null,selected.title||spec.title),el("small",null,`${effective.scope} · click Change to swap`));card.append(copy);const actions=el("div","z3h3-stack-actions");const variation=body.sceneVariation?.(slot)||0;actions.append(button("−",()=>body.setSceneVariation?.(slot,-1),`z3h3-stack-btn${variation<0?" active":""}`,"All −: walk the entire live category backward by batch index"),button("Change",()=>openScenePicker(body,slot),"z3h3-stack-btn primary",`Replace ${spec.title}`),button("+",()=>body.setSceneVariation?.(slot,1),`z3h3-stack-btn${variation>0?" active":""}`,"All +: walk the entire live category forward by batch index"));if(currentOwn(body,slot))actions.append(button("×",()=>body.removeScenePreset?.(slot),"z3h3-stack-btn danger",`Clear ${spec.title}`));else actions.append(el("span","z3h3-stack-inherited","inherited"));card.append(actions);card.title=`${selected.prompt||""}
Tip: + / - marks this slot to step through presets across an incrementing-seed batch; Change picks the starting choice.`;
  }else{card.append(el("div","z3h3-stack-empty-icon","＋"),el("div","z3h3-stack-copy",null));card.lastChild.append(el("strong",null,`Pick ${spec.title.toLowerCase()}`),el("small",null,"Visible here after selection"));card.append(button("Pick",()=>openScenePicker(body,slot),"z3h3-stack-btn primary"));}
  return card;
}
function castGroup(body){const group=el("section","z3h3-stack-group wide"),head=el("div","z3h3-stack-group-head");head.append(el("div",null),button("Cast Studio",()=>body.openCast?.(),"z3h3-stack-link"));head.firstChild.append(el("small",null,"WHO"),el("b",null,"Cast in this scene"));group.append(head);const track=el("div","z3h3-stack-cast-track"),active=(body.data.subjects||[]).filter((subject)=>mentioned(body,subject.handle));
  if(!active.length)track.append(button("＋ Add / insert character",()=>body.openCast?.(),"z3h3-stack-empty-action"));
  for(const subject of active){const card=el("div","z3h3-stack-cast-card");card.append(createSubjectAvatar(body,subject));const copy=el("div");copy.append(el("b",null,subjectDisplayName(subject)),el("small",null,`@${subject.handle}`));const actions=el("div","z3h3-stack-actions");actions.append(button("Insert",()=>body.insertText?.(`@${subject.handle}`),"z3h3-stack-btn"),button("Remove mention",()=>body.removeSubjectMention?.(subject),"z3h3-stack-btn",`Remove @${subject.handle} from this prompt only; keep the character and reusable edits`));card.append(copy,actions);track.append(card);}group.append(track);return group;
}
function mediaGroup(body){const group=el("section","z3h3-stack-group wide"),head=el("div","z3h3-stack-group-head"),left=el("div");left.append(el("small",null,"MEDIA"),el("b",null,"References & clips"));head.append(left,button("＋ Media",()=>body.openMedia?.(),"z3h3-stack-link"));group.append(head);const track=el("div","z3h3-stack-media-track"),items=[];
  const shared=body.data.assets||[];for(const asset of shared)items.push({asset,scope:"Shared",list:shared});
  if(body.target!=="global"){const own=body.data.segments?.[body.target]?.assets||[];for(const asset of own)items.push({asset,scope:"Shot",list:own});}
  const seg=body.target!=="global"?body.data.segments?.[body.target]:null;if(seg?.kind==="clip")items.unshift({clip:seg,scope:"Clip"});
  if(!items.length)track.append(button("＋ Attach image, video or audio",()=>body.openMedia?.(),"z3h3-stack-empty-action"));
  for(const item of items){if(item.clip){const card=el("div","z3h3-stack-media-card clip");const thumb=el("div","z3h3-stack-thumb media video");thumb.style.backgroundImage=`url("${safeBg(H.thumbUrl(item.clip.filename,256))}")`;const copy=el("div");copy.append(el("b",null,filename(item.clip.filename)),el("small",null,`Supplied clip · ${Number(item.clip.duration_s||0).toFixed(1)}s`));card.append(thumb,copy,button("Options",()=>body.openShotOptions?.(body.target),"z3h3-stack-btn"));track.append(card);continue;}
    const {asset,scope,list}=item,card=el("div","z3h3-stack-media-card");const copy=el("div");copy.append(el("b",null,`@${asset.handle}`),el("small",null,`${scope} · ${filename(asset.filename)}`));const actions=el("div","z3h3-stack-actions");actions.append(button("Replace",()=>body.replaceAsset?.(asset,list),"z3h3-stack-btn primary","Swap the media while keeping this @handle"),button("Edit",()=>body.openAsset?.(asset),"z3h3-stack-btn"),button("×",()=>body.removeAsset?.(asset),"z3h3-stack-btn danger","Remove this reference and its @mention"));card.append(assetThumb(asset),copy,actions);track.append(card);}
  group.append(track);return group;
}
function loraGroup(body){const group=el("section","z3h3-stack-group"),head=el("div","z3h3-stack-group-head"),left=el("div");left.append(el("small",null,"STYLE"),el("b",null,"Active LoRAs"));head.append(left,button("Manage",()=>body.openLoras?.(),"z3h3-stack-link"));group.append(head);const list=el("div","z3h3-stack-small-list"),entries=[];
  for(const lora of body.data.loras||[])if(lora.enabled!==false)entries.push({lora,scope:"Shared",container:body.data});
  if(body.target!=="global")for(const lora of body.data.segments?.[body.target]?.loras||[])if(lora.enabled!==false)entries.push({lora,scope:"Shot",container:body.data.segments[body.target]});
  if(!entries.length)list.append(button("＋ Add LoRA",()=>body.openLoras?.(),"z3h3-stack-empty-action"));
  for(const {lora,scope,container} of entries){const row=el("div","z3h3-stack-lora");const preview=el("div","z3h3-stack-lora-preview");preview.style.backgroundImage=`url("${safeBg(H.loraPreviewUrl(lora.name))}")`;const copy=el("div");copy.append(el("b",null,filename(lora.name)),el("small",null,`${scope} · ${Number(lora.strength??1).toFixed(2)}`));row.append(preview,copy,button("×",()=>{S.removeLora(container,lora.name);body.commitData?.();},"z3h3-stack-btn danger"));list.append(row);}group.append(list);return group;
}
function timingGroup(body){const group=el("section","z3h3-stack-group"),head=el("div","z3h3-stack-group-head"),left=el("div");left.append(el("small",null,"WHEN"),el("b",null,body.target==="global"?"Shared across shots":`Shot ${Number(body.target)+1}`));head.append(left,body.target==="global"?el("span","z3h3-stack-inherited","inherited by shots"):button("Inspect",()=>body.openShotOptions?.(body.target),"z3h3-stack-link"));group.append(head);const seg=body.target==="global"?body.data.segments?.[0]:body.data.segments?.[body.target];const line=el("div","z3h3-stack-timing");line.append(el("b",null,body.target==="global"?"Global prompt":`${Number(seg?.duration_s||S.DEFAULT_DURATION_S).toFixed(1)} seconds`),el("small",null,body.target==="global"?"Prompt, references, Cast and LoRAs apply to every generated shot.":`${S.durationFrames(seg?.duration_s||S.DEFAULT_DURATION_S)} frames · ${seg?.checkpoint||"auto"} route`));group.append(line);return group;
}

export function renderSceneStack(body,host){if(!host)return;host.replaceChildren();const shell=el("section","z3h3-scene-stack"),head=el("div","z3h3-scene-stack-head"),copy=el("div");copy.append(el("b",null,"Current Scene Stack"),el("small",null,body.target==="global"?"GLOBAL / Shared — inherited by every generated shot":"Everything active in this shot, visible without opening submenus"));const headActions=el("div","z3h3-stack-head-actions");headActions.append(body.target==="global"?el("span","z3h3-stack-global-badge","SHARED"):el("span","z3h3-stack-shot-badge",`SHOT ${Number(body.target)+1}`),button("Collapse",()=>body.setUIPref?.("scene_stack_mode","prompt"),"z3h3-stack-link","Collapse this card stack; colored scene tokens stay in the prompt editor"),button("Sidebar",()=>body.setUIPref?.("scene_stack_mode","sidebar"),"z3h3-stack-link","Hide the large stack here and manage scene choices from the Library sidebar"));head.append(copy,headActions);shell.append(head,castGroup(body),mediaGroup(body));const grid=el("div","z3h3-stack-grid");for(const slot of ["location","wardrobe","prop","action","camera","lighting","dialogue","ambience","music"])grid.append(slotCard(body,slot));shell.append(grid);const bottom=el("div","z3h3-stack-bottom");bottom.append(loraGroup(body),timingGroup(body));shell.append(bottom);host.append(shell);}

function rowsForSlot(map,slot){const rows=[];for(const [id,category] of Object.entries(map||{})){for(const prompt of category?.prompts||[]){if(scenePromptMatchesSlot(slot,id,prompt))rows.push({...prompt,category:id});}}return rows;}

export async function listSceneSlotPresets(slot){const spec=SLOT_SPECS[slot];if(!spec)throw new Error(`Unknown scene slot ${slot}`);const data=await catalog(),map=categories(data);return rowsForSlot(map,slot);}

export async function cycleSceneSlotPreset(body,slot,delta=1){
  const all=await listSceneSlotPresets(slot);if(!all.length)return null;
  const current=body.scenePreset?.(slot);let index=-1;
  if(current){index=all.findIndex((row)=>String(row.id||'')===String(current.id||'')) ; if(index<0) index=all.findIndex((row)=>String(row.prompt||'').trim()===String(current.prompt||'').trim());}
  const next=all[(index<0? (delta<0?all.length-1:0) : (index+all.length+Number(delta||1))%all.length)]||all[0];
  body.applyScenePreset?.(slot,next);return next;
}

function openGalleryShell(body,slot,mode){
  const spec=SLOT_SPECS[slot],back=el("div","z3h3-backdrop z3h3-gallery-backdrop"),box=el("div",`z3h3-modal wide z3h3-scene-gallery tone-${spec.tone}`),head=el("div","z3h3-gallery-head"),identity=el("div","z3h3-gallery-identity"),mark=el("i","z3h3-gallery-mark"),copy=el("div"),close=button("Close",()=>remove(),"z3h3-btn z3h3-gallery-close");
  box.style.setProperty("--gallery-tone",TONAL[spec.tone]||"#8c96a8");
  copy.append(el("small",null,mode==="audition"?"BATCH AUDITION":"SCENE LIBRARY"),el("b",null,mode==="audition"?`${spec.title} variations`:`Choose ${spec.title}`),el("span",null,mode==="audition"?"Choose the complete category or a deliberate shortlist. Your starting preset stays visible.":"Pick the exact preset that should become the current scene ingredient."));
  identity.append(mark,copy);head.append(identity,close);const content=el("div","z3h3-modal-body z3h3-gallery-body");box.append(head,content);back.append(box);document.body.append(back);
  const onKey=(event)=>{if(event.key==="Escape")remove();};
  function remove(){document.removeEventListener("keydown",onKey,true);back.remove();}
  document.addEventListener("keydown",onKey,true);back.addEventListener("mousedown",(event)=>{if(event.target===back)remove();});
  return {back,content,remove};
}

function modeCard(title,detail,active,action,{disabled=false,icon=""}={}){const node=button("",action,`z3h3-gallery-mode${active?" active":""}`,detail);node.disabled=disabled;node.append(el("span","z3h3-gallery-mode-icon",icon),el("b",null,title),el("small",null,detail));return node;}

async function openSceneGallery(body,slot,{mode="pick",initialQuery="",onPick=null}={}){
  const spec=SLOT_SPECS[slot];if(!spec)throw new Error(`Unknown scene slot ${slot}`);
  const shell=openGalleryShell(body,slot,mode),{content,remove}=shell,loading=el("div","z3h3-progress");loading.append(el("i"));content.append(loading);
  try{
    const data=await catalog(),all=rowsForSlot(categories(data),slot),toolbar=el("div","z3h3-gallery-toolbar"),search=document.createElement("input"),summary=el("div","z3h3-gallery-summary"),modes=el("div","z3h3-gallery-modes"),status=el("div","z3h3-gallery-status"),grid=el("div","z3h3-gallery-grid");
    search.type="search";search.placeholder=`Search ${spec.title.toLowerCase()} titles, notes or prompt text…`;search.value=String(initialQuery||"");
    toolbar.append(el("div","z3h3-gallery-search",null));toolbar.firstChild.append(el("span",null,"⌕"),search);
    const draw=()=>{
      const effective=currentEffective(body,slot),current=effective?.preset||null,currentId=String(current?.id||""),config=sceneAuditionFor(body,slot)||{candidates:[],direction:1,mode:"prepared"},marker=body.sceneVariation?.(slot)||0,activeMode=auditionMode({marker,candidates:config.candidates,direction:config.direction,mode:config.mode}),rows=galleryRows(all,{query:search.value,currentId,candidates:config.candidates,marker,direction:config.direction,audition:mode==="audition"});
      summary.replaceChildren();const selected=el("div","z3h3-gallery-current");selected.append(el("small",null,"CURRENT START"),el("b",null,current?.title||`No ${spec.title.toLowerCase()} selected`),el("span",null,current?`${effective.scope} · ${all.length} live presets`:`Choose a preset below · ${all.length} available`));summary.append(selected);
      if(mode==="pick"){const clear=button("Clear current",()=>{body.removeScenePreset?.(slot);remove();},"z3h3-btn danger",`Remove the current ${spec.title}`);clear.disabled=!current;summary.append(clear);}
      else{
        const setFixed=()=>{const active=body.sceneVariation?.(slot)||0;if(active)body.setSceneVariation?.(slot,active);if(sceneAuditionFor(body,slot)?.candidates?.length)clearSceneAudition(body,slot);draw();};
        const setAll=(direction)=>{const active=body.sceneVariation?.(slot)||0;if(active!==direction)body.setSceneVariation?.(slot,direction);draw();};
        modes.replaceChildren(
          modeCard("Fixed","Keep only the current preset",activeMode==="fixed",setFixed,{disabled:!current,icon:"◆"}),
          modeCard("All forward",`Current → next through all ${all.length}`,activeMode==="all_forward",()=>setAll(1),{disabled:!current,icon:"→"}),
          modeCard("All reverse",`Current → previous through all ${all.length}`,activeMode==="all_reverse",()=>setAll(-1),{disabled:!current,icon:"←"}),
          modeCard("Shortlist forward",config.candidates.length?`Current → ${config.candidates.length} selected`:`Select cards below first`,activeMode==="shortlist_forward",()=>{activateSceneAuditionShortlist(body,slot,1);draw();},{disabled:!config.candidates.length,icon:"⇢"}),
          modeCard("Shortlist reverse",config.candidates.length?`Current → selected in reverse`:`Select cards below first`,activeMode==="shortlist_reverse",()=>{activateSceneAuditionShortlist(body,slot,-1);draw();},{disabled:!config.candidates.length,icon:"⇠"})
        );
        status.className=`z3h3-gallery-status mode-${activeMode}`;
        if(!current)status.textContent=`Choose the current ${spec.title.toLowerCase()} first. It becomes batch item one and the remaining modes will unlock.`;
        else if(marker)status.textContent=`Complete ${spec.title} category ${marker>0?"forward":"in reverse"} is active. ${config.candidates.length?`${config.candidates.length} shortlist pick${config.candidates.length===1?" is":"s are"} saved but inactive.`:"No shortlist is needed."}`;
        else if(config.candidates.length&&config.mode==="shortlist")status.textContent=`Shortlist ${config.direction<0?"reverse":"forward"} is active: current preset first, then ${config.candidates.length} selected alternative${config.candidates.length===1?"":"s"}.`;
        else if(config.candidates.length)status.textContent=`Fixed. ${config.candidates.length} shortlist pick${config.candidates.length===1?" is":"s are"} prepared but inactive; choose Shortlist forward/reverse to batch through them.`;
        else status.textContent="Fixed. Select cards to prepare a shortlist, or choose All forward/reverse to use the complete live category.";
        const shortlistTools=el("div","z3h3-gallery-shortlist-head");shortlistTools.append(el("div",null));shortlistTools.firstChild.append(el("b",null,"Optional shortlist"),el("small",null,"Card clicks only edit the shortlist; they never replace the current starting preset."));if(config.candidates.length)shortlistTools.append(button("Clear shortlist",()=>{clearSceneAudition(body,slot);draw();},"z3h3-btn danger"));
        summary.append(shortlistTools);
      }
      grid.replaceChildren();
      for(const item of rows){const prompt=item.row,card=button("",async()=>{if(mode==="audition"){if(!current)body.applyScenePreset?.(slot,prompt);else if(!item.current)toggleSceneAuditionCandidate(body,slot,prompt.id);draw();return;}if(typeof onPick==="function")await onPick(prompt);else body.applyScenePreset?.(slot,prompt);remove();},`z3h3-gallery-card${item.current?" current":""}${item.selected?" shortlisted":""}`,prompt.prompt||prompt.title);if(mode==="audition"&&item.current)card.disabled=true;card.style.setProperty("--gallery-tone",TONAL[spec.tone]||"#8c96a8");
        const visual=createScenePresetVisual(body,slot,prompt,"z3h3-gallery-thumb"),copy=el("div","z3h3-gallery-card-copy"),top=el("div","z3h3-gallery-card-title");top.append(el("b",null,prompt.title||spec.title));
        const badges=el("div","z3h3-gallery-card-badges");if(item.sequence)badges.append(el("span","sequence",`#${item.sequence}`));if(item.current)badges.append(el("span","current","Current"));else if(item.selected)badges.append(el("span","selected","✓ Shortlist"));else if(mode==="audition")badges.append(el("span","available","＋ Add"));top.append(badges);
        copy.append(top,el("small",null,prompt.note||prompt.subcategory||spec.title),el("p",null,prompt.prompt||"No prompt text stored."));card.append(visual,copy);grid.append(card);
      }
      if(!rows.length)grid.append(el("div","z3h3-gallery-empty",`No ${spec.title.toLowerCase()} presets match “${search.value.trim()}”.`));
      toolbar.dataset.count=`${rows.length} shown`;
    };
    search.addEventListener("input",draw);content.replaceChildren(toolbar,summary,...(mode==="audition"?[modes,status]:[]),grid);draw();queueMicrotask(()=>search.focus());
  }catch(error){content.replaceChildren(el("div","z3h3-error",error.message||String(error)));}
  return shell.back;
}

export function openScenePicker(body,slot,options={}){return openSceneGallery(body,slot,{mode:"pick",...options});}
export function openSceneAuditionGallery(body,slot,options={}){return openSceneGallery(body,slot,{mode:"audition",...options});}

export function invalidateScenePackCatalog(){catalogPromise=null;}
window.addEventListener?.("z3-h3-pack-changed",()=>{catalogPromise=null;});
