import { app } from "../../scripts/app.js";
import * as H from "./z3_h3_api.js";
import * as S from "./z3_h3_state.js";
import { installMentionAutocomplete } from "./h3_mention_autocomplete.js";
import { installSceneAutocomplete } from "./h3_scene_autocomplete.js";
import { registerCreatorBody, notifyCreatorBodyChanged, setActiveCreatorBody } from "./h3_workspace_runtime.js";
import { findSubjectImage, openCastStudio, refreshCastPresetCache, syncBodyFromCastPresets } from "./h3_cast_studio.js";
import { renderPromptGuide } from "./h3_prompt_guide.js";
import { openH3SettingsDrawer } from "./h3_settings_drawer.js";
import { installPreviewSidecar } from "./h3_preview_sidecar.js";
import { installSeedHunt } from "./h3_seed_hunt.js";
import { applyCreatorSnapshotToPreStageNode, bypassPreStageForCreator } from "./h3_prestage_bridge.js";
import { applySceneSelection, removeSceneSelection, sceneSelectionFor, reconcileSceneSelections, migrateSceneSelections } from "./h3_scene_state.js";
import { renderSceneStack, openScenePicker } from "./h3_scene_stack.js";
import { describeH3Resolution, resolveH3Canvas, normalizeVideoTargetEdge, MIN_RATIO, MAX_RATIO } from "./h3_canvas.js";
import { saveMachineSettings } from "./h3_settings_store.js";
import { renderPromptComposer } from "./h3_prompt_composer.js";
import { loadCreatorUIPrefs, saveCreatorUIPrefs } from "./h3_ui_prefs.js";
import { expandSceneTokens, decorateH3PromptSource, setSceneVariationMarker, sceneVariationDirection, sceneToken, stripSceneTokenForMove, castVariationDirection, setCastVariationMarker, hasPromptPaletteBatchOperator, castMentionRanges } from "./h3_prompt_tokens.js";
import { installPromptTokenInteractions } from "./h3_prompt_token_interactions.js";
import { H3_SCENE_SLOT_ORDER } from "./h3_prompt_categories.js";
import { H3PackAPI } from "./h3_pack_api.js";
import { openH3Director } from "./h3_director.js";
import { initCreatorHistory, noteCreatorCommit, checkpointCreatorHistory, undoCreator, redoCreator, creatorHistoryStatus } from "./h3_creator_history.js";
import { chooseCreatorData, persistCreatorBackup, creatorRoundTripAudit } from "./h3_persistence_guard.js";
import { openReferenceWorkspace } from "./h3_reference_workspace.js";
import { openCanonicalShotInspector } from "./h3_shot_inspector.js";
import { openTimingInspector } from "./h3_timing_inspector.js";
import { installVariationQueueLifecycle } from "./h3_variation_queue.js";
import { createChoicePicker } from "./h3_choice_picker.js";
import { h3LengthChoices, clipLengthChoices, h3AspectChoices, h3ResolutionChoices, h3QualityChoices, samplingChoiceRows } from "./h3_quick_control_options.js";
import { SAMPLING_PROPERTY, SAMPLING_KEYS, comboValues, samplingSnapshot, normalizeSamplingSnapshot, applySamplingSnapshot } from "./h3_sampling_state.js";
import { normalizeLoraLibraryRows, loraLibraryIdentity, loraLibrarySelection } from "./h3_lora_library.js";
import { h3SelectedModelProfile } from "./h3_model_profile.js";
import { formatWorkloadRatio, planH3Workload } from "./h3_workload.js";

const el = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!=null)n.textContent=text; return n; };
const btn = (text, fn, cls="z3h3-btn") => { const b=el("button",cls,text); b.type="button"; b.addEventListener("pointerdown",(event)=>event.stopPropagation()); b.addEventListener("click",async(event)=>{event.stopPropagation();try{await fn?.(event);}catch(error){console.error("MiniMax Creator action failed",error);b.dataset.error="1";b.title=error?.message||String(error);setTimeout(()=>delete b.dataset.error,1600);}}); return b; };
const field = (label, control, hint="") => { const w=el("label","z3h3-field"); w.append(el("span",null,label),control); if(hint)w.append(el("small","z3h3-note",hint)); return w; };
const input = (type,value) => { const n=document.createElement("input"); n.type=type; if(type!=="checkbox")n.value=value??""; return n; };
const textarea = (value, rows=3) => { const n=document.createElement("textarea"); n.value=value??""; n.rows=rows; return n; };
const select = (options,value) => { const n=document.createElement("select"); for(const o of options){const [v,l]=Array.isArray(o)?o:[o,o]; const x=document.createElement("option"); x.value=v; x.textContent=l; if(String(v)===String(value))x.selected=true; n.append(x);} return n; };
const debounce=(fn,ms=120)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const esc=(s)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function modal(title, build, {small=false,wide=false}={}){
  const back=el("div","z3h3-backdrop"), box=el("div",`z3h3-modal${small?" small":""}${wide?" wide":""}`), head=el("div","z3h3-modal-head");
  const body=el("div","z3h3-modal-body"), close=btn("Close",()=>back.remove());
  head.append(el("div",null,title),el("div","z3h3-spacer"),close); box.append(head,body); back.append(box); document.body.append(back);
  back.addEventListener("mousedown",e=>{if(e.target===back)back.remove()});
  build(body,()=>back.remove(),box); return back;
}
function setWidget(widget,value,node){ if(!widget)return; widget.value=value; widget.callback?.(value,node.graph?.canvas,node); node.graph?.setDirtyCanvas?.(true,true); }
function filenameLabel(path){ const p=String(path||"").replace(/ \[output\]$/,'').split(/[\\/]/); return p[p.length-1]||path; }
function assetIcon(kind){return kind==="image"?"▧":kind==="video"?"▶":kind==="audio"?"♪":"•";}
function kindOf(row){return row.kind||H.kindFromName(row.path||row.name);}
function outputPath(row){return [row?.subfolder,row?.filename].filter(Boolean).join("/")+(row?.type==="output"?" [output]":"");}
function readJSONStorage(key,fallback){try{return JSON.parse(localStorage.getItem(key)||"")||fallback}catch{return fallback}}
function writeJSONStorage(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{/* local storage may be disabled */}}
const FAVORITES_KEY="z3.minimaxCreator.mediaFavorites";
const LORA_FOLDER_KEY="z3.minimaxCreator.loraFolder";
function checkbox(checked){const c=input("checkbox","");c.checked=!!checked;return c;}
function buttonRow(...children){const r=el("div","z3h3-tabs");r.append(...children.filter(Boolean));return r;}
function section(title,...children){const s=el("section","z3h3-section");if(title)s.append(el("h3",null,title));s.append(...children.filter(Boolean));return s;}
function toOptions(values,emptyLabel=null){const out=[]; if(emptyLabel!==null)out.push(["",emptyLabel]); for(const v of values||[])out.push([v,v]); return out;}

