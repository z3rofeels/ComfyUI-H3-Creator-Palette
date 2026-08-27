import { app } from "../../scripts/app.js";
import * as H from "./z3_h3_api.js";
import * as S from "./z3_h3_state.js";
import { variationLifecycleWidget } from "./h3_variation_queue.js";
import { applyCreatorAppearance } from "./h3_suite_appearance.js";

const PREVIEW_EVENT="kj_preview_override";
const PREFS_PROPERTY="z3_seed_hunt_prefs";
const SELECTED_PROPERTY="z3_seed_hunt_selected";
const MAX_DRAFTS=4;
const MAX_SAFE_SEED=Number.MAX_SAFE_INTEGER;

const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
const button=(text,fn,cls="z3h3-btn")=>{const node=el("button",cls,text);node.type="button";node.addEventListener("pointerdown",event=>event.stopPropagation());node.addEventListener("click",async event=>{event.preventDefault();event.stopPropagation();try{await fn?.(event);}catch(error){console.error("MiniMax Creator Seed Hunt action failed",error);node.dataset.error="1";node.title=error?.message||String(error);setTimeout(()=>delete node.dataset.error,1600);}});return node;};
const select=(rows,value)=>{const node=document.createElement("select");for(const [key,label] of rows){const option=document.createElement("option");option.value=String(key);option.textContent=label;option.selected=String(key)===String(value);node.append(option);}return node;};
const input=(type,value)=>{const node=document.createElement("input");node.type=type;node.value=String(value??"");return node;};
const field=(label,control,hint="")=>{const node=el("label","z3h3-seed-field");node.append(el("span",null,label),control);if(hint)node.append(el("small",null,hint));return node;};
const clamp=(value,min,max,fallback)=>Math.min(max,Math.max(min,Number.isFinite(Number(value))?Math.trunc(Number(value)):fallback));
const clone=value=>structuredClone(value);
const eventDetail=event=>event?.detail||event||{};
const belongs=(nodeId,creatorId)=>{const child=String(nodeId??""),parent=String(creatorId??"");return child===parent||child.startsWith(`${parent}.`);};
const previewDataUrl=payload=>payload?.image?`data:${String(payload.mime||"image/jpeg")};base64,${payload.image}`:"";
const videoResultKey=video=>video?.filename?`${String(video.type||"output")}|${String(video.subfolder||"")}|${String(video.filename)}`:"";
const generatedIndexes=data=>(data?.segments||[]).map((row,index)=>row?.kind==="clip"?null:index).filter(Number.isInteger);

export function normalizeSeedHuntPrefs(raw={}){
  const value=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{};
  return {
    count:clamp(value.count,1,MAX_DRAFTS,4),
    edge:[384,512,640,768].includes(Number(value.edge))?Number(value.edge):512,
    seconds:[1,2.3,3.8,0].includes(Number(value.seconds))?Number(value.seconds):2.3,
    steps:[4,6,8,0].includes(Number(value.steps))?Number(value.steps):4,
    method:value.method==="random"?"random":"sequence",
    base_seed:clamp(value.base_seed,0,MAX_SAFE_SEED,0),
  };
}

export function seedHuntTargetIndex(data,target){
  const indexes=generatedIndexes(data);
  if(!indexes.length)return -1;
  const requested=Number(target);
  return Number.isInteger(requested)&&indexes.includes(requested)?requested:indexes[0];
}

export function makeSeedCandidates({count=4,method="sequence",base_seed=0,random=()=>Math.random()}={}){
  const total=clamp(count,1,MAX_DRAFTS,4),base=clamp(base_seed,0,MAX_SAFE_SEED,0),seen=new Set(),out=[];
  for(let index=0;index<total;index++){
    const wraps=index>MAX_SAFE_SEED-base;
    let seed=method==="random"?Math.floor(Math.max(0,Math.min(.9999999999999999,Number(random())||0))*MAX_SAFE_SEED):(wraps?index-(MAX_SAFE_SEED-base)-1:base+index);
    while(seen.has(seed))seed=seed>=MAX_SAFE_SEED?0:seed+1;
    seen.add(seed);out.push(seed);
  }
  return out;
}

