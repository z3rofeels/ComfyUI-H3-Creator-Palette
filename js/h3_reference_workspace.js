import * as H from "./z3_h3_api.js";
import * as S from "./z3_h3_state.js";
import { H3PackAPI } from "./h3_pack_api.js";
import { canonicalShotSnapshot, shotIndexFor, validateShotSnapshot, missingReferenceMentionsForShot } from "./h3_shot_snapshot.js";
import { subscribeCreatorBody } from "./h3_workspace_runtime.js";

const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
const input=(type,value="")=>{const n=document.createElement("input");n.type=type;if(type!=="checkbox")n.value=value??"";return n;};
const textarea=(value="",rows=4)=>{const n=document.createElement("textarea");n.value=value??"";n.rows=rows;return n;};
const select=(options,value)=>{const n=document.createElement("select");for(const raw of options){const [v,label]=Array.isArray(raw)?raw:[raw,raw];const o=document.createElement("option");o.value=v;o.textContent=label;if(String(v)===String(value))o.selected=true;n.append(o);}return n;};
const clean=(value)=>String(value??"").trim();
const filename=(value)=>clean(value).replace(/ \[output\]$/,'').split(/[\\/]/).pop()||clean(value);
const safeBg=(url)=>String(url||"").replaceAll('"','%22');
const now=()=>new Date().toISOString();
const SUBJECT_ROLES=[["reference","General reference"],["face","Face identity"],["body","Body identity"],["appearance","Appearance"],["style","Style"]];
const MEDIA_ROLES=[["reference","Reference"],["first_frame","Start frame"],["last_frame","End frame"]];
let active=null;