export class CreatorPaletteBody {
  constructor(node, ppRoot, textWidget, editorSurface=null){
    this.node=node; this.ppRoot=ppRoot; this.textWidget=textWidget;
    this.editorSurface=editorSurface || ppRoot?.querySelector?.('[data-el="textarea"]') || ppRoot?.querySelector?.('[data-pp-editor-surface]') || ppRoot?.querySelector?.("textarea");
    this.widgets=Object.fromEntries((node.widgets||[]).map(w=>[w.name,w]));
    this._variationCursor=Math.max(0,Math.trunc(Number(this.widgets?.variation_index?.value)||0));
    this._queueVariationStep=null;
    this._samplingCleanup=this._installSamplingPersistence();
    this.dataWidget=this.widgets.creator_data;
    const selection=chooseCreatorData(this.dataWidget?.value,node.properties?.z3_creator_data_backup,node.properties?.z3_creator_data_backup_prev);
    this.data=selection.data;
    this.persistenceRecovery=selection.recovered?selection.source:"";
    this._migrateStructuredPromptSources();
    initCreatorHistory(this);
    this.uiPrefs=loadCreatorUIPrefs(node);
    if(this.dataWidget){
      this.dataWidget.options ||= {};this.dataWidget.options.serialize=true;
      this.dataWidget.value=S.serializeData(this.data);
      this.dataWidget.serializeValue=()=>this._serializeCreatorData();
    }
    this.node.properties ||= {};persistCreatorBackup(this.node,S.serializeData(this.data));
    this.target=Math.max(0,Math.min(Math.trunc(Number(this.uiPrefs?.last_selected_shot)||0),Math.max(0,(this.data.segments?.length||1)-1)));
    this.root=el("div","z3h3"); this.root.dataset.z3H3="1";
    this._wrapTextCallback();
    this._installInteractionBoundary();
    this._libraryTabPrefsCleanup=this._installLibraryTabPrefs();
    this._historyShortcutCleanup=this._installHistoryShortcuts();
    this._variationCleanup=this._installVariationStepper();
    this.previewSidecar=installPreviewSidecar(this);
    this.seedHunt=installSeedHunt(this);
    this.renderShell(); this.syncPrompt(false); this.refreshAll();
    this._workspaceCleanup=registerCreatorBody(this);
    this._mentionCleanup=installMentionAutocomplete(this,this.editorSurface);
    this._sceneAutocompleteCleanup=installSceneAutocomplete(this,this.editorSurface);
    this._installPromptPaletteHooks();
    this._tokenInteractionCleanup=installPromptTokenInteractions(this,this.editorSurface);
    setActiveCreatorBody(this,"mounted");
    this.hydrateMachineDefaults();
    this.hydrateCastPackSync();
  }
  async hydrateCastPackSync(){
    try{const presets=await refreshCastPresetCache();syncBodyFromCastPresets(this,presets);}
    catch(error){console.debug("MiniMax Creator: reusable Cast sync unavailable",error);}
  }
  async hydrateMachineDefaults(){
    if(Object.keys(this.data.models||{}).length)return;
    try{
      const response=await H.readSettings(),defaults=response.settings?.model_defaults;
      // The request is asynchronous. Re-check live state so a user choice made
      // while settings were loading can never be overwritten by an older default.
      if(Object.keys(this.data.models||{}).length)return;
      if(defaults&&Object.keys(defaults).length){this.data.models=structuredClone(defaults);delete this.data.models.dynamic_vram;this.commitData(false);}
    }catch(error){console.debug("MiniMax Creator: model defaults unavailable",error);}
  }
  destroy(){this.seedHunt?.destroy?.();this.previewSidecar?.destroy?.();this._quickPickerCleanup?.();this._tokenInteractionCleanup?.();this._sceneAutocompleteCleanup?.();this._mentionCleanup?.();this._workspaceCleanup?.();this._restorePromptPaletteHooks?.();this._restoreTextCallback?.();this._variationCleanup?.();this._samplingCleanup?.();this._interactionCleanup?.();this._libraryTabPrefsCleanup?.();this._historyShortcutCleanup?.();this.root.remove();}
  _installSamplingPersistence(){
    this.node.properties ||= {};
    let retained=normalizeSamplingSnapshot(this.node.properties[SAMPLING_PROPERTY],this.widgets),ready=Object.keys(retained).length>0;
    const legacyAttention=String(this.node.properties.z3_attention_backend||"").trim();
    if(ready)applySamplingSnapshot(this.widgets,retained);
    else if(legacyAttention&&(!comboValues(this.widgets.attention).length||comboValues(this.widgets.attention).includes(legacyAttention)))this.widgets.attention.value=legacyAttention;
    const capture=()=>{retained=samplingSnapshot(this.widgets);this.node.properties[SAMPLING_PROPERTY]=structuredClone(retained);if(retained.attention)this.node.properties.z3_attention_backend=retained.attention;ready=true;this.node.graph?.setDirtyCanvas?.(true,true);return retained;};
    const previous=new Map();
    for(const name of SAMPLING_KEYS){const widget=this.widgets?.[name];if(!widget)continue;const callback=widget.callback;previous.set(widget,callback);widget.callback=(value,...args)=>{const result=callback?.call(widget,value,...args);capture();return result;};}
    this.rehydrateSamplingPreferences=({finalize=false}={})=>{if(ready)applySamplingSnapshot(this.widgets,retained);else{if(legacyAttention&&this.widgets.attention)this.widgets.attention.value=legacyAttention;if(finalize)capture();}this.renderQuick?.();this.renderStatus?.();return retained;};
    return ()=>{for(const [widget,callback] of previous)widget.callback=callback;delete this.rehydrateSamplingPreferences;};
  }
  _migrateStructuredPromptSources(){
    const global=migrateSceneSelections(this.data.prompt,this.data.scene_palette);this.data.prompt=global.prompt;this.data.scene_palette=global.selections;
    for(const segment of this.data.segments||[]){if(segment?.kind==="clip")continue;const migrated=migrateSceneSelections(segment.prompt,segment.scene_palette);segment.prompt=migrated.prompt;segment.scene_palette=migrated.selections;}
  }
  _installPromptPaletteHooks(){
    const node=this.node,previousResolve=node._ppResolveSource,previousDecorate=node._ppDecoratePrompt,previousResolveVariations=node._ppResolveVariations;
    node._ppResolveSource=(source)=>expandSceneTokens(source,S.activeContainer(this.data,this.target)?.scene_palette||{});
    node._ppDecoratePrompt=(source,result)=>decorateH3PromptSource(source,result,{castHandles:(this.data.subjects||[]).map((row)=>row?.handle).filter(Boolean),assetHandles:S.allKnownAssets(this.data).map((row)=>row?.handle).filter(Boolean)});
    node._ppResolveVariations=async({seed=0,mode="entire text as one",count=4,signal}={})=>{
      const baseVariation=this.currentVariationIndex();
      const items=[];
      for(let offset=0;offset<count;offset++){
        if(signal?.aborted){const error=new Error("Aborted");error.name="AbortError";throw error;}
        const variation_index=baseVariation+offset;
        const currentSeed=(Number(seed)||0)+offset;
        const preview=await H.promptPreview(S.normalizeData(structuredClone(this.data)),currentSeed,mode,variation_index);
        const passes=Array.isArray(preview?.passes)?preview.passes:[];
        const generations=passes.filter((pass)=>pass?.kind==="generation");
        const resolved=passes.map((pass,idx)=>{
          if(pass?.kind==="generation")return String(pass.prompt||"");
          if(pass?.kind==="clip")return `[Clip ${idx+1}] ${String(pass.clip||"")}`;
          return "";
        }).filter(Boolean).join("\n\n");
        items.push({seed:currentSeed,variation_index,resolved,token_stats:null,wildcards:[],meta:`${this.data.h3_auto_format===true?"H3 Auto Format":"Raw resolved"} · ${generations.length} pass${generations.length===1?"":"es"}`});
      }
      return items;
    };
    this.editorSurface?.setAttribute?.("data-h3-structured-prompt","1");
    this._restorePromptPaletteHooks=()=>{if(previousResolve===undefined)delete node._ppResolveSource;else node._ppResolveSource=previousResolve;if(previousDecorate===undefined)delete node._ppDecoratePrompt;else node._ppDecoratePrompt=previousDecorate;if(previousResolveVariations===undefined)delete node._ppResolveVariations;else node._ppResolveVariations=previousResolveVariations;this.editorSurface?.removeAttribute?.("data-h3-structured-prompt");};
    this.node._wgRefreshFromHidden?.();
  }
  _installInteractionBoundary(){
    const selector="button,input,select,textarea,[contenteditable=true],[role=button],a";
    const stop=(event)=>{if(event.target?.closest?.(selector))event.stopPropagation();};
    const events=["pointerdown","pointerup","mousedown","mouseup","click","dblclick","wheel"];
    for(const name of events)this.root.addEventListener(name,stop,false);
    this._interactionCleanup=()=>{for(const name of events)this.root.removeEventListener(name,stop,false);};
  }
  _installLibraryTabPrefs(){
    const onClick=(event)=>{const tab=event.target?.closest?.("[data-library-tab]");if(!tab||!this.ppRoot?.contains?.(tab))return;const value=String(tab.dataset.libraryTab||"").trim();if(value)this.uiPrefs=saveCreatorUIPrefs(this.node,{...this.uiPrefs,last_library_tab:value});};
    this.ppRoot?.addEventListener?.("click",onClick,true);
    return()=>this.ppRoot?.removeEventListener?.("click",onClick,true);
  }
  _installHistoryShortcuts(){
    const editable="input,textarea,select,[contenteditable=true],[contenteditable=plaintext-only]";
    const onKey=(event)=>{
      const key=String(event.key||"").toLowerCase(),modified=event.ctrlKey||event.metaKey;
      const wantsUndo=modified&&!event.altKey&&key==="z"&&!event.shiftKey;
      const wantsRedo=modified&&!event.altKey&&((key==="z"&&event.shiftKey)||key==="y");
      if(!wantsUndo&&!wantsRedo)return;
      // Native text undo/redo must always win while typing. Creator history is
      // only intercepted outside editable surfaces so Editor 2 keeps its own
      // DOM/caret-safe browser editing behavior.
      if(event.target?.closest?.(editable)||event.target===this.editorSurface||this.editorSurface?.contains?.(event.target))return;
      event.preventDefault();event.stopPropagation();
      Promise.resolve(wantsRedo?this.redo():this.undo()).catch(error=>console.error("MiniMax Creator history shortcut failed",error));
    };
    this.root.addEventListener("keydown",onKey,true);
    return()=>this.root.removeEventListener("keydown",onKey,true);
  }
  _hasSceneVariations(){
    if(this._seedHuntQueueing)return false;
    const containers=[this.data,...(this.data.segments||[]).filter((seg)=>seg?.kind!=="clip")];
    const hasWildcardBatch=hasPromptPaletteBatchOperator;
    const containerVariation=containers.some((container)=>{
      const source=String(container?.prompt||"");
      const scene=H3_SCENE_SLOT_ORDER.some((slot)=>sceneVariationDirection(source,slot)!==0);
      const castHandles=(this.data.subjects||[]).map((subject)=>subject?.handle).filter(Boolean);
      const castMarker=castMentionRanges(source,castHandles).some((row)=>row.direction!==0);
      const castAuditions=container?.cast_auditions&&typeof container.cast_auditions==="object"&&Object.values(container.cast_auditions).some((config)=>Array.isArray(config?.candidates)&&config.candidates.length);
      const sceneAuditions=container?.scene_auditions&&typeof container.scene_auditions==="object"&&Object.values(container.scene_auditions).some((config)=>Array.isArray(config?.candidates)&&config.candidates.length);
      const wildcardBatch=[source,container?.soundscape,container?.music,container?.prompt_override,container?.director_prompt].some(hasWildcardBatch);
      const refinedBatch=[container?.refined?.body,...Object.values(container?.refined?.sections||{})].some(hasWildcardBatch);
      return scene||castMarker||castAuditions||sceneAuditions||wildcardBatch||refinedBatch;
    });
    const subjectVariation=(this.data.subjects||[]).some((subject)=>hasWildcardBatch(subject?.description)||hasWildcardBatch(subject?.clothing));
    return containerVariation||subjectVariation;
  }
  _serializeCreatorData(){
    const snapshot=this.seedHunt?.serializeOverride?.()||S.normalizeData(structuredClone(this.data));
    if(Number.isInteger(this._queueVariationStep)&&this._queueVariationStep>=0)snapshot._queue_variation_index=this._queueVariationStep;
    return JSON.stringify(snapshot);
  }
  currentVariationIndex(){return Math.max(0,Math.trunc(Number(this._variationCursor)||0));}
  setVariationIndex(value,render=true){
    const next=Math.min(1000000,Math.max(0,Math.trunc(Number(value)||0)));
    const changed=next!==this.currentVariationIndex();
    this._variationCursor=next;
    const widget=this.widgets?.variation_index;if(widget)widget.value=next;
    if(changed)this.node.graph?.setDirtyCanvas?.(true,true);
    if(render){this.renderStatus?.();this.renderWorkspace?.();}
    return changed;
  }
  resetVariationIndex(render=true){return this.setVariationIndex(0,render);}
  _installVariationStepper(){
    const widget=this.widgets?.variation_index;if(!widget)return ()=>{};
    return installVariationQueueLifecycle({
      node:this.node,target:widget,
      hasVariations:()=>this._hasSceneVariations(),
      currentIndex:()=>this.currentVariationIndex(),
      setIndex:(value)=>this.setVariationIndex(value,false),
      onQueued:(value)=>{this._queueVariationStep=value;},
      onAdvanced:()=>{this.renderStatus?.();this.renderWorkspace?.();},
    });
  }
  _wrapTextCallback(){
    const w=this.textWidget, old=w.callback, self=this;
    w.callback=function(value){
      S.setActivePrompt(self.data,self.target,value);
      self.resetVariationIndex(false);
      const container=S.activeContainer(self.data,self.target);
      if(container&&container.scene_palette)container.scene_palette=reconcileSceneSelections(value,container.scene_palette);
      self.commitData(false,{historyLabel:"Edited prompt"});
      return old?.apply(this,arguments);
    };
    this._restoreTextCallback=()=>{w.callback=old};
  }
  commitData(notify=true,options={}){
    const revision=Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,Math.trunc(Number(this.data?._revision)||0))+1);
    this.data=S.normalizeData(this.data);
    this.data._revision=revision;
    const raw=JSON.stringify(this.data);
    if(!options?.skipHistory)noteCreatorCommit(this,raw,String(options?.historyLabel||"Edit"));
    if(this.dataWidget)this.dataWidget.value=raw;
    this.node.properties ||= {};persistCreatorBackup(this.node,raw);
    if(notify)this.dataWidget?.callback?.(raw,this.node.graph?.canvas,this.node);
    this.node.graph?.setDirtyCanvas?.(true,true);
    this.renderTimeline(); this.renderQuick(); this.renderStatus(); this.renderStageMeta(); this.renderWorkspace();
    notifyCreatorBodyChanged(this,"data");this.refreshHistoryButtons?.();
  }
  async undo(){const changed=await undoCreator(this);this.refreshHistoryButtons?.();return changed;}
  async redo(){const changed=await redoCreator(this);this.refreshHistoryButtons?.();return changed;}
  historyStatus(){return creatorHistoryStatus(this);}
  refreshHistoryButtons(){const state=this.historyStatus();if(this.undoButton){this.undoButton.disabled=!state.canUndo;this.undoButton.title=state.canUndo?`Undo: ${state.undoLabel}`:"Nothing to undo";this.undoButton.setAttribute("aria-label",this.undoButton.title);}if(this.redoButton){this.redoButton.disabled=!state.canRedo;this.redoButton.title=state.canRedo?`Redo: ${state.redoLabel}`:"Nothing to redo";this.redoButton.setAttribute("aria-label",this.redoButton.title);}return state;}
  checkpointHistory(label="Edit"){return checkpointCreatorHistory(this,label);}
  persistenceAudit(){return creatorRoundTripAudit(this.data);}
  openReferences(index=null){return openReferenceWorkspace(this,{shotIndex:index==null?(this.target==="global"?0:this.target):index});}
  openInspector(index=null){return openCanonicalShotInspector(this,index==null?(this.target==="global"?0:this.target):index);}
  openTimingInspector(){return openTimingInspector(this);}
  async persistModelDefaults(status=null){
    const snapshot=structuredClone(this.data.models||{});
    delete snapshot.dynamic_vram;
    const serial=(this._modelSaveSerial||0)+1;this._modelSaveSerial=serial;
    if(status){status.textContent="Saving automatically…";status.className="z3h3-note";}
    try{
      await saveMachineSettings({model_defaults:snapshot});
      if(serial===this._modelSaveSerial&&status){status.textContent="Saved automatically. The next queue and future Creator nodes use this selection.";status.className="z3h3-note good";}
      return true;
    }catch(error){
      if(serial===this._modelSaveSerial&&status){status.textContent=`Could not save defaults: ${error.message||error}`;status.className="z3h3-error";}
      console.error("MiniMax Creator model auto-save failed",error);return false;
    }
  }
  syncPrompt(notify=false){
    const value=S.activePrompt(this.data,this.target), guard=this.node._ppPromptStateGuard;
    if(guard)guard.commit(value,{notify,dirty:false}); else this.textWidget.value=value;
    this.node._wgRefreshFromHidden?.();
  }
  switchTarget(target){
    if(target!=="global"&&Number.isInteger(Number(target)))this.uiPrefs=saveCreatorUIPrefs(this.node,{...this.uiPrefs,last_selected_shot:Math.max(0,Number(target))});
    if(target!=="global" && this.data.segments[target]?.kind==="clip"){
      this.target=target;this.refreshAll();setActiveCreatorBody(this,"target");notifyCreatorBodyChanged(this,"target");return;
    }
    this.target=target; this.syncPrompt(false); this.refreshAll();
    setActiveCreatorBody(this,"target");notifyCreatorBodyChanged(this,"target");
  }
  openPromptLibrary(tab="personal"){
    // Creator owns an embedded Prompt Palette editor. Open *that exact editor's*
    // library so this never depends on a separate Prompt Palette node or whichever
    // Prompt Palette happened to be active elsewhere on the graph.
    const root=this.ppRoot;
    const drawer=root?.querySelector?.('[data-drawer="picker"]');
    const launch=root?.querySelector?.('[data-act="picker"]');
    if(!root||!drawer||!launch)throw new Error("Prompt Library is not mounted on this Creator yet");
    if(!drawer.classList.contains("open"))launch.click();
    const target=tab&&root.querySelector?.(`[data-library-tab="${tab}"]`);
    if(target&&!target.hidden&&target.getAttribute("aria-selected")!=="true")target.click();
    if(tab)this.setUIPref?.("last_library_tab",tab);
    return true;
  }
  renderShell(){
    const top=el("div","z3h3-top");
    const brand=el("div","z3h3-brand");brand.append(el("b",null,"MiniMax H3 Creator Palette"));
    top.append(brand,el("div","z3h3-spacer"));
    const undoButton=btn("↶",()=>this.undo(),"z3h3-btn z3h3-history-btn");
    const redoButton=btn("↷",()=>this.redo(),"z3h3-btn z3h3-history-btn");this.undoButton=undoButton;this.redoButton=redoButton;this.refreshHistoryButtons();
    const libraryButton=btn("Library",()=>this.openPromptLibrary(this.uiPrefs?.last_library_tab||"personal"),"z3h3-btn z3h3-library-btn");
    libraryButton.title="Open My Library — your prompts, wildcard lists, RECIPES and custom entries";
    this.directorShortcut=btn("Director",()=>this.openDirector(),"z3h3-btn z3h3-director-launch");
    this.directorShortcut.title="Open the optional H3 Timeline Director. It floats outside the node and can be minimized or hidden.";
    this.refineShortcut=btn("Refine",()=>this.openRefine());
    this.prestageShortcut=btn("Pre-Stage",()=>this.spawnPreStage());
    top.append(
      undoButton,redoButton,libraryButton,btn("References",()=>this.openReferences(),"z3h3-btn z3h3-reference-launch"),btn("Inspect",()=>this.openInspector(),"z3h3-btn"),btn("Media",()=>this.openMedia()),btn("LoRAs",()=>this.openLoras()),
      this.directorShortcut,this.refineShortcut,this.prestageShortcut,
      this.seedHunt?.toggleButton,
      this.previewSidecar?.toggleButton || btn("Preview",()=>this.openSettings()),
      btn("Setup / Settings",()=>this.openSettings(),"z3h3-btn primary")
    );
    this.top=top;this.updateToolbarPrefs();
    this.strip=el("div","z3h3-strip");
    this.composerHost=el("div","z3h3-prompt-composer-host");
    this.promptHost=el("div","z3h3-prompt-host"); this.promptHost.append(this.ppRoot);
    this.clipPromptNote=el("div","z3h3-clip-prompt-note","Supplied footage card — edit trim, sound and continuation in Clip options. Prompt Palette applies to generated shots and Global.");
    this.promptHost.append(this.clipPromptNote);
    this.guideBar=el("div","z3h3-guidebar");
    this.sceneStackHost=el("div","z3h3-scene-stack-host");
    this.controls=el("div","z3h3-controls");
    this.stage=el("div","z3h3-stage"); this.stage.hidden=true;
    this.status=el("div","z3h3-status");
    this.root.append(top,this.strip,this.composerHost,this.sceneStackHost,this.promptHost,this.guideBar,this.controls,this.stage,this.status);
  }
  updateToolbarPrefs(){
    if(this.directorShortcut)this.directorShortcut.hidden=this.uiPrefs?.show_director_shortcut===false;
    if(this.refineShortcut)this.refineShortcut.hidden=!this.uiPrefs?.show_refine_shortcut;
    if(this.prestageShortcut)this.prestageShortcut.hidden=!this.uiPrefs?.show_prestage_shortcut;
    const root=this.root;if(root){const font=Number(this.uiPrefs?.editor_font_size||15),zoom=Number(this.uiPrefs?.editor_zoom||1);root.style.setProperty("--z3-editor-font-size",`${font}px`);root.style.setProperty("--z3-editor-zoom",String(zoom));root.style.setProperty("--wg-editor-font-size",`${Math.max(9,Math.min(34,font*zoom))}px`);root.style.setProperty("--z3-autocomplete-width",`${Number(this.uiPrefs?.autocomplete_width||420)}px`);root.style.setProperty("--z3-autocomplete-max-height",`${Number(this.uiPrefs?.autocomplete_max_height||320)}px`);}
  }
  setUIPref(key,value){
    this.uiPrefs=saveCreatorUIPrefs(this.node,{...this.uiPrefs,[key]:value});
    this.updateToolbarPrefs();this.renderWorkspace();
    notifyCreatorBodyChanged(this,"ui");
    return true;
  }
  fitWorkspace(){
    const run=()=>{
      if(!this.node?.setSize||!this.root?.isConnected)return false;
      let content=0;
      for(const child of this.root.children||[]){
        if(child.hidden||getComputedStyle(child).display==="none")continue;
        content+=Math.max(0,child.getBoundingClientRect?.().height||0);
      }
      if(content<80)return false;
      const top=Number(this.domWidget?.y ?? this.node.widgets_start_y ?? 0)||0;
      const width=Number(this.node.size?.[0])||960;
      const height=Math.max(360,Math.ceil(top+content+12));
      this.node.setSize([width,height]);this.node.graph?.setDirtyCanvas?.(true,true);return true;
    };
    (globalThis.requestAnimationFrame||((fn)=>setTimeout(fn,0)))(run);
    return true;
  }
  renderWorkspace(){
    renderPromptGuide(this,this.guideBar);
    renderPromptComposer(this,this.composerHost);
    const clip=this.target!=="global"&&this.data.segments[this.target]?.kind==="clip";
    // The Prompt Palette editor stays the primary workspace. Structured scene
    // choices are compact semantic tokens in the source; the expanded H3 prose
    // lives behind Preview result / Inspect instead of occupying the editor.
    this.promptHost.hidden=false;
    this.root.dataset.promptView="editor";
    const stackMode=this.uiPrefs?.scene_stack_mode||"prompt";
    this.sceneStackHost.hidden=stackMode!=="expanded";
    this.sceneStackHost.dataset.mode=stackMode;
    if(stackMode==="expanded")renderSceneStack(this,this.sceneStackHost);else this.sceneStackHost.replaceChildren();
  }
  subjectThumbnail(subject){return findSubjectImage(this,subject);}
  assetByHandle(handle){
    const clean=String(handle||"").trim().replace(/^@/,"");
    if(!clean)return null;
    return S.allKnownAssets(this.data).find((asset)=>String(asset?.handle||"").trim()===clean)||null;
  }
  assetPreviewUrl(asset){
    if(!asset)return "";
    if(asset.kind==="image")return asset.type==="output"?H.viewUrl(asset):H.inputViewUrl(asset.filename);
    if(asset.kind==="video")return H.thumbUrl(asset.type==="output"?`${[asset.subfolder,asset.filename].filter(Boolean).join("/")} [output]`:asset.filename,256);
    return "";
  }
  thumbnailUrl(value){
    if(!value)return "";
    if(typeof value==="string"){
      if(value.replaceAll("\\","/").startsWith("thumbs/"))return H3PackAPI.thumbUrl(value);
      return this.assetPreviewUrl(this.assetByHandle(value));
    }
    if(value.handle){const linked=this.assetByHandle(value.handle);if(linked){const url=this.assetPreviewUrl(linked);if(url)return url;}}
    if(value.filename){
      const row={filename:value.filename,subfolder:value.subfolder||"",type:value.type||"input",kind:value.kind||H.kindFromName(value.filename)};
      if(row.kind==="image")return H.viewUrl(row);
      if(row.kind==="video")return H.thumbUrl(`${[row.subfolder,row.filename].filter(Boolean).join("/")}${row.type==="output"?" [output]":""}`,256);
    }
    return "";
  }
  setSubjectThumbnail(handle,thumbnail=null){
    const clean=String(handle||"").trim().replace(/^@/,"");
    const subject=(this.data.subjects||[]).find((row)=>row?.handle===clean);
    if(!subject)return false;
    delete subject.thumbnail_handle;
    if(thumbnail&&typeof thumbnail==="object")subject.thumbnail={...thumbnail};else delete subject.thumbnail;
    this.commitData();return true;
  }
  clearSubjectThumbnail(handle){return this.setSubjectThumbnail(handle,null);}
  _materializeSceneSelection(slot){
    const container=S.activeContainer(this.data,this.target);
    container.scene_palette ||= {};
    if(container.scene_palette[slot])return container.scene_palette[slot];
    const inherited=this.target!=="global"?this.data.scene_palette?.[slot]:null;
    if(inherited)container.scene_palette[slot]=structuredClone(inherited);
    return container.scene_palette[slot]||null;
  }
  _sceneThumbnailKey(slot,preset){
    const id=String(preset?.id||preset?.title||preset?.prompt||"").trim();return id?`${String(slot||"").trim()}:${id}`:"";
  }
  sceneThumbnail(slot,preset){
    const key=this._sceneThumbnailKey(slot,preset),saved=this.data.thumbnail_overrides?.scene?.[key];
    return saved||preset?.thumbnail||null;
  }
  setScenePresetThumbnail(slot,thumbnail=null){
    const slotKey=String(slot||"").trim();if(!slotKey)return false;
    const preset=this._materializeSceneSelection(slotKey);if(!preset)return false;
    const key=this._sceneThumbnailKey(slotKey,preset);if(!key)return false;
    this.data.thumbnail_overrides ||= {};this.data.thumbnail_overrides.scene ||= {};
    delete preset.thumbnail_handle;
    if(thumbnail&&typeof thumbnail==="object"){preset.thumbnail={...thumbnail};this.data.thumbnail_overrides.scene[key]={...thumbnail};}
    else{delete preset.thumbnail;delete this.data.thumbnail_overrides.scene[key];}
    this.commitData();return true;
  }
  clearScenePresetThumbnail(slot){return this.setScenePresetThumbnail(slot,null);}
  removeCastMention(handle){
    const clean=String(handle||"").trim().replace(/^@/,"");if(!clean)return false;
    const source=String(S.activePrompt(this.data,this.target)||"");
    const next=source
      .replace(new RegExp(`@${clean}(?!-[0-9])(?:[+-](?![A-Za-z0-9_])|(?![A-Za-z0-9_+\-]))`,'g'),'')
      .replace(/[ \t]{2,}/g,' ')
      .replace(/\n{3,}/g,'\n\n')
      .trim();
    if(next===source)return false;
    return this.setPromptText(next);
  }
  openTimingCue(seedText=""){
    modal("Insert timing cue",(body,close)=>{
      const generated=(this.data.segments||[]).map((seg,index)=>({seg,index})).filter(({seg})=>seg?.kind!=="clip");
      if(!generated.length){body.append(el("div","z3h3-error","Add a generated shot before inserting a timing cue."));return;}
      const defaultIndex=this.target==="global"?generated[0].index:Number(this.target),target=this.target==="global"?select(generated.map(({index})=>[String(index),`Shot ${index+1}`]),String(defaultIndex)):null;
      const getSeg=()=>this.data.segments[target?Number(target.value):defaultIndex],duration=()=>Number(getSeg()?.duration_s||S.DEFAULT_DURATION_S),at=input("number",Math.min(Math.max(.5,duration()/2),Math.max(.5,duration()-.5))),direction=textarea(seedText||"",3);
      at.min=.2;at.max=Math.max(.2,duration()-.2);at.step=.1;direction.placeholder="what happens, what is said, camera move, transition, sound cue…";
      target?.addEventListener("change",()=>{at.max=Math.max(.2,duration()-.2);at.value=Math.min(Number(at.value)||.5,Number(at.max));});
      const add=()=>{const text=direction.value.trim();if(!text)throw new Error("Describe what happens at this time");const cue=`At ${Number(at.value).toFixed(2).replace(/\.00$/,'')} sec ${text}`;if(target){const seg=getSeg(),current=String(seg?.prompt||"").trim();seg.prompt=current?`${current}\n\n${cue}`:cue;this.resetVariationIndex(false);this.commitData();}else this.insertText(cue);close();};
      body.append(el("div","z3h3-note","Friendly time syntax is normalized to H3 clock timing when the prompt resolves. Quoted dialogue is included in the timing estimate automatically."));if(target)body.append(field("Target shot",target));body.append(field("Time in this shot (seconds)",at),field("Direction",direction),buttonRow(btn("Insert cue",add,"z3h3-btn primary"),btn("Cancel",close)));
    },{small:true});
    return true;
  }
  openTimedLoraCue(lora){
    const entry=typeof lora==="string"?{name:lora}:lora;if(!entry?.name)return false;
    modal(`Timed LoRA cue · ${filenameLabel(entry.name)}`,(body,close)=>{
      const generated=(this.data.segments||[]).map((seg,index)=>({seg,index})).filter(({seg})=>seg?.kind!=="clip");if(!generated.length){body.append(el("div","z3h3-error","Add a generated shot before inserting a timed LoRA cue."));return;}
      const defaultIndex=this.target==="global"?generated[0].index:Number(this.target),target=this.target==="global"?select(generated.map(({index})=>[String(index),`Shot ${index+1}`]),String(defaultIndex)):null,getSeg=()=>this.data.segments[target?Number(target.value):defaultIndex],duration=()=>Number(getSeg()?.duration_s||S.DEFAULT_DURATION_S);
      const at=input("number",Math.min(Math.max(0.5,duration()/2),Math.max(0.5,duration()-0.5))),mode=select([["on","Turn LoRA on"],["off","Turn LoRA off"]],"on"),direction=input("text","");
      at.min=.2;at.max=Math.max(.2,duration()-.2);at.step=.1;direction.placeholder="optional action / dialogue that begins at this moment";target?.addEventListener("change",()=>{at.max=Math.max(.2,duration()-.2);at.value=Math.min(Number(at.value)||.5,Number(at.max));});
      const note=el("div","z3h3-note","Creator keeps ordinary timing direction inside a shot. A timed LoRA cue becomes a real chained render boundary so the adapter is actually off before this time and on/off after it.");
      const add=()=>{const name=String(entry.name),token=`*${mode.value==="off"?"-":""}{${name}}`,text=`At ${Number(at.value).toFixed(2).replace(/\.00$/,'')} sec ${token}${direction.value.trim()?` ${direction.value.trim()}`:""}`;if(target){const seg=getSeg(),current=String(seg?.prompt||"").trim();seg.prompt=current?`${current}\n\n${text}`:text;this.resetVariationIndex(false);this.commitData();}else this.insertText(text);close();};
      body.append(note);if(target)body.append(field("Target shot",target));body.append(field("Time in this shot (seconds)",at),field("LoRA action",mode),field("What happens then",direction),buttonRow(btn("Insert cue",add,"z3h3-btn primary"),btn("Cancel",close)));
    },{small:true});
    return true;
  }
  refreshAll(){
    const clip=this.target!=="global"&&this.data.segments[this.target]?.kind==="clip";
    this.promptHost?.classList.toggle("clip-disabled",!!clip);
    if(this.clipPromptNote)this.clipPromptNote.hidden=!clip;
    this.renderTimeline();this.renderQuick();this.renderStatus();this.renderStageMeta();this.renderWorkspace();
  }
  renderTimeline(){
    this.strip.replaceChildren();
    const targetButton=(title,subtitle,target,extra="")=>{
      const card=btn("",()=>this.switchTarget(target),`z3h3-shot${this.target===target?" active":""}${extra}`);
      card.append(el("b",null,title),el("small",null,subtitle));
      return card;
    };
    this.strip.append(targetButton("GLOBAL / SHARED","inherited prompt · refs · Cast · LoRAs","global"," global"));
    this.data.segments.forEach((seg,i)=>{
      const flags=[];if(seg.merge)flags.push("merged");if(seg.continue)flags.push("picture seam");if(seg.continue_audio)flags.push("audio seam");if(S.isKept(seg))flags.push("kept");else if(seg.hold)flags.push("held");
      const h3Frames=seg.kind==="clip"?0:S.durationFrames(seg.duration_s||S.DEFAULT_DURATION_S);
      const sub=seg.kind==="clip"?`${Number(seg.duration_s||0).toFixed(1)}s · supplied footage`:`${(h3Frames/S.FPS).toFixed(2)}s · ${h3Frames}f · ${(seg.assets||[]).length} refs${flags.length?" · "+flags.join(" · "):""}`;
      this.strip.append(targetButton(seg.kind==="clip"?`Clip ${i+1}`:`Shot ${i+1}`,sub,i,`${S.isKept(seg)?" kept":""}${seg.hold&&!seg.take?" held":""}`));
    });
    this.strip.append(btn("+ Shot",()=>{const base=this.data.segments[Math.max(0,Number(this.target)||0)];this.data.segments.push(S.cloneSegment(base));this.target=this.data.segments.length-1;this.commitData(true,{historyLabel:"Created Shot"});this.syncPrompt(false)},"z3h3-btn primary"));
    if(this.target!=="global"){
      const isClip=this.data.segments[this.target]?.kind==="clip";
      this.strip.append(btn(isClip?"Clip options":"Shot Inspector",()=>this.openShotOptions(this.target)));
      if(this.data.segments[this.target]?.kind!=="clip")this.strip.append(btn("Duplicate",()=>{this.data.segments.splice(Number(this.target)+1,0,S.duplicateSegment(this.data.segments[this.target]));this.target=Number(this.target)+1;this.commitData(true,{historyLabel:"Duplicated Shot"});this.syncPrompt(false)}));
      this.strip.append(btn(this.data.segments.length>1?"Delete shot":"Clear Shot 1",()=>this.clearOrDeleteShot(this.target),"z3h3-btn danger"));
    }
  }
  clearOrDeleteShot(index){
    const i=Number(index);if(!Number.isInteger(i)||!this.data.segments[i])return false;
    const deleting=this.data.segments.length>1;
    if(deleting){this.data.segments.splice(i,1);this.target=Math.max(0,Math.min(i-1,this.data.segments.length-1));}
    else{this.data.segments[0]=S.DEFAULT_SEGMENT();this.target=0;}
    this.commitData(true,{historyLabel:deleting?"Deleted Shot":"Cleared Shot 1"});this.syncPrompt(false);return true;
  }
  openCustomLength(isClip=false){
    const seg=this.data.segments[this.target];if(!seg)return;
    modal(isClip?"Custom clip length":"Custom H3 length",(body,close)=>{
      const seconds=input("number",isClip?Number(seg.duration_s||S.DEFAULT_DURATION_S):S.actualSeconds(seg.duration_s||S.DEFAULT_DURATION_S).toFixed(3));seconds.min=isClip?0.2:1;seconds.max=isClip?120:60;seconds.step=.01;
      const frames=input("number",isClip?Math.max(5,Math.round(Number(seg.duration_s||0)*S.FPS)):S.durationFrames(seg.duration_s||S.DEFAULT_DURATION_S));frames.min=isClip?5:S.durationFrames(1);frames.max=isClip?2880:S.durationFrames(60);frames.step=1;
      const readout=el("div","z3h3-note good");let legalFrames=Number(frames.value),clipSeconds=Number(seg.duration_s||S.DEFAULT_DURATION_S);
      const fromSeconds=()=>{const raw=Math.max(isClip?0.2:1,Math.min(isClip?120:60,Number(seconds.value)||S.DEFAULT_DURATION_S));clipSeconds=raw;legalFrames=isClip?Math.max(5,Math.round(raw*S.FPS)):S.durationFrames(raw);frames.value=legalFrames;readout.textContent=isClip?`${raw.toFixed(3)} seconds · approximately ${legalFrames} timeline frames at 24 fps.`:`H3 will generate ${legalFrames} legal frames · ${(legalFrames/S.FPS).toFixed(3)} seconds. Frame counts are normalized to 17n+5.`;};
      const fromFrames=()=>{const minimum=isClip?5:S.durationFrames(1),raw=Math.max(minimum,Math.trunc(Number(frames.value)||minimum));legalFrames=isClip?Math.min(2880,raw):S.durationFrames(Math.min(60,raw/S.FPS));clipSeconds=legalFrames/S.FPS;frames.value=legalFrames;seconds.value=clipSeconds.toFixed(3);readout.textContent=isClip?`${clipSeconds.toFixed(3)} seconds · ${legalFrames} timeline frames at 24 fps.`:`Nearest legal H3 length: ${legalFrames} frames · ${(legalFrames/S.FPS).toFixed(3)} seconds (17n+5).`;};
      seconds.addEventListener("input",fromSeconds);frames.addEventListener("input",fromFrames);isClip?fromSeconds():fromFrames();
      body.append(el("div","z3h3-note",isClip?"This changes the supplied clip's exact timeline duration. It does not retime the source file.":"Custom values remain constrained only by H3's temporal packing rule and the 1–60 second safety range."),field("Seconds",seconds),field(isClip?"Timeline frames":"H3 frames",frames),readout,buttonRow(btn("Apply",()=>{seg.duration_s=isClip?clipSeconds:legalFrames/S.FPS;this.commitData();close();},"z3h3-btn primary"),btn("Cancel",close)));
    },{small:true});
  }
  openCustomAspect(){
    modal("Custom H3 aspect ratio",(body,close)=>{
      const ratioInput=input("text",this.data.aspect||"16:9"),readout=el("div","z3h3-note"),apply=btn("Apply",()=>{},"z3h3-btn primary");ratioInput.placeholder="Example: 3:2 or 1.85:1";
      let valid="";
      const update=()=>{const match=String(ratioInput.value||"").trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*:\s*([0-9]+(?:\.[0-9]+)?)$/),a=Number(match?.[1]),b=Number(match?.[2]),ratio=a/b;if(!match||!Number.isFinite(ratio)||a<=0||b<=0){valid="";readout.className="z3h3-error";readout.textContent="Enter a positive W:H ratio, such as 3:2.";}else if(ratio<MIN_RATIO||ratio>MAX_RATIO){valid="";readout.className="z3h3-error";readout.textContent="H3 supports ratios from 9:16 through 21:9.";}else{valid=`${match[1]}:${match[2]}`;const canvas=resolveH3Canvas(valid,this.data.short_edge);readout.className="z3h3-note good";readout.textContent=`Resolved canvas at the current resolution: ${canvas.width}×${canvas.height}.`;};apply.disabled=!valid;};
      apply.addEventListener("click",()=>{if(!valid)return;this.data.aspect=valid;this.data.aspect_source="pill";this.commitData();close();});ratioInput.addEventListener("input",update);update();
      body.append(el("div","z3h3-note","Presets stay available. A custom ratio is saved in Creator schema V3 as the same W:H aspect field and is honored by the backend."),field("Width : height",ratioInput),readout,buttonRow(apply,btn("Cancel",close)));
    },{small:true});
  }
  openCustomResolution(){
    modal("Custom H3 resolution",(body,close)=>{
      const edge=input("number",this.data.short_edge||S.NATIVE_SHORT_EDGE),readout=el("div","z3h3-note good");edge.min=384;edge.max=896;edge.step=32;let normalized=normalizeVideoTargetEdge(edge.value);
      const update=()=>{normalized=normalizeVideoTargetEdge(edge.value);const canvas=resolveH3Canvas(this.data.aspect,normalized),mp=canvas.width*canvas.height/1e6;readout.textContent=`Actual H3 canvas: ${canvas.width}×${canvas.height} · ${mp.toFixed(2)} MP · ${normalized}px short-edge target${normalized>768?" · above native":normalized===768?" · native":""}.`;};edge.addEventListener("input",update);update();
      body.append(el("div","z3h3-note","H3 canvases must use 32-pixel latent boundaries. Values are rounded to the nearest supported short edge; the exact output is shown before Apply."),field("Short edge (384–896 px)",edge),readout,buttonRow(btn("Apply",()=>{this.data.short_edge=normalized;this.commitData();close();},"z3h3-btn primary"),btn("Cancel",close)));
    },{small:true});
  }
  openCustomSteps(){
    modal("Custom sampling steps",(body,close)=>{
      const steps=input("number",Math.max(1,Math.trunc(Number(this.widgets.steps?.value)||20))),note=el("div","z3h3-note");steps.min=1;steps.max=10000;steps.step=1;let value=Number(steps.value);
      const update=()=>{value=Math.max(1,Math.min(10000,Math.trunc(Number(steps.value)||1)));note.textContent=`${value} sampling step${value===1?"":"s"}. This changes steps only; your selected sampler and scheduler stay untouched.`;};steps.addEventListener("input",update);update();
      body.append(field("Steps",steps),note,buttonRow(btn("Apply",()=>{setWidget(this.widgets.steps,value,this.node);this.renderQuick();close();},"z3h3-btn primary"),btn("Cancel",close)));
    },{small:true});
  }
  renderQuick(){
    this._quickPickerCleanup?.();
    this.controls.replaceChildren();
    const pickerCleanups=[];
    const picker=(config)=>{const control=createChoicePicker(config);pickerCleanups.push(()=>control.cleanup());return control;};
    this._quickPickerCleanup=()=>{while(pickerCleanups.length)pickerCleanups.pop()?.();};
    const seg=this.target==="global"?this.data.segments[0]:this.data.segments[this.target];
    const isClip=seg?.kind==="clip";
    let length;
    if(this.target==="global"){
      const frames=(this.data.segments||[]).reduce((sum,row)=>sum+(row?.kind==="clip"?Math.round(Number(row?.duration_s||0)*S.FPS):S.durationFrames(row?.duration_s||S.DEFAULT_DURATION_S)),0),seconds=frames/S.FPS;
      length=picker({choices:[{value:"piece",title:`${seconds.toFixed(2)} seconds total`,detail:`${frames} frames across ${(this.data.segments||[]).length} card${(this.data.segments||[]).length===1?"":"s"}`,badge:"Per shot"}],value:"piece",disabled:true,ariaLabel:"Piece length is edited per shot"});
    }else if(isClip){
      length=picker({choices:clipLengthChoices(seg?.duration_s),value:String(Number(seg?.duration_s||S.DEFAULT_DURATION_S)),ariaLabel:"Choose clip length",onChange:(value,choice)=>{if(choice?.action)return this.openCustomLength(true);this.data.segments[this.target].duration_s=Number(value);this.commitData();}});
    }else{
      length=picker({choices:h3LengthChoices(seg?.duration_s),value:String(S.durationFrames(seg?.duration_s||S.DEFAULT_DURATION_S)),ariaLabel:"Choose H3 scene length",onChange:(frames,choice)=>{if(choice?.action)return this.openCustomLength(false);this.data.segments[this.target].duration_s=Number(frames)/S.FPS;this.commitData();}});
    }
    const aspect=picker({choices:h3AspectChoices(this.data.short_edge,this.data.aspect),value:this.data.aspect,ariaLabel:"Choose final aspect",onChange:(value,choice)=>{if(choice?.action)return this.openCustomAspect();this.data.aspect=value;this.data.aspect_source="pill";this.commitData();}});
    const resolution=picker({choices:h3ResolutionChoices(this.data.aspect,this.data.short_edge),value:String(this.data.short_edge||S.NATIVE_SHORT_EDGE),ariaLabel:"Choose final H3 resolution",onChange:(value,choice)=>{if(choice?.action)return this.openCustomResolution();this.data.short_edge=Number(value);this.commitData();}});
    const turbo=!!this.data.turbo?.on,currentSteps=Number(this.widgets.steps?.value??20),samplerValue=String(this.widgets.sampler_name?.value||"res_multistep"),schedulerValue=String(this.widgets.scheduler?.value||"simple"),attentionValue=String(this.widgets.attention?.value||"default"),quality=picker({choices:h3QualityChoices({turbo,currentSteps,sampler:samplerValue,scheduler:schedulerValue}),value:String(currentSteps),ariaLabel:"Choose sampling steps",onChange:(value,choice)=>{if(choice?.action)return this.openCustomSteps();const steps=Number(value);setWidget(this.widgets.steps,steps,this.node);if(turbo){const qualityName=Object.entries(S.TURBO_STEPS).find(([,count])=>count===steps)?.[0];if(qualityName){this.data.turbo.quality=qualityName;this.commitData(false);}}}});
    const sampler=picker({choices:samplingChoiceRows(comboValues(this.widgets.sampler_name),samplerValue,"sampler"),value:samplerValue,ariaLabel:"Choose sampler",onChange:(value)=>setWidget(this.widgets.sampler_name,value,this.node)}),scheduler=picker({choices:samplingChoiceRows(comboValues(this.widgets.scheduler),schedulerValue,"scheduler"),value:schedulerValue,ariaLabel:"Choose scheduler",onChange:(value)=>setWidget(this.widgets.scheduler,value,this.node)}),attention=picker({choices:samplingChoiceRows(comboValues(this.widgets.attention),attentionValue,"attention"),value:attentionValue,ariaLabel:"Choose attention backend",onChange:(value)=>setWidget(this.widgets.attention,value,this.node)});
    this.controls.append(field(isClip?"Clip length":"H3 length",length.root),field("Final aspect",aspect.root),field("Final resolution",resolution.root,"Native is exactly 1344×768 at 16:9. Larger choices use the selected high-resolution mode."),field("Sampling steps",quality.root,`${turbo?"Turbo adapter is on":"Full model weights"} · this changes steps only.`),field("Sampler",sampler.root),field("Scheduler",scheduler.root),field("Attention backend",attention.root,"Saved with this workflow and restored in both frontend modes."));
  }
  _routeForTarget(target){
    const seg=target==="global"?null:this.data.segments?.[target];
    const pinned=seg?.checkpoint&&seg.checkpoint!=="auto"?String(seg.checkpoint).toUpperCase():"";
    if(pinned)return pinned;
    const forced=this.data.models?.route;if(forced==="ref2va")return "REF2VA";if(forced==="fl2va")return "FL2VA";
    const assets=target==="global"?[...(this.data.assets||[])]:S.allAssets(this.data,target);
    const refs=assets.some(a=>a?.role==="reference");
    return refs?"REF2VA":"FL2VA";
  }
  route(){
    if(this.target!=="global")return this._routeForTarget(this.target);
    const routes=[...new Set((this.data.segments||[]).map((seg,index)=>seg?.kind==="clip"?null:this._routeForTarget(index)).filter(Boolean))];
    return routes.length>1?"MIXED":routes[0]||this._routeForTarget("global");
  }
  renderStatus(){
    const archive=this.data.archive_stitch||{};
    if(archive.enabled){
      const range=Number(archive.last_clip||0)>0?`${Number(archive.first_clip||1)}–${Number(archive.last_clip)}`:`${Number(archive.first_clip||1)}+`;
      this.status.replaceChildren(
        el("span","z3h3-status-strong","MOTION CONTEXT ARCHIVE"),
        el("span",null,`${archive.context_length||22}f dissolve · ${Number(archive.fps||24)} fps`),
        el("span",null,`clips ${range}`),
        el("span",null,String(archive.pattern||"clip_*.safetensors")),
        el("span","z3h3-route","DECODE + STITCH · no DiT sampling")
      );
      return;
    }
    const seg=this.target==="global"?null:this.data.segments?.[this.target],piece=this.target==="global";
    const requestedSec=Number(seg?.duration_s||S.DEFAULT_DURATION_S);
    const frames=piece?(this.data.segments||[]).reduce((sum,row)=>sum+(row?.kind==="clip"?Math.round(Number(row?.duration_s||0)*S.FPS):S.durationFrames(Number(row?.duration_s||S.DEFAULT_DURATION_S))),0):(seg?.kind==="clip"?Math.round(requestedSec*S.FPS):S.durationFrames(requestedSec));
    const sec=piece?frames/S.FPS:seg?.kind==="clip"?requestedSec:frames/S.FPS;
    const res=describeH3Resolution(this.data.aspect,this.data.short_edge,{upscale:this.data.upscale,sampleEdge:this.data.sample_edge});
    const adaptive=this.data.aspect_source!=="pill",canvas=adaptive?`Adaptive aspect · ${res.target.shortEdge}px final short edge${res.twoPass?` · ${res.first.shortEdge}px first`:""}`:res.twoPass?`${res.target.width}×${res.target.height} final · ${res.first.width}×${res.first.height} first`:`${res.target.width}×${res.target.height} final`;
    const assets=this.target==="global"?(this.data.assets||[]):S.allAssets(this.data,this.target),refs=assets.filter(a=>a?.role==="reference").length;
    const loras=this.target==="global"?(this.data.loras||[]):[...(this.data.loras||[]),...(seg?.loras||[])],activeLoras=new Set(loras.filter(l=>l?.enabled!==false&&l?.name).map(l=>String(l.name))).size;
    const route=this.route(),pin=piece?"piece routes":seg?.checkpoint&&seg.checkpoint!=="auto"?"pinned":"auto",seed=piece?`workflow seed ${this.widgets.seed?.value??0}`:seg?.seed!=null?`seed ${seg.seed}`:`seed inherits ${this.widgets.seed?.value??0}`;
    const where=piece?`GLOBAL / SHARED · ${(this.data.segments||[]).length} card${(this.data.segments||[]).length===1?"":"s"}`:seg?.kind==="clip"?`CLIP ${Number(this.target)+1}`:`SHOT ${Number(this.target)+1}`;
    const variation=this.currentVariationIndex(),workload=planH3Workload(this.data,{steps:this.widgets.steps?.value});
    this.status.replaceChildren(
      el("span","z3h3-status-strong",where),
      el("span",null,`${sec.toFixed(sec%1?2:1)}s · ${frames}f`),
      el("span",null,canvas),
      el("span",null,`${refs} ref${refs===1?"":"s"}`),
      el("span",null,`${activeLoras} LoRA${activeLoras===1?"":"s"}`),
      el("span",null,seed),
      ...(variation?[el("span","z3h3-var-readout",`VAR ${variation}`)]:[]),
      ...(!workload.bypass?[el("span","z3h3-workload-badge",`ATTN FLOOR ${formatWorkloadRatio(workload.attentionRatio).split(" ")[0]}`)]:[]),
      el("span","z3h3-route",`${route} · ${pin}`)
    );
  }
  renderStageMeta(){
    const gate=this.data?.prestage_gate;
    if(!gate?.active){this.stage.hidden=true;this.stage.replaceChildren();return}
    this.stage.hidden=false;this.stage.replaceChildren();
    const copy=el("div","z3h3-stage-meta z3h3-prestage-gate-copy");copy.append(el("b",null,"Video paused by PreStage"),el("small","z3h3-note",gate.message||"Creator is waiting for Image Lab handoff."));
    const release=btn("Enable Video · Bypass PreStage",()=>{const result=bypassPreStageForCreator(this);if(!result.ok)throw new Error(result.message)},"z3h3-btn primary z3h3-prestage-release");release.title="Turn off the PreStage gate on both nodes so normal Creator video queues work again.";
    this.stage.append(copy,release);
  }
  handleExecution(output){
    this.lastOutput=output||{};
    const seedHuntDraft=this.seedHunt?.handleExecution?.(output)===true;
    const prestageIdle=(output?.mmc_creator_idle||[])[0];
    if(prestageIdle){
      this.stage.hidden=false;this.stage.replaceChildren();
      const copy=el("div","z3h3-stage-meta z3h3-prestage-gate-copy");copy.append(el("b",null,"Video paused by PreStage"),el("small","z3h3-note",prestageIdle.message||"Creator is waiting for Image Lab handoff."));
      const release=btn("Enable Video · Bypass PreStage",()=>{const result=bypassPreStageForCreator(this);if(!result.ok)throw new Error(result.message)},"z3h3-btn primary z3h3-prestage-release");
      this.stage.append(copy,release);
      this.renderStatus();return;
    }
    if(!seedHuntDraft&&S.attachTakes(this.data,output?.mmc_takes||[]))this.commitData();
    const archiveReport=(output?.mmc_archive_report||[])[0];
    if(archiveReport){this.node.properties ||= {};this.node.properties.z3_last_archive_report=String(archiveReport);}
    const video=(output?.mmc_video||[])[0];
    if(video){
      const shown=this.previewSidecar?.showFinal?.(output);
      this.stage.hidden=true;
      this.stage.replaceChildren();
      if(!shown){
        const meta=el("div","z3h3-stage-meta");
        meta.append(el("b",null,filenameLabel(video.filename)),el("small","z3h3-note","render saved · Preview is off"));
        this.stage.append(meta,btn("Open Renders",()=>this.openMedia("output")));
      }
    }
    if(archiveReport){
      const last=String(archiveReport).trim().split(/\n/).filter(Boolean).slice(-1)[0]||"Archive stitch complete";
      this.status?.setAttribute?.("title",String(archiveReport));
      this.node.properties.z3_last_archive_summary=last;
    }
    this.renderTimeline();this.renderStatus();
  }
  setPromptText(value,{notify=true,reconcile=true,resetVariation=true,historyLabel="Edit prompt"}={}){
    const text=String(value??"");
    S.setActivePrompt(this.data,this.target,text);
    if(resetVariation)this.resetVariationIndex(false);
    if(reconcile){const container=S.activeContainer(this.data,this.target);if(container?.scene_palette)container.scene_palette=reconcileSceneSelections(text,container.scene_palette);}
    this.commitData(notify,{historyLabel});this.syncPrompt(false);setActiveCreatorBody(this,"prompt");
    return true;
  }
  insertText(text){
    const chunk=String(text??"").trim();if(!chunk)return false;
    const editor=this.editorSurface || this.ppRoot.querySelector?.('[data-el="textarea"]') || this.ppRoot.querySelector?.('[data-pp-editor-surface]') || this.ppRoot.querySelector?.("textarea");
    if(editor && typeof editor.setRangeText==="function"){
      const value=String(editor.value??"");
      const start=editor.selectionStart??value.length,end=editor.selectionEnd??start;
      const pad=start&&/\S$/.test(value.slice(0,start))?" ":"",tail=end<value.length&&/^\S/.test(value.slice(end))?" ":"";
      editor.setRangeText(`${pad}${chunk}${tail}`,start,end,"end");
      editor.dispatchEvent(new Event("input",{bubbles:true}));
      S.setActivePrompt(this.data,this.target,String(editor.value??""));
      this.commitData(true,{historyLabel:"Inserted semantic token"});editor.focus?.({preventScroll:true});setActiveCreatorBody(this,"insert");
      return true;
    }
    // Newer renderers may temporarily detach the editable surface while a sidebar
    // action is clicked. Never turn that into a silent no-op: update the canonical
    // Creator prompt directly and let syncPrompt restore the editor afterwards.
    const current=S.activePrompt(this.data,this.target).trim();
    return this.setPromptText(current?`${current}\n\n${chunk}`:chunk,{historyLabel:"Inserted semantic token"});
  }
  applyScenePreset(slot,preset){
    const container=S.activeContainer(this.data,this.target);container.scene_palette ||= {};
    const inheritedThumb=this.sceneThumbnail?.(slot,preset);
    const enriched={...preset,category:preset?.category||slot,...(inheritedThumb?{thumbnail:inheritedThumb}:{})};
    const result=applySceneSelection(S.activePrompt(this.data,this.target),container.scene_palette,slot,enriched);
    container.scene_palette=result.selections;
    return this.setPromptText(result.prompt,{historyLabel:`Set ${slot} preset`});
  }
  applyScenePresetAtRange(slot,preset,start,end,direction=0){
    const container=S.activeContainer(this.data,this.target);container.scene_palette ||= {};
    const inheritedThumb=this.sceneThumbnail?.(slot,preset);
    const enriched={...preset,category:preset?.category||slot,...(inheritedThumb?{thumbnail:inheritedThumb}:{})};
    const source=String(S.activePrompt(this.data,this.target)||""),a=Math.max(0,Math.min(Number(start)||0,source.length)),b=Math.max(a,Math.min(Number(end)||a,source.length));
    let text=source.slice(0,a)+source.slice(b),anchor=a;
    ({text,anchor}=stripSceneTokenForMove(text,slot,anchor));
    const marker=Number(direction)>0?"+":Number(direction)<0?"-":"",unit=`${sceneToken(slot)}${marker}`;
    text=text.slice(0,anchor)+unit+text.slice(anchor);
    const result=applySceneSelection(text,container.scene_palette,slot,enriched);
    container.scene_palette=result.selections;
    this.setPromptText(result.prompt,{historyLabel:`Call ${slot} preset`});
    const editor=this.editorSurface;if(editor){const caret=Math.min(result.prompt.length,anchor+unit.length);editor.focus?.({preventScroll:true});editor.setSelectionRange?.(caret,caret);}
    return true;
  }
  removeScenePreset(slot){
    const container=S.activeContainer(this.data,this.target);container.scene_palette ||= {};
    const result=removeSceneSelection(S.activePrompt(this.data,this.target),container.scene_palette,slot);
    container.scene_palette=result.selections;
    return this.setPromptText(result.prompt,{historyLabel:`Remove ${slot} preset`});
  }
  ensureScenePreset(slot){
    const key=String(slot||"").trim(),container=S.activeContainer(this.data,this.target);if(!key||!container||container.kind==="clip")return null;
    container.scene_palette ||= {};
    const selected=container.scene_palette[key]||(this.target!=="global"?this.data.scene_palette?.[key]:null);if(!selected)return null;
    const source=String(S.activePrompt(this.data,this.target)||"");if(source.includes(sceneToken(key))&&container.scene_palette[key])return container.scene_palette[key];
    const result=applySceneSelection(source,container.scene_palette,key,selected);container.scene_palette=result.selections;S.setActivePrompt(this.data,this.target,result.prompt);return container.scene_palette[key]||null;
  }
  setSceneVariation(slot,direction=0){
    const requested=Number(direction)>0?1:Number(direction)<0?-1:0;if(requested&&!this.ensureScenePreset(slot))return false;
    const current=S.activePrompt(this.data,this.target);const existing=sceneVariationDirection(current,slot);const nextDirection=existing===requested?0:requested;
    const next=setSceneVariationMarker(current,slot,nextDirection);
    if(next===current)return false;
    this.resetVariationIndex(false);
    this.setPromptText(next,{resetVariation:false,historyLabel:`Vary ${slot}`});return true;
  }
  sceneVariation(slot){return sceneVariationDirection(S.activePrompt(this.data,this.target),slot);}
  setCastVariation(handle,direction=0){
    const key=S.normalizeSubjectHandle(String(handle||"").replace(/^@/,""));if(!key)return false;
    const current=S.activePrompt(this.data,this.target),existing=castVariationDirection(current,key),requested=Number(direction)>0?1:Number(direction)<0?-1:0;
    const nextDirection=existing===requested?0:requested,next=setCastVariationMarker(current,key,nextDirection);
    if(next===current)return false;
    this.resetVariationIndex(false);this.setPromptText(next,{resetVariation:false,historyLabel:`Vary @${key}`});return true;
  }
  castVariation(handle){return castVariationDirection(S.activePrompt(this.data,this.target),String(handle||"").replace(/^@/,""));}
  scenePreset(slot){return sceneSelectionFor(S.activeContainer(this.data,this.target)?.scene_palette,slot);}
  openScenePicker(slot,options={}){return openScenePicker(this,slot,options);}
  removeSubjectMention(subject){
    const handle=S.normalizeSubjectHandle(typeof subject==="string"?subject:subject?.handle||"character");
    const source=String(S.activePrompt(this.data,this.target)||"");
    const next=source.replace(new RegExp(`@${handle}(?!-[0-9])(?:[+-](?![A-Za-z0-9_])|(?![A-Za-z0-9_+\-]))`,'g'),"").replace(/[ \t]{2,}/g," ").replace(/\n{3,}/g,"\n\n").trim();
    if(next===source)return false;
    this.setPromptText(next);return true;
  }
  removeSubject(subject){S.removeSubject(this.data,subject);this.commitData(true,{historyLabel:`Remove @${subject?.handle||"Cast"}`});this.syncPrompt(false);return true;}
  removeAsset(asset){S.removeAsset(this.data,asset);this.commitData(true,{historyLabel:`Remove @${asset?.handle||"reference"}`});this.syncPrompt(false);return true;}
  activeAssetList(){return S.activeAssetList(this.data,this.target);}
  attach(row,role="reference"){
    if(this.target!=="global"&&this.data.segments[this.target]?.kind==="clip")return;
    const kind=kindOf(row);if(!["image","video","audio"].includes(kind))return;
    const a=S.createAsset(kind,row.path||row.filename||row.name,this.data,role);if(kind==="video")a.track="picture";
    this.activeAssetList().push(a);this.commitData(true,{historyLabel:`Add @${a.handle} reference`});this.insertText(`@${a.handle}`);return a;
  }
  attachReferenceRecord(record,{target=this.target,role=null,globalActive=false,insertMention=false}={}){
    if(!record?.id||!record?.filename)return null;
    const targetKey=target==="global"?"global":Math.max(0,Math.min(this.data.segments.length-1,Number(target)||0));
    if(targetKey!=="global"&&this.data.segments[targetKey]?.kind==="clip")return null;
    let list;
    if(targetKey==="global"){this.data.assets=Array.isArray(this.data.assets)?this.data.assets:[];list=this.data.assets;}
    else{const segment=this.data.segments[targetKey];if(!segment)return null;segment.assets=Array.isArray(segment.assets)?segment.assets:[];list=segment.assets;}
    const refId=String(record.id),desiredRole=role||record.default_role||"reference";
    let asset=list.find((row)=>String(row?.library_ref_id||"")===refId)||null;
    if(!asset){
      const kind=["image","video","audio"].includes(record.kind)?record.kind:H.kindFromName(record.filename);
      // Workflow asset handles are compiler syntax and MUST stay in the
      // machine namespace produced by createAsset(): img-N / vid-N / aud-N.
      // A reusable Reference record's friendly handle is Library metadata, not
      // an H3 @media handle. Mixing the namespaces makes valid references
      // invisible to compile.HANDLE_RE and can turn an assignment into a
      // dangling prompt citation.
      asset=S.createAsset(kind,record.filename,this.data,desiredRole);
      list.push(asset);
    }
    asset.filename=String(record.filename||asset.filename||"");asset.kind=["image","video","audio"].includes(record.kind)?record.kind:asset.kind;asset.role=desiredRole;
    asset.library_ref_id=refId;asset.library_ref_handle=String(record.handle||"").trim().replace(/^@/,"");asset.reference_name=String(record.name||record.handle||asset.handle||"Reference");asset.subject_role=record.subject_role||"reference";
    asset.strength=Number.isFinite(Number(record.strength))?Math.max(0,Math.min(2,Number(record.strength))):1;asset.notes=String(record.notes||"");asset.takes=record.takes||asset.takes||"full";asset.ref_size=record.ref_size||asset.ref_size||(asset.kind==="video"?"max":"match");asset.global_active=targetKey==="global"&&globalActive===true;
    if(asset.kind==="video")asset.track=record.track||asset.track||"picture";else delete asset.track;
    this.commitData(true,{historyLabel:`Assign ${asset.reference_name} reference`});
    if(insertMention)this.insertText?.(`@${asset.handle}`);
    return asset;
  }
  replaceAsset(asset,list){return this.openMedia("input",{replaceAsset:asset,replaceList:list});}
  async openMedia(initial="input",mode={}){
    modal(mode.replaceAsset?`Replace @${mode.replaceAsset.handle}`:"Media, References & Renders",async(body,close)=>{
      const favorites=new Set(readJSONStorage(FAVORITES_KEY,[]));let root=initial==="output"?"output":"input",rows=[],shelf="",showFav=initial==="favorites";
      const toolbar=el("div","z3h3-tabs"), search=input("search","");search.placeholder="Search media…";const shelfPick=select([["","All shelves"]],"");const grid=el("div","z3h3-grid"),note=el("div","z3h3-note");
      const saveFav=()=>writeJSONStorage(FAVORITES_KEY,[...favorites]);
      const load=async()=>{grid.replaceChildren(el("div","z3h3-note","Loading…"));try{const r=await H.listAssets(root);rows=r.assets||[];const shelves=[...new Set(rows.map(x=>x.subfolder||"").filter(Boolean))].sort();shelfPick.replaceChildren(...[["","All shelves"],...shelves.map(x=>[x,x])].map(([v,l])=>{const o=document.createElement("option");o.value=v;o.textContent=l;return o}));draw();}catch(e){grid.textContent=e.message}};
      const draw=()=>{
        const q=search.value.toLowerCase(),accepted=Array.isArray(mode.acceptKinds)&&mode.acceptKinds.length?new Set(mode.acceptKinds):null;grid.replaceChildren();let visible=rows.filter(r=>(!q||`${r.path} ${r.kind}`.toLowerCase().includes(q))&&(!shelfPick.value||r.subfolder===shelfPick.value)&&(!showFav||favorites.has(r.path))&&(!accepted||accepted.has(kindOf(r)))&&(!mode.replaceAsset||!["first_frame","last_frame"].includes(mode.replaceAsset.role)||kindOf(r)==="image"));
        for(const row of visible){const kind=kindOf(row);if(!["image","video","audio"].includes(kind))continue;const c=el("div","z3h3-card"),th=el("div","z3h3-thumb");c.draggable=true;c.title=(c.title?c.title+"\n":"")+"Drag onto the H3 Storyboard Director timeline";c.addEventListener("dragstart",event=>{try{event.dataTransfer?.setData("application/x-z3-media",JSON.stringify({path:row.path||row.filename||row.name,filename:row.filename||row.path||row.name,subfolder:row.subfolder||"",kind}));event.dataTransfer.effectAllowed="copy";}catch{}});
          if(kind==="image")th.style.backgroundImage=`url("${H.thumbUrl(row.path,256)}")`;else th.textContent=assetIcon(kind);
          const fav=btn(favorites.has(row.path)?"★":"☆",()=>{favorites.has(row.path)?favorites.delete(row.path):favorites.add(row.path);saveFav();draw();},"z3h3-mini");fav.title="Favorite locally";th.append(fav);
          const meta=el("div","z3h3-card-meta");meta.append(el("b",null,filenameLabel(row.path)),el("small",null,[kind,row.subfolder].filter(Boolean).join(" · ")));
          const actions=el("div","actions");
          const choose=async(role="reference")=>{
            if(typeof mode.onChoose==="function"){await mode.onChoose(row,{kind,role,root});close();return;}
            if(mode.replaceAsset){const old=mode.replaceAsset,list=mode.replaceList||this.activeAssetList(),index=list.indexOf(old);if(index<0)throw new Error("That reference is no longer active.");const replacement={...old,kind,filename:row.path,role:old.role||role};if(kind==="video")replacement.track=old.track&&old.track!=="sound"?old.track:"picture";else delete replacement.track;if(kind==="image")delete replacement.trim;list[index]=S.normalizeAsset(replacement);this.commitData();close();return;}
            const previousTarget=this.target;if(mode.target==="global")this.target="global";else if(Number.isInteger(Number(mode.targetIndex)))this.target=Number(mode.targetIndex);const attached=this.attach(row,role);if(attached&&mode.defaultTakes){attached.takes=mode.defaultTakes;if(mode.defaultTakes==="voice"&&attached.kind==="video")attached.track="sound";this.commitData();}this.target=previousTarget;this.syncPrompt(false);close();
          };
          if(typeof mode.onChoose==="function")actions.append(btn(mode.chooseLabel||"Use this media",()=>choose(mode.defaultRole||"reference"),"z3h3-btn primary"));
          else if(mode.replaceAsset)actions.append(btn("Use this media",()=>choose(mode.replaceAsset.role||"reference"),"z3h3-btn primary"));
          else if(mode.defaultRole){const roleLabel={reference:"Use as reference",first_frame:"Use as start frame",last_frame:"Use as end frame"}[mode.defaultRole]||"Use this media";if(mode.defaultRole==="reference"||kind==="image")actions.append(btn(roleLabel,()=>choose(mode.defaultRole),"z3h3-btn primary"));actions.append(btn("Reference",()=>choose("reference")));if(kind==="image")actions.append(btn("Start",()=>choose("first_frame")),btn("End",()=>choose("last_frame")));}
          else{actions.append(btn("Reference",()=>choose("reference")));if(kind==="image")actions.append(btn("Start",()=>choose("first_frame")),btn("End",()=>choose("last_frame")));}
          if(kind==="video"&&!mode.replaceAsset)actions.append(btn("Cut into timeline",async()=>{try{const pr=await H.probe(row.path);const clip={kind:"clip",filename:row.path,duration_s:Number(pr.duration||5),width:Number(pr.width||0),height:Number(pr.height||0),has_audio:pr.has_audio!==false,sound:pr.has_audio!==false,continue:false,continue_audio:false};const at=this.target==="global"?this.data.segments.length:Math.min(this.data.segments.length,Number(this.target)+1);this.data.segments.splice(at,0,clip);this.target=at;this.commitData();close();}catch(e){note.textContent=e.message;}}));
          const manage=btn("⋯",()=>this.openMediaManage(row,()=>load()),"z3h3-mini");manage.title="Move or delete";actions.append(manage);meta.append(actions);c.append(th,meta);grid.append(c);
        }
        note.textContent=`${visible.length} shown · ${rows.length} total · ${root==="output"?"ComfyUI output":"ComfyUI input"}`;
      };
      const tab=(label,r)=>btn(label,()=>{root=r;showFav=false;[...toolbar.querySelectorAll(".z3h3-tab")].forEach(x=>x.classList.remove("active"));load()},"z3h3-btn z3h3-tab");
      const inputTab=tab("Input","input"),renderTab=tab("Renders","output"),favTab=btn("Favorites",()=>{showFav=true;draw()},"z3h3-btn z3h3-tab");
      if(root==="input")inputTab.classList.add("active");else renderTab.classList.add("active");
      const upload=input("file","");upload.multiple=true;upload.accept="image/*,video/*,audio/*";upload.onchange=async()=>{for(const f of upload.files||[])await H.uploadFile(f);await load()};
      search.oninput=draw;shelfPick.onchange=draw;toolbar.append(inputTab,renderTab,favTab,field("Shelf",shelfPick),field("Upload",upload));body.append(toolbar,search,note,grid);await load();
    },{wide:true});
  }
  openMediaManage(row,done){
    modal(`Organize ${filenameLabel(row.path)}`,(body,close)=>{const dest=input("text",row.subfolder||"");body.append(field("Move to shelf/subfolder",dest,"Blank moves to the root of this same Input or Renders library."),buttonRow(btn("Move",async()=>{try{await H.moveAsset(row.path,dest.value.trim());done?.();close()}catch(e){body.append(el("div","z3h3-error",e.message))}},"z3h3-btn primary"),btn("Delete file",async()=>{if(!confirm(`Delete ${filenameLabel(row.path)} from disk?`))return;try{await H.deleteAsset(row.path);done?.();close()}catch(e){body.append(el("div","z3h3-error",e.message))}})));},{small:true});
  }
  openAsset(asset){
    modal(`Reference @${asset.handle}`,(body,close)=>{
      let liveHandle=String(asset.handle||"");const originalFilename=asset.filename;
      const current=()=>S.allKnownAssets(this.data).find(a=>a.handle===liveHandle)||S.allKnownAssets(this.data).find(a=>a.filename===originalFilename);
      const replaceMention=(oldHandle,newHandle)=>{if(!oldHandle||oldHandle===newHandle)return;const swap=(value)=>String(value??"").split(`@${oldHandle}`).join(`@${newHandle}`);this.data.prompt=swap(this.data.prompt);this.data.soundscape=swap(this.data.soundscape);this.data.music=swap(this.data.music);for(const seg of this.data.segments||[]){seg.prompt=swap(seg.prompt);seg.soundscape=swap(seg.soundscape);seg.music=swap(seg.music);}for(const subject of this.data.subjects||[]){subject.from=(subject.from||[]).map(v=>String(v).replace(/^@/,"")===oldHandle?newHandle:v);for(const key of ["motion","voice","replaces"])if(String(subject[key]||"").replace(/^@/,"")===oldHandle)subject[key]=newHandle;}};
      const roleOptions=asset.kind==="image"?[["reference","Reference"],["first_frame","First frame"],["last_frame","Last frame"]]:[["reference","Reference"]];
      const f=input("text",asset.handle),role=select(roleOptions,asset.role||"reference"),ref=select(["match","max"],asset.ref_size||(asset.kind==="video"?"max":"match")),scopes=select(S.scopeOptions(asset),asset.takes||"full");
      let track,st,en;
      const apply=()=>{const row=current();if(!row)return;const next=f.value.trim()||row.handle;if(next!==liveHandle){replaceMention(liveHandle,next);row.handle=next;liveHandle=next;}row.role=role.value;row.ref_size=ref.value;row.takes=scopes.value;if(track)row.track=track.value;if(st&&en&&en.value!=="")row.trim={start:Number(st.value),end:Number(en.value)};else if(st&&en)delete row.trim;this.commitData();};
      f.onchange=role.onchange=ref.onchange=scopes.onchange=apply;
      body.append(el("div","z3h3-note good","Live reference settings — every change is part of the next queue immediately."),field("Handle",f),field("Role",role),field("Reference size",ref),field("Scope / takes",scopes,"Controls what H3 should borrow from this reference; the compiler/refiner translates the role into H3 reference language."));
      if(asset.kind==="image"){const preview=document.createElement("img");preview.className="z3h3-reference-preview";preview.src=H.inputViewUrl(asset.filename);preview.alt=`Preview for @${asset.handle}`;body.append(preview);}
      if(asset.kind==="video"){track=select([["picture","Picture only"],["picture+sound","Picture + sound"],["sound","Sound only"]],asset.track||"picture");track.onchange=apply;body.append(field("Video contribution",track));}
      if(asset.kind!=="image"){
        const player=asset.kind==="video"?document.createElement("video"):document.createElement("audio");player.controls=true;player.preload="metadata";player.src=H.inputViewUrl(asset.filename);player.className="z3h3-media-player";body.append(player);
        const wave=el("canvas","z3h3-wave");wave.width=640;wave.height=70;body.append(wave);this.drawWaveform(asset.filename,wave);
        const two=el("div","z3h3-two");st=input("number",asset.trim?.start??0);en=input("number",asset.trim?.end??"");st.step=en.step=.01;st.onchange=en.onchange=apply;two.append(field("Trim start (s)",st),field("Trim end (s)",en));body.append(two);
      }
      const currentList=(row)=>{if(!row)return null;if((this.data.assets||[]).includes(row))return this.data.assets;for(const seg of this.data.segments||[])if((seg.assets||[]).includes(row))return seg.assets;return null;};
      body.append(el("div","z3h3-note",asset.filename),buttonRow(btn("Replace media",()=>{const row=current(),list=currentList(row);if(!row||!list)throw new Error("That reference is no longer active.");close();this.replaceAsset(row,list);},"z3h3-btn"),btn("Insert @ mention",()=>this.insertText(`@${liveHandle}`)),btn("Done",close,"z3h3-btn primary"),btn("Remove reference",()=>{const row=current();if(row)this.removeAsset(row);close()})));
    },{small:true});
  }
  async drawWaveform(filename,canvas){
    try{const r=await H.peaks(filename),peaks=r.peaks;if(!Array.isArray(peaks)||!peaks.length)return;const ctx=canvas.getContext("2d"),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.strokeStyle="rgba(130,185,255,.85)";ctx.beginPath();for(let x=0;x<w;x++){const p=Number(peaks[Math.floor(x/w*peaks.length)]||0);ctx.moveTo(x,h/2-p*h*.45);ctx.lineTo(x,h/2+p*h*.45)}ctx.stroke();}catch{/* waveform is optional */}
  }
  async openLoras(options={}){
    modal("H3 LoRA Manager",async(body,close)=>{
      body.classList.add("z3h3-lora-manager");
      const shell=el("div","z3h3-lora-shell"),activeHost=el("div","z3h3-lora-active-stack"),libraryGrid=el("div","z3h3-lora-library-grid"),note=el("div","z3h3-lora-library-note");
      const search=input("search","");search.placeholder="Search names, trigger words, tags or base model…";search.className="z3h3-lora-search";
      let selectedFolder=String(readJSONStorage(LORA_FOLDER_KEY,"")||"").replace(/\\/g,"/").replace(/^\/+|\/+$/g,"");
      const folder=select([["","All folders"]],"");folder.className="z3h3-lora-folder";
      const densityKey="z3.minimaxCreator.loraDensity";let density=readJSONStorage(densityKey,"compact")==="comfortable"?"comfortable":"compact";
      const densityButton=btn(density==="compact"?"Comfort view":"Compact view",()=>{density=density==="compact"?"comfortable":"compact";writeJSONStorage(densityKey,density);libraryGrid.dataset.density=density;densityButton.textContent=density==="compact"?"Comfort view":"Compact view";},"z3h3-btn");
      let rows=[],loadSerial=0;
      const currentContainer=()=>S.activeContainer(this.data,this.target)||this.data;
      const currentEntry=(name)=>S.findLora(currentContainer(),name);
      const scopeName=()=>this.target==="global"?"GLOBAL / SHARED":`SHOT ${Number(this.target)+1}`;
      const commit=()=>{this.commitData();renderActive();draw();};
      const edit=(name,fn)=>{const entry=currentEntry(name);if(!entry)return;fn(entry);commit();};
      const preview=(name,hasPreview)=>{const th=el("div","z3h3-lora-preview");if(hasPreview)th.style.backgroundImage=`url("${H.loraPreviewUrl(name)}")`;else{th.append(el("span","z3h3-lora-preview-mark","◇"),el("small",null,"LoRA"));}return th;};
      const activeSummary=()=>{
        const entries=(currentContainer().loras||[]),enabled=entries.filter((entry)=>entry.enabled!==false).length;
        return `${enabled} active · ${entries.length} in ${scopeName()}`;
      };
      const renderActive=()=>{
        activeHost.replaceChildren();const entries=currentContainer().loras||[];
        const title=el("div","z3h3-lora-section-head"),copy=el("div");copy.append(el("b",null,"Active stack"),el("small",null,activeSummary()));title.append(copy,el("span","z3h3-lora-live-badge","LIVE"));activeHost.append(title);
        const list=el("div","z3h3-lora-active-list");activeHost.append(list);
        if(!entries.length){const empty=el("div","z3h3-lora-empty");empty.append(el("b",null,"No LoRAs on this level"),el("small",null,"Choose one from the library below. It becomes active immediately and can be tuned here."));list.append(empty);return;}
        for(const entry of entries){
          const row=el("article",`z3h3-lora-stack-card${entry.enabled===false?" disabled":""}`),head=el("div","z3h3-lora-stack-head"),identity=el("div","z3h3-lora-stack-identity"),actions=el("div","z3h3-lora-stack-actions");
          const metadata=rows.find((item)=>item.name===entry.name);identity.append(preview(entry.name,metadata?.preview||metadata?.thumb));const names=el("div","z3h3-lora-stack-name");names.append(el("b",null,filenameLabel(entry.name)),el("small",null,S.loraModes(entry).length===2?"FL2VA + Ref2VA":`${String(S.loraModes(entry)[0]||"both").toUpperCase()} only`));identity.append(names);
          const on=checkbox(entry.enabled!==false);on.className="z3h3-lora-switch-input";const switchWrap=el("label","z3h3-lora-switch");switchWrap.append(on,el("span",null,""));switchWrap.title=entry.enabled===false?"Enable LoRA":"Disable LoRA";
          actions.append(switchWrap,btn("Timed cue",()=>this.openTimedLoraCue(entry),"z3h3-btn"),btn("Remove",()=>{S.removeLora(currentContainer(),entry.name);commit();},"z3h3-btn danger"));head.append(identity,actions);row.append(head);
          const controls=el("div","z3h3-lora-stack-controls"),strengthWrap=el("label","z3h3-lora-control"),strengthTop=el("span","z3h3-lora-control-label"),strengthValue=input("number",entry.strength??1);strengthValue.min=-2;strengthValue.max=2;strengthValue.step=.05;strengthValue.className="z3h3-lora-strength-value";strengthTop.append(el("span",null,"Strength"),strengthValue);const strength=input("range",entry.strength??1);strength.min=-2;strength.max=2;strength.step=.05;strength.className="z3h3-lora-strength-slider";strengthWrap.append(strengthTop,strength);
          const mode=select([["both","Both checkpoints"],["fl2va","FL2VA only"],["ref2va","Ref2VA only"]],S.loraModes(entry).length===2?"both":S.loraModes(entry)[0]);mode.className="z3h3-lora-mode";
          const triggers=input("text",(entry.triggers||[]).join(", "));triggers.placeholder="Optional trigger words…";triggers.className="z3h3-lora-triggers";
          const checkpoint=el("label","z3h3-lora-control");checkpoint.append(el("span","z3h3-lora-control-label","Checkpoint"),mode);
          const triggerField=el("label","z3h3-lora-control wide");triggerField.append(el("span","z3h3-lora-control-label","Trigger words"),triggers);
          controls.append(strengthWrap,checkpoint,triggerField);row.append(controls);list.append(row);
          on.onchange=()=>edit(entry.name,e=>e.enabled=on.checked);
          const syncStrength=(value)=>{const n=Math.max(-2,Math.min(2,Number(value)));strength.value=String(n);strengthValue.value=String(n);edit(entry.name,e=>e.strength=n);};
          strength.oninput=()=>{strengthValue.value=strength.value;};strength.onchange=()=>syncStrength(strength.value);strengthValue.onchange=()=>syncStrength(strengthValue.value);
          mode.onchange=()=>edit(entry.name,e=>e.modes=mode.value==="both"?[]:[mode.value]);
          triggers.onchange=()=>edit(entry.name,e=>e.triggers=triggers.value.split(",").map(x=>x.trim()).filter(Boolean));
        }
      };
      const draw=()=>{
        const q=search.value.trim().toLowerCase(),container=currentContainer();libraryGrid.dataset.density=density;libraryGrid.replaceChildren();
        const visible=rows.filter(x=>!q||[x.name,x.title,x.base_model,...(x.tags||[]),...(x.trained_words||[]),...(x.triggers||[])].filter(Boolean).join(" ").toLowerCase().includes(q)).slice(0,400);
        for(const l of visible){
          const identity=loraLibraryIdentity(l),selection=loraLibrarySelection(l),loraName=selection.name;
          const existing=S.findLora(container,loraName),isActive=existing&&existing.enabled!==false,card=el("article",`z3h3-lora-library-card${isActive?" active":""}`),media=preview(loraName,l.preview||l.thumb),content=el("div","z3h3-lora-library-copy"),top=el("div","z3h3-lora-library-top");
          card.dataset.loraName=loraName;card.title=loraName;
          const subtitle=[identity.folder,identity.metadataTitle,l.base_model||"H3 LoRA"].filter(Boolean).join(" · ");const title=el("div","z3h3-lora-library-title");title.append(el("b",null,identity.filename),el("small",null,subtitle));top.append(title,isActive?el("span","z3h3-lora-active-badge","ACTIVE"):null);
          const words=selection.triggers.slice(0,3);const tags=el("div","z3h3-lora-tags");for(const word of words)tags.append(el("span",null,word));
          const bottom=el("div","z3h3-lora-library-actions");const add=btn(isActive?"Added":"+ Add to stack",()=>{const e=S.addLora(currentContainer(),loraName,selection.triggers);if(e){e.enabled=true;e.modes=e.modes||[];}commit();},isActive?"z3h3-btn active":"z3h3-btn primary");add.dataset.loraName=loraName;add.disabled=!!isActive;bottom.append(add);
          content.append(top);if(words.length)content.append(tags);content.append(bottom);card.append(media,content);libraryGrid.append(card);
        }
        note.textContent=`${visible.length}${visible.length!==rows.length?` of ${rows.length}`:""} shown · ${scopeName()} · changes apply immediately`;
        if(!visible.length){const empty=el("div","z3h3-lora-empty");empty.append(el("b",null,"No matching LoRAs"),el("small",null,"Try another folder or clear the search field."));libraryGrid.append(empty);}
      };
      const load=async(force=false,requestedFolder=selectedFolder)=>{const serial=++loadSerial;requestedFolder=String(requestedFolder||"");libraryGrid.replaceChildren(el("div","z3h3-lora-empty","Scanning models/loras…"));try{const r=await H.listLoras(requestedFolder,force);if(serial!==loadSerial)return;rows=normalizeLoraLibraryRows(r.loras||[]);folder.replaceChildren(...(r.folders||[{path:"",count:rows.length}]).map(x=>{const o=document.createElement("option");o.value=String(x.path||"");o.textContent=`${x.path||"All folders"} · ${x.count}`;return o}));selectedFolder=[...folder.options].some(o=>o.value===requestedFolder)?requestedFolder:"";folder.value=selectedFolder;writeJSONStorage(LORA_FOLDER_KEY,selectedFolder);draw();renderActive();renderTurbo();}catch(e){if(serial!==loadSerial)return;libraryGrid.replaceChildren(el("div","z3h3-error",e.message||String(e)));}};
      folder.onchange=()=>{selectedFolder=folder.value;writeJSONStorage(LORA_FOLDER_KEY,selectedFolder);load(false,selectedFolder);};search.oninput=draw;
      const hero=el("div","z3h3-lora-hero"),heroCopy=el("div");heroCopy.append(el("b",null,"LoRA workspace"),el("small",null,"Build the current H3 style stack, tune only what matters, then return to prompting. Every change is live."));hero.append(heroCopy,el("span","z3h3-lora-scope-badge",scopeName()));
      const librarySection=el("section","z3h3-lora-library-section"),libraryHead=el("div","z3h3-lora-section-head"),libCopy=el("div");libCopy.append(el("b",null,"Installed library"),el("small",null,"Search and add without leaving the current shot."));libraryHead.append(libCopy);const toolbar=el("div","z3h3-lora-toolbar");toolbar.append(folder,search,densityButton,btn("Rescan",()=>load(true),"z3h3-btn"));librarySection.append(libraryHead,toolbar,note,libraryGrid);
      const turboDetails=document.createElement("details");turboDetails.className="z3h3-lora-performance";const adapterState=S.turboAdapterState(this.data,this.target),summary=document.createElement("summary");summary.append(el("span",null,"Turbo / Distillation"),el("small",null,adapterState.name?`${filenameLabel(adapterState.name)} detected · configure profile`:"Performance profile · optional"));const turboHost=el("div","z3h3-lora-performance-body");turboDetails.append(summary,turboHost);turboDetails.open=options?.focusTurbo===true||!!adapterState.detectedName;
      const renderTurbo=()=>{turboHost.replaceChildren(this.turboControls(rows,commit));};
      const footer=el("div","z3h3-lora-footer");footer.append(el("small",null,"No Save button needed — this manager edits the current stack live."),btn("Done",close,"z3h3-btn primary"));
      shell.append(hero,activeHost,librarySection,turboDetails,footer);body.append(shell);renderActive();renderTurbo();await load();renderTurbo();
    },{wide:true});
  }
  turboControls(rows,onChange){
    const wrap=el("div","z3h3-two");
    const current=()=>this.data.turbo||(this.data.turbo=S.DEFAULT_TURBO());
    const initial=current(),adapterState=S.turboAdapterState(this.data,this.target),initialLora=initial.lora||adapterState.detectedName;
    const names=[...new Set([initial.lora,...(rows||[]).map(x=>x.name)].filter(Boolean))];const turboNames=names.filter(n=>/turbo|distill/i.test(n));
    const choices=turboNames.length?turboNames:names;
    const lora=select([["","— no LoRA / merged distill checkpoint —"],...choices.map(x=>[x,x])],initialLora||"");const merged=checkbox(initial.merged),quality=select(S.TURBO_QUALITIES,initial.quality),on=checkbox(initial.on);
    const apply=()=>{
      const t=current(),wasOn=t.on,oldLora=t.lora;t.lora=lora.value;t.merged=merged.checked;t.quality=quality.value;
      if(on.checked!==wasOn){this.setTurbo(on.checked);return;}
      if(wasOn&&oldLora!==t.lora){
        if(oldLora)S.removeLora(this.data,oldLora);
        if(t.lora){const entry=S.addLora(this.data,t.lora,[]),preset=S.turboPreset(t.lora);if(entry){entry.enabled=true;entry.strength=preset.strength;}setWidget(this.widgets.shift_video,preset.shift_video,this.node);setWidget(this.widgets.shift_audio,preset.shift_audio,this.node);}
        this.commitData();return;
      }
      onChange?.();
    };
    lora.onchange=apply;merged.onchange=apply;quality.onchange=()=>{const t=current();t.quality=quality.value;if(t.on)setWidget(this.widgets.steps,S.TURBO_STEPS[t.quality],this.node);onChange?.();};on.onchange=apply;
    const recipe=el("div","z3h3-note");const refreshRecipe=()=>{const selected=S.turboPreset(lora.value);recipe.textContent=selected.recipe==="lightx2v-v1"?"LightX2V 4-step v1.0 detected · use Settings → Inference profile to apply its exact 4-step / CFG 1 / 6:3 flow-shift recipe.":selected.recipe==="lightx2v-legacy"?"Older or generically named LightX2V adapter · existing 0.6 strength and 6:3 shifts are preserved; the v1.0 recipe is not guessed.":"Generic Turbo/distillation adapter · existing Creator tuning is preserved.";};lora.addEventListener("change",refreshRecipe);refreshRecipe();
    wrap.append(el("div","z3h3-note",adapterState.detectedName&&!initial.lora?`${filenameLabel(adapterState.detectedName)} is active in the current LoRA stack and has been preselected as the likely Turbo adapter. Confirm it here, then enable Turbo or choose an inference profile in Setup / Settings.`:"The Turbo adapter role controls its initial step preset and optional hybrid switching. Sampler and scheduler remain independent workflow controls after Turbo is enabled."),field("Turbo LoRA",lora),recipe,field("Merged distill checkpoint",merged),field("Turbo step preset",quality,`draft ${S.TURBO_STEPS.draft} · balanced ${S.TURBO_STEPS.medium} · high ${S.TURBO_STEPS.good} steps`),field("Turbo on",on,"Initially selects Euler/Beta and saves the prior sampling values. Later sampler/scheduler changes remain selected."));return wrap;
  }
  setTurbo(enabled){
    const t=this.data.turbo||(this.data.turbo=S.DEFAULT_TURBO());
    if(enabled){
      const wasOn=t.on===true;if(!wasOn)t.saved={steps:Number(this.widgets.steps?.value??20),sampler_name:String(this.widgets.sampler_name?.value??"res_multistep"),scheduler:String(this.widgets.scheduler?.value??"simple"),shift_video:Number(this.widgets.shift_video?.value??12),shift_audio:Number(this.widgets.shift_audio?.value??3)};
      if(t.lora){const e=S.addLora(this.data,t.lora,[]),p=S.turboPreset(t.lora);if(e){e.enabled=true;e.strength=p.strength;}for(const seg of this.data.segments||[]){const scoped=S.findLora(seg,t.lora);if(scoped)scoped.enabled=true;}setWidget(this.widgets.shift_video,p.shift_video,this.node);setWidget(this.widgets.shift_audio,p.shift_audio,this.node);}
      if(!wasOn){setWidget(this.widgets.steps,S.TURBO_STEPS[t.quality]||6,this.node);setWidget(this.widgets.sampler_name,S.TURBO_SAMPLER,this.node);setWidget(this.widgets.scheduler,S.TURBO_SCHEDULER,this.node);}t.on=true;
    }else{
      const wasOn=t.on===true;if(t.lora){S.removeLora(this.data,t.lora);for(const seg of this.data.segments||[])S.removeLora(seg,t.lora);}if(wasOn){const saved=t.saved||S.TURBO_RESET;for(const k of ["steps","sampler_name","scheduler","shift_video","shift_audio"])setWidget(this.widgets[k],saved[k]??S.TURBO_RESET[k],this.node);}t.on=false;t.saved=null;
    }
    this.commitData();
  }
  openCast(){openCastStudio(this);}
  async openModels(){
    modal("Models, Routing, GGUF & Devices",async(body,close)=>{
      const status=el("div","z3h3-note","Scanning local model folders and saved machine defaults…");body.append(status);
      try{
        const [m,stored]=await Promise.all([H.listModels(),H.readSettings()]);
        const saved=stored.settings?.model_defaults||{};this.data.models ||= {};
        let hydrated=false;for(const [key,value] of Object.entries(saved)){if(this.data.models[key]===undefined||this.data.models[key]===""){this.data.models[key]=structuredClone(value);hydrated=true;}}
        if(hydrated)this.commitData(false);
        const fields=[["fl2va","FL2VA checkpoint"],["ref2va","Ref2VA checkpoint"],["clip","MiniMax text encoder"],["vae","Video VAE"],["audio_vae","Audio VAE"],["preview","TinyVAE preview decoder / taeh3"],["sam3","SAM3 face detector"]],grid=el("div","z3h3-two"),controls={};
        const currentBlock=()=>this.data.models||(this.data.models={}),modelProfileInfo=el("div","z3h3-model-default-note");
        const renderModelProfile=()=>{const profile=h3SelectedModelProfile(currentBlock());modelProfileInfo.textContent=profile.guidance;modelProfileInfo.className=`z3h3-model-default-note${profile.hasConvRot?" good":""}`;};
        const saveNow=async()=>{this.commitData();await this.persistModelDefaults(status);};
        const setChoice=async(key,value)=>{const block=currentBlock();if(value)block[key]=value;else delete block[key];renderModelProfile();await saveNow();};
        const syncControls=()=>{const block=currentBlock();for(const [key] of fields)if(controls[key])controls[key].value=block[key]||"";};
        const guess=async()=>{const block=currentBlock(),hints={fl2va:["fl2va","first_last"],ref2va:["ref2va"],clip:["minimax"],vae:["minimax","h3"],audio_vae:["audio"],preview:["taeh3"]};for(const [key] of fields){if(block[key])continue;let matched=(m.files?.[key]||[]).filter(n=>(hints[key]||[]).some(h=>n.toLowerCase().includes(h)));if(key==="vae")matched=matched.filter(n=>!/(audio|t1[_-]?image|image[_-]?vae)/i.test(n));if(matched.length===1)block[key]=matched[0];}syncControls();await saveNow();};
        for(const [key,label] of fields){const q=select(toOptions(m.files?.[key]||[],"— choose local file —"),currentBlock()[key]||"");controls[key]=q;q.onchange=()=>setChoice(key,q.value);grid.append(field(label,q));}
        delete currentBlock().dynamic_vram;
        const dtype=select(m.dtypes||["default"],currentBlock().dtype||"default"),route=select([["auto","Auto route"],["fl2va","Always FL2VA"],["ref2va","Always Ref2VA"]],currentBlock().route||"auto");
        dtype.onchange=()=>setChoice("dtype",dtype.value);route.onchange=()=>setChoice("route",route.value);grid.append(field("UNet dtype",dtype,"GGUF ignores this because its precision is in the file."),field("Checkpoint route",route),el("div","z3h3-note good","H3 memory follows native ComfyUI DynamicVRAM/AIMDO. The old per-model bypass has been removed."));
        const tools=buttonRow(btn("Auto-fill unambiguous files",async()=>{await guess();renderModelProfile();}),btn("Restore saved machine defaults",async()=>{this.data.models=structuredClone(saved);delete this.data.models.dynamic_vram;this.commitData();syncControls();dtype.value=currentBlock().dtype||"default";route.value=currentBlock().route||"auto";renderModelProfile();await this.persistModelDefaults(status);}));
        renderModelProfile();body.replaceChildren(el("div","z3h3-model-default-note","Live model selection: choosing a file immediately updates this workflow and the local defaults for this ComfyUI install. Queue immediately — there is no Save step."),tools,grid,modelProfileInfo,status);
        if((m.devices||[]).length){const dev=section("Multi-GPU placement");currentBlock().devices||={};for(const key of m.device_fields||[]){const q=select([["","Comfy default"],...(m.devices||[]).map(x=>[x,x])],currentBlock().devices?.[key]||"");q.onchange=async()=>{const block=currentBlock();block.devices||={};if(q.value)block.devices[key]=q.value;else delete block.devices[key];await saveNow();};dev.append(field(key,q));}body.append(dev);}else body.append(el("div","z3h3-note","ComfyUI-MultiGPU is not installed or exposes no alternate devices. Nothing is required for single-GPU use."));
        body.append(el("div","z3h3-note",m.preview_override?"KJNodes Model Preview Override detected. Pick taeh3 / H3 TinyVAE here; the Preview sidecar uses it for animated sampling previews.":"KJNodes Model Preview Override not detected. Rendering still works; the TinyVAE Preview sidecar will show setup guidance until KJNodes is installed."),buttonRow(btn("Done",close,"z3h3-btn primary")));
        status.textContent="All selections save automatically.";status.className="z3h3-note good";
      }catch(e){status.textContent=e.message;status.className="z3h3-error";}
    },{wide:true});
  }
  async openRefine(){
    modal("Local H3 Refiner",async(body)=>{
      const note=el("div","z3h3-note","Runs locally through a Qwen3-VL model in models/text_encoders. No prompt, image, video or audio is uploaded."),model=select([],""),target=select(this.target==="global"?[["timeline","Whole timeline"]]:[["segment",`Shot ${this.target+1}`],["timeline","Whole timeline"]],"segment"),templ=select(["auto","T2VA","I2VA","L2VA","FL2VA","REF2VA"],"auto"),skill=select([["","Built-in H3 refiner"]],""),lang=input("text","English"),temp=input("number",.3);temp.step=.05;temp.min=0;temp.max=2;const out=textarea("",9);out.readOnly=true;const status=el("div","z3h3-note");
      const run=btn("Refine locally",async()=>{status.innerHTML='<div class="z3h3-progress"><i></i></div>';try{const req={kind:target.value,data:this.data,index:this.target==="global"?0:this.target,model:model.value,template:templ.value,language:lang.value,temperature:Number(temp.value),seed:Number(this.widgets.seed?.value??-1),skill:skill.value};const j=await H.startRefine(req);let res;for(let i=0;i<720;i++){await sleep(1000);const poll=await H.refineJob(j.job);if(poll.done){if(poll.error)throw new Error(poll.error);res=poll.result;break;}}if(!res)throw new Error("Refine timed out waiting for the local model");out.value=JSON.stringify(res,null,2);status.textContent=(res.problems||[]).join(" · ")||"Refine complete";for(const sh of res.shots||[]){const idx=Number.isInteger(sh.index)?sh.index:(target.value==="segment"?this.target:null);if(idx!=null&&this.data.segments[idx])this.data.segments[idx].refined={body:sh.body,source:"local",model:model.value,enabled:true,sections:sh.sections||undefined};}if(res.piece&&typeof res.piece.body==="string")this.data.prompt=res.piece.body;if(typeof res.soundscape==="string")this.data.soundscape=res.soundscape;if(typeof res.music==="string")this.data.music=res.music;this.commitData();this.syncPrompt(false);}catch(e){status.textContent=e.message;status.className="z3h3-error";}},"z3h3-btn primary");
      body.append(note,el("div","z3h3-two"),run,status,field("Refiner result",out));const grid=body.querySelector(".z3h3-two");grid.append(field("Local refiner model",model),field("Target",target),field("Template",templ),field("Skill package",skill),field("Language",lang),field("Temperature",temp));
      try{const [r,s]=await Promise.all([H.refineModels(),H.refineSkills()]);for(const n of r.models||[]){const o=document.createElement("option");o.value=o.textContent=n;model.append(o);}for(const k of s.skills||[]){const name=typeof k==="string"?k:(k.name||k.id);if(!name)continue;const o=document.createElement("option");o.value=name;o.textContent=typeof k==="string"?k:(k.title||k.name||name);skill.append(o);}}catch(e){status.textContent=e.message;}
    },{wide:true});
  }
  spawnPreStage(){
    try{
      const type="Z3MiniMaxH3PreStage",liteGraph=globalThis.LiteGraph;
      if(!liteGraph?.createNode)throw new Error("ComfyUI node factory is not ready yet");
      const n=liteGraph.createNode(type);
      if(!n)throw new Error("Pre-Stage node type is not registered");
      // Seed before graph insertion so PreStage's async DOM mount reads the
      // Creator snapshot on its very first frame. This includes the active
      // scene prompt, cited Cast definitions and the reference files those
      // subjects actually depend on.
      applyCreatorSnapshotToPreStageNode(n,this);
      n.pos=[this.node.pos[0]-560,this.node.pos[1]];app.graph.add(n);app.canvas?.selectNode?.(n);this.node.graph?.setDirtyCanvas?.(true,true);
    }catch(e){modal("Pre-Stage",b=>b.append(el("div","z3h3-error",e.message)),{small:true});}
  }
  openShotOptions(index){
    const initial=this.data.segments[index];if(!initial)return;
    if(initial.kind!=="clip")return this.openInspector(index);
    modal(`Clip ${index+1} setup`,(body,close)=>{
      body.classList.add("z3h3-shot-options");
      const current=()=>this.data.segments[index];
      const intro=el("div","z3h3-shot-options-intro");intro.append(el("b",null,initial.kind==="clip"?"Supplied footage":"Generated H3 shot"),el("small",null,index===0?"First timeline card · changes are live immediately.":"Changes apply immediately to this timeline card."));body.append(intro);
      const dur=input("number",initial.duration_s||S.DEFAULT_DURATION_S);dur.min=.2;dur.max=120;dur.step=.5;
      if(initial.kind==="clip"){
        const snd=checkbox(initial.sound!==false),st=input("number",initial.trim?.start??0),en=input("number",initial.trim?.end??"");st.step=en.step=.01;const cont=checkbox(initial.continue),conta=checkbox(initial.continue_audio);cont.disabled=conta.disabled=index===0;
        const apply=()=>{const seg=current();if(!seg)return;seg.duration_s=Number(dur.value);seg.sound=snd.checked;seg.continue=cont.checked;seg.continue_audio=conta.checked;if(en.value!=="")seg.trim={start:Number(st.value),end:Number(en.value)};else delete seg.trim;this.commitData();};
        for(const c of [dur,snd,st,en,cont,conta])c.addEventListener("change",apply);
        const grid=el("div","z3h3-shot-options-grid");grid.append(section("Timing & playback",field("Duration (seconds)",dur),field("Trim start",st),field("Trim end",en,"Leave blank to use the stored clip duration."),field("Keep clip audio",snd)),section("Continuity",field("Previous generated shot lands on this clip opening",cont,index===0?"Not available on the first timeline card.":"Uses the opening picture as a seam target."),field("Previous audio continues into this clip",conta,index===0?"Not available on the first timeline card.":"Carries the previous audio tail across the cut.")));
        body.append(el("div","z3h3-note good","Live clip settings — no Save step."),grid);
        const foot=el("div","z3h3-shot-options-foot");foot.append(btn("Done",close,"z3h3-btn primary"),btn(this.data.segments.length>1?"Delete clip":"Clear timeline",()=>{close();this.clearOrDeleteShot(index);},"z3h3-btn danger"));body.append(foot);return;
      }
      const merge=checkbox(initial.merge);merge.disabled=index===0;const cont=checkbox(initial.continue);cont.disabled=index===0;const conta=checkbox(initial.continue_audio);conta.disabled=index===0;const source=input("text",initial.continue_from??"");source.placeholder="previous pass, or @video handle";const feather=select(S.FEATHERS.map(v=>[v,`${v} frame${v===1?"":"s"}`]),Number(initial.feather||5)),hold=checkbox(initial.hold),checkpoint=select([["auto","Auto checkpoint"],["fl2va","FL2VA"],["ref2va","REF2VA"]],initial.checkpoint||"auto"),seed=input("number",initial.seed??"");seed.placeholder="inherit node seed";const face=select([["","Inherit Global"],["on","Face pass on"],["off","Face pass off"]],initial.face||""),sound=textarea(initial.soundscape||"",3),music=textarea(initial.music||"",3);
      const apply=()=>{const seg=current();if(!seg)return;seg.duration_s=Number(dur.value);seg.checkpoint=checkpoint.value;seg.merge=merge.checked;seg.continue=cont.checked;seg.continue_audio=conta.checked;seg.feather=Number(feather.value);seg.hold=hold.checked;seg.soundscape=sound.value;seg.music=music.value;if(source.value.trim())seg.continue_from=source.value.trim().replace(/^@/,"");else delete seg.continue_from;if(seed.value!=="")seg.seed=Math.max(0,Math.trunc(Number(seed.value)));else delete seg.seed;if(face.value)seg.face=face.value;else delete seg.face;this.commitData();};
      for(const c of [dur,checkpoint,merge,cont,conta,feather,hold,face])c.addEventListener("change",apply);for(const c of [source,seed,sound,music])c.addEventListener("input",apply);
      const grid=el("div","z3h3-shot-options-grid");
      const timing=section("Timing & render route",field("Duration (seconds)",dur),field("Checkpoint",checkpoint),field("Per-shot seed",seed,"Blank inherits the Creator seed."),field("Face pass",face));
      const continuity=section("Continuity & seams",field("Merge into previous shot",merge,index===0?"The first shot cannot merge backward.":"Combines this shot with the previous generated shot in one H3 pass."),field("Continue picture seam",cont,index===0?"The first shot has no previous picture.":"Carries visual motion across the shot boundary."),field("Continue audio seam",conta,index===0?"The first shot has no previous audio.":"Carries the previous sound tail."),field("Continue from source",source,"Blank = previous pass; or use an attached compatible @video handle."),field("Seam feather",feather,"More frames preserve more motion at the transition."));
      const take=section("Saved take / render behavior",field("Hold this shot on next render",hold,S.takeOn(initial)?`Saved take: ${filenameLabel(S.takeOn(initial).filename)}`:"No saved take yet. Holding an unsaved shot omits it."));
      if(S.takeOn(initial))take.append(buttonRow(btn("Use saved take",()=>{const seg=current();if(seg){seg.hold=true;this.commitData();}close();},"z3h3-btn primary"),btn("Retake",()=>{const seg=current();if(seg){seg.hold=false;this.commitData();}close();}),btn("Forget saved take",()=>{const seg=current();if(seg){delete seg.take;seg.hold=false;this.commitData();}close();},"z3h3-btn danger")));
      const audio=section("Audio direction",field("Overall soundscape",sound,"Diegetic ambience, Foley and environmental sound for this shot."),field("Non-diegetic music",music,"Score/music direction outside the scene world."));
      grid.append(timing,continuity,take,audio);body.append(el("div","z3h3-note good","Live shot settings — the next Queue uses these values immediately."),grid);
      const foot=el("div","z3h3-shot-options-foot");foot.append(btn("Done",close,"z3h3-btn primary"),el("div","z3h3-spacer"),btn(this.data.segments.length>1?`Delete Shot ${index+1}`:"Clear Shot 1",()=>{close();this.clearOrDeleteShot(index);},"z3h3-btn danger"));body.append(foot);
    },{wide:true});
  }
  openDirector(){return openH3Director(this);}
  openSettings(){openH3SettingsDrawer(this);}
}
