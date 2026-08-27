import * as S from "./z3_h3_state.js";

const isObject=(value)=>value&&typeof value==="object"&&!Array.isArray(value);
const isObjectJSON=(raw)=>{try{return isObject(JSON.parse(String(raw??"")));}catch{return false;}};

export function parseCreatorCandidate(raw){
  const text=String(raw??"").trim();if(!text)return {ok:false,raw:"",data:null,error:"empty"};
  try{const parsed=JSON.parse(text);if(!isObject(parsed))return {ok:false,raw:text,data:null,error:"root is not an object"};return {ok:true,raw:text,data:S.normalizeData(parsed),error:""};}
  catch(error){return {ok:false,raw:text,data:null,error:error?.message||String(error)};}
}

export function chooseCreatorData(widgetRaw,backupRaw,previousRaw=""){
  const widget=parseCreatorCandidate(widgetRaw),backup=parseCreatorCandidate(backupRaw),previous=parseCreatorCandidate(previousRaw);
  // Preserve the existing v3.11 rule when both primary copies are healthy:
  // prefer the richer snapshot because ComfyUI can briefly serialize a hidden
  // widget before its DOM-backed editor has pushed the newest structured data.
  if(widget.ok&&backup.ok){
    const wr=Math.max(0,Math.trunc(Number(widget.data?._revision)||0)),br=Math.max(0,Math.trunc(Number(backup.data?._revision)||0));
    if(wr!==br)return {data:br>wr?backup.data:widget.data,source:br>wr?"backup":"widget",recovered:false};
    const wd=S.dataRichness(widget.data),bd=S.dataRichness(backup.data);return {data:bd>wd?backup.data:widget.data,source:bd>wd?"backup":"widget",recovered:false};
  }
  if(widget.ok)return {data:widget.data,source:"widget",recovered:false};
  if(backup.ok)return {data:backup.data,source:"backup",recovered:true};
  if(previous.ok)return {data:previous.data,source:"previous-backup",recovered:true};
  return {data:S.defaultData(),source:"factory-default",recovered:true};
}

export function persistCreatorBackup(node,raw){
  if(!node)return false;node.properties||={};const next=String(raw||""),current=String(node.properties.z3_creator_data_backup||"");
  // `current` was produced by the preceding successful commit. A shallow JSON
  // validation is enough before rotation and avoids deep-normalizing the entire
  // Creator a second time on every prompt keystroke.
  if(current&&current!==next&&isObjectJSON(current))node.properties.z3_creator_data_backup_prev=current;
  node.properties.z3_creator_data_backup=next;node.properties.z3_creator_data_backup_version=3;return true;
}

export function creatorRoundTripAudit(data){
  const normalized=S.normalizeData(structuredClone(data||{})),raw=JSON.stringify(normalized),parsed=parseCreatorCandidate(raw);if(!parsed.ok)return {ok:false,error:parsed.error,raw};
  const raw2=JSON.stringify(parsed.data),warnings=[];
  if(raw!==raw2)warnings.push("Creator state changes after a serialize/parse round trip.");
  if(!Array.isArray(parsed.data.segments)||!parsed.data.segments.length)warnings.push("No storyboard segments survived serialization.");
  const handles=new Set();for(const subject of parsed.data.subjects||[]){if(handles.has(subject.handle))warnings.push(`Duplicate Cast handle after reload: @${subject.handle}`);handles.add(subject.handle);}
  const assetHandles=new Set();for(const asset of S.allKnownAssets(parsed.data)){if(!asset?.handle)warnings.push("A reference has no handle after reload.");else if(assetHandles.has(asset.handle))warnings.push(`Duplicate reference handle after reload: @${asset.handle}`);else assetHandles.add(asset.handle);}
  return {ok:!warnings.length,warnings,raw,raw2,data:parsed.data};
}
