import * as H from "./z3_h3_api.js";
import * as S from "./z3_h3_state.js";
import { openCastStudio, createSubjectAvatar, subjectDisplayName, refreshCastPresetCache, castPresetLibrary } from "./h3_cast_studio.js";
import { cycleSceneSlotPreset, openSceneAuditionGallery } from "./h3_scene_stack.js";
import { auditionFor, toggleAuditionCandidate, activateAuditionShortlist, clearAudition, setAllCastMarker, clearAllCastMarker } from "./h3_cast_auditions.js";
import { sceneAuditionFor, clearSceneAudition } from "./h3_scene_auditions.js";
import { H3_CATEGORY_META, categoryMeta } from "./h3_prompt_categories.js";
import { castVariationDirection } from "./h3_prompt_tokens.js";
import { promptThumbnailSvg } from "./prompt_library.js";
import { auditionMode, galleryRows } from "./h3_gallery_model.js";

const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
const esc=(value)=>String(value??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let activeMenu=null;

function closeMenu(){activeMenu?.cleanup?.();activeMenu=null;}
function stop(event){event.preventDefault?.();event.stopPropagation?.();}
function button(text,fn,cls="z3h3-btn",title=""){
  const node=el("button",cls,text);node.type="button";if(title)node.title=title;
  node.addEventListener("pointerdown",(event)=>event.stopPropagation());
  node.addEventListener("click",async(event)=>{stop(event);try{await fn?.(event);}catch(error){console.error("MiniMax Creator quick action failed",error);}});
  return node;
}
function modal(title,build,{wide=false}={}){
  const back=el("div","z3h3-backdrop"),box=el("div",`z3h3-modal${wide?" wide":""}`),head=el("div","z3h3-modal-head"),body=el("div","z3h3-modal-body");
  let closed=false;const closeModal=()=>{if(closed)return;closed=true;document.removeEventListener("keydown",onKey,true);back.remove();};
  const onKey=(event)=>{if(event.key==="Escape")closeModal();};
  const close=button("Close",closeModal,"z3h3-btn");
  head.append(el("div",null,title),el("div","z3h3-spacer"),close);box.append(head,body);back.append(box);document.body.append(back);
  document.addEventListener("keydown",onKey,true);back.addEventListener("mousedown",(event)=>{if(event.target===back)closeModal();});
  build(body,closeModal,box);
  return back;
}
const THUMB_SHELF_KEY="z3.minimaxCreator.thumbnailShelf.v1";
function visuals(body){
  return S.allKnownAssets(body.data).filter((asset)=>asset&&(asset.kind==="image"||(asset.kind==="video"&&asset.track!=="sound")));
}
function readShelf(){try{return localStorage.getItem(THUMB_SHELF_KEY)||"z3_minimax_creator/thumbnails";}catch{return "z3_minimax_creator/thumbnails";}}
function writeShelf(value){try{localStorage.setItem(THUMB_SHELF_KEY,String(value||""));}catch{/* storage unavailable */}}
function descriptorFromAsset(asset){
  if(!asset)return null;
  const annotated=String(asset.filename||asset.path||"");
  const output=/ \[output\]$/.test(annotated)||asset.type==="output";
  const bare=annotated.replace(/ \[output\]$/,'');const parts=bare.split("/");const filename=parts.pop()||bare,subfolder=asset.subfolder??parts.join("/");
  return {filename,subfolder:subfolder||"",type:output?"output":"input",kind:asset.kind||H.kindFromName(filename),...(asset.handle?{handle:asset.handle}:{})};
}
function descriptorKey(value){if(!value)return "";if(typeof value==="string")return `handle:${value.replace(/^@/,"")}`;if(value.handle)return `handle:${value.handle}`;return `${value.type||"input"}:${value.subfolder||""}/${value.filename||""}`;}
function thumbForDescriptor(body,value){
  if(!value)return "";const direct=body.thumbnailUrl?.(value);if(direct)return direct;
  const row=typeof value==="string"?descriptorFromAsset(body.assetByHandle?.(value)):value;if(!row)return "";
  if(row.kind==="image")return H.viewUrl(row);
  if(row.kind==="video"){const path=[row.subfolder,row.filename].filter(Boolean).join("/")+(row.type==="output"?" [output]":"");return H.thumbUrl(path,256);}
  return "";
}
function thumbnailPicker(body,title,current,onSet){
  modal(title,(mount,close)=>{
    let tab="shelf",rows=[],query="",loading=false;
    const currentKey=descriptorKey(current),note=el("div","z3h3-note","Thumbnail-only gallery. Pick from attached references, any ComfyUI input image/video, finished outputs, or your dedicated thumbnail shelf. Nothing selected here is added to the H3 reference stack."),tools=el("div","z3h3-thumb-browser-tools"),tabs=el("div","z3h3-tabs"),search=document.createElement("input"),grid=el("div","z3h3-thumb-browser-grid"),status=el("div","z3h3-note"),shelfRow=el("div","z3h3-thumb-shelf-row"),shelf=document.createElement("input"),upload=document.createElement("input");
    search.type="search";search.placeholder="Search thumbnails…";search.addEventListener("input",()=>{query=search.value.toLowerCase();render();});
    shelf.type="text";shelf.value=readShelf();shelf.placeholder="z3_minimax_creator/thumbnails";shelf.title="Folder inside ComfyUI/input used as your thumbnail shelf";
    upload.type="file";upload.accept="image/*";upload.multiple=true;
    const tabButton=(id,label)=>button(label,()=>{tab=id;load();},`z3h3-btn${tab===id?" primary":""}`);
    const refreshTabs=()=>{tabs.replaceChildren(tabButton("shelf","Thumbnail Shelf"),tabButton("attached","Attached"),tabButton("input","Inputs"),tabButton("output","Outputs"));};
    const toDescriptor=(row)=>{
      if(row?.handle)return descriptorFromAsset(row);
      const annotated=String(row?.path||"");const output=/ \[output\]$/.test(annotated)||tab==="output";return {filename:String(row?.name||row?.filename||"").trim(),subfolder:String(row?.subfolder||""),type:output?"output":"input",kind:row?.kind||H.kindFromName(row?.name||row?.filename||"")};
    };
    const render=()=>{
      refreshTabs();grid.replaceChildren();
      const auto=button("",()=>{onSet?.(null);close();},`z3h3-thumb-choice${!currentKey?" active":""}`,"Use the automatic thumbnail / icon");
      const autoVisual=el("div","z3h3-thumb-choice-visual");autoVisual.innerHTML=promptThumbnailSvg({id:"auto-thumb",title:"Automatic",visual:"concept",accent:H3_CATEGORY_META.guide.color,compact:true});
      const autoCopy=el("div","z3h3-thumb-choice-copy");autoCopy.append(el("b",null,"Automatic"),el("small",null,"Default category icon or first Cast appearance source"));auto.append(autoVisual,autoCopy);grid.append(auto);
      const filtered=rows.filter((row)=>{const d=toDescriptor(row);if(!d||!["image","video"].includes(d.kind))return false;if(tab==="shelf"&&d.type==="input"&&!String(d.subfolder||"").startsWith(String(shelf.value||"").replace(/\\/g,"/").replace(/^\/+|\/+$/g,"")))return false;const hay=`${d.filename} ${d.subfolder} ${row.handle||""}`.toLowerCase();return !query||hay.includes(query);});
      for(const row of filtered){const descriptor=toDescriptor(row),key=descriptorKey(descriptor),label=row.handle?`@${row.handle}`:descriptor.filename;
        const card=button("",()=>{onSet?.(descriptor);close();},`z3h3-thumb-choice${key===currentKey?" active":""}`,`Use ${label} as the thumbnail`),visual=el("div","z3h3-thumb-choice-visual"),url=thumbForDescriptor(body,descriptor);if(url)visual.style.backgroundImage=`url("${String(url).replaceAll('"','%22')}")`;else visual.textContent=descriptor.kind==="video"?"▶":"▧";
        const copy=el("div","z3h3-thumb-choice-copy");copy.append(el("b",null,label),el("small",null,[descriptor.type==="output"?"Output":row.handle?"Attached":"Input",descriptor.subfolder].filter(Boolean).join(" · ")));card.append(visual,copy);grid.append(card);}
      if(!filtered.length&&!loading)grid.append(el("div","z3h3-note",tab==="shelf"?"This thumbnail shelf is empty. Upload images here or change the shelf path below. Videos already present in Inputs/Outputs can still be chosen by their preview frame.":"No matching visual media in this source."));
      status.textContent=loading?"Loading gallery…":`${filtered.length} thumbnail choice${filtered.length===1?"":"s"} shown · selection is UI-only`;
      shelfRow.hidden=tab!=="shelf";
    };
    const load=async()=>{loading=true;render();try{if(tab==="attached")rows=visuals(body);else{const root=tab==="output"?"output":"input";rows=(await H.listAssets(root)).assets||[];}}catch(error){rows=[];status.textContent=error.message||String(error);}finally{loading=false;render();}};
    shelf.addEventListener("change",()=>{writeShelf(shelf.value.trim()||"z3_minimax_creator/thumbnails");load();});
    upload.addEventListener("change",async()=>{const dest=shelf.value.trim()||"z3_minimax_creator/thumbnails";writeShelf(dest);status.textContent="Uploading to thumbnail shelf…";for(const file of upload.files||[])await H.uploadFile(file,dest);upload.value="";tab="shelf";await load();});
    shelfRow.append(el("span",null,"Shelf inside ComfyUI/input"),shelf,el("label","z3h3-thumb-upload-label","Upload thumbnails"));shelfRow.lastChild.append(upload);
    tools.append(tabs,search);mount.append(note,tools,shelfRow,status,grid);load();
  },{wide:true});
}
function activeCastMarker(body,role){
  return castVariationDirection(String(S.activePrompt(body.data,body.target)||""),role);
}

function castModeCard(title,detail,active,action,{disabled=false,icon=""}={}){const node=button("",action,`z3h3-gallery-mode${active?" active":""}`,detail);node.disabled=disabled;node.append(el("span","z3h3-gallery-mode-icon",icon),el("b",null,title),el("small",null,detail));return node;}

export function openCastAuditionGallery(body,initialRole,options={}){
  let role=String(initialRole||"").replace(/^@/,""),choices=[];
  const roles=[...new Set([role,...(options.roles||[])].map((value)=>String(value||"").replace(/^@/,"")).filter(Boolean))];
  return modal("Cast auditions",(mount,close,box)=>{
    box.parentElement?.classList.add("z3h3-gallery-backdrop");box.classList.add("z3h3-scene-gallery","tone-cast");box.style.setProperty("--gallery-tone",H3_CATEGORY_META.cast.color);mount.classList.add("z3h3-gallery-body");
    const head=box.querySelector(":scope > .z3h3-modal-head"),identity=el("div","z3h3-gallery-identity"),mark=el("i","z3h3-gallery-mark"),headCopy=el("div");
    headCopy.append(el("small",null,"ROLE-BASED BATCH AUDITION"),el("b",null,"Cast variations"),el("span",null,"Keep each prompt role stable while auditioning the complete Cast or a deliberate shortlist."));identity.append(mark,headCopy);head.classList.add("z3h3-gallery-head");head.replaceChildren(identity,button("Close",close,"z3h3-btn z3h3-gallery-close"));
    const roleTabs=el("div","z3h3-gallery-role-tabs"),toolbar=el("div","z3h3-gallery-toolbar"),search=document.createElement("input"),summary=el("div","z3h3-gallery-summary"),modes=el("div","z3h3-gallery-modes"),status=el("div","z3h3-gallery-status"),grid=el("div","z3h3-gallery-grid cast");
    search.type="search";search.placeholder="Search names, handles, groups, appearance or clothing…";toolbar.append(el("div","z3h3-gallery-search"));toolbar.firstChild.append(el("span",null,"⌕"),search);
    const load=async()=>{await refreshCastPresetCache();const byHandle=new Map();for(const subject of body.data.subjects||[]){if(subject?.handle)byHandle.set(subject.handle,subject);}for(const preset of castPresetLibrary()){const handle=S.normalizeSubjectHandle(preset?.handle||preset?.name||"Character");if(!handle||byHandle.has(handle))continue;byHandle.set(handle,{handle,display_name:preset.name||handle,preset_id:preset.id||preset.handle||handle,preset_group:preset.group||"Cast",preset_note:preset.note||"",pack_thumbnail:preset.thumbnail||"",description:preset.description||"",clothing:preset.clothing||"",takes:"person",from:[]});}choices=[...byHandle.values()];};
    const draw=()=>{
      if(roles.length>1){roleTabs.replaceChildren(...roles.map((handle)=>button(`@${handle}`,()=>{role=handle;options.onRoleChange?.(handle);draw();},`z3h3-gallery-role${handle===role?" active":""}`,`Configure @${handle}`)));roleTabs.hidden=false;}else roleTabs.hidden=true;
      const config=auditionFor(body,role)||{candidates:[],direction:1},marker=activeCastMarker(body,role),activeMode=auditionMode({marker,candidates:config.candidates,direction:config.direction}),rows=galleryRows(choices,{query:search.value,currentId:role,candidates:config.candidates,marker,direction:config.direction,audition:true}),current=choices.find((subject)=>subject.handle===role);
      summary.replaceChildren();const selected=el("div","z3h3-gallery-current");selected.append(el("small",null,"CURRENT ROLE / START"),el("b",null,subjectDisplayName(current)||`@${role}`),el("span",null,`@${role} · ${choices.length} live Cast members`));summary.append(selected);const shortlistTools=el("div","z3h3-gallery-shortlist-head");shortlistTools.append(el("div",null));shortlistTools.firstChild.append(el("b",null,"Optional shortlist"),el("small",null,"Select alternates without replacing the character currently assigned to this role."));if(config.candidates.length)shortlistTools.append(button("Clear shortlist",()=>{clearAudition(body,role);draw();},"z3h3-btn danger"));summary.append(shortlistTools);
      const fixed=()=>{if(marker)clearAllCastMarker(body,role);if(auditionFor(body,role)?.candidates?.length)clearAudition(body,role);draw();};
      const all=(direction)=>{if(activeCastMarker(body,role)!==direction)setAllCastMarker(body,role,direction);draw();};
      modes.replaceChildren(
        castModeCard("Fixed","Keep the current Cast member",activeMode==="fixed",fixed,{icon:"◆"}),
        castModeCard("All forward",`Current → next through all ${choices.length}`,activeMode==="all_forward",()=>all(1),{icon:"→"}),
        castModeCard("All reverse",`Current → previous through all ${choices.length}`,activeMode==="all_reverse",()=>all(-1),{icon:"←"}),
        castModeCard("Shortlist forward",config.candidates.length?`Current → ${config.candidates.length} selected`:`Select cards below first`,activeMode==="shortlist_forward",()=>{activateAuditionShortlist(body,role,1);draw();},{disabled:!config.candidates.length,icon:"⇢"}),
        castModeCard("Shortlist reverse",config.candidates.length?"Current → selected in reverse":"Select cards below first",activeMode==="shortlist_reverse",()=>{activateAuditionShortlist(body,role,-1);draw();},{disabled:!config.candidates.length,icon:"⇠"})
      );
      status.className=`z3h3-gallery-status mode-${activeMode}`;status.textContent=marker?`Complete Cast ${marker>0?"forward":"in reverse"} is active for @${role}. ${config.candidates.length?`${config.candidates.length} shortlist choice${config.candidates.length===1?" is":"s are"} saved but inactive.`:"No shortlist is needed."}`:config.candidates.length?`Shortlist ${config.direction<0?"reverse":"forward"} is active: @${role} first, then ${config.candidates.length} selected alternate${config.candidates.length===1?"":"s"}.`:`Fixed. Select cards to prepare a shortlist, or use the complete Cast pool.`;
      grid.replaceChildren();for(const item of rows){const subject=item.row,card=button("",()=>{if(!item.current)toggleAuditionCandidate(body,role,subject.handle);draw();},`z3h3-gallery-card cast${item.current?" current":""}${item.selected?" shortlisted":""}`,item.current?`Current role @${role}`:item.selected?"Remove from shortlist":"Add to shortlist");if(item.current)card.disabled=true;const avatar=createSubjectAvatar(body,subject);avatar.classList.add("z3h3-gallery-cast-avatar");const copy=el("div","z3h3-gallery-card-copy"),top=el("div","z3h3-gallery-card-title"),badges=el("div","z3h3-gallery-card-badges");top.append(el("b",null,subjectDisplayName(subject)));if(item.sequence)badges.append(el("span","sequence",`#${item.sequence}`));if(item.current)badges.append(el("span","current","Current"));else if(item.selected)badges.append(el("span","selected","✓ Shortlist"));else badges.append(el("span","available","＋ Add"));top.append(badges);copy.append(top,el("small",null,`@${subject.handle} · ${subject.preset_group||"Creator Cast"}`),el("p",null,subject.description||subject.clothing||"Reusable Cast member"));card.append(avatar,copy);grid.append(card);}if(!rows.length)grid.append(el("div","z3h3-gallery-empty","No Cast members match this search."));toolbar.dataset.count=`${rows.length} shown`;
    };
    search.addEventListener("input",draw);mount.append(roleTabs,toolbar,summary,modes,status,grid);load().then(()=>{draw();search.focus();}).catch((error)=>grid.replaceChildren(el("div","z3h3-error",error.message||String(error))));
  },{wide:true});
}

function menuItem(label,action,{hint="",danger=false,checked=false,disabled=false}={}){return {label,action,hint,danger,checked,disabled};}

function showMenu(event,items,title=""){
  closeMenu();stop(event);
  const menu=el("div","z3h3-quick-menu"),content=el("div","z3h3-quick-menu-items");
  if(title)menu.append(el("div","z3h3-quick-menu-title",title));
  for(const item of items){
    if(item?.separator){content.append(el("div","z3h3-quick-menu-sep"));continue;}
    const row=el("button",`z3h3-quick-menu-item${item.danger?" danger":""}${item.checked?" checked":""}${item.disabled?" disabled":""}`);row.type="button";row.disabled=!!item.disabled;
    const copy=el("div","z3h3-quick-menu-copy");copy.append(el("b",null,item.label),item.hint?el("small",null,item.hint):el("small",null,""));
    row.append(copy,item.checked?el("span","z3h3-quick-menu-mark","✓"):el("span","z3h3-quick-menu-mark",""));
    row.addEventListener("pointerdown",(e)=>e.stopPropagation());
    row.addEventListener("click",async(e)=>{stop(e);if(item.disabled)return;closeMenu();await item.action?.();});
    content.append(row);
  }
  menu.append(content);document.body.append(menu);
  const rect=menu.getBoundingClientRect();const x=Math.min(window.innerWidth-rect.width-10,Math.max(8,event.clientX||8)),y=Math.min(window.innerHeight-rect.height-10,Math.max(8,event.clientY||8));
  menu.style.left=`${x}px`;menu.style.top=`${y}px`;
  const onPointer=(e)=>{if(!menu.contains(e.target))closeMenu();};
  const onKey=(e)=>{if(e.key==="Escape")closeMenu();};
  queueMicrotask(()=>{document.addEventListener("mousedown",onPointer,true);document.addEventListener("contextmenu",onPointer,true);document.addEventListener("keydown",onKey,true);});
  activeMenu={node:menu,cleanup(){document.removeEventListener("mousedown",onPointer,true);document.removeEventListener("contextmenu",onPointer,true);document.removeEventListener("keydown",onKey,true);menu.remove();}};
  return menu;
}

export function openSceneSlotMenu(body,event,slot){
  const meta=categoryMeta(slot),current=(body.scenePreset?.(slot))||(body.target!=="global"?body.data.scene_palette?.[slot]:null),variation=body.sceneVariation?.(slot)||0,config=sceneAuditionFor(body,slot);
  showMenu(event,[
    menuItem(`Choose ${meta.title}…`,()=>body.openScenePicker?.(slot),{hint:current?.title||`Pick a ${meta.title.toLowerCase()} starter`} ),
    menuItem("Cycle to next now",()=>cycleSceneSlotPreset(body,slot,1),{hint:"Immediate swap to the next starter"}),
    menuItem("Cycle to previous now",()=>cycleSceneSlotPreset(body,slot,-1),{hint:"Immediate swap to the previous starter"}),
    {separator:true},
    menuItem("All + · full category",()=>body.setSceneVariation?.(slot,1),{hint:"Every preset in this live category, forward by batch index",checked:variation>0}),
    menuItem("All − · full category",()=>body.setSceneVariation?.(slot,-1),{hint:"Every preset in this live category, backward by batch index",checked:variation<0}),
    menuItem("Fixed",()=>{const currentVariation=body.sceneVariation?.(slot)||0;if(currentVariation)body.setSceneVariation?.(slot,currentVariation);if(config?.candidates?.length)clearSceneAudition(body,slot);},{hint:"Disable full-pool and shortlist variation",checked:variation===0&&!config?.candidates?.length}),
    menuItem("Open audition gallery…",()=>openSceneAuditionGallery(body,slot),{hint:config?.candidates?.length?`${config.candidates.length} saved alternate pick(s)`:"Full-category and optional shortlist controls"}),
    menuItem("Insert timing cue…",()=>body.openTimingCue?.(`${current?.title||meta.title}: `),{hint:"Add “At N sec …” direction without remembering the syntax"}),
    {separator:true},
    menuItem("Set thumbnail…",()=>thumbnailPicker(body,`${meta.title} thumbnail`,body.sceneThumbnail?.(slot,current)||current?.thumbnail||current?.thumbnail_handle,(thumbnail)=>body.setScenePresetThumbnail?.(slot,thumbnail)),{hint:"Browse Thumbnail Shelf, Inputs, Outputs or attached media"}),
    menuItem("Clear thumbnail",()=>body.clearScenePresetThumbnail?.(slot),{disabled:!body.sceneThumbnail?.(slot,current)&&!current?.thumbnail_handle,hint:"Return to the automatic icon"}),
    {separator:true},
    menuItem(`Remove ${meta.title}`,()=>body.removeScenePreset?.(slot),{danger:true,hint:"Delete this scene token from the prompt"}),
  ],meta.title);
}

export function openCastRoleMenu(body,event,role){
  const clean=String(role||"").replace(/^@/,"");const subject=(body.data.subjects||[]).find((row)=>row?.handle===clean),config=auditionFor(body,clean),marker=activeCastMarker(body,clean);
  showMenu(event,[
    menuItem(`Swap @${clean}…`,()=>openCastStudio(body,{swap:clean}),{hint:subject?subjectDisplayName(subject):"Pick a different Cast member for this role"}),
    menuItem("Open Cast Studio",()=>openCastStudio(body,{edit:clean}),{hint:"Edit the role, appearance, sources and defaults"}),
    {separator:true},
    menuItem("Open audition gallery…",()=>openCastAuditionGallery(body,clean),{hint:config?.candidates?.length?`${config.candidates.length} saved alternate Cast member(s)`:"Full-Cast and optional shortlist controls"}),
    menuItem(`@${clean}+ · full Cast`,()=>setAllCastMarker(body,clean,1),{hint:"Every character in the live reusable Cast library, forward by batch index",checked:marker>0}),
    menuItem(`@${clean}− · full Cast`,()=>setAllCastMarker(body,clean,-1),{hint:"Every character in the live reusable Cast library, backward by batch index",checked:marker<0}),
    menuItem("Fixed",()=>{if(marker)clearAllCastMarker(body,clean);if(config?.candidates?.length)clearAudition(body,clean);},{hint:"Disable full-Cast and shortlist variation",checked:marker===0&&!config?.candidates?.length}),
    menuItem("Insert timing cue…",()=>body.openTimingCue?.(`@${clean} `),{hint:"Add a timed action/dialogue beat for this role"}),
    {separator:true},
    menuItem("Set thumbnail…",()=>thumbnailPicker(body,`${subjectDisplayName(subject)} thumbnail`,subject?.thumbnail||subject?.thumbnail_handle,(thumbnail)=>body.setSubjectThumbnail?.(clean,thumbnail)),{hint:"Browse Thumbnail Shelf, Inputs, Outputs or attached media"}),
    menuItem("Clear thumbnail",()=>body.clearSubjectThumbnail?.(clean),{disabled:!subject?.thumbnail&&!subject?.thumbnail_handle,hint:"Return to the first appearance source / initials"}),
    {separator:true},
    menuItem(`Remove @${clean} from prompt`,()=>body.removeCastMention?.(clean),{danger:true,hint:"Leave the character in Cast, but remove this mention here"}),
  ],`@${clean}`);
}

export function openAssetReferenceMenu(body,event,asset){
  showMenu(event,[
    menuItem(`Manage @${asset?.handle}`,()=>body.openAsset?.(asset),{hint:"Handle, role, scope, trim and replacement live inside the reference editor"}),
    {separator:true},
    menuItem(`Remove @${asset?.handle}`,()=>body.removeAsset?.(asset),{danger:true,hint:"Remove this reference from the current stack"}),
  ],`@${asset?.handle||"reference"}`);
}
