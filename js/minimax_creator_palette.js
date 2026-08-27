// The only side-effect entry point for MiniMax H3 Creator Palette.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { buildWildcardWidget, livePromptPaletteNodes, cleanupSharedPromptPaletteDom } from "./editor/editor_core.js";
import { editorStylesReady } from "./editor/styles.js";
import {
  hideNativeWidget, installResponsiveDomWidgetWidth, getDomWidgetAvailableHeight,
  scheduleDomWidgetRemeasure, ensureNodeLifecycle, nodeIsActive,
  installPromptStateGuard, installPromptMetadataCapture,
  cleanupSocketRailLayout, queueSocketRailLayout,
} from "./prompt_palette_compat.js";
import { clearLegacyPromptPaletteGlobalTheme } from "./prompt_palette_shared.js";
import { CreatorPaletteBody } from "./z3_h3_ui.js";
import { PreStagePaletteBody } from "./z3_prestage_ui.js";
import { installH3Styles } from "./z3_h3_styles.js";
import { installH3WorkspaceStyles } from "./h3_workspace_styles.js";
import { installH3Sidebar } from "./h3_sidebar.js";
import { installCreatorAppearanceRuntime, bindCreatorAppearance } from "./h3_suite_appearance.js";

const CREATOR="Z3MiniMaxH3CreatorV3";
const PRESTAGE="Z3MiniMaxH3PreStage";
const MOUNTED=new Set([CREATOR,PRESTAGE]);
clearLegacyPromptPaletteGlobalTheme();
installH3Styles();
installH3WorkspaceStyles();
installCreatorAppearanceRuntime();

function hideNative(widget){
  if(!widget)return;
  hideNativeWidget(widget);
  widget.computeSize=()=>[0,-4];
}
export function resultBelongsToNode(eventId,nodeId,allowChildren=false){
  const child=String(eventId??""),parent=String(nodeId??"");
  return child===parent||(allowChildren&&!!parent&&child.startsWith(`${parent}.`));
}
function installPreStageStockPreviewSuppression(node){
  if(!node||node._z3PreStageStockPreviewSuppression)return()=>{};
  node._z3PreStageStockPreviewSuppression=true;
  const onExecuted=node.onExecuted,onDrawBackground=node.onDrawBackground;
  const clearPreview=function(){this.imgs=undefined;this.imageIndex=null;};
  node.onExecuted=function(message){
    // Keep the backend's standard `images` payload for ComfyUI Assets, but do not
    // hand it to the stock node-preview renderer. Image Lab is the sole visual
    // result surface for PreStage.
    const clean=message&&typeof message==="object"&&Array.isArray(message.images)
      ? Object.assign({},message)
      : message;
    if(clean!==message)delete clean.images;
    const result=onExecuted?onExecuted.call(this,clean):undefined;
    clearPreview.call(this);
    this.graph?.setDirtyCanvas?.(true,true);
    return result;
  };
  node.onDrawBackground=function(){clearPreview.call(this);return onDrawBackground?.apply(this,arguments)};
  return()=>{if(node._z3PreStageStockPreviewSuppression){node.onExecuted=onExecuted;node.onDrawBackground=onDrawBackground;delete node._z3PreStageStockPreviewSuppression;}clearPreview.call(node);};
}
function nodeResult(body,event){
  const detail=event?.detail||event;
  const id=String(detail?.node??detail?.node_id??"");
  // Both output nodes expand into backend children. The saved Creator MP4 is
  // emitted by one of those children, just like PreStage's saved image.
  if(!resultBelongsToNode(id,body.node.id,true))return;
  const out=detail?.output||{};
  if(!out?.mmc_prestage_idle&&!out?.mmc_creator_idle&&!out?.mmc_image&&!out?.images&&!out?.mmc_video&&!out?.mmc_takes)return;
  body.lastOutput=out;
  body.handleExecution?.(out);
  if(body.node.comfyClass===PRESTAGE){body.node.imgs=undefined;body.node.imageIndex=null;queueMicrotask(()=>{body.node.imgs=undefined;body.node.imageIndex=null;body.node.graph?.setDirtyCanvas?.(true,true)});}
  if(out?.mmc_prestage_idle||out?.mmc_creator_idle){
    body.status?.append(Object.assign(document.createElement("span"),{className:"z3h3-note",textContent:out?.mmc_creator_idle?"waiting for PreStage review":"PreStage idle"}));
    return;
  }
  if(out?.mmc_image||out?.images||out?.mmc_video)body.status?.append(Object.assign(document.createElement("span"),{className:"z3h3-good",textContent:"render saved"}));
}

