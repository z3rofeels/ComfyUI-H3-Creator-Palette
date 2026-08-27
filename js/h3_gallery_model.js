const clean=(value)=>String(value??"").trim();
const idOf=(row)=>clean(row?.id??row?.handle);

export function auditionMode({marker=0,candidates=[],direction=1,mode=null}={}){
  const step=Number(marker);
  if(step>0)return "all_forward";
  if(step<0)return "all_reverse";
  if(Array.isArray(candidates)&&candidates.length&&mode!=="prepared")return Number(direction)<0?"shortlist_reverse":"shortlist_forward";
  return "fixed";
}

export function auditionSequence(rows,currentId,{marker=0,candidates=[],direction=1}={}){
  const source=Array.isArray(rows)?rows.filter((row)=>idOf(row)):[],current=clean(currentId);
  const byId=new Map(source.map((row)=>[idOf(row),row])),selected=byId.get(current)||null;
  if(Number(marker)){
    const start=source.findIndex((row)=>idOf(row)===current),sign=Number(marker)<0?-1:1;
    if(start<0)return selected?[selected,...source]:source;
    return source.map((_,offset)=>source[(start+sign*offset+source.length)%source.length]);
  }
  const picked=[];
  for(const value of Array.isArray(candidates)?candidates:[]){const row=byId.get(clean(value));if(row&&idOf(row)!==current&&!picked.includes(row))picked.push(row);}
  if(Number(direction)<0)picked.reverse();
  return selected?[selected,...picked]:picked;
}

export function galleryRows(rows,{query="",currentId="",candidates=[],marker=0,direction=1,audition=false}={}){
  const source=Array.isArray(rows)?rows.filter((row)=>idOf(row)):[],needle=clean(query).toLowerCase(),selected=new Set((candidates||[]).map(clean).filter(Boolean));
  const sequence=audition?auditionSequence(source,currentId,{marker,candidates,direction}):[];
  const sequenceIndex=new Map(sequence.map((row,index)=>[idOf(row),index+1]));
  const filtered=source.filter((row)=>!needle||`${row?.title||""} ${row?.note||""} ${row?.subcategory||""} ${row?.prompt||""} ${row?.display_name||""} ${row?.handle||""} ${row?.preset_group||row?.group||""} ${row?.description||""} ${row?.clothing||""}`.toLowerCase().includes(needle));
  if(audition)filtered.sort((a,b)=>(sequenceIndex.get(idOf(a))||Number.MAX_SAFE_INTEGER)-(sequenceIndex.get(idOf(b))||Number.MAX_SAFE_INTEGER));
  return filtered.map((row)=>({
    row,
    id:idOf(row),
    current:idOf(row)===clean(currentId),
    selected:selected.has(idOf(row)),
    sequence:sequenceIndex.get(idOf(row))||0,
  }));
}
