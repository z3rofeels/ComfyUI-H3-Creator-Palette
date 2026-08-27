import * as S from "./z3_h3_state.js";
import { VIDEO_RESOLUTION_EDGES, resolveH3Canvas, normalizeVideoTargetEdge } from "./h3_canvas.js";

const ASPECTS = Object.freeze([
  ["16:9", "Landscape", "Widescreen video"],
  ["9:16", "Portrait", "Vertical video"],
  ["1:1", "Square", "Equal width and height"],
  ["4:3", "Classic landscape", "Traditional frame"],
  ["3:4", "Classic portrait", "Traditional vertical frame"],
  ["21:9", "Cinema wide", "Ultra-wide frame"],
]);

const LENGTHS = Object.freeze([
  [56, "Quick beat"],
  [90, "Short scene"],
  [124, "Compact scene"],
  [141, "Standard scene"],
  [192, "Full scene"],
  [243, "Long scene"],
  [294, "Extended scene"],
  [362, "Maximum single scene"],
]);

const RESOLUTION_NAMES = Object.freeze({
  384: "Draft", 512: "Fast", 640: "Balanced", 704: "High",
  768: "Standard", 832: "Large", 896: "Maximum",
});

const megapixels = (width, height) => width * height / 1_000_000;
const mpLabel = (width, height) => {
  const mp = megapixels(width, height);
  return mp >= .95 && mp < 1.1 ? "1.0 MP" : `${mp.toFixed(mp < 1 ? 2 : 1)} MP`;
};

export function h3LengthChoices(currentSeconds=S.DEFAULT_DURATION_S) {
  const currentFrames=S.durationFrames(currentSeconds), rows=[...LENGTHS];
  if(!rows.some(([frames])=>frames===currentFrames))rows.push([currentFrames,"Custom H3 length"]);
  rows.sort((a,b)=>a[0]-b[0]);
  return [...rows.map(([frames,name])=>({
    value:String(frames),title:`${(frames/S.FPS).toFixed(2)} seconds`,
    detail:`${frames} H3 frames · ${name}`,
    badge:frames===192?"Recommended":"",
  })),{value:"__custom__",title:"Custom H3 length…",detail:"Choose seconds or an exact legal 17n+5 frame count",badge:"Custom",action:true}];
}

export function clipLengthChoices(currentSeconds=S.DEFAULT_DURATION_S) {
  const seconds=Math.max(.2,Number(currentSeconds)||S.DEFAULT_DURATION_S),values=[2,4,5,6,8,10,12,15];
  if(!values.some((value)=>Math.abs(value-seconds)<.0001))values.push(seconds);
  values.sort((a,b)=>a-b);
  return [...values.map((value)=>({value:String(value),title:`${Number(value).toFixed(value%1?2:0)} seconds`,detail:"Supplied clip duration · exact timeline time",badge:value===8?"Common":""})),{value:"__custom__",title:"Custom clip length…",detail:"Choose any supplied clip duration from 0.2 to 120 seconds",badge:"Custom",action:true}];
}

export function h3AspectChoices(shortEdge=S.NATIVE_SHORT_EDGE,current="") {
  const rows=ASPECTS.map(([value,title,description])=>{
    const canvas=resolveH3Canvas(value,shortEdge);
    return {value,title:`${value} · ${title}`,detail:`${canvas.width}×${canvas.height} at current resolution · ${description}`};
  });
  if(current&&!rows.some(row=>row.value===String(current))){const canvas=resolveH3Canvas(current,shortEdge);rows.push({value:String(current),title:`${current} · Custom`,detail:`${canvas.width}×${canvas.height} at current resolution`,badge:"Current"});}
  return [...rows,{value:"__custom__",title:"Custom aspect ratio…",detail:"Enter any W:H ratio inside H3's 9:16 to 21:9 envelope",badge:"Custom",action:true}];
}

export function h3ResolutionChoices(aspect="16:9",current=S.NATIVE_SHORT_EDGE) {
  const values=[...VIDEO_RESOLUTION_EDGES],custom=normalizeVideoTargetEdge(current);
  if(!values.includes(custom))values.push(custom);
  values.sort((a,b)=>a-b);
  return [...values.map((edge)=>{
    const canvas=resolveH3Canvas(aspect,edge),native=edge===S.NATIVE_SHORT_EDGE;
    return {
      value:String(edge),
      title:`${RESOLUTION_NAMES[edge]||"Custom"} (${mpLabel(canvas.width,canvas.height)})`,
      detail:`${canvas.width}×${canvas.height} final · ${native?"H3 native":`${edge}px short edge${edge>S.NATIVE_SHORT_EDGE?" · above native":""}`}`,
      badge:native?"Recommended":"",
    };
  }),{value:"__custom__",title:"Custom resolution…",detail:"Choose a 384–896 px short edge and see the exact H3 canvas",badge:"Custom",action:true}];
}

export function h3QualityChoices({turbo=false,currentSteps=20,sampler="res_multistep",scheduler="simple"}={}) {
  const rows=turbo
    ? [[4,"4 steps · Turbo Draft","Fastest"],[6,"6 steps · Turbo Balanced","Recommended"],[8,"8 steps · Turbo High","Highest Turbo preset"]]
    : [[12,"12 steps · Quick","Fast preview"],[16,"16 steps · Balanced","Faster final"],[20,"20 steps · H3 default","Recommended"],[24,"24 steps · Refined","More sampling"],[30,"30 steps · Maximum","Slowest preset"]];
  const steps=Math.max(1,Math.trunc(Number(currentSteps)||20));
  if(!rows.some(([value])=>value===steps))rows.push([steps,`${steps} steps · Custom`,"Current workflow value"]);
  rows.sort((a,b)=>a[0]-b[0]);
  return [...rows.map(([value,title,badge])=>({
    value:String(value),title,detail:`${value} steps · ${turbo?"Euler / beta":`${sampler} / ${scheduler}`}`,
    badge,
  })),{value:"__custom__",title:"Custom sampling steps…",detail:"Choose any whole step count from 1 to 10,000",badge:"Custom",action:true}];
}

const SAMPLER_DETAILS={res_multistep:"H3 full-model baseline",euler:"Turbo baseline",er_sde:"SDE sampler",dpmpp_2m_sde:"DPM++ SDE sampler"};
const SCHEDULER_DETAILS={simple:"H3 full-model baseline",beta:"Turbo baseline",bong_tangent:"Experimental tangent schedule",normal:"Standard sigma schedule"};
const ATTENTION_DETAILS={default:"ComfyUI automatic/default backend",kitchen:"Comfy-Kitchen attention backend",sage:"KJNodes SageAttention backend"};
export function samplingChoiceRows(values,current,kind="sampler") {
  const rows=[...new Set([...(values||[]).map(String),String(current||"")].filter(Boolean))],details=kind==="scheduler"?SCHEDULER_DETAILS:kind==="attention"?ATTENTION_DETAILS:SAMPLER_DETAILS;
  return rows.map((value)=>({value,title:value,detail:details[value]||`${kind} option`,badge:kind==="sampler"&&value==="res_multistep"?"H3 default":kind==="sampler"&&value==="euler"?"Turbo default":kind==="scheduler"&&value==="simple"?"H3 default":kind==="scheduler"&&value==="beta"?"Turbo default":""}));
}

export function flatChoiceLabels(choices) {
  return (choices||[]).map((choice)=>[String(choice.value),[choice.title,choice.detail,choice.badge].filter(Boolean).join(" · ")]);
}
