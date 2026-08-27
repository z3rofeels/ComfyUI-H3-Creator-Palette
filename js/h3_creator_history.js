import * as S from "./z3_h3_state.js";
import { H3PackAPI } from "./h3_pack_api.js";
import { activeCreatorBody } from "./h3_workspace_runtime.js";

const histories=new WeakMap();
const MAX_HISTORY=120;
const COALESCE_MS=700;
const COMPOSITE_MS=1600;
let listenerInstalled=false;

function stateFor(body){
  let state=histories.get(body);
  if(!state){
    const raw=S.serializeData(body?.data||S.defaultData());
    state={undo:[],redo:[],last:raw,lastAt:0,busy:false,label:"Edit",lastLibraryTx:""};
    histories.set(body,state);
  }
  return state;
}
function trim(stack){if(stack.length>MAX_HISTORY)stack.splice(0,stack.length-MAX_HISTORY);}
function cleanLabel(label){const value=String(label||"Edit").trim();return value||"Edit";}
function sameAction(a,b){return cleanLabel(a).toLowerCase()===cleanLabel(b).toLowerCase();}
function emitStatus(body){try{body?.refreshHistoryButtons?.();}catch{}}

function installLibraryListener(){
  if(listenerInstalled||typeof window==="undefined")return;listenerInstalled=true;
  window.addEventListener("z3-h3-library-transaction",event=>{
    const body=activeCreatorBody(),tx=event?.detail?.transaction;if(!body||!tx?.transaction_id||tx.reversible===false)return;
    const state=stateFor(body),id=String(tx.transaction_id);if(id===state.lastLibraryTx)return;
    const label=cleanLabel(tx.label||"Library change"),now=Date.now(),top=state.undo.at(-1);
    if(top?.kind==="creator"&&sameAction(top.label,label)&&now-Number(top.at||0)<COMPOSITE_MS){top.kind="composite";top.transaction=id;top.label=label;top.at=now;}
    else state.undo.push({kind:"library",transaction:id,label,at:now});
    trim(state.undo);state.redo=[];state.lastLibraryTx=id;emitStatus(body);
  });
}

export function initCreatorHistory(body){stateFor(body);installLibraryListener();return body;}

export function noteCreatorCommit(body,raw,label="Edit"){
  const state=stateFor(body);if(state.busy)return false;
  const next=String(raw||"");if(!next||next===state.last)return false;
  const now=Date.now(),name=cleanLabel(label),top=state.undo.at(-1);
  // A Cast/Reference save often writes reusable Library state first and the
  // linked workflow copy immediately after. Treat matching labels as one user
  // action so one Undo restores both halves atomically.
  if(top?.kind==="library"&&sameAction(top.label,name)&&now-Number(top.at||0)<COMPOSITE_MS){
    top.kind="composite";top.raw=state.last;top.at=now;top.label=name;
  }else if(top?.kind==="composite"&&sameAction(top.label,name)&&now-Number(top.at||0)<COMPOSITE_MS){
    // Keep the original pre-action workflow snapshot; only advance the live
    // state so several save-side sync commits stay one logical Undo.
    top.at=now;
  }else{
    const coalesce=now-state.lastAt<COALESCE_MS&&state.label===name&&top?.kind==="creator";
    if(!coalesce)state.undo.push({kind:"creator",raw:state.last,label:name,at:now});
    trim(state.undo);
  }
  state.redo=[];state.last=next;state.lastAt=now;state.label=name;emitStatus(body);return true;
}

export function creatorHistoryStatus(body){
  const state=stateFor(body),undo=state.undo.at(-1),redo=state.redo.at(-1);
  return {canUndo:!!undo,canRedo:!!redo,undoLabel:undo?.label||"Edit",redoLabel:redo?.label||"Edit",undoKind:undo?.kind||"",redoKind:redo?.kind||""};
}

function applyCreatorRaw(body,raw,label){
  const state=stateFor(body);state.busy=true;
  try{
    body.data=S.parseData(raw);const max=Math.max(0,(body.data.segments?.length||1)-1);
    if(body.target!=="global")body.target=Math.max(0,Math.min(Number(body.target)||0,max));
    body.commitData?.(false,{skipHistory:true});body.syncPrompt?.(false);body.refreshAll?.();
    state.last=S.serializeData(body.data);state.lastAt=Date.now();state.label=cleanLabel(label);
  }finally{state.busy=false;}
}
async function refreshAfterLibrary(body){
  try{await body?.hydrateCastPackSync?.();}catch{}try{body?.refreshAll?.();}catch{}
  try{window.dispatchEvent(new CustomEvent("z3-h3-pack-changed",{detail:{kind:"history",source:"global-history"}}));}catch{}
}
async function applyEntry(body,entry,direction){
  if(!body||!entry)return false;const state=stateFor(body),current=S.serializeData(body.data),opposite=direction==="undo"?state.redo:state.undo;
  state.busy=true;
  try{
    if(entry.kind==="library"){
      await H3PackAPI.applyHistory(entry.transaction,direction);opposite.push({...entry,at:Date.now()});trim(opposite);await refreshAfterLibrary(body);
    }else if(entry.kind==="creator"){
      opposite.push({kind:"creator",raw:current,label:entry.label,at:Date.now()});trim(opposite);applyCreatorRaw(body,entry.raw,entry.label);
    }else if(entry.kind==="composite"){
      await H3PackAPI.applyHistory(entry.transaction,direction);opposite.push({kind:"composite",raw:current,transaction:entry.transaction,label:entry.label,at:Date.now()});trim(opposite);applyCreatorRaw(body,entry.raw,entry.label);await refreshAfterLibrary(body);
    }else return false;
  }finally{state.busy=false;}
  state.last=S.serializeData(body.data);emitStatus(body);return true;
}

export async function undoCreator(body){const state=stateFor(body),entry=state.undo.pop();if(!entry)return false;try{return await applyEntry(body,entry,"undo");}catch(error){state.undo.push(entry);emitStatus(body);throw error;}}
export async function redoCreator(body){const state=stateFor(body),entry=state.redo.pop();if(!entry)return false;try{return await applyEntry(body,entry,"redo");}catch(error){state.redo.push(entry);emitStatus(body);throw error;}}
export function clearCreatorHistory(body){const state=stateFor(body);state.undo=[];state.redo=[];state.last=S.serializeData(body.data);state.lastAt=0;state.lastLibraryTx="";emitStatus(body);return true;}

export function checkpointCreatorHistory(body,label="Edit"){
  if(!body)return false;return noteCreatorCommit(body,S.serializeData(body.data),label);
}
export function creatorHistoryDepth(body){const state=stateFor(body);return {undo:state.undo.length,redo:state.redo.length,max:MAX_HISTORY};}