export function seedHuntDraftData(source,{targetIndex=0,edge=512,seconds=2.3,promptSeed=0}={}){
  const data=S.normalizeData(clone(source));
  const index=seedHuntTargetIndex(data,targetIndex);
  if(index<0)throw new Error("Seed Hunt needs at least one generated H3 shot; supplied footage cards cannot be hunted.");
  const segment=clone(data.segments[index]);
  const explicitPromptSeed=Number(segment.seed);
  const segmentPromptSeed=Number.isInteger(explicitPromptSeed)&&explicitPromptSeed>=0?explicitPromptSeed:clamp(promptSeed,0,MAX_SAFE_SEED,0)+index;
  delete segment.seed;
  delete segment.take;
  delete segment.hold;
  segment.continue=false;
  segment.continue_audio=false;
  if(Number(seconds)>0)segment.duration_s=Number(seconds);
  data.segments=[segment];
  data.short_edge=Number(edge)||512;
  data.sample_edge=Math.min(Number(edge)||512,768);
  data.upscale="direct";
  data.refine_denoise=.5;
  data.face={...(data.face||{}),on:false};
  if(data.archive_stitch)data.archive_stitch={...data.archive_stitch,enabled:false};
  delete data.prestage_gate;
  data._seed_hunt={prompt_seed:clamp(promptSeed,0,MAX_SAFE_SEED,0),segment_prompt_seed:clamp(segmentPromptSeed,0,MAX_SAFE_SEED,0)};
  return S.normalizeData(data);
}

export function lockSeedHuntSelection(body,targetIndex,seed){
  const picked=clamp(seed,0,MAX_SAFE_SEED,0),indexes=generatedIndexes(body?.data);
  if(!indexes.length)throw new Error("The Creator no longer has a generated shot to receive this seed.");
  const index=indexes.includes(Number(targetIndex))?Number(targetIndex):indexes[0];
  if(indexes.length===1){
    delete body.data.segments[index].seed;
    const widget=body.widgets?.seed;
    if(widget){widget.value=picked;widget.callback?.(picked,body.node.graph?.canvas,body.node);}
  }else body.data.segments[index].seed=picked;
  const control=variationLifecycleWidget(body.node,body.widgets?.seed);
  if(control&&control!==body.widgets?.seed){control.value="fixed";control.callback?.("fixed",body.node.graph?.canvas,body.node);}
  body.node.properties ||= {};
  body.node.properties[SELECTED_PROPERTY]={seed:picked,target_index:index,selected_at:new Date().toISOString()};
  body.commitData?.(true,{historyLabel:`Lock Seed Hunt seed ${picked}`});
  body.renderStatus?.();
  return {seed:picked,targetIndex:index,global:indexes.length===1};
}