app.registerExtension({
  name:"z3rofeels.minimax_h3_creator_palette.v3",
  setup(){ installH3Sidebar(app); },
  settings:[{
    id:"Z3MiniMaxCreatorPalette.WildcardsPath",
    category:["MiniMax H3 Creator Palette","Library"],
    name:"Creator wildcard library folder",
    type:"text",defaultValue:"",
    tooltip:"Optional folder used only by Creator Palette. It never reads or changes standalone Prompt Palette's custom folder.",
    async onChange(value){
      const { API }=await import("./prompt_palette_api.js");
      await API.setPath(String(value||"").trim());
      for(const n of livePromptPaletteNodes) if(MOUNTED.has(n.comfyClass)) await n._wgRefreshLibrary?.();
    }
  }],
  async nodeCreated(node){
    if(!MOUNTED.has(node.comfyClass))return;
    if(node.__z3CreatorPaletteMounted)return;
    node.__z3CreatorPaletteMounted=true;
    const lifecycle=ensureNodeLifecycle(node);
    await editorStylesReady;
    if(!nodeIsActive(node))return;
    const textWidget=node.widgets?.find(w=>w.name==="text");
    const dataName=node.comfyClass===PRESTAGE?"prestage_data":"creator_data";
    const dataWidget=node.widgets?.find(w=>w.name===dataName);
    if(!textWidget||!dataWidget)return;
    installPromptStateGuard(node,textWidget);
    installPromptMetadataCapture(node);
    const cleanupStockPreview=node.comfyClass===PRESTAGE?installPreStageStockPreviewSuppression(node):()=>{};
    hideNative(textWidget);hideNative(dataWidget);
    const hiddenControls=node.comfyClass===PRESTAGE
      ? ["processing_mode","seed","steps","cfg","sampler_name","scheduler"]
      : ["processing_mode","seed","steps","cfg","sampler_name","scheduler","shift_video","shift_audio","block_cache","spectrum","spectrum_blend","attention","chunk_ffn","fp16_accumulation","variation_index","h3_memory","h3_sparse","h3_sparse_edges"];
    for(const name of hiddenControls){hideNative(node.widgets?.find(w=>w.name===name))}
    node.resizable=true;
    const pp=buildWildcardWidget(node,textWidget,{ioRail:false,settings:false});
    const body=node.comfyClass===PRESTAGE
      ? new PreStagePaletteBody(node,pp.root,textWidget)
      : new CreatorPaletteBody(node,pp.root,textWidget,pp.editor);
    node._z3CreatorBody=body;
    const appearanceBinding=bindCreatorAppearance({node,targets:[body.root,body.imageSidecar?.root].filter(Boolean)});
    lifecycle.add(()=>appearanceBinding.cleanup?.());
    let domWidget;
    domWidget=node.addDOMWidget(node.comfyClass===PRESTAGE?"z3_minimax_prestage_palette_ui":"z3_minimax_creator_palette_ui","div",body.root,{
      getValue:()=>node._ppPromptStateGuard?.current()??textWidget.value,
      setValue:(value)=>{node._ppPromptStateGuard?.acceptRendererValue(value);node._wgRefreshFromHidden?.()},
      serialize:false,hideOnZoom:false,selectOn:["focus","click"],getMinHeight:()=>0,
      getMaxHeight:()=>getDomWidgetAvailableHeight(node,domWidget),
      getHeight:()=>getDomWidgetAvailableHeight(node,domWidget),
      afterResize:()=>scheduleDomWidgetRemeasure(node),
    });
    body.domWidget=domWidget;
    installResponsiveDomWidgetWidth(node,domWidget);
    node._wgRefreshFromHidden=pp.refreshFromHidden;node._wgRefreshVisuals=pp.refreshVisuals;
    node._wgReassertHiddenWidgets=pp.reassertHiddenWidgets;node._wgReapplyTheme=pp.reapplyTheme;
    node._wgRendererModeChanged=()=>{node._wgReassertHiddenWidgets?.();node._wgReapplyTheme?.();scheduleDomWidgetRemeasure(node)};
    livePromptPaletteNodes.add(node);
    const onExec=e=>nodeResult(body,e);api.addEventListener?.("executed",onExec);
    const raf=globalThis.requestAnimationFrame||((f)=>setTimeout(f,0));
    raf(()=>{if(!nodeIsActive(node))return;scheduleDomWidgetRemeasure(node)});
    queueMicrotask(()=>{pp.reassertHiddenWidgets?.();body.refreshAll();body.syncCreatorGate?.()});
    lifecycle.add(()=>{api.removeEventListener?.("executed",onExec);cleanupStockPreview();livePromptPaletteNodes.delete(node);cleanupSocketRailLayout(node);body.destroy();pp.cleanup?.();if(!livePromptPaletteNodes.size)cleanupSharedPromptPaletteDom()});
  },
  loadedGraphNode(node){
    if(!MOUNTED.has(node.comfyClass))return;
    queueMicrotask(()=>{node._z3CreatorBody?.rehydrateSamplingPreferences?.({finalize:false});node._wgRefreshFromHidden?.();node._wgReapplyTheme?.();node._z3CreatorBody?.refreshAll();scheduleDomWidgetRemeasure(node)})
  },
  afterConfigureGraph(){
    queueMicrotask(()=>{for(const node of livePromptPaletteNodes){if(!MOUNTED.has(node.comfyClass))continue;node._z3CreatorBody?.rehydrateSamplingPreferences?.({finalize:true});if(node.comfyClass===PRESTAGE){node._z3CreatorBody?.autoPullIfBlank?.();node._z3CreatorBody?.syncCreatorGate?.()}node._wgReapplyTheme?.();node._z3CreatorBody?.refreshAll();node.graph?.setDirtyCanvas?.(true,true)}})
  }
});
