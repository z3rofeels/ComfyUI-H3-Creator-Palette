import { sceneTokenAtOffset, sceneTokenRanges, sceneVariationDirection, castMentionAtOffset, castMentionRanges } from "./h3_prompt_tokens.js";
import { createDomRangeForOffsets } from "./editor/editor_surface.js";
import { openCastStudio } from "./h3_cast_studio.js";
import { openSceneSlotMenu, openCastRoleMenu, openAssetReferenceMenu } from "./h3_quick_actions.js";
import * as S from "./z3_h3_state.js";

function pointOffset(editor,event){
  if(!editor)return null;
  try{
    if(typeof document.caretPositionFromPoint==="function"){
      const pos=document.caretPositionFromPoint(event.clientX,event.clientY);if(pos?.offsetNode&&editor.contains(pos.offsetNode)){
        const range=document.createRange();range.selectNodeContents(editor);range.setEnd(pos.offsetNode,pos.offset);return range.toString().replace(/\u200b/g,"").length;
      }
    }
    if(typeof document.caretRangeFromPoint==="function"){
      const at=document.caretRangeFromPoint(event.clientX,event.clientY);if(at?.startContainer&&editor.contains(at.startContainer)){
        const range=document.createRange();range.selectNodeContents(editor);range.setEnd(at.startContainer,at.startOffset);return range.toString().replace(/\u200b/g,"").length;
      }
    }
  }catch{/* fall through */}
  const n=Number(editor.selectionStart);return Number.isFinite(n)?n:null;
}

function mediaMentionAt(text,offset){
  const source=String(text??"");const re=/@([A-Za-z]+-\d+)(?![A-Za-z0-9_-])/g;let match;
  while((match=re.exec(source))){if(offset>=match.index&&offset<match.index+match[0].length)return {kind:"media",handle:match[1],start:match.index,end:match.index+match[0].length,unitEnd:match.index+match[0].length};}
  return null;
}
function knownCastHandles(body){return (body?.data?.subjects||[]).map((row)=>String(row?.handle||"").trim()).filter(Boolean);}
function mentionAt(text,offset,body){
  const cast=castMentionAtOffset(text,offset,knownCastHandles(body),{includeMarker:true});
  if(cast)return {kind:"cast",...cast};
  return mediaMentionAt(text,offset);
}

function tokenHelp(body,hit){
  const preset=S.activeContainer(body.data,body.target)?.scene_palette?.[hit.slot];
  const title=String(preset?.title||hit.label),prompt=String(preset?.prompt||"").trim(),vary=hit.direction>0?" · batch +":hit.direction<0?" · batch −":"";
  return `${hit.label}${vary} · ${title}\nClick to swap · right-click for Fixed / + / −${prompt?`\nH3: ${prompt}`:""}`;
}

// A caret API returns the nearest insertion point, not necessarily text physically under
// the pointer. On an otherwise-empty line that means a click far to the right of
// @Character can still resolve to the mention's end offset. Interactive prompt tokens
// must therefore pass BOTH logical-offset and rendered-glyph-bound checks.
function pointerInsideRange(editor,event,start,end){
  if(!editor||!event||!Number.isFinite(Number(start))||!Number.isFinite(Number(end))||Number(end)<=Number(start))return false;
  if(editor.dataset?.ppEditorSurface==="single") {
    try{
      const range=createDomRangeForOffsets(editor,Number(start),Number(end));
      const rects=[...range.getClientRects()];
      if(rects.length){
        const x=Number(event.clientX),y=Number(event.clientY);
        // Tiny tolerance makes the exact glyph edge usable without turning the rest
        // of the line into a click target.
        return rects.some((rect)=>x>=rect.left-1&&x<=rect.right+1&&y>=rect.top-1&&y<=rect.bottom+1);
      }
    }catch{/* compatibility fallback below */}
  }
  const offset=pointOffset(editor,event);
  return offset!=null&&offset>=Number(start)&&offset<Number(end);
}

function sceneTokenAtPoint(editor,event){
  const offset=pointOffset(editor,event);if(offset==null)return null;
  const hit=sceneTokenAtOffset(editor.value,offset,{includeMarker:true});if(!hit)return null;
  const end=hit.markerEnd>0?hit.markerEnd:hit.visibleEnd;
  return pointerInsideRange(editor,event,hit.visibleStart,end)?hit:null;
}

