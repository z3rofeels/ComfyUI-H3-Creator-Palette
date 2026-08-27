// Local-only presentation preferences for Creator Palette.
//
// v3.13.3 deliberately separates three state domains:
//   1) workflow/generation state -> creator_data on the ComfyUI node
//   2) reusable Library state    -> server-side editable pack
//   3) harmless UI preferences   -> browser localStorage only
//
// Caret, focus, hover and autocomplete-selection state are intentionally absent.

const STORAGE_KEY = "z3.minimaxCreator.uiPrefs.v3";
const LEGACY_KEYS = ["z3.minimaxCreator.uiPrefs.v2","z3.minimaxCreator.uiPrefs.v1"];
const DEFAULTS = Object.freeze({
  prompt_view:"editor",
  scene_stack_mode:"prompt",
  show_director_shortcut:true,
  show_refine_shortcut:false,
  show_prestage_shortcut:false,
  editor_font_size:15,
  editor_zoom:1,
  autocomplete_width:420,
  autocomplete_max_height:320,
  last_library_tab:"personal",
  last_selected_shot:0,
});
function object(value){return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}
function readKey(key){try{return object(JSON.parse(localStorage.getItem(key)||"{}"));}catch{return {};}}
function local(){const current=readKey(STORAGE_KEY);if(Object.keys(current).length)return current;for(const key of LEGACY_KEYS){const old=readKey(key);if(Object.keys(old).length)return old;}return {};}
function write(value){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(value));}catch{/* private/locked storage */}}
const clamp=(v,min,max,fallback)=>{const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;};
export function normalizeCreatorUIPrefs(raw){
  const value={...DEFAULTS,...object(raw)};
  value.prompt_view="editor";
  value.scene_stack_mode=["expanded","prompt","sidebar"].includes(value.scene_stack_mode)?value.scene_stack_mode:DEFAULTS.scene_stack_mode;
  value.show_director_shortcut=value.show_director_shortcut!==false;value.show_refine_shortcut=value.show_refine_shortcut===true;value.show_prestage_shortcut=value.show_prestage_shortcut===true;
  value.editor_font_size=clamp(value.editor_font_size,11,26,15);value.editor_zoom=clamp(value.editor_zoom,.75,1.6,1);
  value.autocomplete_width=clamp(value.autocomplete_width,300,680,420);value.autocomplete_max_height=clamp(value.autocomplete_max_height,180,620,320);
  value.last_library_tab=String(value.last_library_tab||"personal");value.last_selected_shot=Math.max(0,Math.trunc(Number(value.last_selected_shot)||0));
  return value;
}
export function loadCreatorUIPrefs(node){
  const stored=local(),legacyWorkflow=object(node?.properties?.z3_creator_ui),seed=Object.keys(stored).length?stored:legacyWorkflow;
  const value=normalizeCreatorUIPrefs(seed);write(value);
  // One-way migration: never serialize presentation state into workflows again.
  if(node?.properties&&"z3_creator_ui" in node.properties){try{delete node.properties.z3_creator_ui;}catch{}}
  return value;
}
export function saveCreatorUIPrefs(_node,prefs){const value=normalizeCreatorUIPrefs(prefs);write(value);return value;}
export function readCreatorUIPrefs(){return normalizeCreatorUIPrefs(local());}
export function patchCreatorUIPrefs(patch){const value=normalizeCreatorUIPrefs({...local(),...object(patch)});write(value);return value;}
