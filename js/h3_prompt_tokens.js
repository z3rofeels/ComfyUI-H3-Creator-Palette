import { H3_CATEGORY_META, H3_SCENE_SLOT_ORDER, categoryMeta } from "./h3_prompt_categories.js";

// Invisible separators make the saved source self-describing without drawing
// punctuation around the visual token. In the editor the user sees LOCATION,
// CAMERA, LIGHT, etc.; the compiler expands those markers to the selected H3
// prose immediately before wildcard resolution / compilation.
export const H3_TOKEN_BOUNDARY = "\u2063"; // INVISIBLE SEPARATOR

export const H3_SCENE_TOKEN_LABELS = Object.freeze(Object.fromEntries(
  H3_SCENE_SLOT_ORDER.map((slot) => [slot, categoryMeta(slot).label])
));
export const H3_SCENE_TOKEN_SLOTS = Object.freeze(Object.fromEntries(
  Object.entries(H3_SCENE_TOKEN_LABELS).map(([slot, label]) => [label, slot])
));

const escRe=(value)=>String(value??"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const clean=(value)=>String(value??"").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
function visibleSceneTokenRe(slot,{global=false,marker=false}={}){
  const label=H3_SCENE_TOKEN_LABELS[String(slot||"").trim()];if(!label)return null;
  return new RegExp(`(?<![A-Za-z0-9_])${escRe(label)}(?![A-Za-z0-9_])${marker?"(?:[ \\t]*[+-])?":""}`,global?"g":"");
}

const castHandle=(value)=>String(value??"").trim().replace(/^@/,"");
const castHandles=(values)=>[...new Set((values||[]).map(castHandle).filter((value)=>/^[A-Za-z][A-Za-z0-9_]*$/.test(value)))];

export function hasPromptPaletteBatchOperator(value){
  const source=String(value??"");
  return /__(?:[+\-*%~@])[A-Za-z0-9_\-/*]+__/.test(source)||/\{[+\-*%~@][^{}]+\}/.test(source);
}

export function castMentionRanges(text,knownHandles=[]){
  const source=String(text??""),known=new Set(castHandles(knownHandles)),filter=known.size>0,out=[];
  const re=/@([A-Za-z][A-Za-z0-9_]*)([+-])?(?![A-Za-z0-9_+\-])/g;let match;
  while((match=re.exec(source))){
    const handle=match[1];if(filter&&!known.has(handle))continue;
    const mentionEnd=match.index+1+handle.length,marker=match[2]||"";
    out.push({
      handle,start:match.index,end:mentionEnd,
      marker,markerStart:marker?mentionEnd:-1,markerEnd:marker?mentionEnd+1:-1,
      unitEnd:marker?mentionEnd+1:mentionEnd,
      direction:marker==="+"?1:marker==="-"?-1:0,
      color:H3_CATEGORY_META.cast.color,
    });
  }
  return out;
}

export function castMentionAtOffset(text,offset,knownHandles=[],{includeMarker=true}={}){
  const n=Number(offset);if(!Number.isFinite(n))return null;
  return castMentionRanges(text,knownHandles).find((row)=>{
    if(n>=row.start&&n<row.end)return true;
    return !!includeMarker&&row.markerStart>=0&&n>=row.markerStart&&n<row.markerEnd;
  })||null;
}

export function castVariationDirection(text,handle){
  const key=castHandle(handle);if(!key)return 0;
  const row=castMentionRanges(text,[key])[0];return row?.direction||0;
}

export function setCastVariationMarker(text,handle,direction=0){
  const key=castHandle(handle),source=String(text??"");if(!key)return source;
  const marker=Number(direction)>0?"+":Number(direction)<0?"-":"";
  const re=new RegExp(`@${escRe(key)}(?!-[0-9])(?:([+-])(?![A-Za-z0-9_])|(?![A-Za-z0-9_+\-]))`,"g");
  return source.replace(re,`@${key}${marker}`);
}

export function replaceCastMention(text,oldHandle,newHandle){
  const oldKey=castHandle(oldHandle),newKey=castHandle(newHandle),source=String(text??"");
  if(!oldKey||!newKey||oldKey===newKey)return source;
  const re=new RegExp(`@${escRe(oldKey)}(?!-[0-9])(?:([+-])(?![A-Za-z0-9_])|(?![A-Za-z0-9_+\-]))`,"g");
  return source.replace(re,(_whole,marker="")=>`@${newKey}${marker||""}`);
}

export function sceneToken(slot){
  const key=String(slot||"").trim();
  const label=H3_SCENE_TOKEN_LABELS[key];
  return label?`${H3_TOKEN_BOUNDARY}${label}${H3_TOKEN_BOUNDARY}`:"";
}

export function tokenLabel(slot){return H3_SCENE_TOKEN_LABELS[String(slot||"").trim()]||String(slot||"").toUpperCase();}
export function slotForTokenLabel(label){return H3_SCENE_TOKEN_SLOTS[String(label||"").trim().toUpperCase()]||null;}

function variationTailAt(source,end,{legacyNewlines=false}={}){
  const tail=String(source??"").slice(Number(end)||0);
  // Current syntax never lets a +/- cross a line boundary. v3.11.2 and older
  // accidentally used \s*, which could visually push ACTION+ onto the next row.
  // The legacy branch exists only for one-time migration of those saved prompts.
  const re=legacyNewlines?/^([ \t\r\n]*)([+-])/:/^([ \t]*)([+-])/;
  const match=tail.match(re);
  if(!match)return {direction:0,marker:"",spacing:"",markerStart:-1,markerEnd:-1,consumed:0};
  const marker=match[2],spacing=match[1]||"",markerStart=(Number(end)||0)+spacing.length;
  return {direction:marker==="+"?1:-1,marker,spacing,markerStart,markerEnd:markerStart+1,consumed:match[0].length};
}

export function sceneTokenRanges(text){
  const source=String(text??""),out=[];
  for(const [slot,label] of Object.entries(H3_SCENE_TOKEN_LABELS)){
    const token=sceneToken(slot);let from=0;
    while(token&&from<=source.length){
      const index=source.indexOf(token,from);if(index<0)break;
      const end=index+token.length,variation=variationTailAt(source,end);
      out.push({
        slot,label,start:index,end,
        visibleStart:index+H3_TOKEN_BOUNDARY.length,
        visibleEnd:index+H3_TOKEN_BOUNDARY.length+label.length,
        marker:variation.marker,direction:variation.direction,
        markerStart:variation.markerStart,markerEnd:variation.markerEnd,
        unitEnd:variation.markerEnd>0?variation.markerEnd:end,
        color:categoryMeta(slot).color,
      });
      from=end;
    }
    // Recovery range for a workflow/editor path that retained the visible
    // canonical label but lost its invisible separators. Ignore labels still
    // surrounded by our boundary so one token is never reported twice.
    const visible=visibleSceneTokenRe(slot,{global:true});let match;
    while(visible&&(match=visible.exec(source))){
      const start=match.index,end=start+match[0].length;
      if(source[start-1]===H3_TOKEN_BOUNDARY||source[end]===H3_TOKEN_BOUNDARY)continue;
      const variation=variationTailAt(source,end);
      out.push({slot,label,start,end,visibleStart:start,visibleEnd:end,marker:variation.marker,direction:variation.direction,markerStart:variation.markerStart,markerEnd:variation.markerEnd,unitEnd:variation.markerEnd>0?variation.markerEnd:end,color:categoryMeta(slot).color,recovered:true});
    }
  }
  return out.sort((a,b)=>a.start-b.start);
}

export function sceneTokenAtOffset(text,offset,{includeMarker=true}={}){
  const n=Number(offset);if(!Number.isFinite(n))return null;
  return sceneTokenRanges(text).find((row)=>{
    if(n>=row.visibleStart&&n<row.visibleEnd)return true;
    return !!includeMarker&&row.markerStart>=0&&n>=row.markerStart&&n<row.markerEnd;
  })||null;
}

export function hasSceneToken(text,slot){const source=String(text??""),token=sceneToken(slot);if(token&&source.includes(token))return true;return !!visibleSceneTokenRe(slot)?.test(source);}

export function sceneVariationDirection(text,slot){
  const token=sceneToken(slot);if(!token)return 0;const source=String(text??""),index=source.indexOf(token);
  if(index>=0)return variationTailAt(source,index+token.length).direction;
  const match=visibleSceneTokenRe(slot)?.exec(source);return match?variationTailAt(source,match.index+match[0].length).direction:0;
}

export function setSceneVariationMarker(text,slot,direction=0){
  const token=sceneToken(slot);let source=String(text??"");if(!token)return source;
  let index=source.indexOf(token),length=token.length;
  if(index<0){const match=visibleSceneTokenRe(slot)?.exec(source);if(!match)return source;index=match.index;length=match[0].length;}
  const after=index+length,tail=source.slice(after);
  // Only horizontal whitespace may separate a legacy marker from its category.
  // Preserve that whitespace AFTER the marker so PROP+ always renders as one
  // semantic unit instead of letting '+' drift toward the following category.
  const match=tail.match(/^([ \t]*)([+-])?/),spacing=match?.[1]||"",consumed=(match?.[0]||"").length;
  const marker=Number(direction)>0?"+":Number(direction)<0?"-":"";
  return source.slice(0,after)+marker+spacing+tail.slice(consumed);
}

export function normalizeLegacySceneVariationMarkers(text){
  let out=String(text??"");
  for(const slot of H3_SCENE_SLOT_ORDER){
    const token=sceneToken(slot);if(!token)continue;let from=0;
    while(from<=out.length){
      const index=out.indexOf(token,from);if(index<0)break;
      const after=index+token.length,current=variationTailAt(out,after);
      if(current.direction){
        // Normalize old "TOKEN   +" to "TOKEN+   ".
        const tail=out.slice(after),match=tail.match(/^([ \t]*)([+-])/);
        if(match&&match[1])out=out.slice(0,after)+match[2]+match[1]+tail.slice(match[0].length);
        from=after+1;continue;
      }
      // One-time repair for the old \s* bug: a generated marker could cross a
      // newline and land immediately before the next category/free phrase.
      const legacy=variationTailAt(out,after,{legacyNewlines:true});
      if(legacy.direction&&legacy.spacing.includes("\n")){
        const tail=out.slice(after),match=tail.match(/^([ \t\r\n]*)([+-])/);
        if(match)out=out.slice(0,after)+match[2]+match[1]+tail.slice(match[0].length);
      }
      from=after+1;
    }
  }
  return out;
}

export function stripSceneTokenForMove(text,slot,anchor=0){
  let source=String(text??""),point=Math.max(0,Math.min(Number(anchor)||0,source.length));
  const rows=sceneTokenRanges(source).filter((row)=>row.slot===String(slot||"")).sort((a,b)=>b.start-a.start);
  for(const row of rows){
    const preserved=row.markerStart>=0?source.slice(row.end,row.markerStart):"",removeEnd=row.markerEnd>=0?row.markerEnd:row.end,removed=(removeEnd-row.start)-preserved.length;
    source=source.slice(0,row.start)+preserved+source.slice(removeEnd);
    if(point>row.start){if(point>=removeEnd)point-=removed;else point=row.start+preserved.length;}
  }
  return {text:source,anchor:Math.max(0,Math.min(point,source.length))};
}

export function stripSceneTokens(text){
  let out=String(text??"");
  for(const slot of H3_SCENE_SLOT_ORDER){const token=sceneToken(slot);if(token)out=out.replace(new RegExp(`${escRe(token)}(?:[ \\t]*[+-])?`,"g")," ");const visible=visibleSceneTokenRe(slot,{global:true,marker:true});if(visible)out=out.replace(visible," ");}
  return clean(out.replace(/[ \t]{2,}/g," "));
}

export function expandSceneTokens(text,selections,{suppress=[]}={}){
  let out=String(text??""),blocked=new Set((suppress||[]).map(String));
  const source=selections&&typeof selections==="object"&&!Array.isArray(selections)?selections:{};
  // Replace ranges from the original source in one reverse pass. Inserted
  // category prose is output and must not be rescanned as fresh syntax.
  const rows=sceneTokenRanges(out).filter((row)=>!row.recovered||Object.prototype.hasOwnProperty.call(source,row.slot)||blocked.has(row.slot)).sort((a,b)=>b.start-a.start);
  for(const row of rows){
    const prompt=String(source?.[row.slot]?.prompt||"").trim(),replacement=blocked.has(row.slot)?"":prompt,removeEnd=row.markerEnd>=0?row.markerEnd:row.end;
    out=out.slice(0,row.start)+replacement+out.slice(removeEnd);
  }
  // Unknown/corrupt marked labels should never leak to MiniMax as mysterious
  // source syntax. Keep ordinary words untouched; only strip our bounded form.
  out=out.replace(new RegExp(`${escRe(H3_TOKEN_BOUNDARY)}[A-Z][A-Z0-9 _/-]{1,31}${escRe(H3_TOKEN_BOUNDARY)}`,"g"),"");
  return clean(out);
}

export function migrateLegacyScenePrompt(prompt,selections){
  let text=normalizeLegacySceneVariationMarkers(String(prompt??""));
  const source=selections&&typeof selections==="object"&&!Array.isArray(selections)?selections:{};
  const kept={};
  for(const slot of H3_SCENE_SLOT_ORDER){
    const preset=source?.[slot];if(!preset||typeof preset!=="object")continue;
    const token=sceneToken(slot),legacy=String(preset.prompt||"").trim();
    if(text.includes(token)){kept[slot]=preset;continue;}
    const visible=visibleSceneTokenRe(slot,{global:true,marker:true});
    if(visible&&visible.test(text)){
      visible.lastIndex=0;
      text=text.replace(visible,(whole)=>{const marker=whole.match(/([+-])$/)?.[1]||"";return `${token}${marker}`;});
      kept[slot]=preset;continue;
    }
    if(legacy&&text.includes(legacy)){
      text=text.replace(legacy,token);kept[slot]=preset;continue;
    }
    // The user already removed/rewrote this structured choice in the full
    // editor. Do not resurrect it from metadata on load.
  }
  return {prompt:clean(text),selections:kept};
}

export function decorateH3PromptSource(text,result={},options={}){
  const source=String(text??""),decorations=[...(result.decorations||[])];
  // The Custom Highlight API can paint these ranges without changing the text
  // width/caret mapping. The zero-width boundaries remain invisible.
  for(const row of sceneTokenRanges(source)){
    // Paint LABEL+ / LABEL- as one semantic unit. Keeping the variation glyph
    // inside the same highlight prevents Prompt Palette's ordinary text layer
    // from winning the '+'/'-' when adjacent highlight ranges are composed.
    const visualEnd=row.markerEnd>=0?row.markerEnd:row.visibleEnd;
    decorations.push({start:row.visibleStart,end:visualEnd,kind:"h3_scene_token",color:row.color,slot:row.slot,direction:row.direction});
  }

  // Cast/media mentions remain ordinary source text because H3 itself uses
  // @handles. Only known Creator handles are semantic/editor-interactive; this
  // prevents ordinary @words from being painted as Cast by accident.
  const knownCast=castHandles(options?.castHandles||[]),knownAssets=new Set((options?.assetHandles||[]).map((value)=>String(value??"").replace(/^@/,"")).filter(Boolean));
  for(const row of castMentionRanges(source,knownCast)){
    // @Handle+ / @Handle- is one Cast token visually and semantically. The
    // marker must never fall through to plain prompt text styling.
    decorations.push({start:row.start,end:row.unitEnd,kind:"h3_cast_mention",color:row.color,handle:row.handle,direction:row.direction});
  }
  const media=/@([A-Za-z]+-\d+)(?![A-Za-z0-9_-])/g;let match;
  while((match=media.exec(source))){
    if(knownAssets.size&&!knownAssets.has(match[1]))continue;
    decorations.push({start:match.index,end:match.index+match[0].length,kind:"h3_media_mention",color:H3_CATEGORY_META.media.color,handle:match[1]});
  }
  return {...result,decorations};
}
