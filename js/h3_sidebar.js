import { activeCreatorBody, subscribeCreatorBody, setActiveCreatorBody } from "./h3_workspace_runtime.js";
import { H3PackAPI } from "./h3_pack_api.js";
import * as S from "./z3_h3_state.js";
import { openCastStudio, createSubjectAvatar, subjectDisplayName, setCastPresetCache, syncBodyFromCastPresets, syncLinkedSubjectFromPreset } from "./h3_cast_studio.js";
import { promptThumbnailSvg } from "./prompt_library.js";
import { H3_CATEGORY_META, H3_SCENE_SLOT_ORDER, scenePromptMatchesSlot } from "./h3_prompt_categories.js";
import { buildPromptComposerModel } from "./h3_prompt_composer.js";
import { castMentionHandles } from "./h3_cast_auditions.js";
import { sceneAuditionFor, clearSceneAudition } from "./h3_scene_auditions.js";
import { applyCreatorAppearance } from "./h3_suite_appearance.js";
import { sidebarStateSignature } from "./h3_sidebar_signature.js";
import { openSceneAuditionGallery } from "./h3_scene_stack.js";
import { openCastAuditionGallery } from "./h3_quick_actions.js";

let installed=false,catalogPromise=null,unsubscribe=null,currentRoot=null,selectedAuditionRole="",packState=null,rerenderSidebar=null;
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
const TONES={builder:H3_CATEGORY_META.builder.color,cast:H3_CATEGORY_META.cast.color,location:H3_CATEGORY_META.location.color,wardrobe:H3_CATEGORY_META.wardrobe.color,prop:H3_CATEGORY_META.prop.color,action:H3_CATEGORY_META.action.color,camera:H3_CATEGORY_META.camera.color,lighting:H3_CATEGORY_META.lighting.color,dialogue:H3_CATEGORY_META.dialogue.color,ambience:H3_CATEGORY_META.ambience.color,music:H3_CATEGORY_META.music.color,guide:H3_CATEGORY_META.guide.color};
const SLOT_LABELS={location:"Location",wardrobe:"Wardrobe",prop:"Prop",action:"Action",camera:"Camera",lighting:"Lighting",dialogue:"Dialogue",ambience:"Ambience / Foley",music:"Music"};
const SIDEBAR_KIT_KEY="z3.minimaxCreator.sidebarSceneKitCollapsed";
let sidebarKitCollapsed=(()=>{try{return localStorage.getItem(SIDEBAR_KIT_KEY)==="1";}catch{return false;}})();
function saveSidebarKitState(){try{localStorage.setItem(SIDEBAR_KIT_KEY,sidebarKitCollapsed?"1":"0");}catch{/* storage unavailable */}}

