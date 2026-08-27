// Shared semantic vocabulary for every Creator Palette surface.
// One palette keeps the inline prompt editor, Scene Stack and ComfyUI sidebar visually
// consistent without letting UI color become part of the text sent to H3.

export const H3_CATEGORY_META = Object.freeze({
  cast:      { label: "CAST",      title: "Cast",              color: "#66b7aa" },
  media:     { label: "MEDIA",     title: "References",        color: "#72a8c9" },
  location:  { label: "LOCATION",  title: "Location",          color: "#d69b62" },
  wardrobe:  { label: "CLOTHING",  title: "Clothing",          color: "#bd7ea3" },
  prop:      { label: "PROP",      title: "Prop",              color: "#9186cb" },
  action:    { label: "ACTION",    title: "Action",            color: "#d98264" },
  camera:    { label: "CAMERA",    title: "Camera",            color: "#6d9fd1" },
  lighting:  { label: "LIGHT",     title: "Lighting",          color: "#d5b365" },
  dialogue:  { label: "DIALOGUE",  title: "Dialogue",          color: "#ca7f8d" },
  ambience:  { label: "AUDIO",     title: "Ambience / Foley",  color: "#6fa98f" },
  music:     { label: "MUSIC",     title: "Music",             color: "#9b83bd" },
  lora:      { label: "STYLE",     title: "LoRAs",             color: "#b18a61" },
  timing:    { label: "WHEN",      title: "Timing",            color: "#8e99aa" },
  direction: { label: "DIRECTION", title: "Free direction",    color: "#9ca5b4" },
  builder:   { label: "SCENE",     title: "Scene",             color: "#c59862" },
  guide:     { label: "GUIDE",     title: "Guide",             color: "#8c96a8" },
});

export const H3_SCENE_SLOT_ORDER = Object.freeze([
  "location", "wardrobe", "prop", "action", "camera", "lighting", "dialogue", "ambience", "music",
]);

const CATEGORY_ALIASES=Object.freeze({
  location:new Set(["location","locations","environment","environments","place","places"]),
  wardrobe:new Set(["wardrobe props","wardrobe","clothing","clothes","outfit","outfits","fashion","apparel","costume","costumes"]),
  prop:new Set(["wardrobe props","prop","props","object","objects","item","items"]),
  action:new Set(["action","actions","motion","movement","performance"]),
  camera:new Set(["camera","cameras","shot","shots","cinematography"]),
  lighting:new Set(["lighting","light","lights","illumination"]),
  dialogue:new Set(["dialogue performance","dialogue","speech","audio"]),
  ambience:new Set(["audio","foley","ambience","ambient","sound","sounds"]),
  music:new Set(["audio","music","score","soundtrack"]),
});
const SLOT_ALIASES=Object.freeze({
  location:"location",locations:"location",environment:"location",environments:"location",place:"location",places:"location",
  wardrobe:"wardrobe",clothing:"wardrobe",clothes:"wardrobe",outfit:"wardrobe",outfits:"wardrobe",fashion:"wardrobe",apparel:"wardrobe",costume:"wardrobe",costumes:"wardrobe",
  prop:"prop",props:"prop",object:"prop",objects:"prop",item:"prop",items:"prop",
  action:"action",actions:"action",motion:"action",movement:"action",
  camera:"camera",cameras:"camera",shot:"camera",shots:"camera",cinematography:"camera",
  lighting:"lighting",light:"lighting",lights:"lighting",illumination:"lighting",
  dialogue:"dialogue",dialog:"dialogue",speech:"dialogue",voice:"dialogue",
  ambience:"ambience",ambient:"ambience",audio:"ambience",foley:"ambience",sound:"ambience",
  music:"music",score:"music",scores:"music",soundtrack:"music",soundtracks:"music",
});
const WARDROBE_LABELS=new Set(["wardrobe","clothing","clothes","outfit","outfits","fashion","apparel","costume","costumes","look","looks"]);
const PROP_LABELS=new Set(["prop","props","object","objects","item","items"]);
const DIALOGUE_LABELS=new Set(["dialogue","dialog","speech","speaking","voice","voices"]);
const MUSIC_LABELS=new Set(["music","score","soundtrack"]);
const normalized=(value)=>String(value??"").trim().toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ");

export function canonicalSceneSlot(value){return SLOT_ALIASES[normalized(value)]||null;}

export function scenePromptMatchesSlot(slot,categoryId,prompt={}){
  const key=String(slot||""),explicit=canonicalSceneSlot(prompt?.slot);if(explicit)return explicit===key;
  const category=normalized(categoryId);if(!CATEGORY_ALIASES[key]?.has(category))return false;
  const subcategory=normalized(prompt?.subcategory);
  if(category==="wardrobe props"){
    if(key==="wardrobe")return WARDROBE_LABELS.has(subcategory);
    if(key==="prop")return PROP_LABELS.has(subcategory);
  }
  if(category==="audio"){
    if(key==="dialogue")return DIALOGUE_LABELS.has(subcategory);
    if(key==="music")return MUSIC_LABELS.has(subcategory);
    if(key==="ambience")return !DIALOGUE_LABELS.has(subcategory)&&!MUSIC_LABELS.has(subcategory);
  }
  if(key==="ambience")return !DIALOGUE_LABELS.has(subcategory)&&!MUSIC_LABELS.has(subcategory);
  return true;
}

export function categoryMeta(key) {
  return H3_CATEGORY_META[key] || H3_CATEGORY_META.guide;
}

export function categoryColor(key) {
  return categoryMeta(key).color;
}