function stopUiEvent(event){event.stopPropagation();}
function button(text,fn,cls="z3h3-ref-btn",title=""){
  const n=el("button",cls,text);n.type="button";if(title)n.title=title;n.addEventListener("pointerdown",stopUiEvent);
  n.addEventListener("click",async(event)=>{event.preventDefault();event.stopPropagation();try{await fn?.(event);}catch(error){console.error("MiniMax Reference Workspace action failed",error);n.dataset.error="1";n.title=error?.message||String(error);setTimeout(()=>delete n.dataset.error,1800);}});return n;
}
function field(label,control,hint=""){const wrap=el("label","z3h3-ref-field");wrap.append(el("span",null,label),control);if(hint)wrap.append(el("small",null,hint));return wrap;}
function makeId(seed="reference"){
  let h=2166136261;for(const ch of String(seed)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return `ref_${Date.now().toString(36)}_${(h>>>0).toString(36)}_${Math.random().toString(36).slice(2,6)}`;
}
function handleBase(value,kind="image"){
  const prefix=kind==="video"?"vid":kind==="audio"?"aud":"ref";
  let out=filename(value).replace(/\.[^.]+$/,'').normalize?.("NFKD")??filename(value).replace(/\.[^.]+$/,'');
  out=String(out).replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z0-9_-]+/g,"_").replace(/^[_-]+|[_-]+$/g,"").slice(0,48);
  if(!out)out="media";if(!/^[A-Za-z]/.test(out))out=`${prefix}_${out}`;return `${prefix}-${out}`.slice(0,64);
}
function uniqueHandle(rows,value,currentId=""){
  const used=new Set((rows||[]).filter(row=>String(row?.id||"")!==String(currentId||"")).map(row=>clean(row?.handle).toLowerCase()).filter(Boolean));
  const base=clean(value).replace(/^@/,"")||"ref-media";let out=base,n=2;while(used.has(out.toLowerCase()))out=`${base.slice(0,55)}-${n++}`;return out;
}
function previewUrl(record){if(!record?.filename)return "";if(record.kind==="image")return H.inputViewUrl(record.filename);if(record.kind==="video")return H.thumbUrl(record.filename,256);return "";}
function recordThumb(record,status){
  const box=el("div",`z3h3-ref2-thumb kind-${record?.kind||"image"}${status===false?" missing":""}`),url=previewUrl(record);
  if(url)box.style.backgroundImage=`url("${safeBg(url)}")`;else box.textContent=record?.kind==="audio"?"♪":record?.kind==="video"?"▶":"▧";
  if(status===false)box.append(el("span","z3h3-ref2-missing-flag","MISSING"));return box;
}
function assignmentLocation(body,asset){
  const global=(body?.data?.assets||[]).indexOf(asset);if(global>=0)return {scope:"global",index:-1,list:body.data.assets,label:"Shared"};
  for(let i=0;i<(body?.data?.segments?.length||0);i++){const list=body.data.segments[i]?.assets||[],at=list.indexOf(asset);if(at>=0)return {scope:"shot",index:i,list,label:`Shot ${i+1}`};}
  return null;
}
function allWorkflowReferences(body){
  const rows=[];for(const asset of body?.data?.assets||[])if(asset?.handle)rows.push({asset,scope:"global",index:-1,label:"Shared"});
  for(let i=0;i<(body?.data?.segments?.length||0);i++)for(const asset of body.data.segments[i]?.assets||[])if(asset?.handle)rows.push({asset,scope:"shot",index:i,label:`Shot ${i+1}`});
  return rows;
}
function workflowCopies(body,refId){return allWorkflowReferences(body).filter(row=>String(row.asset?.library_ref_id||"")===String(refId||""));}
function referenceRecordFromAsset(asset,seed=""){
  const rid=clean(asset?.library_ref_id)||makeId(`${seed}|${asset?.handle}|${asset?.filename}`);
  return {id:rid,handle:clean(asset?.library_ref_handle)||handleBase(asset?.filename,asset?.kind),name:clean(asset?.reference_name)||filename(asset?.filename)||clean(asset?.handle)||"Workflow reference",group:"Workflow local",filename:clean(asset?.filename),kind:asset?.kind||H.kindFromName(asset?.filename),default_role:asset?.role||"reference",subject_role:asset?.subject_role||"reference",strength:Number.isFinite(Number(asset?.strength))?Number(asset.strength):1,takes:asset?.takes||"full",ref_size:asset?.ref_size||(asset?.kind==="video"?"max":"match"),track:asset?.track||"picture",notes:clean(asset?.notes),_localOnly:true,_sourceAsset:asset};
}
function mergedReferenceRows(body,library){
  const byId=new Map((library||[]).map(row=>[String(row.id),{...row,_localOnly:false}])),rows=[...byId.values()],seenLocal=new Set();
  for(const item of allWorkflowReferences(body)){
    const asset=item.asset,id=clean(asset.library_ref_id);if(id&&byId.has(id))continue;
    const key=id?`missing:${id}`:`local:${item.scope}:${item.index}:${asset.handle}`;if(seenLocal.has(key))continue;seenLocal.add(key);
    const local=referenceRecordFromAsset(asset,key);local.id=id||local.id;local._missingLibrary=!!id;local._assignmentLabel=item.label;rows.push(local);
  }
  return rows;
}
function normalizeReferenceDraft(raw,library=[]){
  const kind=["image","video","audio"].includes(raw?.kind)?raw.kind:H.kindFromName(raw?.filename);
  const created=clean(raw?.created_at)||now(),id=clean(raw?.id)||makeId(`${raw?.filename}|${created}`);
  return {...raw,id,handle:uniqueHandle(library,clean(raw?.handle)||handleBase(raw?.filename,kind),id),name:clean(raw?.name)||filename(raw?.filename)||"Reference",group:clean(raw?.group)||"References",filename:clean(raw?.filename),kind,default_role:["reference","first_frame","last_frame"].includes(raw?.default_role)?raw.default_role:"reference",subject_role:["reference","face","body","appearance","style"].includes(raw?.subject_role)?raw.subject_role:"reference",strength:Math.max(0,Math.min(2,Number(raw?.strength??1)||0)),takes:clean(raw?.takes)||"full",ref_size:["match","max"].includes(raw?.ref_size)?raw.ref_size:(kind==="video"?"max":"match"),track:kind==="video"&&["picture","picture+sound","sound"].includes(raw?.track)?raw.track:"picture",notes:String(raw?.notes||"").slice(0,2000),created_at:created,modified_at:now()};
}
function syncWorkflowCopies(body,record,{syncRole=false}={}){
  let touched=false;for(const {asset} of workflowCopies(body,record.id)){
    asset.filename=record.filename;asset.kind=record.kind;asset.library_ref_handle=record.handle||asset.library_ref_handle||"";asset.reference_name=record.name;asset.subject_role=record.subject_role;asset.strength=record.strength;asset.notes=record.notes;asset.takes=record.takes;asset.ref_size=record.ref_size;
    if(syncRole)asset.role=record.default_role;if(record.kind==="video")asset.track=record.track||asset.track||"picture";else delete asset.track;touched=true;
  }
  if(touched)body.commitData?.(true,{historyLabel:`Update ${record.name} reference metadata`});return touched;
}
function markPackChanged(item,action="save"){window.dispatchEvent?.(new CustomEvent("z3-h3-pack-changed",{detail:{kind:"reference",item,action,source:"reference-workspace"}}));}
async function saveReferenceRecord(body,raw,library,{syncRole=false}={}){
  const draft=normalizeReferenceDraft(raw,library),saved=await H3PackAPI.saveReference(draft);syncWorkflowCopies(body,saved,{syncRole});markPackChanged(saved);return saved;
}
function recordUsage(body,record,index){
  const copies=workflowCopies(body,record.id),shotCopies=copies.filter(row=>row.scope==="shot"&&row.index===index),globalCopies=copies.filter(row=>row.scope==="global"),cast=[];
  for(const subject of body?.data?.subjects||[]){const ids=new Set(Array.isArray(subject.reference_ids)?subject.reference_ids.map(String):[]),handles=new Set(Array.isArray(subject.from)?subject.from.map(v=>String(v).replace(/^@/,"")):[]);if(ids.has(String(record.id))||copies.some(row=>handles.has(row.asset.handle)))cast.push(subject);}
  return {copies,shotCopies,globalCopies,cast};
}
function removeAssignment(body,item){
  const {asset}=item;if(!asset)return false;const loc=assignmentLocation(body,asset);if(!loc)return false;
  const at=loc.list.indexOf(asset);if(at>=0)loc.list.splice(at,1);
  // Only remove literal prompt mentions for this exact workflow handle. A
  // Library record itself is not prompt source, so deleting an assignment does
  // not touch RAW unless the user explicitly mentioned that assignment.
  const strip=(value)=>String(value||"").replace(new RegExp(`@${String(asset.handle).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?![A-Za-z0-9_-])`,"g"),"").replace(/[ \t]{2,}/g," ").trim();
  if(loc.scope==="global")body.data.prompt=strip(body.data.prompt);else if(body.data.segments[loc.index])body.data.segments[loc.index].prompt=strip(body.data.segments[loc.index].prompt);
  // A shared identity reference may be a Cast source. Detach only the matching
  // source, but keep the character itself and its stable reusable ref IDs.
  if(loc.scope==="global")for(const subject of body.data.subjects||[]){if(Array.isArray(subject.from))subject.from=subject.from.filter(v=>String(v).replace(/^@/,"")!==asset.handle);if(subject.reference_roles&&typeof subject.reference_roles==="object")delete subject.reference_roles[asset.handle];}
  body.commitData?.(true,{historyLabel:`Remove @${asset.handle} reference assignment`});return true;
}
async function attachReferenceToCast(body,record,subject,subjectRole="face"){
  if(!subject)throw new Error("Choose a Cast character first.");
  const asset=body.attachReferenceRecord?.(record,{target:"global",role:"reference",globalActive:false,insertMention:false});if(!asset)throw new Error("This reference could not be attached to Cast.");
  subject.from=[...new Set([...(Array.isArray(subject.from)?subject.from:[]),asset.handle])];subject.reference_images=[...new Set([...(Array.isArray(subject.reference_images)?subject.reference_images:[]),asset.handle])];
  subject.reference_roles={...(subject.reference_roles||{}),[asset.handle]:subjectRole};subject.reference_ids=[...new Set([...(Array.isArray(subject.reference_ids)?subject.reference_ids.map(String):[]),String(record.id)])];subject.reference_roles_by_id={...(subject.reference_roles_by_id||{}),[String(record.id)]:subjectRole};subject.modified_at=now();body.commitData?.(true,{historyLabel:`Attach ${record.name} to @${subject.handle}`});
  const pack=await H3PackAPI.load(),pid=String(subject.preset_id||""),preset=(pack.cast||[]).find(row=>String(row.id||"")===pid)||(pack.cast||[]).find(row=>String(row.handle||"")===String(subject.handle||""));
  if(preset){await H3PackAPI.saveCast({...preset,reference_images:[...subject.reference_images],reference_roles:{...subject.reference_roles},reference_ids:[...subject.reference_ids],reference_roles_by_id:{...subject.reference_roles_by_id},modified_at:subject.modified_at});markPackChanged(preset,"cast-reference");}
  return asset;
}