// Sidebar folder presentation is deliberately UI-only. It never changes the
// editable pack, generated prompt, or compiler state, so users can organize a
// huge pack without risking generation regressions.
const GROUP_UI_KEY="z3.minimaxCreator.sidebarGroupUI.v2";
function readGroupUI(){try{const raw=JSON.parse(localStorage.getItem(GROUP_UI_KEY)||"{}");return {collapsed:raw&&typeof raw.collapsed==="object"?raw.collapsed:{},colors:raw&&typeof raw.colors==="object"?raw.colors:{}};}catch{return {collapsed:{},colors:{}};}}
let groupUI=readGroupUI();
function saveGroupUI(){try{localStorage.setItem(GROUP_UI_KEY,JSON.stringify(groupUI));}catch{/* local storage may be disabled */}}
function groupKey(scope,name){return `${String(scope||"section")}::${String(name||"Presets")}`;}
function hashHue(value){let h=2166136261;for(const ch of String(value||"")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return Math.abs(h>>>0)%360;}
function fallbackGroupColor(scope,name,base="#8993a6"){
  const hue=hashHue(`${scope}|${name}`),sat=38+(hue%13),light=52+(hue%7);
  // The deterministic default is intentionally muted; a user's chosen color
  // wins completely and persists across Creator/node reloads.
  return `hsl(${hue} ${sat}% ${light}%)`;
}
function groupColor(scope,name,base="#8993a6"){return groupUI.colors[groupKey(scope,name)]||fallbackGroupColor(scope,name,base);}
function isGroupCollapsed(scope,name,{defaultCollapsed=true}={}){const key=groupKey(scope,name);return key in groupUI.collapsed?groupUI.collapsed[key]!==false:!!defaultCollapsed;}
function setGroupCollapsed(scope,name,value){groupUI.collapsed[groupKey(scope,name)]=!!value;saveGroupUI();}
function setGroupColor(scope,name,value){const key=groupKey(scope,name);if(value)groupUI.colors[key]=String(value);else delete groupUI.colors[key];saveGroupUI();}
function allGroupKeys(scope,names){return (names||[]).map(name=>groupKey(scope,name));}
function setManyGroups(scope,names,collapsed){for(const name of names||[])groupUI.collapsed[groupKey(scope,name)]=!!collapsed;saveGroupUI();rerenderSidebar?.();}
function clamp(value,min,max){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):min;}
function hexToRgb(hex){const clean=String(hex||"").trim().replace(/^#/,"");if(!/^[0-9a-f]{6}$/i.test(clean))return null;return {r:parseInt(clean.slice(0,2),16),g:parseInt(clean.slice(2,4),16),b:parseInt(clean.slice(4,6),16)};}
function rgbToHex(r,g,b){return `#${[r,g,b].map(v=>Math.round(clamp(v,0,255)).toString(16).padStart(2,"0")).join("")}`;}
function rgbToHsl(r,g,b){r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0,s=0,l=(max+min)/2;if(d){s=l>.5?d/(2-max-min):d/(max+min);switch(max){case r:h=((g-b)/d+(g<b?6:0));break;case g:h=(b-r)/d+2;break;default:h=(r-g)/d+4;}h*=60;}return {h:Math.round(h),s:Math.round(s*100),l:Math.round(l*100)};}
function hslToHex(h,s,l){h=((Number(h)%360)+360)%360;s=clamp(s,0,100)/100;l=clamp(l,0,100)/100;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;let r=0,g=0,b=0;if(h<60){r=c;g=x}else if(h<120){r=x;g=c}else if(h<180){g=c;b=x}else if(h<240){g=x;b=c}else if(h<300){r=x;b=c}else{r=c;b=x}return rgbToHex((r+m)*255,(g+m)*255,(b+m)*255);}
function normalizeHex(value,fallback="#8993a6"){const clean=String(value||"").trim();if(/^#[0-9a-f]{6}$/i.test(clean))return clean.toLowerCase();if(/^#[0-9a-f]{3}$/i.test(clean))return `#${clean.slice(1).split("").map(c=>c+c).join("")}`.toLowerCase();return /^#[0-9a-f]{6}$/i.test(fallback)?fallback.toLowerCase():"#8993a6";}
function openGroupColorEditor(scope,name,baseColor="#8993a6",section=null){
  const key=groupKey(scope,name),original=groupUI.colors[key]||"",initial=normalizeHex(original||baseColor,"#8993a6");
  sideModal(`${name} · folder color`,(mount,close)=>{
    const shell=el("div","z3h3-group-color-editor"),preview=el("div","z3h3-group-color-preview"),previewSwatch=el("i"),previewCopy=el("div"),hexWrap=el("label","z3h3-group-color-hex"),hexLabel=el("span",null,"Hex"),hex=document.createElement("input"),sliders=el("div","z3h3-group-color-sliders"),swatches=el("div","z3h3-group-color-swatches"),actions=el("div","z3h3-pack-editor-actions");
    previewCopy.append(el("b",null,name),el("small",null,"Folder accent · stored locally · prompts are unchanged"));preview.append(previewSwatch,previewCopy);
    const rgb=hexToRgb(initial)||hexToRgb("#8993a6"),hsl=rgbToHsl(rgb.r,rgb.g,rgb.b);let state={...hsl,hex:initial};hex.type="text";hex.spellcheck=false;hex.value=initial;hexWrap.append(hexLabel,hex);
    const makeRange=(label,min,max,value,suffix="")=>{const wrap=el("label","z3h3-group-color-range"),top=el("div"),caption=el("span",null,label),out=el("output",null,`${value}${suffix}`),input=document.createElement("input");input.type="range";input.min=String(min);input.max=String(max);input.value=String(value);top.append(caption,out);wrap.append(top,input);return {wrap,input,out,suffix};};
    const hue=makeRange("Hue",0,359,state.h,"°"),sat=makeRange("Saturation",12,100,state.s,"%"),light=makeRange("Lightness",24,76,state.l,"%");sliders.append(hue.wrap,sat.wrap,light.wrap);
    const apply=(value,{persist=true}={})=>{const next=normalizeHex(value,initial);state.hex=next;hex.value=next;preview.style.setProperty("--picker-color",next);previewSwatch.style.background=next;if(section)section.style.setProperty("--group-accent",next);if(persist)setGroupColor(scope,name,next);};
    const syncFromSliders=()=>{state.h=Number(hue.input.value);state.s=Number(sat.input.value);state.l=Number(light.input.value);hue.out.textContent=`${state.h}°`;sat.out.textContent=`${state.s}%`;light.out.textContent=`${state.l}%`;apply(hslToHex(state.h,state.s,state.l));};
    for(const control of [hue,sat,light])control.input.addEventListener("input",syncFromSliders);
    hex.addEventListener("change",()=>{const next=normalizeHex(hex.value,state.hex),r=hexToRgb(next),h=rgbToHsl(r.r,r.g,r.b);state={...h,hex:next};hue.input.value=String(h.h);sat.input.value=String(h.s);light.input.value=String(h.l);syncFromSliders();});
    const palette=["#d69b62","#bd7ea3","#9186cb","#6d9fd1","#d5b365","#6fa98f","#66b7aa","#9b83bd","#d98264","#d97076","#79b98b","#8993a6"];
    for(const value of palette){const sw=button("",()=>{const r=hexToRgb(value),h=rgbToHsl(r.r,r.g,r.b);hue.input.value=String(h.h);sat.input.value=String(h.s);light.input.value=String(h.l);syncFromSliders();},"z3h3-group-color-swatch",`Use ${value}`);sw.style.setProperty("--swatch",value);swatches.append(sw);}
    actions.append(button("Reset automatic",()=>{setGroupColor(scope,name,"");if(section)section.style.setProperty("--group-accent",fallbackGroupColor(scope,name,baseColor));announce(`${name} color reset`,"good");close();rerenderSidebar?.();},"z3h3-side-secondary"),button("Done",()=>{announce(`${name} color saved`,"good");close();},"z3h3-side-primary"));
    shell.append(preview,el("div","z3h3-group-color-subhead","Quick colors"),swatches,sliders,hexWrap,actions);mount.append(shell);apply(initial,{persist:false});
  });
}
function folderHeader({scope,name,count=0,baseColor="#8993a6",query="",defaultCollapsed=true}={}){
  const section=el("section","z3h3-side-folder"),header=el("div","z3h3-side-folder-head"),toggle=button("",()=>{const next=!isGroupCollapsed(scope,name,{defaultCollapsed});setGroupCollapsed(scope,name,next);rerenderSidebar?.();},"z3h3-side-folder-toggle",`Expand / collapse ${name}`),copy=el("div","z3h3-side-folder-copy"),tools=el("div","z3h3-side-folder-tools");
  const collapsed=!query&&isGroupCollapsed(scope,name,{defaultCollapsed}),accent=groupColor(scope,name,baseColor);
  section.style.setProperty("--group-accent",accent);section.classList.toggle("collapsed",collapsed);section.dataset.groupScope=scope;section.dataset.groupName=name;
  toggle.innerHTML=`<span class="z3h3-side-folder-chevron" aria-hidden="true">${collapsed?"▸":"▾"}</span>`;toggle.setAttribute("aria-expanded",collapsed?"false":"true");
  copy.append(el("b",null,name),el("small",null,`${count} item${count===1?"":"s"}${query?" · matching search":""}`));
  const color=button("",()=>openGroupColorEditor(scope,name,baseColor,section),"z3h3-side-folder-color",`Choose a color for ${name}`);color.style.setProperty("--swatch",accent);color.setAttribute("aria-label",`Choose a color for ${name}`);
  const menuItems=()=>[{label:collapsed?"Expand group":"Collapse group",action:()=>{setGroupCollapsed(scope,name,!collapsed);rerenderSidebar?.();}},{label:"Change folder color…",action:()=>openGroupColorEditor(scope,name,baseColor,section),hint:"Local UI preference; prompts are unchanged"},{label:"Reset folder color",action:()=>{setGroupColor(scope,name,"");rerenderSidebar?.();},hint:"Return to the automatic accent"}];
  const more=button("⋯",event=>contextMenu(event,menuItems()),"z3h3-side-folder-more",`${name} display options`);
  tools.append(color,more);header.append(toggle,copy,tools);section.append(header);
  header.addEventListener("click",event=>{if(event.target.closest("button,input"))return;setGroupCollapsed(scope,name,!collapsed);rerenderSidebar?.();});
  header.addEventListener("contextmenu",event=>contextMenu(event,menuItems()));
  return {section,body:el("div","z3h3-side-folder-body"),collapsed};
}
const TABS=[
  {id:"scene",label:"Scene",hint:"Ready-made H3 starters",category:"builders",mode:"insert",tone:"builder"},
  {id:"cast",label:"Cast"},
  {id:"location",label:"Locations",category:"locations",slot:"location",tone:"location"},
  {id:"wardrobe",label:"Clothing",category:"wardrobe-props",slot:"wardrobe",tone:"wardrobe",subcategory:"Wardrobe"},
  {id:"props",label:"Props",category:"wardrobe-props",slot:"prop",tone:"prop",subcategory:"Prop"},
  {id:"action",label:"Action",category:"actions",slot:"action",tone:"action"},
  {id:"camera",label:"Camera",category:"camera",slot:"camera",tone:"camera"},
  {id:"lighting",label:"Lighting",category:"lighting",slot:"lighting",tone:"lighting"},
  {id:"audio",label:"Audio",categories:["dialogue-performance","audio","foley"],tone:"ambience"},
  {id:"guides",label:"Guides",categories:["continuity","reference-scopes","frame-guides","multi-shot"],mode:"insert",tone:"guide"},
];

function button(text,fn,cls="",title=""){
  const node=el("button",cls,text);node.type="button";if(title)node.title=title;let pointerHandled=false;
  const invoke=async(event)=>{event?.preventDefault?.();event?.stopPropagation?.();try{await fn?.(event);}catch(error){console.error("MiniMax Creator sidebar action failed",error);node.dataset.error="1";announce(error?.message||String(error),"bad");setTimeout(()=>delete node.dataset.error,1600);}};
  node.addEventListener("pointerdown",(event)=>{event.stopPropagation();});
  node.addEventListener("pointerup",async(event)=>{if(event.button!==0)return;pointerHandled=true;await invoke(event);setTimeout(()=>{pointerHandled=false;},0);});
  node.addEventListener("click",async(event)=>{if(pointerHandled||event.detail>0){event.preventDefault();event.stopPropagation();return;}await invoke(event);});return node;
}
function activateSurface(node,fn){
  let pointerHandled=false;
  const invoke=(event)=>{if(event.target?.closest?.("button"))return;event.preventDefault?.();event.stopPropagation?.();fn?.(event);};
  node.addEventListener("pointerdown",(event)=>{if(!event.target?.closest?.("button"))event.stopPropagation();});
  node.addEventListener("pointerup",(event)=>{if(event.button!==0||event.target?.closest?.("button"))return;pointerHandled=true;invoke(event);setTimeout(()=>{pointerHandled=false;},0);});
  node.addEventListener("click",(event)=>{if(event.target?.closest?.("button"))return;if(pointerHandled||event.detail>0){event.preventDefault();event.stopPropagation();return;}invoke(event);});
  node.addEventListener("keydown",(event)=>{if((event.key==="Enter"||event.key===" ")&&!event.target?.closest?.("button")){event.preventDefault();event.stopPropagation();fn?.(event);}});
}

function localFile(accept,handler){const input=document.createElement("input");input.type="file";input.accept=accept;input.style.display="none";input.addEventListener("change",async()=>{const file=input.files?.[0];input.remove();if(file)await handler(file);},{once:true});document.body.append(input);input.click();}
function downloadPack(options){const a=document.createElement("a");a.href=H3PackAPI.exportUrl(options);a.download="";document.body.append(a);a.click();a.remove();}
function sideModal(title,build,{wide=false}={}){const back=el("div","z3h3-side-modal-backdrop"),box=el("div",`z3h3-side-modal${wide?" wide":""}`),head=el("div","z3h3-side-modal-head"),body=el("div","z3h3-side-modal-body");const close=button("Close",()=>back.remove(),"z3h3-side-secondary");head.append(el("b",null,title),el("span","z3h3-side-modal-spacer"),close);box.append(head,body);back.append(box);document.body.append(back);back.addEventListener("pointerdown",e=>{if(e.target===back)back.remove()});build(body,()=>back.remove());return back;}
function textField(label,value="",multi=false){const wrap=el("label","z3h3-pack-field"),caption=el("span",null,label),control=multi?document.createElement("textarea"):document.createElement("input");if(!multi)control.type="text";control.value=value??"";if(multi)control.rows=5;wrap.append(caption,control);return {wrap,control};}
function contextMenu(event,items){event.preventDefault();event.stopPropagation();document.querySelectorAll(".z3h3-side-context").forEach(n=>n.remove());const menu=el("div","z3h3-side-context");for(const item of items){if(item.separator){menu.append(el("div","sep"));continue;}const row=button(item.label,async()=>{menu.remove();await item.action?.();},`z3h3-side-context-item${item.danger?" danger":""}`,item.hint||"");menu.append(row);}document.body.append(menu);const r=menu.getBoundingClientRect();menu.style.left=`${Math.min(innerWidth-r.width-8,Math.max(8,event.clientX))}px`;menu.style.top=`${Math.min(innerHeight-r.height-8,Math.max(8,event.clientY))}px`;const close=e=>{if(!menu.contains(e.target)){menu.remove();document.removeEventListener("pointerdown",close,true)}};queueMicrotask(()=>document.addEventListener("pointerdown",close,true));}
async function setLocalThumb(kind,category,id){localFile("image/png,image/jpeg,image/webp,image/gif",async(file)=>{try{await H3PackAPI.setThumbnail({kind,category,id,file});announce("Thumbnail saved into the current pack","good");await reloadPack();}catch(error){announce(error.message||String(error),"bad");}});}
function packCountSummary(counts={}){const parts=[];if(Number(counts.cast||0))parts.push(`${counts.cast} Cast`);if(Number(counts.references||0))parts.push(`${counts.references} refs`);if(Number(counts.prompts||0))parts.push(`${counts.prompts} presets`);if(!parts.length)parts.push("no reusable records");return parts.join(" · ");}
function importScopeLabel(scope,category="",subcategory=""){if(scope==="pack")return "Pack";if(scope.startsWith("cast"))return scope==="cast_item"?"Cast preset":"Cast library";return subcategory||category||"Preset section";}
function packImport(scope,category="",subcategory=""){
  localFile(".zip,.json,application/zip,application/json",async(file)=>{
    let report;
    try{report=await H3PackAPI.inspectImport(file,{scope,category,subcategory});}
    catch(error){announce(error.message||String(error),"bad");return;}
    sideModal(`Review import · ${file.name}`,(mount,close)=>{
      const incoming=report.incoming||{},current=report.current||{},impact=report.impact||{},summary=impact.summary||{},groups=Array.isArray(impact.groups)?impact.groups:[],intro=el("div","z3h3-pack-import-hero"),incomingCard=el("div","z3h3-pack-import-card"),currentCard=el("div","z3h3-pack-import-card"),grid=el("div","z3h3-pack-import-grid"),impactBox=el("div","z3h3-pack-import-impact"),metrics=el("div","z3h3-pack-import-metrics"),actions=el("div","z3h3-pack-import-actions safe-v3131b");
      intro.append(el("b",null,report.name||file.name),el("small",null,`${importScopeLabel(scope,category,subcategory)} · ${report.thumbnail_files||0} local thumbnails · stable-ID preview before import`));
      incomingCard.append(el("span",null,"INCOMING"),el("b",null,packCountSummary(incoming)));
      currentCard.append(el("span",null,"CURRENT LIBRARY"),el("b",null,packCountSummary(current)));grid.append(incomingCard,currentCard);
      const metric=(label,value,kind="")=>{const box=el("div",`z3h3-pack-import-metric ${kind}`);box.append(el("b",null,String(value||0)),el("small",null,label));metrics.append(box);};
      metric("NEW",summary.new,"good");metric("UPDATED BY MERGE",summary.updated,"info");metric("COLLISIONS",summary.collisions,summary.collisions?"warn":"");metric("DELETED",0,"safe");
      impactBox.append(el("div","safe","APPEND adds new stable IDs only. MERGE updates matching stable IDs and adds new records. Neither operation deletes unrelated Library content."));
      if(summary.moved)impactBox.append(el("div",null,`${summary.moved} matching stable ID${summary.moved===1?"":"s"} move to a different group when merged.`));
      if(summary.name_collisions)impactBox.append(el("div",null,`${summary.name_collisions} same-name/title record${summary.name_collisions===1?"":"s"} use different IDs; names alone never overwrite.`));
      for(const warning of report.warnings||[])impactBox.append(el("div","warn",warning));
      const affected=el("details","z3h3-pack-import-breakdown");affected.open=true;affected.append(el("summary",null,`Affected content · ${groups.length} group${groups.length===1?"":"s"}`));const list=el("div","z3h3-pack-import-breakdown-list");
      for(const row of groups){const item=el("div","z3h3-pack-import-breakdown-row"),copy=el("div"),stats=el("small",null,`${row.current||0} current · ${row.incoming||0} incoming · ${row.new||0} new · ${row.updated||0} update${row.collisions?` · ${row.collisions} collision`:""}`);copy.append(el("b",null,row.label||row.group||"Group"),stats);item.append(copy,row.deleted?el("span","warn",`${row.deleted} replace-delete`):el("span",null,"0 delete"));list.append(item);}affected.append(list);
      const replaceableGroups=groups.filter(row=>row?.kind==="cast"||row?.kind==="reference"||row?.kind==="prompt"),canReplaceGroup=!scope.endsWith("_item")&&replaceableGroups.length>0,replaceWrap=el("div","z3h3-pack-replace-group");let groupSelect=null,replacePreview=null,replaceBtn=null;
      if(canReplaceGroup){const label=el("label","z3h3-pack-field"),caption=el("span",null,"REPLACE SELECTED GROUP"),select=document.createElement("select");select.className="z3h3-pack-group-select";const placeholder=document.createElement("option");placeholder.value="";placeholder.textContent="Choose one incoming Cast/Reference/category group…";select.append(placeholder);replaceableGroups.forEach((row,index)=>{const option=document.createElement("option");option.value=String(index);option.textContent=`${row.label} · ${row.incoming||0} incoming`;select.append(option);});label.append(caption,select);replacePreview=el("div","z3h3-pack-replace-preview","Choose a group to see exactly what would be deleted from that group only.");replaceWrap.append(label,replacePreview);groupSelect=select;}
      const run=async(mode,row=null)=>{try{const options={scope,category,subcategory,mode,expectedFingerprint:report.current_fingerprint||""};if(mode==="replace_group"&&row){options.replaceKind=row.kind;options.replaceCategory=row.category||"";options.replaceGroup=row.group||"";}await H3PackAPI.importPack(file,options);close();await reloadPack();announce(mode==="append"?"Pack appended safely":mode==="merge"?"Pack merged by stable ID":"Selected group replaced; unrelated Library content preserved","good");}catch(error){announce(error.message||String(error),"bad");}};
      actions.append(button("APPEND",()=>run("append"),"z3h3-side-primary","Add new stable IDs only. Existing records always win."),button("MERGE",()=>run("merge"),"z3h3-side-secondary","Update matching stable IDs, add new records, preserve unrelated records."));
      if(canReplaceGroup){replaceBtn=button("REPLACE SELECTED GROUP",async()=>{const index=Number(groupSelect.value);if(!Number.isInteger(index)||index<0||!replaceableGroups[index])return;const row=replaceableGroups[index],deleted=Number(row.deleted||0);if(deleted>0){if(!confirm(`Replace only “${row.label}”?\n\n${deleted} existing record${deleted===1?"":"s"} in this selected group will move to Trash. Unrelated groups remain untouched.`))return;const typed=prompt(`Type REPLACE to confirm replacing only “${row.label}”.`);if(typed!=="REPLACE")return;}await run("replace_group",row);},"z3h3-side-danger","Replace only the explicitly selected group. Records removed from that group go to Trash.");replaceBtn.disabled=true;actions.append(replaceBtn);groupSelect.addEventListener("change",()=>{const index=Number(groupSelect.value),row=replaceableGroups[index];replaceBtn.disabled=!row;if(!row){replacePreview.textContent="Choose a group to see exactly what would be deleted from that group only.";return;}replacePreview.textContent=`${row.label}: ${row.new||0} new · ${row.updated||0} updated by stable ID · ${row.collisions||0} collision · ${row.deleted||0} moved to Trash. Other groups: 0 deleted.`;replacePreview.dataset.destructive=Number(row.deleted||0)>0?"1":"0";});}
      actions.append(button("Cancel",close,"z3h3-side-secondary"));
      mount.append(intro,grid,metrics,impactBox);if(groups.length)mount.append(affected);if(canReplaceGroup)mount.append(replaceWrap);mount.append(actions);
    },{wide:true});
  });
}

async function trashManager(){
  sideModal("Library Trash",async(mount,close)=>{
    const render=async()=>{mount.replaceChildren();let state;try{state=await H3PackAPI.trash();}catch(error){mount.append(el("div","z3h3-note bad",error.message||String(error)));return;}const rows=state.items||[],head=el("div","z3h3-pack-manager-copy");head.append(el("b",null,`Trash · ${rows.length} item${rows.length===1?"":"s"}`),el("small",null,"Normal Library deletes are recoverable here. Restore never overwrites a live stable ID or conflicting handle."));mount.append(head);if(!rows.length){mount.append(el("div","z3h3-pack-trash-empty","Trash is empty."));return;}const list=el("div","z3h3-pack-trash-list");for(const entry of rows.slice().reverse()){const record=entry.record||{},row=el("div","z3h3-pack-trash-row"),copy=el("div"),title=entry.kind==="cast"?(record.name||`@${record.handle||record.id}`):entry.kind==="reference"?(record.name||record.filename||`Reference ${record.id||""}`):(record.title||record.id||"Preset"),meta=entry.kind==="cast"?`Cast · ${record.group||"Unsorted"}`:entry.kind==="reference"?`Reference · ${record.group||"References"}`:`${entry.category||"Category"} · ${record.subcategory||"Unsorted"}`;copy.append(el("b",null,title),el("small",null,`${meta}${entry.source_pack?` · ${entry.source_pack}`:""}`));const tools=el("div","z3h3-pack-trash-tools");tools.append(button("Restore",async()=>{try{await H3PackAPI.restoreTrash(entry.trash_id);await reloadPack();announce(`${title} restored`,`good`);await render();}catch(error){announce(error.message||String(error),"bad");}},"z3h3-side-secondary"),button("Delete permanently…",async()=>{if(!confirm(`Permanently delete “${title}” from Trash? This removes the recoverable copy.`))return;const typed=prompt("Type DELETE to permanently destroy this Trash item.");if(typed!=="DELETE")return;try{await H3PackAPI.permanentDeleteTrash(entry.trash_id);announce(`${title} permanently deleted`,`good`);await render();}catch(error){announce(error.message||String(error),"bad");}},"z3h3-side-danger"));row.append(copy,tools);list.append(row);}mount.append(list);const footer=el("div","z3h3-pack-trash-footer");footer.append(button("Empty Trash permanently…",async()=>{if(!confirm(`Permanently empty all ${rows.length} Trash item${rows.length===1?"":"s"}?`))return;const typed=prompt("Type EMPTY to permanently empty Library Trash.");if(typed!=="EMPTY")return;try{await H3PackAPI.emptyTrash();announce("Library Trash emptied permanently","good");await render();}catch(error){announce(error.message||String(error),"bad");}},"z3h3-side-danger"));mount.append(footer);};await render();
  },{wide:true});
}


function promptEditor(category,prompt={},defaults={}){sideModal(prompt?.id?`Edit ${prompt.title||"starter"}`:"Add starter",(mount,close)=>{const title=textField("Title",prompt.title||""),sub=textField("Subcategory",prompt.subcategory||defaults.subcategory||""),note=textField("Short note",prompt.note||""),body=textField("Prompt",prompt.prompt||"",true),visual=textField("Visual motif",prompt.visual||defaults.visual||"concept");const actions=el("div","z3h3-pack-editor-actions");actions.append(button("Save",async()=>{try{await H3PackAPI.savePrompt(category,{...prompt,title:title.control.value,subcategory:sub.control.value,slot:prompt.slot||defaults.slot||"",note:note.control.value,prompt:body.control.value,visual:visual.control.value});close();announce("Starter saved","good");await reloadPack();}catch(error){announce(error.message||String(error),"bad");}},"z3h3-side-primary"),button("Cancel",close,"z3h3-side-secondary"));mount.append(title.wrap,sub.wrap,note.wrap,body.wrap,visual.wrap,actions);},{wide:true});}
function composeCastDescription(preset,base){
  const pieces=[];const push=(label,value)=>{const clean=String(value||"").trim();if(clean)pieces.push(label?`${label}: ${clean}`:clean);};
  push("",base);push("Identity",preset.identity_anchor);push("Physical traits",preset.physical_traits);push("Consistency",preset.consistency_notes);push("Positive anchors",preset.positive_anchors);push("Exclude",preset.negative_notes);return pieces.join(". ").replace(/\.\s*\./g,".").trim();
}
function castEditor(preset={}){
  sideModal(preset?.handle?`Edit ${preset.name||preset.handle}`:"Add Cast preset",(mount,close)=>{
    const originalHandle=String(preset.handle||"").trim(),name=textField("Name",preset.name||""),handle=textField("Handle",preset.handle||""),group=textField("Group",preset.group||"Custom"),desc=textField("Appearance / identity",preset.prompt_base??preset.description??"",true),clothing=textField("Default clothing",preset.permanent_look??preset.clothing??"",true),note=textField("Short note",preset.note||"");
    const actions=el("div","z3h3-pack-editor-actions");
    actions.append(button("Save",async()=>{try{
      const base=String(desc.control.value||"").trim(),permanent=String(clothing.control.value||"").trim(),saved=await H3PackAPI.saveCast({...preset,name:name.control.value,handle:handle.control.value,group:group.control.value,prompt_base:base,description:composeCastDescription(preset,base),permanent_look:permanent,use_scene_clothing:permanent?false:(preset.use_scene_clothing!==undefined?!!preset.use_scene_clothing:true),clothing:permanent,note:note.control.value});
      if(originalHandle&&originalHandle!==saved.handle)await H3PackAPI.deleteCast(originalHandle,{permanent:true});const body=activeCreatorBody();if(body)syncLinkedSubjectFromPreset(body,saved,{oldHandle:originalHandle});close();announce("Cast preset synced everywhere","good");await reloadPack();
    }catch(error){announce(error.message||String(error),"bad");}},"z3h3-side-primary"),button("Cancel",close,"z3h3-side-secondary"));
    mount.append(el("div","z3h3-note good","This is the same reusable Cast record used by Cast Studio. Name, description, clothing, group and thumbnail stay synchronized."),name.wrap,handle.wrap,group.wrap,desc.wrap,clothing.wrap,note.wrap,actions);
  },{wide:true});
}
function sectionPackToolbar({scope="category",category="",subcategory="",label="Section",onAdd=null}={}){const bar=el("div","z3h3-pack-toolbar");if(onAdd)bar.append(button("＋ Add",onAdd,"z3h3-pack-tool primary",`Add a new ${label.toLowerCase()} starter`));if(scope==="category")bar.append(button("Import item",()=>packImport("prompt_item",category,subcategory),"z3h3-pack-tool","Review one starter, then Append or Merge by stable ID"));if(scope==="cast")bar.append(button("Import character",()=>packImport("cast_item"),"z3h3-pack-tool","Review one Cast preset, then Append or Merge by stable ID"));bar.append(button("Import section",()=>packImport(scope,category,subcategory),"z3h3-pack-tool","Review this section import before anything changes"),button("Backup",()=>downloadPack({scope,category,subcategory}),"z3h3-pack-tool","Export this section including local thumbnails"));return bar;}
function packManager(){sideModal("Starter Pack Manager",async(mount,close)=>{
  const copy=el("div","z3h3-pack-manager-copy");copy.append(el("b",null,packState?.name||"Current H3 Library"),el("small",null,"Imports are reviewed before commit. APPEND never overwrites; MERGE updates stable IDs; replacement is restricted to one explicitly selected group. Normal deletes go to Trash."));
  const actions=el("div","z3h3-pack-manager-actions"),safety=el("div","z3h3-pack-safety-card"),trashCard=el("div","z3h3-pack-safety-card"),sourcesCard=el("div","z3h3-pack-source-card");actions.append(button("Import pack…",()=>packImport("pack"),"z3h3-side-primary"),button("Export full Library",()=>downloadPack({scope:"pack"}),"z3h3-side-secondary"),button("Import Cast…",()=>packImport("cast"),"z3h3-side-secondary"),button("Export Cast",()=>downloadPack({scope:"cast"}),"z3h3-side-secondary"));
  let backup={available:false},trash={count:0},sources=[];try{[backup,trash,sources]=await Promise.all([H3PackAPI.importBackupStatus(),H3PackAPI.trash(),H3PackAPI.sourcePacks()]);}catch{/* backend may be hot-reloading */}
  safety.append(el("b",null,"Transaction safety net"),el("small",null,backup.available?`Rollback ZIP available: ${backup.name}`:"A rollback ZIP is created before imports and destructive Library mutations."));if(backup.available)safety.append(button("Restore latest safety backup…",async()=>{if(!confirm("Restore the latest automatic Library backup? Current live Library data will be replaced by that backup."))return;await H3PackAPI.undoLastImport();close();await reloadPack();announce("Previous Library restored","good");},"z3h3-side-secondary"));
  trashCard.append(el("b",null,`Trash · ${trash.count||0}`),el("small",null,"Recover normal Cast/preset/reference deletions. Permanent deletion requires a separate deliberate confirmation."),button("Open Trash",()=>trashManager(),"z3h3-side-secondary"));
  sourcesCard.append(el("b",null,"Imported packs"),el("small",null,"Imported records retain pack provenance, so deleting one pack never means deleting unrelated Creator Palette Library content."));
  if(!sources.length)sourcesCard.append(el("div","z3h3-pack-trash-empty","No provenance-tracked imported packs are currently installed."));
  else{const list=el("div","z3h3-pack-source-list");for(const source of sources){const row=el("div","z3h3-pack-source-row"),info=el("div"),tools=el("div","z3h3-pack-source-tools");info.append(el("b",null,source.name||source.id),el("small",null,`${source.cast||0} Cast · ${source.references||0} refs · ${source.prompts||0} presets · ${(source.groups||[]).length} group${(source.groups||[]).length===1?"":"s"}`));tools.append(button("Move pack to Trash…",async()=>{const total=Number(source.cast||0)+Number(source.references||0)+Number(source.prompts||0);if(!confirm(`Move all ${total} reusable record${total===1?"":"s"} from “${source.name||source.id}” to Trash?\n\nUnrelated packs and workflow-local copies remain untouched.`))return;try{await H3PackAPI.deleteSourcePack(source.id);close();await reloadPack();announce(`${source.name||"Imported pack"} moved to Trash`,`good`);}catch(error){announce(error.message||String(error),"bad");}},"z3h3-side-secondary"),button("Delete pack permanently…",async()=>{const total=Number(source.cast||0)+Number(source.references||0)+Number(source.prompts||0);if(!confirm(`Permanently delete all ${total} reusable record${total===1?"":"s"} from “${source.name||source.id}”? Unrelated Library content remains.`))return;const typed=prompt(`Type DELETE PACK to permanently delete only “${source.name||source.id}”.`);if(typed!=="DELETE PACK")return;try{await H3PackAPI.deleteSourcePack(source.id,{permanent:true});close();await reloadPack();announce(`${source.name||"Imported pack"} permanently deleted`,`good`);}catch(error){announce(error.message||String(error),"bad");}},"z3h3-side-danger"));row.append(info,tools);list.append(row);}sourcesCard.append(list);}
  const danger=el("div","z3h3-pack-danger-zone");danger.append(el("b",null,"Reset shipped defaults"),el("small",null,"This replaces the live Library with the shipped starter set. A rollback ZIP is created first."),button("Reset shipped defaults…",async()=>{if(!confirm("Reset the editable Library to shipped defaults? A rollback backup will be created automatically."))return;await H3PackAPI.reset();close();await reloadPack();announce("Shipped Library restored · rollback available","good");},"z3h3-side-danger"));
  mount.append(copy,actions,safety,trashCard,sourcesCard,danger);
});}

async function loadPack(force=false){if(force||!packState){packState=await H3PackAPI.load();catalogPromise=null;setCastPresetCache(packState?.cast||[]);const body=activeCreatorBody();if(body)syncBodyFromCastPresets(body,packState?.cast||[]);}return packState;}
async function catalog(){const pack=await loadPack();return pack.catalog;}
function castPresets(){return packState?.cast||[];}
async function reloadPack(){await loadPack(true);window.dispatchEvent?.(new CustomEvent("z3-h3-pack-changed",{detail:{source:"sidebar"}}));rerenderSidebar?.();return packState;}
if(typeof window!=="undefined"&&!window.__z3H3SidebarPackSync){window.__z3H3SidebarPackSync=true;window.addEventListener("z3-h3-pack-changed",async(event)=>{if(event?.detail?.source==="sidebar")return;try{await loadPack(true);rerenderSidebar?.();}catch(error){console.error("MiniMax Creator sidebar Cast sync failed",error);}});}
function h3Model(data){return (data?.models||[]).find((model)=>model.id==="minimax-creator-h3")||data?.models?.[0]||null;}
function categoryMap(model){return Object.fromEntries((model?.categories||[]).map((category)=>[category.id,category]));}
function initials(label){return String(label||"?").split(/[\s_]+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()||"").join("")||"?";}
let statusNode=null;
function announce(message,kind="good"){if(!statusNode)return;statusNode.textContent=String(message||"");statusNode.dataset.kind=kind;clearTimeout(statusNode._timer);statusNode._timer=setTimeout(()=>{statusNode.textContent="Click a card to insert or swap it into the active Creator.";statusNode.dataset.kind="";statusNode._timer=null;},2600);}
function ensureBody(candidate){const body=activeCreatorBody()||candidate;if(!body?.node){announce("Select a MiniMax Creator node first.","bad");return null;}setActiveCreatorBody(body,"sidebar-action");return body;}
function insert(candidate,text,label="Prompt"){const body=ensureBody(candidate);if(!body)return false;const ok=body.insertText?.(text);if(ok)announce(`${label} added to ${body.target==="global"?"Global":`Shot ${Number(body.target)+1}`}`,"good");else announce(`${label} could not be inserted`,"bad");return !!ok;}
function apply(candidate,slot,prompt,category){const body=ensureBody(candidate);if(!body)return false;const ok=body.applyScenePreset?.(slot,{...prompt,category});if(ok)announce(`${SLOT_LABELS[slot]||slot} set to ${prompt.title}`,"good");else announce(`${prompt.title} could not be applied`,"bad");return !!ok;}
function clearSlot(candidate,slot){const body=ensureBody(candidate);if(!body)return;body.removeScenePreset?.(slot);announce(`${SLOT_LABELS[slot]||slot} cleared`,"good");}

function activeHeader(body){const head=el("div","z3h3-side-active v3104"),dot=el("i",body?"online":""),copy=el("div");copy.append(el("strong",null,body?(body.target==="global"?"Global / Shared":`Shot ${Number(body.target)+1}`):"No Creator selected"),el("small",null,body?"Creator connected · live edits":"Click a MiniMax Creator node to connect"));head.append(dot,copy);return head;}
function thumb(prompt,tone,body=null,slot=""){const wrap=el("div","z3h3-side-thumb"),sceneLocal=slot?body?.sceneThumbnail?.(slot,prompt):null,custom=(sceneLocal?body?.thumbnailUrl?.(sceneLocal):"")||(prompt?.thumbnail?H3PackAPI.thumbUrl(prompt.thumbnail):"");if(custom){wrap.classList.add("custom");wrap.style.backgroundImage=`url("${String(custom).replaceAll('"','%22')}")`;}else wrap.innerHTML=promptThumbnailSvg({id:prompt.id,title:prompt.title,visual:prompt.visual,accent:TONES[tone]||TONES.guide,compact:true});return wrap;}
function selectedStrip(body){
  const strip=el("div",`z3h3-side-selections${sidebarKitCollapsed?" collapsed":""}`),title=el("div","z3h3-side-selection-head"),headCopy=el("div");
  const model=body?buildPromptComposerModel(body):{parts:[],duration:null,frames:null};
  const sceneParts=model.parts.filter((part)=>H3_SCENE_SLOT_ORDER.includes(part.kind));
  const castParts=model.parts.filter((part)=>part.kind==="cast"),mediaParts=model.parts.filter((part)=>part.kind==="media"),loraParts=model.parts.filter((part)=>part.kind==="lora");
  const total=sceneParts.length+castParts.length+mediaParts.length+loraParts.length;
  headCopy.append(el("b",null,"Current scene"),el("small",null,`${total} active pieces · same state as the prompt editor`));
  const toggle=button(sidebarKitCollapsed?"Show":"Hide",()=>{sidebarKitCollapsed=!sidebarKitCollapsed;saveSidebarKitState();strip.classList.toggle("collapsed",sidebarKitCollapsed);detail.hidden=sidebarKitCollapsed;summary.hidden=!sidebarKitCollapsed;toggle.textContent=sidebarKitCollapsed?"Show":"Hide";},"z3h3-side-kit-toggle",sidebarKitCollapsed?"Show current scene":"Collapse current scene");
  title.append(headCopy,toggle);strip.append(title);

  const summary=el("div","z3h3-side-selection-summary");summary.hidden=!sidebarKitCollapsed;
  for(const part of [...castParts,...sceneParts,...mediaParts,...loraParts]){const tone=part.kind==="lora"?"lora":part.kind;const meta=H3_CATEGORY_META[tone]||H3_CATEGORY_META.guide;const pill=el("span",`tone-${tone}`,meta.label);pill.style.setProperty("--chip-tone",meta.color);pill.title=`${meta.title}: ${part.title}`;summary.append(pill);}
  const when=el("span","tone-timing","WHEN");when.style.setProperty("--chip-tone",H3_CATEGORY_META.timing.color);when.title=body?.target==="global"?"Global / Shared · each shot owns its timing":`Timing: ${Number(model.duration||0).toFixed(1)}s · ${model.frames} frames`;summary.append(when);
  if(!total)summary.append(el("small",null,"No scene pieces selected yet."));strip.append(summary);

  const detail=el("div","z3h3-side-current-detail");detail.hidden=sidebarKitCollapsed;
  const quick=el("div","z3h3-side-current-actions");
  quick.append(button("Cast",()=>{const target=ensureBody(body);if(target)openCastStudio(target);},"z3h3-side-kit-action","Open Cast Studio"),button("Inspect",()=>ensureBody(body)?.openInspector?.(),"z3h3-side-kit-action","Open the canonical Shot Inspector"),button("References",()=>ensureBody(body)?.openReferences?.(),"z3h3-side-kit-action","Open the canonical H3 Reference Manager"),button("Media",()=>ensureBody(body)?.openMedia?.(),"z3h3-side-kit-action","Quick-add image, video or audio media"),button("LoRAs",()=>ensureBody(body)?.openLoras?.(),"z3h3-side-kit-action","Manage active LoRAs"));
  if(body?.target!=="global"){const seg=body?.data?.segments?.[Number(body.target)];quick.append(button(seg?.kind==="clip"?"Clip options":"Shot Inspector",()=>ensureBody(body)?.openShotOptions?.(body.target),"z3h3-side-kit-action",seg?.kind==="clip"?"Open clip trim and continuation options":"Inspect exactly what this shot sends to H3"));}
  detail.append(quick);

  if(castParts.length){const group=el("div","z3h3-side-current-group");group.append(el("b","tone-cast","WHO"));for(const part of castParts){const chip=button(part.title,()=>{const target=ensureBody(body);if(target)openCastStudio(target,{swap:part.subject?.handle});},"z3h3-side-current-pill tone-cast",`${part.detail||part.title} · click to swap`);chip.style.setProperty("--chip-tone",H3_CATEGORY_META.cast.color);group.append(chip);}detail.append(group);}
  if(mediaParts.length){const group=el("div","z3h3-side-current-group");group.append(el("b","tone-media","MEDIA"));for(const part of mediaParts){const chip=button(part.title,()=>ensureBody(body)?.openMedia?.("input"),"z3h3-side-current-pill tone-media",part.detail||part.title);chip.style.setProperty("--chip-tone",H3_CATEGORY_META.media.color);group.append(chip);}detail.append(group);}

  const row=el("div","z3h3-side-selection-row");
  for(const part of sceneParts){const slot=part.kind,label=SLOT_LABELS[slot]||slot,selected=part.preset;const chip=el("div",`z3h3-side-selection-chip tone-${slot}`);chip.style.setProperty("--chip-tone",H3_CATEGORY_META[slot]?.color||H3_CATEGORY_META.guide.color);const main=button(`${label}: ${selected.title||"Selected"}`,()=>ensureBody(body)?.openScenePicker?.(slot),"z3h3-side-chip-main",`Change ${label} · ${selected.prompt||""}`);chip.append(main);if(part.own)chip.append(button("×",()=>clearSlot(body,slot),"z3h3-side-chip-x",`Remove ${label}`));else chip.append(el("small","z3h3-side-chip-scope","Shared"));chip.title=selected.prompt;row.append(chip);}
  if(!sceneParts.length)row.append(el("span","z3h3-side-selection-empty","Pick a location, clothing, prop, action, camera, lighting or audio preset below."));detail.append(row);

  if(loraParts.length){const group=el("div","z3h3-side-current-group");group.append(el("b","tone-lora","STYLE"));for(const part of loraParts){const chip=button(part.title,()=>ensureBody(body)?.openLoras?.(),"z3h3-side-current-pill tone-lora",part.detail||part.title);chip.style.setProperty("--chip-tone",H3_CATEGORY_META.lora.color);group.append(chip);}detail.append(group);}
  const timing=el("div","z3h3-side-current-group timing");timing.append(el("b","tone-timing","WHEN"),el("span","z3h3-side-current-time",body?.target==="global"?"Shared · per-shot timing":`${Number(model.duration||0).toFixed(1)}s · ${model.frames}f`));detail.append(timing);
  strip.append(detail);return strip;
}
function effectiveScenePreset(body,slot){
  const own=S.activeContainer(body?.data,body?.target)?.scene_palette?.[slot];
  if(own)return own;
  return body?.target!=="global"?body?.data?.scene_palette?.[slot]:null;
}
function renderSceneAudition(body,content,slot,rows,{tone=slot,label=SLOT_LABELS[slot]||slot}={}){
  if(!slot||!H3_SCENE_SLOT_ORDER.includes(slot))return;
  const available=(rows||[]).filter((prompt)=>prompt?.id),current=effectiveScenePreset(body,slot),config=body?sceneAuditionFor(body,slot):null,marker=body?.sceneVariation?.(slot)||0;
  const bar=el("div",`z3h3-audition-compact tone-${tone}`),copy=el("div","z3h3-audition-compact-copy");
  const mode=marker>0?`ALL + · ${available.length} presets`:marker<0?`ALL − · ${available.length} presets`:config?.candidates?.length?`SHORTLIST ${config.direction<0?"−":"+"} · ${config.candidates.length}`:"FIXED";
  copy.append(el("b",null,`${label} variation`),el("small",null,current?`${current.title||label} · ${mode}`:`Pick a ${label.toLowerCase()} below to enable variation`));bar.append(copy);
  if(body&&current){
    const actions=el("div","z3h3-audition-compact-actions");
    const setAll=(direction)=>{const active=body.sceneVariation?.(slot)||0;if(active!==direction)body.setSceneVariation?.(slot,direction);announce(direction>0?`${label}: ALL ${available.length} presets forward`:`${label}: ALL ${available.length} presets reverse`);};
    const fixed=()=>{const active=body.sceneVariation?.(slot)||0;if(active)body.setSceneVariation?.(slot,active);if(sceneAuditionFor(body,slot)?.candidates?.length)clearSceneAudition(body,slot);announce(`${label} fixed`);};
    const shortlist=()=>openSceneAuditionGallery(body,slot);
    actions.append(button("All +",()=>setAll(1),`z3h3-pack-tool${marker>0?" active":""}`,`Cycle every ${label} preset forward`),button("All −",()=>setAll(-1),`z3h3-pack-tool${marker<0?" active":""}`,`Cycle every ${label} preset backward`),button("Shortlist",shortlist,`z3h3-pack-tool${config?.candidates?.length&&!marker?" active":""}`,"Optional hand-picked audition pool"),button("Fixed",fixed,`z3h3-pack-tool${!marker&&!config?.candidates?.length?" active":""}`));bar.append(actions);
  }
  content.append(bar);
}

function sceneCard(body,prompt,{slot="",tone="guide",mode="swap",category="",subcategory=""}={}){
  const selected=slot&&body?.scenePreset?.(slot)?.id===prompt.id,card=el("div",`z3h3-side-scene-row tone-${tone}${selected?" selected":""}`),main=button("",()=>mode==="insert"?insert(body,prompt.prompt,prompt.title):apply(body,slot,prompt,category),"z3h3-side-scene-main",prompt.prompt);
  main.disabled=!body;main.append(thumb(prompt,tone,body,slot));const copy=el("div","z3h3-side-card-copy");copy.append(el("b",null,prompt.title),el("small",null,prompt.note||prompt.subcategory||"Click to apply"));if(slot)copy.append(el("span","z3h3-side-card-action",selected?`✓ ${SLOT_LABELS[slot]}`:`Use ${SLOT_LABELS[slot]}`));main.append(copy);
  const tools=el("div","z3h3-side-row-tools"),defaults={subcategory,slot};tools.append(button("✎",()=>promptEditor(category,prompt,defaults),"z3h3-side-row-tool","Edit this starter"),button("⋯",e=>contextMenu(e,[{label:"Edit starter",action:()=>promptEditor(category,prompt,defaults)},{label:"Export this starter",action:()=>downloadPack({scope:"prompt_item",category,id:prompt.id}),hint:"Portable one-item ZIP including its local thumbnail"},{label:"Add / replace thumbnail…",action:()=>setLocalThumb("prompt",category,prompt.id),hint:"Local image stored inside the pack"},{label:"Remove thumbnail",action:async()=>{await H3PackAPI.removeThumbnail({kind:"prompt",category,id:prompt.id});await reloadPack();},hint:"Return to generated icon"},{separator:true},{label:"Move to Trash",danger:true,action:async()=>{if(!confirm(`Move “${prompt.title}” to Library Trash? You can restore it later.`))return;await H3PackAPI.deletePrompt(category,prompt.id);announce("Starter moved to Trash","good");await reloadPack();}},{label:"Delete permanently…",danger:true,action:async()=>{if(!confirm(`Permanently delete “${prompt.title}”? This bypasses Trash.`))return;const typed=prompt(`Type DELETE to permanently remove “${prompt.title}”.`);if(typed!=="DELETE")return;await H3PackAPI.deletePrompt(category,prompt.id,{permanent:true});announce("Starter permanently deleted","good");await reloadPack();}}]),"z3h3-side-row-tool","Starter actions"));
  card.append(main,tools);card.addEventListener("contextmenu",e=>contextMenu(e,[{label:"Edit starter",action:()=>promptEditor(category,prompt,defaults)},{label:"Export this starter",action:()=>downloadPack({scope:"prompt_item",category,id:prompt.id}),hint:"Portable one-item ZIP including its local thumbnail"},{label:"Add / replace thumbnail…",action:()=>setLocalThumb("prompt",category,prompt.id)},{label:"Remove thumbnail",action:async()=>{await H3PackAPI.removeThumbnail({kind:"prompt",category,id:prompt.id});await reloadPack();}},{separator:true},{label:"Move to Trash",danger:true,action:async()=>{if(!confirm(`Move “${prompt.title}” to Library Trash? You can restore it later.`))return;await H3PackAPI.deletePrompt(category,prompt.id);await reloadPack();}},{label:"Delete permanently…",danger:true,action:async()=>{if(!confirm(`Permanently delete “${prompt.title}”? This bypasses Trash.`))return;const typed=prompt(`Type DELETE to permanently remove “${prompt.title}”.`);if(typed!=="DELETE")return;await H3PackAPI.deletePrompt(category,prompt.id,{permanent:true});await reloadPack();}}]));return card;
}

function renderPromptSection(body,content,category,query,spec){
  const all=(category?.prompts||[]).filter((prompt)=>spec.semanticSlot?scenePromptMatchesSlot(spec.semanticSlot,category?.id,prompt):!spec.subcategory||prompt.subcategory===spec.subcategory),prompts=all.filter((prompt)=>!query||`${prompt.title} ${prompt.note||""} ${prompt.subcategory||""} ${prompt.prompt}`.toLowerCase().includes(query));
  const label=spec.label||SLOT_LABELS[spec.slot]||category?.name||"Starter",scope=`prompt:${category.id}:${spec.slot||spec.subcategory||label}`;
  const groups=new Map();for(const prompt of prompts){const name=prompt.pack_group||prompt.group||prompt.subcategory||category.name||"Presets";if(!groups.has(name))groups.set(name,[]);groups.get(name).push(prompt);}
  const groupNames=[...groups.keys()];
  const subcategories=[...new Set(all.map((prompt)=>String(prompt.subcategory||"").trim()).filter(Boolean))],sectionSubcategory=spec.semanticSlot&&subcategories.length===1?subcategories[0]:spec.subcategory||"";
  const head=el("div","z3h3-pack-section-head"),copy=el("div"),toolbar=sectionPackToolbar({scope:"category",category:category.id,subcategory:sectionSubcategory,label,onAdd:()=>promptEditor(category.id,{}, {subcategory:sectionSubcategory,slot:spec.semanticSlot||spec.slot||"",visual:spec.tone||spec.slot||"concept"})});
  copy.append(el("b",null,label),el("small",null,`${all.length} editable starter${all.length===1?"":"s"} · folders collapse · right-click rows for edit / thumbnail / delete`));
  if(groupNames.length){toolbar.append(button("Close folders",()=>setManyGroups(scope,groupNames,true),"z3h3-pack-tool","Collapse every folder in this section"),button("Open folders",()=>setManyGroups(scope,groupNames,false),"z3h3-pack-tool","Expand every folder in this section"));}
  head.append(copy,toolbar);content.append(head);
  if(spec.slot&&all.length)renderSceneAudition(body,content,spec.slot,all,{tone:spec.tone||spec.slot,label:SLOT_LABELS[spec.slot]||spec.slot});
  if(!prompts.length){content.append(el("div","z3h3-side-empty",query?"No matching starters in this editable section.":"This section is empty. Add one or import a pack."));return 0;}
  let count=0;
  for(const [group,rows] of groups){
    const activeId=spec.slot?body?.scenePreset?.(spec.slot)?.id:null,containsActive=!!activeId&&rows.some(row=>String(row.id)===String(activeId));
    const folder=folderHeader({scope,name:group,count:rows.length,baseColor:TONES[spec.tone||spec.slot]||TONES.guide,query,defaultCollapsed:!containsActive});
    const list=el("div","z3h3-side-compact-list");
    for(const prompt of rows){list.append(sceneCard(body,prompt,{slot:spec.slot||"",tone:spec.tone||"guide",mode:spec.mode||"swap",category:category.id,subcategory:prompt.subcategory||sectionSubcategory}));count++;}
    folder.body.append(list);folder.section.append(folder.body);content.append(folder.section);
  }
  return count;
}
function renderAudio(body,content,categories,query){
  let count=0;const labels={dialogue:"Dialogue / Performance",ambience:"Ambience / Foley",music:"Music"};
  for(const slot of ["dialogue","ambience","music"]){for(const category of Object.values(categories||{})){if(!(category?.prompts||[]).some((prompt)=>scenePromptMatchesSlot(slot,category.id,prompt)))continue;count+=renderPromptSection(body,content,category,query,{slot,tone:slot,label:labels[slot],semanticSlot:slot});}}
  return count;
}

function addPreset(candidate,preset){const body=ensureBody(candidate);if(!body)return null;const handle=S.normalizeSubjectHandle(preset.handle||preset.name);let subject=(body.data.subjects||[]).find((candidate)=>candidate.handle===handle||String(candidate.preset_id||"")===String(preset.id||preset.handle||""));if(!subject){subject={handle,takes:"person",from:[]};body.data.subjects.push(subject);}subject.handle=handle;subject.display_name=preset.name;subject.description=preset.description;subject.clothing=preset.clothing||"";subject.preset_group=preset.group||"Custom";subject.preset_note=preset.note||"";subject.takes="person";subject.preset_id=preset.id||preset.handle||handle;if(preset.thumbnail)subject.pack_thumbnail=preset.thumbnail;else delete subject.pack_thumbnail;body.commitData();announce(`${preset.name} added to Creator Cast`,"good");return subject;}
function removeSubjectMention(candidate,subject){const body=ensureBody(candidate);if(!body)return;const changed=body.removeSubjectMention?.(subject);announce(changed?`@${subject.handle} removed from this prompt — character kept`:`@${subject.handle} is not used in this prompt`,changed?"good":"warn");}
function deleteSubjectFromCreator(candidate,subject){const body=ensureBody(candidate);if(!body)return;if(!confirm(`Delete ${subjectDisplayName(subject)} from this Creator and remove its mentions? The reusable Cast preset is kept.`))return;body.removeSubject?.(subject);announce(`${subjectDisplayName(subject)} deleted from this Creator; reusable preset kept`,"good");}
function presetAvatar(preset){const avatar=el("div","z3h3-side-cast-thumb");if(preset?.thumbnail){avatar.classList.add("custom");avatar.style.backgroundImage=`url("${String(H3PackAPI.thumbUrl(preset.thumbnail)).replaceAll('"','%22')}")`;}else{avatar.textContent=initials(preset.name);avatar.style.setProperty("--cast-hue",String(Math.abs([...String(preset.id||preset.name)].reduce((n,c)=>n+c.charCodeAt(0),0))%360));avatar.append(el("small",null,"Cast"));}return avatar;}


function castAuditionChoices(subjects){
  const byHandle=new Map();
  for(const subject of subjects||[]){if(subject?.handle)byHandle.set(subject.handle,subject);}
  for(const preset of castPresets()){
    const handle=S.normalizeSubjectHandle(preset?.handle||preset?.name||"Character");if(!handle||byHandle.has(handle))continue;
    byHandle.set(handle,{handle,display_name:preset.name||handle,preset_id:preset.id||preset.handle||handle,preset_group:preset.group||"Cast",preset_note:preset.note||"",pack_thumbnail:preset.thumbnail||"",description:preset.description||"",clothing:preset.clothing||"",takes:"person",from:[]});
  }
  return [...byHandle.values()];
}

function renderAuditionForRole(body,content){
  if(!body?.data?.subjects?.length)return;const mentioned=castMentionHandles(body),subjects=body.data.subjects||[],pool=castAuditionChoices(subjects);
  const bar=el("div","z3h3-audition-compact tone-cast"),copy=el("div","z3h3-audition-compact-copy");copy.append(el("b",null,"Cast variation"),el("small",null,mentioned.length?`${mentioned.length} role${mentioned.length===1?"":"s"} · All = complete ${pool.length}-member Cast pool · shortlist optional`:"Insert a Cast @mention to enable role auditions"));bar.append(copy);
  if(mentioned.length){const open=()=>{const role=mentioned.includes(selectedAuditionRole)?selectedAuditionRole:mentioned[0];openCastAuditionGallery(body,role,{roles:mentioned,onRoleChange:(handle)=>{selectedAuditionRole=handle;}});};bar.append(button("Open gallery",open,"z3h3-pack-tool","Open cohesive Cast variation gallery"));}
  content.append(bar);
}

function renderCast(body,content,query){
  const tools=el("div","z3h3-side-cast-tools");tools.append(button("＋ Character",()=>{const target=ensureBody(body);if(target)openCastStudio(target,{create:true});},"z3h3-side-primary","Create a character directly in this Creator"),button("Cast Studio",()=>{const target=ensureBody(body);if(target)openCastStudio(target);},"z3h3-side-secondary"),button("Pack Manager",packManager,"z3h3-side-secondary"));content.append(tools);
  renderAuditionForRole(body,content);
  const activeHead=el("div","z3h3-pack-section-head"),acopy=el("div");acopy.append(el("b",null,"In this Creator"),el("small",null,"Live Cast definitions stay here even when their @mention is removed. Linked presets sync with the reusable pack below."));activeHead.append(acopy);content.append(activeHead);
  const active=el("div","z3h3-side-cast-list compact");if(!body?.data?.subjects?.length)active.append(el("div","z3h3-side-empty","No active Cast yet. Use a reusable preset below or create a character."));
  for(const subject of body?.data?.subjects||[]){const hay=`${subjectDisplayName(subject)} ${subject.handle} ${subject.description||""}`.toLowerCase();if(query&&!hay.includes(query))continue;const source=String(S.activePrompt(body.data,body.target)||""),mentioned=new RegExp(`@${subject.handle}(?!-[0-9])(?![A-Za-z0-9_])`).test(source),row=el("div",`z3h3-side-cast-row compact${mentioned?" mentioned":""}`);row.append(createSubjectAvatar(body,subject));const copy=el("div");copy.append(el("b",null,subjectDisplayName(subject)),el("small",null,`@${subject.handle} · ${mentioned?"in this prompt":"kept in Cast"}`));const actions=el("div","z3h3-side-row-tools");const menuItems=()=>[{label:"Edit in Cast Studio",action:()=>{const target=ensureBody(body);if(target)openCastStudio(target,{edit:subject.handle});}},{label:"Insert @mention",action:()=>insert(body,`@${subject.handle}`,subjectDisplayName(subject))},{label:"Remove @ from this prompt",action:()=>removeSubjectMention(body,subject),hint:"Keeps the character, edits and reusable preset"},{separator:true},{label:"Delete from this Creator",danger:true,action:()=>deleteSubjectFromCreator(body,subject),hint:"Reusable pack preset is still kept"}];actions.append(button("＋",()=>insert(body,`@${subject.handle}`,subjectDisplayName(subject)),"z3h3-side-row-tool","Insert @mention"),button("✎",()=>{const target=ensureBody(body);if(target)openCastStudio(target,{edit:subject.handle});},"z3h3-side-row-tool","Edit synced Cast member"),button("−@",()=>removeSubjectMention(body,subject),"z3h3-side-row-tool","Remove only this prompt mention"),button("⋯",e=>contextMenu(e,menuItems()),"z3h3-side-row-tool","More Cast actions"));row.append(copy,actions);row.addEventListener("contextmenu",e=>contextMenu(e,menuItems()));active.append(row);}content.append(active);

  const groups=new Map();for(const preset of castPresets()){const hay=`${preset.name} ${preset.group} ${preset.note||""} ${preset.description||""}`.toLowerCase();if(query&&!hay.includes(query))continue;const group=preset.group||"Custom";if(!groups.has(group))groups.set(group,[]);groups.get(group).push(preset);}
  const groupNames=[...groups.keys()],scope="cast-pack";
  const packHead=el("div","z3h3-pack-section-head"),pcopy=el("div"),packTools=sectionPackToolbar({scope:"cast",label:"Cast",onAdd:()=>castEditor({})});pcopy.append(el("b",null,"Reusable Cast pack"),el("small",null,`${castPresets().length} editable presets · collapsible color-coded folders · right-click for thumbnail / edit / delete`));
  if(groupNames.length){packTools.append(button("Close folders",()=>setManyGroups(scope,groupNames,true),"z3h3-pack-tool","Collapse every Cast folder"),button("Open folders",()=>setManyGroups(scope,groupNames,false),"z3h3-pack-tool","Expand every Cast folder"));}
  packHead.append(pcopy,packTools);content.append(packHead);

  for(const [group,presets] of groups){
    const containsActive=presets.some(preset=>{const handle=S.normalizeSubjectHandle(preset.handle||preset.name);return body?.data?.subjects?.some(subject=>subject.handle===handle);});
    const folder=folderHeader({scope,name:group,count:presets.length,baseColor:TONES.cast,query,defaultCollapsed:!containsActive}),list=el("div","z3h3-side-compact-list");
    for(const preset of presets){
      const handle=S.normalizeSubjectHandle(preset.handle||preset.name),activeSubject=body?.data?.subjects?.find((subject)=>subject.handle===handle),row=el("div",`z3h3-side-cast-pack-row${activeSubject?" active":""}`),main=button("",()=>{if(activeSubject)insert(body,`@${handle}`,preset.name);else{const subject=addPreset(body,preset);if(subject)insert(body,`@${subject.handle}`,preset.name);}},"z3h3-side-cast-pack-main",preset.description||preset.note||"");
      main.disabled=!body;main.append(presetAvatar(preset));const copy=el("div");copy.append(el("b",null,preset.name),el("small",null,activeSubject?`@${handle} · active`:preset.note||preset.group));main.append(copy);
      const menuItems=()=>[{label:"Edit preset",action:()=>castEditor(preset)},{label:"Export this Cast preset",action:()=>downloadPack({scope:"cast_item",id:preset.handle}),hint:"Portable one-item ZIP including its local thumbnail"},{label:"Add / replace thumbnail…",action:()=>setLocalThumb("cast","",preset.handle),hint:"Stored as a small local image in the pack"},{label:"Remove thumbnail",action:async()=>{await H3PackAPI.removeThumbnail({kind:"cast",category:"",id:preset.handle});await reloadPack();}},{separator:true},{label:"Move reusable character to Trash",danger:true,action:async()=>{if(!confirm(`Move “${preset.name}” to Library Trash? Workflow-local copies remain usable.`))return;await H3PackAPI.deleteCast(preset.handle,{id:preset.id||""});await reloadPack();}},{label:"Delete reusable character permanently…",danger:true,action:async()=>{if(!confirm(`Permanently delete “${preset.name}” from the reusable Cast Library? Workflow-local copies remain.`))return;const typed=prompt(`Type DELETE to permanently remove “${preset.name}”.`);if(typed!=="DELETE")return;await H3PackAPI.deleteCast(preset.handle,{id:preset.id||"",permanent:true});await reloadPack();}}];
      const actions=el("div","z3h3-side-row-tools");actions.append(button("✎",()=>castEditor(preset),"z3h3-side-row-tool","Edit reusable Cast preset"),button("⋯",e=>contextMenu(e,menuItems()),"z3h3-side-row-tool","Preset actions"));row.append(main,actions);row.addEventListener("contextmenu",e=>contextMenu(e,menuItems()));list.append(row);
    }
    folder.body.append(list);folder.section.append(folder.body);content.append(folder.section);
  }
  if(!groups.size)content.append(el("div","z3h3-side-empty",query?"No matching reusable Cast presets.":"Cast pack is empty. Import or add presets."));
}

async function mountSidebar(root){
  if(unsubscribe){unsubscribe();unsubscribe=null;}currentRoot=root;root.classList.add("z3h3-sidebar-root");applyCreatorAppearance(root);let model=null,categories={};
  try{await loadPack();}catch(error){root.replaceChildren(el("div","z3h3-side-empty",`Could not load editable H3 pack: ${error.message}`));return;}
  const rebuildMaps=()=>{model=h3Model(packState?.catalog||{});categories=categoryMap(model);};rebuildMaps();
  let tab="location",query="",body=activeCreatorBody();const shell=el("div","z3h3-side-shell"),header=el("div","z3h3-side-head compact"),tabs=el("div","z3h3-side-tabs compact"),search=document.createElement("input"),content=el("div","z3h3-side-content");search.type="search";search.placeholder="Search this pack…";search.className="z3h3-side-search";const brand=el("div","z3h3-side-brand"),brandActions=el("div","z3h3-side-brand-actions");brand.append(el("b",null,"MiniMax Scene Builder"),el("span",null,"editable H3 packs · z3rofeels"));brandActions.append(button("Pack",packManager,"z3h3-pack-tool","Import/export/swap the current editable pack"));const connection=el("div");statusNode=el("div","z3h3-side-status compact","Click to apply · right-click a starter to edit, thumbnail or delete.");header.append(brand,brandActions,connection,search,statusNode);shell.append(header,tabs,content);root.replaceChildren(shell);
  let lastSignature="";
  const render=()=>{rebuildMaps();body=activeCreatorBody();lastSignature=sidebarStateSignature(body);connection.replaceChildren(activeHeader(body));tabs.replaceChildren();for(const item of TABS){const tone=item.tone||item.id;const tabButton=button(item.label,()=>{tab=item.id;render();},`z3h3-side-tab tone-${tone}${tab===item.id?" active":""}`,item.hint||item.label);tabButton.style.setProperty("--tab-tone",TONES[tone]||TONES.guide);tabs.append(tabButton);}content.replaceChildren();content.append(selectedStrip(body));const q=query.trim().toLowerCase();if(tab==="cast"){renderCast(body,content,q);return;}if(tab==="audio"){renderAudio(body,content,categories,q);return;}const spec=TABS.find((item)=>item.id===tab)||TABS[0];let count=0;if(spec.slot){for(const category of Object.values(categories)){if(!(category?.prompts||[]).some((prompt)=>scenePromptMatchesSlot(spec.slot,category.id,prompt)))continue;count+=renderPromptSection(body,content,category,q,{...spec,label:spec.label,semanticSlot:spec.slot});}}else{for(const id of spec.categories||[spec.category]){if(!id)continue;const category=categories[id];if(category)count+=renderPromptSection(body,content,category,q,{...spec,label:spec.label});}}if(!count&&!content.querySelector(".z3h3-pack-section-head"))content.append(el("div","z3h3-side-empty",q?"No matching scene tools in this section.":"This editable pack section is empty."));};
  rerenderSidebar=render;search.addEventListener("input",()=>{query=search.value;render();});unsubscribe=subscribeCreatorBody((candidate,reason)=>{const next=sidebarStateSignature(candidate);if(String(reason)==="data"&&next===lastSignature)return;render();});
}


export function installH3Sidebar(app){
  if(installed)return;installed=true;const manager=app?.extensionManager;if(!manager?.registerSidebarTab){console.warn("MiniMax Creator Palette: current ComfyUI sidebar API is unavailable; node UI remains fully usable.");return;}
  try{manager.registerSidebarTab({id:"z3-minimax-creator-workspace",icon:"pi pi-video",title:"MiniMax Creator",tooltip:"Visual MiniMax H3 scene builder, Cast, locations, clothing, props, camera, lighting and audio",type:"custom",render:(element)=>{mountSidebar(element).catch((error)=>{element.textContent=`MiniMax Creator sidebar failed: ${error.message}`;console.error(error);});},destroy:()=>{unsubscribe?.();unsubscribe=null;currentRoot=null;statusNode=null;rerenderSidebar=null;}});}catch(error){console.error("MiniMax Creator Palette: sidebar registration failed",error);}
}