export class SeedHuntController{
  constructor(body){
    this.body=body;this.node=body.node;this.enabled=false;this.running=false;this.stopping=false;this.session=null;this.modal=null;this.activeCandidate=null;this.queueOverride=null;this.destroyed=false;
    const storedPrefs=this.node.properties?.[PREFS_PROPERTY],initialPrefs=storedPrefs&&typeof storedPrefs==="object"?storedPrefs:{base_seed:Number(body.widgets?.seed?.value)||0};
    this.prefs=normalizeSeedHuntPrefs(initialPrefs);
    this.toggleButton=button("Seed Hunt",()=>this.open(),"z3h3-btn z3h3-seed-hunt-toggle");
    this.toggleButton.hidden=true;
    this.toggleButton.title="Optional beta: compare up to four sequential H3 draft seeds, then lock one into Creator.";
    this._onPreview=event=>this.handlePreview(eventDetail(event));
    this._onError=event=>this.handleError(eventDetail(event));
    H.api.addEventListener?.(PREVIEW_EVENT,this._onPreview);
    H.api.addEventListener?.("execution_error",this._onError);
    H.api.addEventListener?.("execution_interrupted",this._onError);
    this.refreshFromSettings();
  }
  async refreshFromSettings(){
    try{const result=await H.readSettings();if(this.destroyed)return;this.setEnabled(result?.settings?.seed_hunt_beta===true);}
    catch(error){console.debug("MiniMax Creator: Seed Hunt preference unavailable",error);this.setEnabled(false);}
  }
  setEnabled(value){
    this.enabled=!!value;
    if(!this.enabled&&this.running)this.stopping=true;
    this.toggleButton.hidden=!this.enabled&&!this.running;
    if(!this.enabled&&!this.running)this.close();
    else if(this.running)this.render();
  }
  isQueueing(){return !!this.queueOverride;}
  serializeOverride(){
    if(!this.queueOverride)return null;
    const {snapshot,targetIndex,prefs,promptSeed}=this.queueOverride;
    return seedHuntDraftData(snapshot,{targetIndex,edge:prefs.edge,seconds:prefs.seconds,promptSeed});
  }
  savePrefs(next){this.prefs=normalizeSeedHuntPrefs({...this.prefs,...next});this.node.properties ||= {};this.node.properties[PREFS_PROPERTY]=clone(this.prefs);this.node.graph?.setDirtyCanvas?.(true,true);}
  targetIndex(){return seedHuntTargetIndex(this.body.data,this.body.target);}
  open(){
    if(!this.enabled&&!this.running)return;
    if(this.modal?.isConnected)return;
    const back=el("div","z3h3-backdrop z3h3-seed-backdrop"),box=el("div","z3h3-seed-lab"),head=el("header","z3h3-seed-head"),brand=el("div");
    brand.append(el("b",null,"Seed Hunt Lab"),el("small",null,"Optional beta · sequential draft audition · final settings stay untouched"));
    head.append(brand,el("span","z3h3-seed-beta","BETA"),button("Close",()=>this.close(),"z3h3-btn"));
    this.setup=el("section","z3h3-seed-setup");this.gallery=el("section","z3h3-seed-grid");this.footer=el("footer","z3h3-seed-footer");
    box.append(head,this.setup,this.gallery,this.footer);back.append(box);document.body.append(back);applyCreatorAppearance(back,this.node);this.modal=back;
    back.addEventListener("mousedown",event=>{if(event.target===back)this.close();});
    this.render();
  }
  close(){this.modal?.remove();this.modal=null;}
  renderSetup(){
    if(!this.setup)return;
    const target=this.targetIndex(),shotLabel=target>=0?`Shot ${target+1}`:"No generated shot";
    const warning=el("div","z3h3-seed-warning");warning.append(el("b",null,"Start hunts from this Lab."),el("span",null,"Enabling Seed Hunt never hijacks the normal ComfyUI Queue button; normal Queue still runs the final Creator workflow. Start Seed Hunt below queues real drafts. Two to four drafts take roughly two to four times as long as one draft, but run one at a time so they do not multiply active-render VRAM. Draft resolution, duration, steps, face repair and two-pass upscale are temporary."));
    const count=select([[1,"1 draft"],[2,"2 drafts"],[3,"3 drafts"],[4,"4 drafts"]],this.prefs.count),edge=select([[384,"384px · fastest"],[512,"512px · balanced"],[640,"640px · clearer"],[768,"768px · native edge"]],this.prefs.edge),seconds=select([[1,"1.0s · fastest motion check"],[2.3,"2.3s · 56-frame check"],[3.8,"3.8s · 90-frame check"],[0,"Same length as final"]],this.prefs.seconds),steps=select([[4,"4 steps · fast"],[6,"6 steps · balanced"],[8,"8 steps · clearer"],[0,"Same steps as final"]],this.prefs.steps),method=select([["sequence","Sequential seeds"],["random","Random unique seeds"]],this.prefs.method),base=input("number",this.prefs.base_seed);
    base.min="0";base.max=String(MAX_SAFE_SEED);base.step="1";base.disabled=method.value==="random";
    const controls={count,edge,seconds,steps,method,base_seed:base};
    const save=()=>{this.savePrefs({count:Number(count.value),edge:Number(edge.value),seconds:Number(seconds.value),steps:Number(steps.value),method:method.value,base_seed:Number(base.value)});base.disabled=method.value==="random";};
    for(const control of Object.values(controls))control.addEventListener("change",save);
    const grid=el("div","z3h3-seed-controls");grid.append(field("Drafts",count),field("Draft short edge",edge,"Final canvas is unchanged."),field("Draft length",seconds,"Only the active generated shot is hunted."),field("Draft steps",steps,"Sampler and scheduler stay identical."),field("Seed pattern",method),field("Starting seed",base));
    const finalSteps=Number(this.body.widgets?.steps?.value||20),summary=el("div","z3h3-seed-contract",`${shotLabel} · final contract preserved · ${finalSteps} steps · ${this.body.data.aspect} · ${this.body.data.short_edge}px short edge`);
    const start=button(this.running?"Hunt running…":"Start Seed Hunt",()=>this.start(),"z3h3-btn primary");start.disabled=this.running||target<0;
    const stop=button("Stop after current",()=>{this.stopping=true;this.render();},"z3h3-btn");stop.disabled=!this.running||this.stopping;
    const launch=el("div","z3h3-seed-launch");launch.append(summary,start,stop);
    this.setup.replaceChildren(warning,grid,launch);
  }
  renderGallery(){
    if(!this.gallery)return;this.gallery.replaceChildren();
    const candidates=this.session?.candidates||[];
    for(let index=0;index<MAX_DRAFTS;index++){
      const candidate=candidates[index],card=el("article",`z3h3-seed-card${candidate?.selected?" selected":""}`);card.dataset.state=candidate?.status||"empty";
      const head=el("div","z3h3-seed-card-head");head.append(el("b",null,`Draft ${index+1}`),el("span",null,candidate?`Seed ${candidate.seed}`:"Not queued"));
      const media=el("div","z3h3-seed-media");
      if(candidate?.video){const video=document.createElement("video");video.controls=true;video.loop=true;video.playsInline=true;video.preload="metadata";video.src=H.viewUrl(candidate.video);media.append(video);}
      else if(candidate?.preview){const mime=String(candidate.preview.mime||"image/jpeg"),preview=mime.startsWith("video/")?document.createElement("video"):document.createElement("img");preview.src=previewDataUrl(candidate.preview);if(preview.tagName==="VIDEO"){preview.muted=true;preview.loop=true;preview.autoplay=true;preview.playsInline=true;preview.play?.().catch(()=>{});}media.append(preview);}
      else media.append(el("div","z3h3-seed-placeholder",candidate?.status==="running"?"Waiting for TinyVAE…":candidate?.status==="queued"?"Queued":"Draft preview"));
      const state=el("div","z3h3-seed-card-state",candidate?.message||({queued:"Queued",running:"Sampling",complete:"Ready to compare",error:"Draft failed"}[candidate?.status]||"Choose how many drafts above"));
      const actions=el("div","z3h3-seed-card-actions");
      if(candidate?.status==="complete"){
        const lock=button(candidate.selected?"Seed locked":"Lock this seed",()=>this.selectCandidate(index),candidate.selected?"z3h3-btn primary":"z3h3-btn"),final=button("Lock + final render",()=>this.selectCandidate(index,true),"z3h3-btn primary");
        lock.disabled=this.running;final.disabled=this.running;actions.append(lock,final);
      }
      card.append(head,media,state,actions);this.gallery.append(card);
    }
  }
  renderFooter(){
    if(!this.footer)return;const complete=this.session?.candidates?.filter(row=>row.status==="complete").length||0,selected=this.session?.candidates?.find(row=>row.selected);
    const message=selected
      ?`Locked seed ${selected.seed} into Creator. Final uses the original full settings.`
      :this.running
        ?`${complete} complete · ${this.stopping?"stopping after current":"drafts continue sequentially"}`
        :complete
          ?`${complete} draft${complete===1?"":"s"} ready · choose one to lock`
          :"TinyVAE previews appear here when Preview Override is installed and enabled.";
    this.footer.replaceChildren(el("div",null,message),button("Open Renders",()=>this.body.openMedia?.("output"),"z3h3-btn"),button("Reset Lab",()=>this.reset(),"z3h3-btn"));
  }
  render(){this.renderSetup();this.renderGallery();this.renderFooter();this.toggleButton.textContent=this.running?"Seed Hunt running":this.session?.candidates?.some(row=>row.status==="complete")?"Seed Hunt results":"Seed Hunt";this.toggleButton.classList.toggle("on",this.running);}
  async start(){
    if(this.running)return;
    const targetIndex=this.targetIndex();if(targetIndex<0)throw new Error("Seed Hunt needs at least one generated H3 shot.");
    this.savePrefs(this.prefs);
    const seeds=makeSeedCandidates(this.prefs),snapshot=S.normalizeData(clone(this.body.data)),promptSeed=clamp(Number(this.body.widgets?.seed?.value),0,MAX_SAFE_SEED,0);
    this.session={targetIndex,snapshot,promptSeed,prefs:clone(this.prefs),candidates:seeds.map(seed=>({seed,status:"queued",preview:null,video:null,message:"Queued"})),index:0,seenVideos:new Set()};
    this.running=true;this.stopping=false;this.render();await this.queueCurrent();
  }
  async queueCurrent(){
    if(!this.running||!this.session)return;
    if(this.stopping||this.session.index>=this.session.candidates.length){this.finish();return;}
    const candidate=this.session.candidates[this.session.index],seedWidget=this.body.widgets?.seed,stepsWidget=this.body.widgets?.steps,seedControl=variationLifecycleWidget(this.node,seedWidget),saved={seed:seedWidget?.value,steps:stepsWidget?.value,control:seedControl&&seedControl!==seedWidget?seedControl.value:undefined};
    candidate.status="running";candidate.message="Submitting draft…";this.activeCandidate=candidate;
    this.queueOverride={snapshot:this.session.snapshot,targetIndex:this.session.targetIndex,prefs:this.session.prefs,promptSeed:this.session.promptSeed};
    this.body._seedHuntQueueing=true;
    try{
      if(seedWidget)seedWidget.value=candidate.seed;
      if(stepsWidget&&Number(this.session.prefs.steps)>0)stepsWidget.value=Number(this.session.prefs.steps);
      if(seedControl&&seedControl!==seedWidget)seedControl.value="fixed";
      this.render();
      if(typeof app?.queuePrompt!=="function")throw new Error("ComfyUI queue action is unavailable in this frontend build.");
      await app.queuePrompt(0,1);
      candidate.message="Sampling · TinyVAE will update here";
    }catch(error){candidate.status="error";candidate.message=error?.message||String(error);this.running=false;this.activeCandidate=null;throw error;}
    finally{
      if(seedWidget)seedWidget.value=saved.seed;
      if(stepsWidget)stepsWidget.value=saved.steps;
      if(seedControl&&seedControl!==seedWidget)seedControl.value=saved.control;
      this.queueOverride=null;this.body._seedHuntQueueing=false;this.render();
    }
  }
  handlePreview(payload){if(!this.running||!this.activeCandidate||!belongs(payload?.node_id,this.node.id)||!previewDataUrl(payload))return;this.activeCandidate.preview=payload;this.activeCandidate.message=payload.total?`Sampling · step ${Number(payload.step||0)} / ${Number(payload.total||0)}`:"Sampling · TinyVAE preview";this.renderGallery();this.renderFooter();}
  handleExecution(output){
    if(!this.running||!this.session)return false;
    const video=(output?.mmc_video||[])[0];
    if(!video)return !!output?.mmc_takes?.length;
    const key=videoResultKey(video);
    this.session.seenVideos ||= new Set();
    if(key&&this.session.seenVideos.has(key))return true;
    if(!this.activeCandidate)return false;
    if(key)this.session.seenVideos.add(key);
    this.activeCandidate.video=video;this.activeCandidate.status="complete";this.activeCandidate.message="Ready to compare";this.activeCandidate=null;this.session.index+=1;this.render();
    if(this.stopping||this.session.index>=this.session.candidates.length)this.finish();else setTimeout(()=>this.queueCurrent().catch(error=>{console.error("Seed Hunt queue failed",error);this.finish();}),0);
    return true;
  }
  handleError(detail){
    const nodeId=detail?.node_id??detail?.node;if(!this.running||!this.activeCandidate||(nodeId!=null&&!belongs(nodeId,this.node.id)))return;
    this.activeCandidate.status="error";this.activeCandidate.message=detail?.exception_message||detail?.message||"Draft execution failed";this.activeCandidate=null;this.finish();
  }
  finish(){this.running=false;this.queueOverride=null;this.body._seedHuntQueueing=false;this.activeCandidate=null;this.stopping=false;this.toggleButton.hidden=!this.enabled;this.render();if(!this.enabled)this.close();}
  async selectCandidate(index,queueFinal=false){
    const candidate=this.session?.candidates?.[index];if(candidate?.status!=="complete")throw new Error("That draft has not finished yet.");
    for(const row of this.session.candidates)row.selected=false;candidate.selected=true;
    const result=lockSeedHuntSelection(this.body,this.session.targetIndex,candidate.seed);candidate.message=result.global?"Locked as Creator seed":"Locked as this shot's seed";this.render();
    if(queueFinal){this.close();if(typeof app?.queuePrompt!=="function")throw new Error("ComfyUI queue action is unavailable in this frontend build.");await app.queuePrompt(0,1);}
  }
  reset(){if(this.running){this.stopping=true;this.render();return;}this.session=null;this.activeCandidate=null;this.render();}
  destroy(){this.destroyed=true;this.stopping=true;this.close();H.api.removeEventListener?.(PREVIEW_EVENT,this._onPreview);H.api.removeEventListener?.("execution_error",this._onError);H.api.removeEventListener?.("execution_interrupted",this._onError);}
}

export function installSeedHunt(body){return new SeedHuntController(body);}