function mentionAtPoint(body,editor,event){
  const offset=pointOffset(editor,event);if(offset==null)return null;
  const hit=mentionAt(editor.value,offset,body);if(!hit)return null;
  const end=hit.kind==="cast"&&hit.markerEnd>0?hit.markerEnd:hit.end;
  return pointerInsideRange(editor,event,hit.start,end)?hit:null;
}

function rowTouchingCaret(source,caret){
  const rows=sceneTokenRanges(source),n=Number(caret);
  if(!Number.isFinite(n))return null;
  return rows.find((row)=>n>=row.start&&n<=Math.max(row.end,row.markerEnd>0?row.markerEnd:row.end))||null;
}

function safeOutsideOffset(row,caret){
  const n=Number(caret),after=row.markerEnd>0?row.markerEnd:row.end;
  if(n<=row.visibleStart)return row.start;
  return after;
}

export function installPromptTokenInteractions(body,editor){
  if(!body||!editor)return ()=>{};
  const hover=(event)=>{
    const token=sceneTokenAtPoint(editor,event);
    if(token){editor.dataset.h3PromptHover="token";editor.title=tokenHelp(body,token);return;}
    const mention=mentionAtPoint(body,editor,event);
    if(mention){
      if(mention.kind==="cast"){
        const subject=(body.data.subjects||[]).find((row)=>row?.handle===mention.handle);
        if(subject){const vary=mention.direction>0?"\n+ cycles this role forward through the entire reusable Cast library by batch index":mention.direction<0?"\n− cycles this role backward through the entire reusable Cast library by batch index":"";editor.dataset.h3PromptHover="cast";editor.title=`CAST · @${mention.handle}${mention.marker||""}${vary}\nClick exact @name to swap · right-click for role options`;return;}
      }
      const asset=S.allKnownAssets(body.data).find((row)=>row?.handle===mention.handle);
      if(asset){editor.dataset.h3PromptHover="media";editor.title=`MEDIA · @${mention.handle}\nClick to inspect / replace this reference`;return;}
    }
    delete editor.dataset.h3PromptHover;editor.title="";
  };
  const click=(event)=>{
    if(editor.selectionStart!==editor.selectionEnd)return;
    const token=sceneTokenAtPoint(editor,event);
    if(token){event.preventDefault();event.stopPropagation();body.openScenePicker?.(token.slot);return;}
    const mention=mentionAtPoint(body,editor,event);if(!mention)return;
    const subject=mention.kind==="cast"?(body.data.subjects||[]).find((row)=>row?.handle===mention.handle):null;
    if(subject){event.preventDefault();event.stopPropagation();openCastStudio(body,{swap:mention.handle});return;}
    const asset=S.allKnownAssets(body.data).find((row)=>row?.handle===mention.handle);
    if(asset){event.preventDefault();event.stopPropagation();body.openAsset?.(asset);}
  };
  const contextmenu=(event)=>{
    const token=sceneTokenAtPoint(editor,event);
    if(token){event.preventDefault();event.stopPropagation();openSceneSlotMenu(body,event,token.slot);return;}
    const mention=mentionAtPoint(body,editor,event);if(!mention)return;
    const subject=(body.data.subjects||[]).find((row)=>row?.handle===mention.handle);
    if(subject){event.preventDefault();event.stopPropagation();openCastRoleMenu(body,event,mention.handle);return;}
    const asset=S.allKnownAssets(body.data).find((row)=>row?.handle===mention.handle);
    if(asset){event.preventDefault();event.stopPropagation();openAssetReferenceMenu(body,event,asset);}
  };
  const keydown=(event)=>{
    const source=String(editor.value??""),start=Number(editor.selectionStart??0),end=Number(editor.selectionEnd??start),collapsed=start===end;
    const castRows=castMentionRanges(source,knownCastHandles(body));
    const castHit=castRows.find((row)=>end>start?start<row.unitEnd&&end>row.start:start>=row.start&&start<=row.unitEnd);
    const isPlus=event.key==="+"||(event.key==="="&&event.shiftKey),isMinus=event.key==="-";
    if(castHit&&(isPlus||isMinus)&&!event.metaKey&&!event.ctrlKey&&!event.altKey){
      event.preventDefault();event.stopPropagation();body.setCastVariation?.(castHit.handle,isPlus?1:-1);return;
    }
    if(castHit&&event.key==="Backspace"&&collapsed&&castHit.markerEnd>0&&start===castHit.markerEnd){
      event.preventDefault();event.stopPropagation();body.setCastVariation?.(castHit.handle,castHit.direction);return;
    }
    // A known @Character handle is valid H3 syntax. If prose is typed exactly at
    // its right edge, insert a separator first so "hello" can never silently turn
    // @Alex into @Alexhello and disconnect the Cast role. Editing inside the name
    // remains normal text editing, preserving the user's ability to rename/remove it.
    if(castHit&&collapsed&&start===castHit.unitEnd&&event.key?.length===1&&/^[A-Za-z0-9_]$/.test(event.key)&&!event.metaKey&&!event.ctrlKey&&!event.altKey){
      editor.setRangeText?.(" ",start,start,"end");
    }
    const rows=sceneTokenRanges(source);
    const hit=rows.find((row)=>{
      const unitEnd=row.markerEnd>0?row.markerEnd:row.end;
      if(end>start)return start<unitEnd&&end>row.start;
      return start>=row.start&&start<=unitEnd;
    });
    if(hit&&(isPlus||isMinus)&&!event.metaKey&&!event.ctrlKey&&!event.altKey){
      event.preventDefault();event.stopPropagation();body.setSceneVariation?.(hit.slot,isPlus?1:-1);return;
    }
    if(hit&&(event.key==="Backspace"||event.key==="Delete")){
      const markerEnd=hit.markerEnd>0?hit.markerEnd:-1;
      // Backspace immediately after PROP+ / PROP- clears variation first. This
      // mirrors deleting one visible glyph and avoids deleting the whole category.
      if(event.key==="Backspace"&&collapsed&&markerEnd>0&&start===markerEnd){
        event.preventDefault();event.stopPropagation();body.setSceneVariation?.(hit.slot,hit.direction);return;
      }
      event.preventDefault();event.stopPropagation();body.removeScenePreset?.(hit.slot);return;
    }
    // The invisible scene-token boundaries are implementation details, not editable
    // characters. If the caret lands inside one after clicking beside LOCATION/CAMERA,
    // move it outside before normal typing so adjacent prose can never corrupt the
    // semantic token or make it lose its color/function.
    if(hit&&collapsed&&event.key?.length===1&&!event.metaKey&&!event.ctrlKey&&!event.altKey){
      const safe=safeOutsideOffset(hit,start);
      if(safe!==start)editor.setSelectionRange?.(safe,safe);
    }
  };
  const beforeinput=(event)=>{
    if(!String(event.inputType||"").startsWith("insert"))return;
    const source=String(editor.value??""),start=Number(editor.selectionStart??0),end=Number(editor.selectionEnd??start);if(start!==end)return;
    const cast=castMentionRanges(source,knownCastHandles(body)).find((row)=>start===row.unitEnd);
    const inserted=String(event.data??"");
    if(cast&&inserted&&/^[A-Za-z0-9_]/.test(inserted))editor.setRangeText?.(" ",start,start,"end");
    const caret=Number(editor.selectionStart??start),hit=rowTouchingCaret(String(editor.value??""),caret);if(!hit)return;
    const safe=safeOutsideOffset(hit,caret);if(safe!==caret)editor.setSelectionRange?.(safe,safe);
  };
  editor.addEventListener("pointermove",hover);
  editor.addEventListener("click",click,true);
  editor.addEventListener("contextmenu",contextmenu,true);
  editor.addEventListener("keydown",keydown,true);
  editor.addEventListener("beforeinput",beforeinput,true);
  const leave=()=>{delete editor.dataset.h3PromptHover;editor.title="";};
  editor.addEventListener("pointerleave",leave);
  return ()=>{editor.removeEventListener("pointermove",hover);editor.removeEventListener("click",click,true);editor.removeEventListener("contextmenu",contextmenu,true);editor.removeEventListener("keydown",keydown,true);editor.removeEventListener("beforeinput",beforeinput,true);editor.removeEventListener("pointerleave",leave);};
}
