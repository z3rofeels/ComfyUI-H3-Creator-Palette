import { api } from "../../scripts/api.js";

const BASE = "/z3_minimax_creator";
const check = async (response, label) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `${label} failed (${response.status})`);
  return body;
};

export async function listAssets(root = "input") {
  return check(await api.fetchApi(`${BASE}/assets?root=${encodeURIComponent(root)}`), "asset listing");
}
export async function assetStatus(filenames = []) {
  const values=[...new Set((filenames||[]).map(value=>String(value||"")).filter(Boolean))];
  if(!values.length)return {};
  const result=await check(await api.fetchApi(`${BASE}/asset_status`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filenames:values})}),"reference file check");
  return result.status||{};
}
export async function probe(filename) {
  return check(await api.fetchApi(`${BASE}/probe?filename=${encodeURIComponent(filename)}`), "media probe");
}
export function thumbUrl(filename, size = 256) {
  return api.apiURL(`${BASE}/thumb?filename=${encodeURIComponent(filename)}&size=${size}`);
}
export function peaksUrl(filename) {
  return api.apiURL(`${BASE}/peaks?filename=${encodeURIComponent(filename)}`);
}
export async function moveAsset(filename, subfolder) {
  return check(await api.fetchApi(`${BASE}/move`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({filename, subfolder})}), "move");
}
export async function deleteAsset(filename) {
  return check(await api.fetchApi(`${BASE}/delete`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({filename})}), "delete");
}
export async function listModels() {
  return check(await api.fetchApi(`${BASE}/models`), "model listing");
}
export async function listLoras(folder = "", refresh = false) {
  const q = new URLSearchParams({folder}); if (refresh) q.set("refresh","1");
  return check(await api.fetchApi(`${BASE}/loras?${q}`), "LoRA listing");
}
export function loraPreviewUrl(name) { return api.apiURL(`${BASE}/lora_preview?name=${encodeURIComponent(name)}`); }
export async function loraDetail(name) {
  return check(await api.fetchApi(`${BASE}/lora_detail?name=${encodeURIComponent(name)}`), "LoRA detail");
}
export async function promptPreview(data, seed=0, processing_mode="entire text as one", variation_index=0) {
  return check(await api.fetchApi(`${BASE}/prompt_preview`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({data,seed,processing_mode,variation_index})}), "prompt preview");
}
export async function readSettings() { return check(await api.fetchApi(`${BASE}/settings`), "settings"); }
export async function acceleratorStatus() { return check(await api.fetchApi(`${BASE}/accelerators`), "accelerator status"); }
export async function saveSettings(patch) {
  return check(await api.fetchApi(`${BASE}/settings`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(patch)}), "settings");
}
export async function refineModels() { return check(await api.fetchApi(`${BASE}/refine/models`), "refiner model listing"); }
export async function refineSkills() { return check(await api.fetchApi(`${BASE}/refine/skills`), "refiner skill listing"); }
export async function startRefine(body) {
  return check(await api.fetchApi(`${BASE}/refine`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)}), "refine");
}
export async function refineJob(job) { return check(await api.fetchApi(`${BASE}/refine/job/${encodeURIComponent(job)}`), "refine job"); }
export async function uploadFile(file, subfolder = "z3_minimax_creator") {
  const form = new FormData();
  form.append("image", file, file.name);
  form.append("subfolder", subfolder);
  form.append("type", "input");
  const body = await check(await api.fetchApi("/upload/image", {method:"POST", body:form}), "upload");
  const path = [body.subfolder, body.name].filter(Boolean).join("/");
  return {path, name: body.name, subfolder: body.subfolder || "", kind: kindFromName(body.name)};
}
export function kindFromName(name) {
  const ext = String(name||"").split(".").pop().toLowerCase();
  if (["png","jpg","jpeg","webp","bmp","gif","avif"].includes(ext)) return "image";
  if (["mp4","webm","mov","mkv","avi","m4v"].includes(ext)) return "video";
  if (["wav","mp3","flac","ogg","m4a","aac"].includes(ext)) return "audio";
  return "other";
}
export { api };

export async function peaks(filename) {
  return check(await api.fetchApi(`${BASE}/peaks?filename=${encodeURIComponent(filename)}`), "waveform");
}
export function inputViewUrl(filename) {
  const clean=String(filename||"");
  const output=/ \[output\]$/.test(clean);
  const bare=clean.replace(/ \[output\]$/,"");
  const parts=bare.split("/");
  const name=parts.pop()||bare, subfolder=parts.join("/");
  const q=new URLSearchParams({filename:name,type:output?"output":"input"});
  if(subfolder)q.set("subfolder",subfolder);
  return api.apiURL(`/view?${q.toString()}`);
}
export function viewUrl(row) {
  if(!row)return "";
  if(typeof row==="string")return inputViewUrl(row);
  const q=new URLSearchParams({filename:String(row.filename||""),type:String(row.type||"output")});
  if(row.subfolder)q.set("subfolder",String(row.subfolder));
  return api.apiURL(`/view?${q.toString()}`);
}
export async function renderMeta(filename) {
  return check(await api.fetchApi(`${BASE}/render_meta?filename=${encodeURIComponent(filename)}`), "render metadata");
}
