import { castMentionRanges, replaceCastMention } from "./h3_prompt_tokens.js";

const clean=(value)=>String(value??"").trim().replace(/^@/,"");

export function activeCastRoleHandles(prompt,subjects=[]){
  const known=[...new Set((subjects||[]).map((subject)=>clean(subject?.handle)).filter(Boolean))];
  if(!known.length)return [];
  return castMentionRanges(String(prompt??""),known).map((row)=>row.handle).filter((handle,index,rows)=>rows.indexOf(handle)===index);
}

export function castCardIntent(swapHandle,clickedHandle){
  const from=clean(swapHandle),next=clean(clickedHandle);
  if(!from)return "inspect";
  return from===next?"current":"swap";
}

export function swapCastRole(prompt,oldHandle,newHandle){
  return replaceCastMention(String(prompt??""),clean(oldHandle),clean(newHandle));
}