export function referenceLibrarySnapshot(body,library=[]){
  const rows=mergedReferenceRows(body,library);return rows.map(row=>{const usage=recordUsage(body,row,shotIndexFor(body));return {...row,_workflow_assignments:usage.copies.length,_cast_links:usage.cast.length};});
}

function build(body,options={}){
  if(active?.root?.isConnected)active.close();
  const root=el("div","z3h3-ref-backdrop"),panel=el("section","z3h3-ref-workspace v3132"),head=el("header","z3h3-ref-head"),content=el("div","z3h3-ref2-content");
  let index=shotIndexFor(body,options.shotIndex),library=[],rows=[],selectedId="",query="",statusMap={},unsubscribe=null,renderQueued=false,loading=false,notice="",noticeTone="",pendingBodyRender=false;
  const close=()=>{unsubscribe?.();unsubscribe=null;root.remove();if(active?.root===root)active=null;};
  const setNotice=(text,tone="")=>{notice=String(text||"");noticeTone=tone;drawNotice();};
  const drawNotice=()=>{const host=content.querySelector?.("[data-ref-notice]");if(!host)return;host.textContent=notice;host.dataset.tone=noticeTone;host.hidden=!notice;};
  const refresh=async({preserve=true}={})=>{
    if(loading)return;loading=true;try{library=await H3PackAPI.references();rows=mergedReferenceRows(body,library);if(!preserve||!rows.some(row=>String(row.id)===String(selectedId)))selectedId=rows[0]?.id||"";
      const files=[...new Set(rows.map(row=>row.filename).filter(Boolean))];try{statusMap=await H.assetStatus(files);}catch(error){console.warn("Reference file status check unavailable",error);statusMap={};}render();
    }finally{loading=false;}
  };
  const selected=()=>rows.find(row=>String(row.id)===String(selectedId))||null;
  const relinkDetachedMention=(missing)=>{
    const handle=clean(missing?.handle).replace(/^@/,"");if(!handle)return;
    const prefix=handle.split("-")[0],acceptKinds=prefix==="img"?["image"]:prefix==="vid"?["video"]:prefix==="aud"?["audio"]:["image","video","audio"];
    body.openMedia?.("input",{acceptKinds,chooseLabel:`Relink @${handle}`,onChoose:async(media,{kind})=>{
      const path=media.path||media.filename||media.name;if(!path)throw new Error("Chosen media has no usable path.");
      const target=missing.scope==="global"?"global":index;
      let list;
      if(target==="global"){body.data.assets=Array.isArray(body.data.assets)?body.data.assets:[];list=body.data.assets;}
      else{const segment=body.data.segments?.[target];if(!segment)throw new Error(`Shot ${target+1} no longer exists.`);segment.assets=Array.isArray(segment.assets)?segment.assets:[];list=segment.assets;}
      // The handle already exists in RAW and is missing from every attached
      // asset. Recreate exactly that workflow handle; do not insert or rewrite
      // any prompt text.
      const asset=S.createAsset(kind,path,body.data,"reference");asset.handle=handle;list.push(asset);body.commitData?.(true,{historyLabel:`Relink @${handle} reference`});setNotice(`Relinked @${handle} to ${filename(path)} without changing RAW.`,`good`);await refresh();
    }});
  };
  const openPicker=({record=null,label="Choose replacement",localAsset=null}={})=>body.openMedia?.("input",{acceptKinds:record?.kind?[record.kind]:["image","video","audio"],chooseLabel:label,onChoose:async(media,{kind})=>{
    const path=media.path||media.filename||media.name;if(!path)throw new Error("Chosen media has no usable path.");
    if(localAsset){localAsset.filename=path;localAsset.kind=kind;if(kind!=="video")delete localAsset.track;else localAsset.track||="picture";body.commitData?.(true,{historyLabel:`Relink @${localAsset.handle} reference`});setNotice(`Relinked @${localAsset.handle}.`,`good`);await refresh();return;}
    const next={...record,filename:path,kind};if(kind!=="video")delete next.track;else next.track=next.track||"picture";const saved=await saveReferenceRecord(body,next,library);selectedId=saved.id;setNotice(`${record.name} now points to ${filename(path)}.`,`good`);await refresh();
  }});
  const addUploadedFiles=async(files)=>{
    const images=[...(files||[])].filter(file=>String(file.type||"").startsWith("image/"));if(!images.length){setNotice("Drop image files here to add reusable references.","warn");return;}
    setNotice(`Adding ${images.length} image reference${images.length===1?"":"s"}…`);
    for(const file of images){const uploaded=await H.uploadFile(file,"z3_minimax_creator/references"),kind=uploaded.kind||"image",record=normalizeReferenceDraft({filename:uploaded.path,kind,name:file.name.replace(/\.[^.]+$/,""),handle:handleBase(file.name,kind),group:"References",default_role:"reference",subject_role:"reference",strength:1,notes:""},library);const saved=await H3PackAPI.saveReference(record);library=[...library,saved];selectedId=saved.id;markPackChanged(saved);}
    setNotice(`${images.length} reusable reference${images.length===1?"":"s"} added.`,"good");await refresh();
  };
  const render=()=>{
    index=shotIndexFor(body,index);rows=mergedReferenceRows(body,library);if(!rows.some(row=>String(row.id)===String(selectedId)))selectedId=rows[0]?.id||"";
    const toolbar=el("div","z3h3-ref2-toolbar"),shot=select((body.data.segments||[]).map((seg,i)=>[String(i),seg?.kind==="clip"?`Clip ${i+1}`:`Shot ${i+1}${clean(seg?.name)?` · ${seg.name}`:""}`]),String(index));shot.addEventListener("change",()=>{index=Number(shot.value)||0;render();});
    const search=input("search",query);search.placeholder="Search references…";search.addEventListener("input",()=>{query=search.value;drawGallery();});
    const upload=input("file");upload.accept="image/*";upload.multiple=true;upload.hidden=true;upload.addEventListener("change",async()=>{try{await addUploadedFiles(upload.files);}catch(error){setNotice(error.message||String(error),"bad");}upload.value="";});
    toolbar.append(field("Inspect shot",shot),search,button("+ Add images",()=>upload.click(),"z3h3-ref-btn primary","Upload one or more images into ComfyUI Input and create reusable Reference records."),button("Refresh",()=>refresh(),"z3h3-ref-btn","Reload Reference Library and re-check missing files."));toolbar.append(upload);
    const noticeHost=el("div","z3h3-ref2-notice");noticeHost.dataset.refNotice="1";noticeHost.hidden=!notice;noticeHost.textContent=notice;noticeHost.dataset.tone=noticeTone;
    const assignmentHost=el("section","z3h3-ref2-assignments"),snap=canonicalShotSnapshot(body,index),checks=validateShotSnapshot(body,index);renderAssignments(assignmentHost,snap,checks);
    const workspace=el("div","z3h3-ref2-workbench"),galleryPane=el("section","z3h3-ref2-library"),galleryHead=el("div","z3h3-ref2-pane-head"),gallery=el("div","z3h3-ref2-gallery");gallery.dataset.refGallery="1";galleryHead.append(el("div",null),el("span","z3h3-ref2-count",`${rows.filter(row=>!row._localOnly).length} Library · ${rows.filter(row=>row._localOnly).length} workflow-local`));galleryHead.firstChild.append(el("b",null,"REFERENCE LIBRARY"),el("small",null,"Reusable stable-ID records · drag images anywhere into this pane"));galleryPane.append(galleryHead,gallery);
    for(const name of ["dragenter","dragover"]){galleryPane.addEventListener(name,event=>{event.preventDefault();event.stopPropagation();galleryPane.classList.add("drop-ready");});}galleryPane.addEventListener("dragleave",event=>{if(!galleryPane.contains(event.relatedTarget))galleryPane.classList.remove("drop-ready");});galleryPane.addEventListener("drop",async event=>{event.preventDefault();event.stopPropagation();galleryPane.classList.remove("drop-ready");try{await addUploadedFiles(event.dataTransfer?.files);}catch(error){setNotice(error.message||String(error),"bad");}});
    const inspector=el("aside","z3h3-ref2-inspector");inspector.dataset.refInspector="1";workspace.append(galleryPane,inspector);content.replaceChildren(toolbar,noticeHost,assignmentHost,workspace);drawGallery();drawInspector();
  };
  const drawGallery=()=>{
    const host=content.querySelector?.("[data-ref-gallery]");if(!host)return;host.replaceChildren();const q=query.trim().toLowerCase();const filtered=rows.filter(row=>!q||`${row.name} ${row.handle} ${row.group} ${row.filename} ${row.subject_role} ${row.notes}`.toLowerCase().includes(q));
    for(const record of filtered){const missing=statusMap[record.filename]===false,usage=recordUsage(body,record,index),card=button("",()=>{selectedId=record.id;drawGallery();drawInspector();},`z3h3-ref2-card${String(record.id)===String(selectedId)?" selected":""}${missing?" missing":""}`);card.dataset.referenceId=String(record.id);const top=recordThumb(record,statusMap[record.filename]),badges=el("div","z3h3-ref2-card-badges");if(record._localOnly)badges.append(el("span",record._missingLibrary?"missing-library":"local",record._missingLibrary?"LIBRARY MISSING":"WORKFLOW LOCAL"));if(usage.cast.length)badges.append(el("span","cast",`${usage.cast.length} CAST`));if(usage.shotCopies.length)badges.append(el("span","shot",`SHOT ${index+1}`));else if(usage.globalCopies.length)badges.append(el("span","global","GLOBAL"));top.append(badges);const copy=el("div","z3h3-ref2-card-copy");copy.append(el("b",null,record.name||record.handle),el("code",null,`Library · ${record.handle}`),el("small",null,`${record.group||"References"} · ${record.subject_role||"reference"}`),el("small","file",filename(record.filename)||"No file linked"));card.append(top,copy);host.append(card);}
    if(!filtered.length){const empty=el("div","z3h3-ref-empty");empty.append(el("b",null,"No references match"),el("span",null,"Upload or drag images here to create reusable references. Existing workflow-only references appear here automatically."));host.append(empty);}
  };
  const drawInspector=()=>{
    const host=content.querySelector?.("[data-ref-inspector]");if(!host)return;host.replaceChildren();const record=selected();if(!record){const empty=el("div","z3h3-ref2-inspector-empty");empty.append(el("b",null,"Reference Inspector"),el("p",null,"Select a reference to edit metadata, assign it globally or to a shot, or attach it to a Cast identity."));host.append(empty);return;}
    const local=record._localOnly===true,sourceAsset=record._sourceAsset||null,missing=statusMap[record.filename]===false,usage=recordUsage(body,record,index),header=el("div","z3h3-ref2-inspector-head");header.append(recordThumb(record,statusMap[record.filename]),el("div"));header.lastChild.append(el("span","z3h3-ref2-kicker",local?record._missingLibrary?"MISSING REUSABLE RECORD":"WORKFLOW-LOCAL REFERENCE":"REUSABLE REFERENCE"),el("b",null,record.name||record.handle),el("small",null,missing?"Media file is missing — metadata and workflow state remain safe.":filename(record.filename)||"No file linked"));host.append(header);
    if(local){const recovery=el("div","z3h3-ref2-recovery");recovery.append(el("b",null,record._missingLibrary?"Reusable Library record is missing":"This reference only lives inside the workflow"),el("span",null,"The shot remains understandable from its workflow-local fallback. Import it into Library to make it reusable again."),button("Import into Library",async()=>{const draft={...record,_localOnly:undefined,_sourceAsset:undefined};if(record._missingLibrary)draft.id=record.id;else draft.id=makeId(`${record.handle}|${record.filename}`);draft.handle=uniqueHandle(library,draft.handle,draft.id);const saved=await saveReferenceRecord(body,draft,library);if(sourceAsset){sourceAsset.library_ref_id=saved.id;sourceAsset.library_ref_handle=saved.handle;sourceAsset.reference_name=saved.name;body.commitData?.(true,{historyLabel:`Link @${sourceAsset.handle} to reusable reference`});}selectedId=saved.id;setNotice(`${saved.name} imported into the reusable Reference Library.`,`good`);await refresh();},"z3h3-ref-btn primary"),button(missing?"Relink file":"Replace file",()=>openPicker({record,localAsset:sourceAsset,label:missing?"Relink workflow reference":"Replace workflow reference"}),"z3h3-ref-btn"));host.append(recovery);}
    const form=el("div","z3h3-ref2-form"),name=input("text",record.name||""),handle=input("text",record.handle||""),group=input("text",record.group||"References"),role=select(MEDIA_ROLES,record.default_role||"reference"),subjectRole=select(SUBJECT_ROLES,record.subject_role||"reference"),strength=input("range",Number(record.strength??1));strength.min=0;strength.max=2;strength.step=.05;const strengthRead=el("output",null,Number(strength.value).toFixed(2));strength.addEventListener("input",()=>strengthRead.textContent=Number(strength.value).toFixed(2));const takes=select((S.scopeOptions(record)||["full"]).map(value=>[value,value]),record.takes||"full"),refSize=select([["match","Match source"],["max","Max reference"]],record.ref_size||(record.kind==="video"?"max":"match")),notes=textarea(record.notes||"",5);
    form.append(field("Display name",name),field("Library handle",handle,"Reusable Library label only. Prompt references use attached workflow handles such as @img-1, @vid-1, or @aud-1."),field("Group",group),field("Default media role",role),field("Subject role",subjectRole),field("Borrow / takes",takes),field("Reference size",refSize));const strengthField=field("Influence metadata",strength,"Stored with the reference and workflow assignment; current H3 routing remains authoritative.");strengthField.append(strengthRead);form.append(strengthField,field("Notes",notes));
    let track=null;if(record.kind==="video"){track=select([["picture","Picture"],["picture+sound","Picture + sound"],["sound","Sound only"]],record.track||"picture");form.append(field("Video contribution",track));}
    const meta=el("div","z3h3-ref2-meta");meta.append(el("span",null,`Stable ID · ${record.id}`),el("span",null,`File · ${record.filename||"not linked"}`));if(record.source_pack)meta.append(el("span",null,`Source pack · ${record.source_pack}`));form.append(meta);host.append(form);
    const readDraft=()=>normalizeReferenceDraft({...record,name:name.value,handle:handle.value,group:group.value,default_role:role.value,subject_role:subjectRole.value,strength:Number(strength.value),takes:takes.value,ref_size:refSize.value,track:track?.value||record.track,notes:notes.value},library);
    const assignment=el("section","z3h3-ref2-action-section");assignment.append(el("b",null,"ASSIGN"),el("small",null,"Assignment changes H3 reference routing only. It never inserts text into RAW unless you explicitly choose Insert @."));const assignActions=el("div","z3h3-ref2-action-row");assignActions.append(button(`Use in Shot ${index+1}`,async()=>{const draft=local?record:await saveReferenceRecord(body,readDraft(),library);body.attachReferenceRecord?.(draft,{target:index,role:draft.default_role,globalActive:false,insertMention:false});setNotice(`${draft.name} assigned to Shot ${index+1} without changing RAW.`,`good`);await refresh();},"z3h3-ref-btn primary"),button("Use globally",async()=>{const draft=local?record:await saveReferenceRecord(body,readDraft(),library);body.attachReferenceRecord?.(draft,{target:"global",role:"reference",globalActive:true,insertMention:false});setNotice(`${draft.name} assigned globally without changing RAW.`,`good`);await refresh();},"z3h3-ref-btn"));if(usage.copies.length)assignActions.append(button("Insert @ explicitly",()=>{const chosen=usage.shotCopies[0]?.asset||usage.globalCopies[0]?.asset||usage.copies[0]?.asset;if(chosen)body.insertText?.(`@${chosen.handle}`);},"z3h3-ref-btn","Explicitly mention an already-assigned workflow handle in the current Prompt Editor."));assignment.append(assignActions);host.append(assignment);
    const castSection=el("section","z3h3-ref2-action-section"),castPick=select([["","— choose Cast —"],...(body.data.subjects||[]).map(subject=>[subject.record_id||subject.handle,`@${subject.handle} · ${subject.display_name||subject.handle}`])],""),castRole=select(SUBJECT_ROLES,record.subject_role||"face");castSection.append(el("b",null,"CAST IDENTITY"),el("small",null,"Attach this stable reference to a character without adding prompt text."),field("Character",castPick),field("Identity role",castRole),button("Attach canonical identity reference",async()=>{const subject=(body.data.subjects||[]).find(row=>String(row.record_id||row.handle)===String(castPick.value));if(!subject)throw new Error("Choose a Cast character first.");const draft=local?record:await saveReferenceRecord(body,readDraft(),library);await attachReferenceToCast(body,draft,subject,castRole.value);setNotice(`${draft.name} attached to @${subject.handle} as ${castRole.value}.`,`good`);await refresh();},"z3h3-ref-btn"));host.append(castSection);
    const footer=el("div","z3h3-ref2-inspector-actions");if(!local)footer.append(button("Save",async()=>{const saved=await saveReferenceRecord(body,readDraft(),library);selectedId=saved.id;setNotice(`${saved.name} saved.`,`good`);await refresh();},"z3h3-ref-btn primary"));footer.append(button(missing?"Relink…":"Replace media…",()=>openPicker({record,localAsset:local?sourceAsset:null,label:missing?"Relink missing reference":"Replace reference media"}),"z3h3-ref-btn"));if(!local)footer.append(button("Export",()=>{const a=document.createElement("a");a.href=H3PackAPI.exportUrl({scope:"reference_item",id:record.id});a.download="";a.rel="noopener";document.body.append(a);a.click();a.remove();},"z3h3-ref-btn"),button("Move to Trash…",async()=>{if(!confirm(`Move “${record.name}” to Library Trash?\n\nWorkflow-local assignments remain usable and will show as missing Library links until restored or re-imported.`))return;await H3PackAPI.deleteReference(record.id);markPackChanged(record,"trash");setNotice(`${record.name} moved to Trash. Workflow copies were preserved.`,`good`);await refresh({preserve:false});},"z3h3-ref-btn danger"),button("Delete permanently…",async()=>{if(!confirm(`Permanently delete reusable reference “${record.name}”? Workflow-local assignments remain as portable fallbacks.`))return;const typed=prompt(`Type DELETE to permanently remove only “${record.name}” from the reusable Library.`);if(typed!=="DELETE")return;await H3PackAPI.deleteReference(record.id,{permanent:true});markPackChanged(record,"delete-permanent");setNotice(`${record.name} permanently deleted from Library.`,`good`);await refresh({preserve:false});},"z3h3-ref-btn danger"));host.append(footer);
  };
  function renderAssignments(host,snap,checks){
    host.replaceChildren();const title=el("div","z3h3-ref2-assignment-head"),copy=el("div");copy.append(el("b",null,`SHOT ${index+1} · ${snap.route}`),el("small",null,`${snap.refs.rows.length} effective media source${snap.refs.rows.length===1?"":"s"} · ${checks.length?`${checks.length} routing check${checks.length===1?"":"s"}`:"routing clean"}`));title.append(copy,button("Open Shot Inspector",()=>body.openInspector?.(index),"z3h3-ref-btn"));host.append(title);
    const missing=missingReferenceMentionsForShot(body,index);if(missing.length){const recovery=el("div","z3h3-ref2-detached");recovery.append(el("b",null,"DETACHED PROMPT REFERENCES"),el("small",null,"These @media handles still exist in RAW but their workflow assets are gone. Relink restores the exact handle and never edits your prompt."));for(const item of missing){const row=el("div","z3h3-ref2-detached-row"),copy2=el("div");copy2.append(el("code",null,`@${item.handle}`),el("small",null,item.scope==="global"?"Shared RAW · applies across shots":`Shot ${index+1} RAW`));row.append(copy2,button("Relink…",()=>relinkDetachedMention(item),"z3h3-ref-btn primary"));recovery.append(row);}host.append(recovery);}
    const list=el("div","z3h3-ref2-assignment-strip");for(const row of snap.refs.rows){const actual=allWorkflowReferences(body).find(item=>item.asset.handle===row.handle)?.asset||null,card=el("div","z3h3-ref2-assignment-card");card.append(recordThumb(row,statusMap[row.filename]),el("div"));card.children[1].append(el("b",null,`@${row.handle}`),el("small",null,`${row._scope||"Assigned"} · ${row.role||"reference"}${row.reference_name?` · ${row.reference_name}`:""}`));if(actual)card.append(button("×",()=>{if(removeAssignment(body,allWorkflowReferences(body).find(item=>item.asset===actual))){setNotice(`Removed @${actual.handle} from ${row._scope||"shot"}.`,`good`);refresh();}},"z3h3-ref2-remove","Remove this workflow assignment"));list.append(card);}if(!snap.refs.rows.length)list.append(el("div","z3h3-ref2-assignment-empty","No effective references for this shot. Assign a reusable record below."));host.append(list);
  }
  const scheduleRender=()=>{if(renderQueued||!root.isConnected)return;const focused=panel.contains(document.activeElement)&&document.activeElement?.matches?.("input,textarea,select,[contenteditable=true]");if(focused){pendingBodyRender=true;return;}renderQueued=true;(globalThis.requestAnimationFrame||((fn)=>setTimeout(fn,0)))(()=>{renderQueued=false;if(root.isConnected)render();});};
  panel.addEventListener("focusout",()=>{if(pendingBodyRender){pendingBodyRender=false;queueMicrotask(scheduleRender);}});
  const brand=el("div","z3h3-ref-brand");brand.append(el("b",null,"Reference Workspace"),el("small",null,"Reusable media records · shot/global routing · Cast identity links · stable-ID recovery"));head.append(brand,el("div","z3h3-spacer"),button("Close",close,"z3h3-ref-btn"));panel.append(head,content);root.append(panel);document.body.append(root);
  root.addEventListener("mousedown",event=>{if(event.target===root)close();});for(const name of ["pointerdown","pointerup","mousedown","mouseup","click","dblclick","wheel","keydown","keyup","keypress","beforeinput","input","change","compositionstart","compositionend"])panel.addEventListener(name,event=>event.stopPropagation());
  unsubscribe=subscribeCreatorBody((candidate,reason)=>{if(candidate!==body||!root.isConnected)return;if(reason==="target"&&body.target!=="global")index=shotIndexFor(body,body.target);if(["data","target","cast-sync","sidebar-action"].includes(String(reason)))scheduleRender();});
  active={root,close,render,refresh};refresh({preserve:false});return active;
}

export function openReferenceWorkspace(body,options={}){if(!body)throw new Error("No MiniMax Creator is active");return build(body,options);}
export function refreshReferenceWorkspace(){if(active?.root?.isConnected)active.refresh?.();}
