import { api } from "../../scripts/api.js";

function apiURL(path){return typeof api.apiURL==="function"?api.apiURL(path):path;}
async function json(path,options){const response=await api.fetchApi(path,options);const text=await response.text();let data={};if(text){try{data=JSON.parse(text);}catch{throw new Error(`H3 Pack Manager received an invalid server response (${response.status})`);}}if(!response.ok||data?.ok===false)throw new Error(data?.error||`H3 Pack Manager request failed (${response.status})`);return data;}
function emitTransaction(data){const tx=data?.transaction;if(!tx?.transaction_id||tx.reversible===false)return;try{window.dispatchEvent(new CustomEvent("z3-h3-library-transaction",{detail:{transaction:tx}}));}catch{} }
function emitPackChanged(source="history"){try{window.dispatchEvent(new CustomEvent("z3-h3-pack-changed",{detail:{kind:"history",source}}));}catch{} }
async function mutation(path,options,{pick=null,emit=true}={}){const data=await json(path,options);if(emit)emitTransaction(data);return typeof pick==="function"?pick(data):data;}

export const H3PackAPI={
  async load(){return (await json("/z3_minimax_creator/h3_pack")).pack;},
  async integrity(){return (await json("/z3_minimax_creator/h3_pack/integrity")).report;},
  async repairIntegrity(){return await mutation("/z3_minimax_creator/h3_pack/integrity/repair",{method:"POST"});},
  async reset(){return (await mutation("/z3_minimax_creator/h3_pack/reset",{method:"POST"})).pack;},
  async savePrompt(category,item){return mutation("/z3_minimax_creator/h3_pack/prompt",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({category,item})},{pick:data=>data.item});},
  async deletePrompt(category,id,{permanent=false}={}){return await mutation("/z3_minimax_creator/h3_pack/prompt/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({category,id,permanent})});},
  async saveCast(item){return mutation("/z3_minimax_creator/h3_pack/cast",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({item})},{pick:data=>data.item});},
  async deleteCast(handle,{id="",permanent=false}={}){return await mutation("/z3_minimax_creator/h3_pack/cast/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({handle,id,permanent})});},
  async references(){return (await this.load()).references||[];},
  async saveReference(item){return mutation("/z3_minimax_creator/h3_pack/reference",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({item})},{pick:data=>data.item});},
  async deleteReference(id,{permanent=false}={}){return await mutation("/z3_minimax_creator/h3_pack/reference/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,permanent})});},
  thumbUrl(file,bust=""){return file?apiURL(`/z3_minimax_creator/h3_pack/thumb?file=${encodeURIComponent(file)}${bust}`):"";},
  async setThumbnail({kind="prompt",category="",id,file}){const form=new FormData();form.append("kind",kind);form.append("category",category);form.append("id",id);form.append("file",file,file.name);return await mutation("/z3_minimax_creator/h3_pack/thumbnail",{method:"POST",body:form});},
  async removeThumbnail({kind="prompt",category="",id}){return await mutation("/z3_minimax_creator/h3_pack/thumbnail/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind,category,id})});},
  exportUrl({scope="pack",category="",subcategory="",id=""}={}){const q=new URLSearchParams({scope});if(category)q.set("category",category);if(subcategory)q.set("subcategory",subcategory);if(id)q.set("id",id);return apiURL(`/z3_minimax_creator/h3_pack/export?${q}`);},
  async inspectImport(file,{scope="pack",category="",subcategory=""}={}){const form=new FormData();form.append("scope",scope);form.append("category",category);form.append("subcategory",subcategory);form.append("file",file,file.name);return (await json("/z3_minimax_creator/h3_pack/import/inspect",{method:"POST",body:form})).report;},
  async importPack(file,{scope="pack",category="",subcategory="",mode="append",expectedFingerprint="",replaceKind="",replaceCategory="",replaceGroup=""}={}){const form=new FormData();form.append("scope",scope);form.append("category",category);form.append("subcategory",subcategory);form.append("mode",mode);if(expectedFingerprint)form.append("expected_fingerprint",expectedFingerprint);if(replaceKind)form.append("replace_kind",replaceKind);if(replaceCategory)form.append("replace_category",replaceCategory);if(replaceGroup)form.append("replace_group",replaceGroup);form.append("file",file,file.name);return mutation("/z3_minimax_creator/h3_pack/import",{method:"POST",body:form},{pick:data=>data.pack});},
  async trash(){return await json("/z3_minimax_creator/h3_pack/trash");},
  async restoreTrash(trashId){return await mutation("/z3_minimax_creator/h3_pack/trash/restore",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({trash_id:trashId})});},
  async emptyTrash(){return await mutation("/z3_minimax_creator/h3_pack/trash/empty",{method:"POST"});},
  async permanentDeleteTrash(trashId){return await mutation("/z3_minimax_creator/h3_pack/trash/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({trash_id:trashId})});},
  async deleteCastGroup(group,{permanent=false}={}){return await mutation("/z3_minimax_creator/h3_pack/cast/group/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({group,permanent})});},
  async sourcePacks(){return (await json("/z3_minimax_creator/h3_pack/sources")).sources||[];},
  async deleteSourcePack(sourcePackId,{permanent=false}={}){return await mutation("/z3_minimax_creator/h3_pack/source/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({source_pack_id:sourcePackId,permanent})});},
  async transactions(limit=50){return (await json(`/z3_minimax_creator/h3_pack/transactions?limit=${encodeURIComponent(limit)}`)).transactions||[];},
  async applyHistory(transactionId,direction="undo"){const data=await mutation("/z3_minimax_creator/h3_pack/history/apply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({transaction_id:transactionId,direction})},{emit:false});emitPackChanged(`history-${direction}`);return data;},
  async importBackupStatus(){return await json("/z3_minimax_creator/h3_pack/import/backup");},
  async undoLastImport(){const data=await mutation("/z3_minimax_creator/h3_pack/import/undo",{method:"POST"},{emit:false});emitPackChanged("legacy-import-undo");return data.pack;},
};
