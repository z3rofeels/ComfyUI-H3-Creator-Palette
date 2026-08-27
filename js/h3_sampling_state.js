// Named workflow persistence for hidden schema widgets. ComfyUI still owns the
// real inputs; this snapshot prevents positional/configuration timing in either
// frontend from making an invisible default overwrite the user's last choice.

export const SAMPLING_PROPERTY = "z3_sampling_profile";
export const SAMPLING_KEYS = Object.freeze([
  "steps", "cfg", "sampler_name", "scheduler", "attention",
  "block_cache", "spectrum", "spectrum_blend", "chunk_ffn",
  "fp16_accumulation", "h3_memory", "h3_sparse", "h3_sparse_edges",
  "shift_video", "shift_audio",
]);

const NUMBER_KEYS=new Set(["steps","cfg","spectrum_blend","shift_video","shift_audio"]);
const BOOLEAN_KEYS=new Set(["spectrum","chunk_ffn","fp16_accumulation","h3_sparse_edges"]);

export function comboValues(widget) {
  const raw=widget?.options?.values||widget?.combo_options||(Array.isArray(widget?.options)?widget.options:[]);
  return Array.isArray(raw)?raw.map(String):[];
}

function normalizedValue(name,value,widget) {
  if(NUMBER_KEYS.has(name)){const number=Number(value);return Number.isFinite(number)?number:undefined;}
  if(BOOLEAN_KEYS.has(name))return value===true;
  const text=String(value??"").trim();if(!text)return undefined;
  const allowed=comboValues(widget);return !allowed.length||allowed.includes(text)?text:undefined;
}

export function samplingSnapshot(widgets={}) {
  const out={};
  for(const name of SAMPLING_KEYS){const widget=widgets?.[name];if(!widget)continue;const value=normalizedValue(name,widget.value,widget);if(value!==undefined)out[name]=value;}
  return out;
}

export function normalizeSamplingSnapshot(raw,widgets={}) {
  const source=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{},out={};
  for(const name of SAMPLING_KEYS){if(!(name in source)||!widgets?.[name])continue;const value=normalizedValue(name,source[name],widgets[name]);if(value!==undefined)out[name]=value;}
  return out;
}

export function applySamplingSnapshot(widgets,snapshot) {
  const clean=normalizeSamplingSnapshot(snapshot,widgets);
  for(const [name,value] of Object.entries(clean))widgets[name].value=value;
  return clean;
}
