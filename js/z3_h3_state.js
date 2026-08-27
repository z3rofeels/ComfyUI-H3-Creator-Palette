export const FPS = 24;
export const NATIVE_SHORT_EDGE = 768;
export const MIN_SHORT_EDGE = 384;
export const MAX_SHORT_EDGE = 896;
export const CANVAS_MULTIPLE = 32;
export const DEFAULT_DURATION_S = 6;
export const VIDEO_PREFIX = "minimax/renders/H3";
export const CHECKPOINTS = ["fl2va", "ref2va"];
export const UPSCALE_MODES = ["two_pass", "direct"];
export const TURBO_QUALITIES = ["draft", "medium", "good"];
export const TURBO_STEPS = { draft: 4, medium: 6, good: 8 };
export const TURBO_SAMPLER = "euler";
export const TURBO_SCHEDULER = "beta";
export const TURBO_RESET = { steps: 20, sampler_name: "res_multistep", scheduler: "simple", shift_video: 12, shift_audio: 3 };
export const FEATHERS = [1, 5, 22, 39];

export const IMAGE_TAKES = ["full", "person", "object", "scene", "style"];
export const VIDEO_TAKES = [...IMAGE_TAKES, "motion", "camera", "edit", "continue"];
export const AUDIO_TAKES = ["full", "voice", "music", "ambience", "copy"];

export const DEFAULT_FACE = () => ({ on: false, canvas: 512, denoise: 0.45 });
export const DEFAULT_TURBO = () => ({ lora: "", merged: false, quality: "medium", on: false, saved: null });
export const DEFAULT_ARCHIVE_STITCH = () => ({ enabled: false, folder: "h3_context", pattern: "clip_*.safetensors", first_clip: 1, last_clip: 0, context_length: 22, fps: 24 });
export const DEFAULT_SEGMENT = () => ({
  prompt: "", assets: [], loras: [], duration_s: DEFAULT_DURATION_S, checkpoint: "auto",
  continue: false, continue_audio: false, soundscape: "", music: ""
});

export function defaultData() {
  return {
    version: 3,
    _revision: 0,
    prompt: "",
    h3_auto_format: false,
    aspect: "16:9",
    aspect_source: "pill",
    short_edge: NATIVE_SHORT_EDGE,
    upscale: "two_pass",
    sample_edge: NATIVE_SHORT_EDGE,
    refine_denoise: 0.5,
    face: DEFAULT_FACE(),
    audio_tail_s: 1,
    output_prefix: VIDEO_PREFIX,
    models: {},
    turbo: DEFAULT_TURBO(),
    archive_stitch: DEFAULT_ARCHIVE_STITCH(),
    assets: [],
    subjects: [],
    loras: [],
    segments: [DEFAULT_SEGMENT()],
  };
}

export function clampNum(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
const snap = (x, multiple = CANVAS_MULTIPLE) => Math.max(multiple, Math.round(Number(x || multiple) / multiple) * multiple);
const array = (v) => Array.isArray(v) ? v : [];
const object = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
const SUBJECT_HANDLE_MAX = 32;
const SUBJECT_RECORD_ID_MAX = 80;
function stableIdHash(value) {
  let hash = 2166136261;
  const source = String(value ?? "");
  for (let i = 0; i < source.length; i++) { hash ^= source.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}
export function normalizeSubjectRecordId(value, fallbackSeed = "character") {
  let out = String(value ?? "").trim().replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!out) out = `cast_${stableIdHash(fallbackSeed)}`;
  if (!/^[A-Za-z]/.test(out)) out = `cast_${out}`;
  return out.slice(0, SUBJECT_RECORD_ID_MAX) || `cast_${stableIdHash(fallbackSeed)}`;
}
export function normalizeSubjectHandle(value, fallback = "character") {
  let out = String(value ?? "").trim().replace(/^@/, "");
  try { out = out.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch {}
  out = out.replace(/[^A-Za-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[A-Za-z]/.test(out)) out = `Character_${out}`;
  out = out.slice(0, SUBJECT_HANDLE_MAX).replace(/_+$/g, "");
  return out || fallback;
}
const escapeRegExp = (value) => String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function migrateSubjectMentions(value, renames) {
  let out = String(value ?? "");
  for (const [oldHandle, newHandle] of renames) {
    if (!oldHandle || oldHandle === newHandle) continue;
    out = out.replace(new RegExp(`@${escapeRegExp(oldHandle)}(?!-[0-9])(?![A-Za-z0-9_])`, "g"), `@${newHandle}`);
  }
  return out;
}
function normalizeSceneAuditions(raw, palette) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const selections = palette && typeof palette === "object" && !Array.isArray(palette) ? palette : {};
  const allowed = new Set(["location", "wardrobe", "prop", "action", "camera", "lighting", "dialogue", "ambience", "music"]);
  const out = {};
  for (const [slot, configRaw] of Object.entries(source)) {
    if (!allowed.has(slot) || !configRaw || typeof configRaw !== "object" || Array.isArray(configRaw)) continue;
    const currentId = String(selections?.[slot]?.id || "").trim();
    const candidates = [...new Set((Array.isArray(configRaw.candidates) ? configRaw.candidates : []).map((value) => String(value || "").trim()).filter((id) => id && id !== currentId))];
    if (!candidates.length) continue;
    // Missing mode is a legacy active shortlist. New shortlist editing writes
    // `prepared` until the user explicitly chooses a Shortlist mode.
    out[slot] = { candidates, direction: Number(configRaw.direction) < 0 ? -1 : 1, mode: configRaw.mode === "prepared" ? "prepared" : "shortlist" };
  }
  return out;
}

function migrateCastAuditions(raw, renames) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const rename = (handle) => {
    const clean = String(handle || "").trim().replace(/^@/, "");
    const hit = renames.find(([oldHandle]) => oldHandle === clean);
    return hit ? hit[1] : normalizeSubjectHandle(clean || "character");
  };
  const out = {};
  for (const [roleRaw, configRaw] of Object.entries(source)) {
    if (!configRaw || typeof configRaw !== "object" || Array.isArray(configRaw)) continue;
    const role = rename(roleRaw);
    const candidates = [...new Set((Array.isArray(configRaw.candidates) ? configRaw.candidates : []).map(rename).filter((handle) => handle && handle !== role))];
    if (!candidates.length) continue;
    out[role] = { candidates, direction: Number(configRaw.direction) < 0 ? -1 : 1 };
  }
  return out;
}
function migrateRefinedBlock(refined, renames) {
  if (!refined || typeof refined !== "object" || Array.isArray(refined)) return refined;
  const out = { ...refined };
  if (typeof out.body === "string") out.body = migrateSubjectMentions(out.body, renames);
  if (out.sections && typeof out.sections === "object" && !Array.isArray(out.sections)) {
    out.sections = Object.fromEntries(Object.entries(out.sections).map(([k, v]) => [k, typeof v === "string" ? migrateSubjectMentions(v, renames) : v]));
  }
  return out;
}

export function normalizeLora(entry) {
  const e = object(entry);
  const modes = array(e.modes).filter((m) => CHECKPOINTS.includes(m));
  return {
    name: String(e.name || ""),
    strength: clampNum(e.strength, -2, 2, 1),
    enabled: e.enabled !== false,
    triggers: array(e.triggers).map(String).map((x) => x.trim()).filter(Boolean),
    modes,
  };
}
export function normalizeFace(raw) {
  const f = { ...DEFAULT_FACE(), ...object(raw) };
  f.on = f.on === true;
  f.canvas = snap(clampNum(f.canvas, 384, 768, 512));
  f.denoise = clampNum(f.denoise, 0.1, 0.9, 0.45);
  return f;
}
export function normalizeTurbo(raw) {
  const t = { ...DEFAULT_TURBO(), ...object(raw) };
  t.lora = String(t.lora || "").trim();
  t.merged = t.merged === true;
  t.quality = TURBO_QUALITIES.includes(t.quality) ? t.quality : "medium";
  t.on = t.on === true;
  t.saved = t.saved && typeof t.saved === "object" ? { ...t.saved } : null;
  return t;
}
export function normalizeArchiveStitch(raw) {
  const value={...DEFAULT_ARCHIVE_STITCH(),...object(raw)};
  value.enabled=value.enabled===true;
  value.folder=String(value.folder||"h3_context").trim()||"h3_context";
  value.pattern=String(value.pattern||"clip_*.safetensors").trim()||"clip_*.safetensors";
  value.first_clip=Math.max(1,Math.trunc(Number(value.first_clip)||1));
  value.last_clip=Math.max(0,Math.trunc(Number(value.last_clip)||0));
  const context=Math.trunc(Number(value.context_length)||22);value.context_length=[5,22,39,56].includes(context)?context:22;
  value.fps=Math.min(240,Math.max(1,Number(value.fps)||24));
  return value;
}
export function normalizeAsset(a) {
  const out = { ...object(a) };
  out.handle = String(out.handle || "").trim();
  out.kind = ["image", "video", "audio"].includes(out.kind) ? out.kind : "image";
  out.role = ["reference", "first_frame", "last_frame"].includes(out.role) ? out.role : "reference";
  out.filename = String(out.filename || "");
  if(out.library_ref_id)out.library_ref_id=String(out.library_ref_id).trim().slice(0,96);else delete out.library_ref_id;
  if(out.reference_name)out.reference_name=String(out.reference_name).trim().slice(0,160);
  if(out.subject_role)out.subject_role=["reference","face","body","appearance","style"].includes(out.subject_role)?out.subject_role:"reference";
  if(out.notes!=null)out.notes=String(out.notes).slice(0,2000);
  if(out.strength!=null)out.strength=clampNum(out.strength,0,2,1);
  out.global_active=out.global_active===true;
  if (out.kind === "video") out.track = ["picture", "picture+sound", "sound"].includes(out.track) ? out.track : "picture";
  if (out.trim && out.kind !== "image") {
    const s = Number(out.trim.start), e = Number(out.trim.end);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) out.trim = { start: Math.max(0, s), end: Math.max(0, e) };
    else delete out.trim;
  }
  return out;
}

// ----- v3.12 durable authoring-state normalization -------------------------
// These helpers only normalize Creator-side authoring metadata. They preserve
// unknown keys so future Director/pack versions can round-trip through an older
// frontend without losing data.
export function normalizeScenePalette(raw) {
  const source = object(raw), out = {};
  for (const [slot, presetRaw] of Object.entries(source)) {
    if (!presetRaw || typeof presetRaw !== "object" || Array.isArray(presetRaw)) continue;
    const preset = { ...presetRaw };
    for (const key of ["id", "title", "prompt", "note", "visual", "subcategory", "category"]) {
      if (key in preset) preset[key] = String(preset[key] ?? "");
    }
    out[String(slot)] = preset;
  }
  return out;
}

function normalizeDirectorBeat(raw, index = 0) {
  const beat = { ...object(raw) };
  beat.id = String(beat.id || `beat_${index + 1}`);
  const t = Number(beat.t); beat.t = Number.isFinite(t) ? t : 0;
  beat.type = String(beat.type || "action");
  if ("text" in beat) beat.text = String(beat.text ?? "");
  if ("speaker" in beat) beat.speaker = String(beat.speaker ?? "").replace(/^@/, "");
  if ("language" in beat) beat.language = String(beat.language ?? "English") || "English";
  if ("lora" in beat) beat.lora = String(beat.lora ?? "");
  return beat;
}
function normalizeDirectorCameraPoint(raw, index = 0) {
  const point = { ...object(raw) };
  point.id = String(point.id || `cam_${index + 1}`);
  for (const [key, fallback] of [["t", 0], ["x", .5], ["y", .5]]) {
    const value = Number(point[key]); point[key] = Number.isFinite(value) ? value : fallback;
  }
  for (const key of ["framing", "move", "amplitude", "speed"]) if (key in point) point[key] = String(point[key] ?? "");
  return point;
}
function normalizeDirectorTimeline(raw) {
  const timeline = { ...object(raw) }, media = {};
  for (const [handleRaw, placementRaw] of Object.entries(object(timeline.media))) {
    const handle = String(handleRaw || "").replace(/^@/, "").trim(); if (!handle) continue;
    const placement = { ...object(placementRaw) };
    for (const key of ["start", "end", "source_in", "source_out", "source_duration"]) {
      if (!(key in placement)) continue; const value = Number(placement[key]); if (Number.isFinite(value)) placement[key] = value; else delete placement[key];
    }
    if ("track" in placement) placement.track = String(placement.track ?? "");
    if ("pin" in placement) placement.pin = placement.pin === true;
    media[handle] = placement;
  }
  timeline.media = media;
  return timeline;
}
export function normalizeDirector(raw) {
  const director = { ...object(raw) };
  director.mode_intent = ["auto", "T2VA", "I2VA", "L2VA", "FL2VA", "REF2VA"].includes(director.mode_intent) ? director.mode_intent : "auto";
  director.beats = array(director.beats).map(normalizeDirectorBeat);
  director.camera_points = array(director.camera_points).map(normalizeDirectorCameraPoint);
  director.camera_settings = { stabilization: "auto", lens: "", depth: "", focus: "", custom: "", ...object(director.camera_settings) };
  director.edit = { type: "none", target: "", change: "", protect_identity: true, protect_camera: true, protect_audio: true, protect_background: true, ...object(director.edit) };
  director.timeline = normalizeDirectorTimeline(director.timeline);
  if ("environment_id" in director) director.environment_id = String(director.environment_id ?? "");
  return director;
}
export function normalizeDirectorEnvironments(raw) {
  return array(raw).filter((row) => row && typeof row === "object" && !Array.isArray(row)).map((rawEnv, index) => {
    const env = { ...rawEnv };
    env.id = String(env.id || `environment_${index + 1}`);
    env.name = String(env.name || `Environment ${index + 1}`);
    env.handles = [...new Set(array(env.handles).map((value) => String(value || "").replace(/^@/, "").trim()).filter(Boolean))];
    return env;
  });
}
export function normalizeThumbnailOverrides(raw) {
  const source = object(raw), out = { ...source };
  if (source.scene && typeof source.scene === "object" && !Array.isArray(source.scene)) out.scene = { ...source.scene };
  return out;
}

export function normalizeSegment(raw) {
  const s = { ...DEFAULT_SEGMENT(), ...object(raw) };
  if (s.kind === "clip") {
    s.filename = String(s.filename || "");
    s.duration_s = Math.max(0.01, Number(s.duration_s) || 0.01);
    s.sound = s.sound !== false;
    s.continue = s.continue === true;
    s.continue_audio = s.continue_audio === true;
    return s;
  }
  s.prompt = String(s.prompt || "");
  s.assets = array(s.assets).map(normalizeAsset);
  s.loras = array(s.loras).map(normalizeLora).filter((x) => x.name);
  s.duration_s = clampNum(s.duration_s, 0.2, 120, DEFAULT_DURATION_S);
  s.checkpoint = ["auto", ...CHECKPOINTS].includes(s.checkpoint) ? s.checkpoint : "auto";
  s.continue = s.continue === true;
  s.continue_audio = s.continue_audio === true;
  s.merge = s.merge === true;
  s.hold = s.hold === true;
  if (!["on", "off"].includes(s.face)) delete s.face;
  if (s.seed !== undefined && s.seed !== null && s.seed !== "") {
    const seed = Number(s.seed);
    if (Number.isInteger(seed) && seed >= 0) s.seed = seed; else delete s.seed;
  }
  s.scene_palette = normalizeScenePalette(s.scene_palette);
  if (s.director && typeof s.director === "object" && !Array.isArray(s.director)) s.director = normalizeDirector(s.director);
  if ("director_prompt" in s) s.director_prompt = String(s.director_prompt || "");
  return s;
}
export function normalizeData(raw) {
  const base = defaultData();
  const data = { ...base, ...object(raw) };
  data.version = 3;
  data._revision = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(Number(data._revision) || 0)));
  data.prompt = String(data.prompt || "");
  data.h3_auto_format = data.h3_auto_format === true;
  data.aspect = typeof data.aspect === "string" ? data.aspect : "16:9";
  data.aspect_source = typeof data.aspect_source === "string" ? data.aspect_source : "pill";
  data.short_edge = snap(clampNum(data.short_edge, MIN_SHORT_EDGE, MAX_SHORT_EDGE, NATIVE_SHORT_EDGE));
  data.upscale = UPSCALE_MODES.includes(data.upscale) ? data.upscale : "two_pass";
  // Mirror compile.first_pass_edge exactly. A saved sampler edge above the
  // target used to remain visible even though the backend silently clamped it,
  // making the Settings panel report a value the queue never used.
  data.sample_edge = snap(clampNum(data.sample_edge, MIN_SHORT_EDGE, Math.min(data.short_edge, NATIVE_SHORT_EDGE), Math.min(data.short_edge, NATIVE_SHORT_EDGE)));
  data.refine_denoise = clampNum(data.refine_denoise, 0.1, 0.9, 0.5);
  data.face = normalizeFace(data.face);
  data.audio_tail_s = clampNum(data.audio_tail_s, 0, 4, 1);
  data.output_prefix = String(data.output_prefix || VIDEO_PREFIX);
  data.models = object(data.models);
  data.turbo = normalizeTurbo(data.turbo);
  data.archive_stitch = normalizeArchiveStitch(data.archive_stitch);
  data.assets = array(data.assets).map(normalizeAsset);
  const subjectRenames = [];
  const usedSubjectHandles = new Set();
  const usedSubjectRecordIds = new Set();
  const seenOriginalHandles = new Set();
  data.subjects = array(data.subjects).filter((x) => x && typeof x === "object").map((subject, index) => {
    const oldHandle = String(subject.handle || "").trim().replace(/^@/, "");
    let handle = normalizeSubjectHandle(oldHandle, `Character_${index + 1}`);
    const baseHandle = handle;
    let suffix = 2;
    while (usedSubjectHandles.has(handle.toLowerCase())) {
      const tail = `_${suffix++}`;
      handle = `${baseHandle.slice(0, Math.max(1, SUBJECT_HANDLE_MAX - tail.length))}${tail}`;
    }
    usedSubjectHandles.add(handle.toLowerCase());
    // Stable workflow identity is intentionally separate from @handle. A handle
    // is editable prompt syntax; record_id is what lets old workflows survive
    // renames, deleted packs and library merges without cloning a character.
    const seed = `${String(subject.preset_id || "")}|${oldHandle || handle}|${index}`;
    let record_id = normalizeSubjectRecordId(subject.record_id || subject.subject_id || "", seed);
    const baseRecordId = record_id;
    let recordSuffix = 2;
    while (usedSubjectRecordIds.has(record_id)) {
      const tail = `_${recordSuffix++}`;
      record_id = `${baseRecordId.slice(0, Math.max(1, SUBJECT_RECORD_ID_MAX - tail.length))}${tail}`;
    }
    usedSubjectRecordIds.add(record_id);
    // When an old workflow contains duplicate handles, existing @mentions
    // belong to the first definition. Renaming the duplicate must not silently
    // redirect every mention to the newly suffixed copy.
    if (!seenOriginalHandles.has(oldHandle)) {
      seenOriginalHandles.add(oldHandle);
      subjectRenames.push([oldHandle, handle]);
    }
    const normalized = { ...subject, handle, record_id };
    delete normalized.subject_id;
    return normalized;
  });
  subjectRenames.sort((a, b) => b[0].length - a[0].length);
  data.prompt = migrateSubjectMentions(data.prompt, subjectRenames);
  data.scene_palette = normalizeScenePalette(data.scene_palette);
  data.director_environments = normalizeDirectorEnvironments(data.director_environments);
  data.thumbnail_overrides = normalizeThumbnailOverrides(data.thumbnail_overrides);
  data.cast_auditions = migrateCastAuditions(data.cast_auditions, subjectRenames);
  data.scene_auditions = normalizeSceneAuditions(data.scene_auditions, data.scene_palette);
  if (data.refined) data.refined = migrateRefinedBlock(data.refined, subjectRenames);
  data.loras = array(data.loras).map(normalizeLora).filter((x) => x.name);
  data.segments = array(data.segments).length ? data.segments.map(normalizeSegment) : [DEFAULT_SEGMENT()];
  for (const segment of data.segments) {
    if (typeof segment.prompt === "string") segment.prompt = migrateSubjectMentions(segment.prompt, subjectRenames);
    segment.cast_auditions = migrateCastAuditions(segment.cast_auditions, subjectRenames);
    segment.scene_auditions = normalizeSceneAuditions(segment.scene_auditions, segment.scene_palette);
    if (typeof segment.soundscape === "string") segment.soundscape = migrateSubjectMentions(segment.soundscape, subjectRenames);
    if (typeof segment.music === "string") segment.music = migrateSubjectMentions(segment.music, subjectRenames);
    if (segment.refined) segment.refined = migrateRefinedBlock(segment.refined, subjectRenames);
  }
  if (data.segments[0]) { data.segments[0].merge = false; data.segments[0].continue = false; data.segments[0].continue_audio = false; }
  return data;
}
export function parseData(value) {
  try { return normalizeData(JSON.parse(String(value || "{}"))); }
  catch { return defaultData(); }
}
export function serializeData(data) { return JSON.stringify(normalizeData(data)); }

export function activePrompt(data, target) {
  return target === "global" ? String(data.prompt || "") : String(data.segments[target]?.prompt || "");
}
export function setActivePrompt(data, target, value) {
  if (target === "global") data.prompt = String(value ?? "");
  else if (data.segments[target] && data.segments[target].kind !== "clip") data.segments[target].prompt = String(value ?? "");
}
export function activeContainer(data, target) { return target === "global" ? data : data.segments[target]; }
export function activeAssetList(data, target) { return target === "global" ? data.assets : (data.segments[target]?.assets || []); }
export function activeLoraList(data, target) { return target === "global" ? data.loras : (data.segments[target]?.loras || []); }
export function allAssets(data, target) {
  const pool = array(data.assets);
  const own = target === "global" ? [] : array(data.segments[target]?.assets);
  return [...pool, ...own];
}
export function allKnownAssets(data) {
  return [...array(data.assets), ...array(data.segments).flatMap((s) => array(s.assets))];
}
export function makeHandle(kind, data) {
  const prefix = { image: "img", video: "vid", audio: "aud" }[kind] || "ref";
  const used = new Set(allKnownAssets(data).map((a) => a?.handle).filter(Boolean));
  let n = 1; while (used.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}
export function createAsset(kind, filename, data, role = "reference") {
  const out = { handle: makeHandle(kind, data), kind, role, filename };
  if (kind === "video") out.track = "picture";
  return out;
}
export function cloneSegment(seg) {
  const c = structuredClone(seg || DEFAULT_SEGMENT());
  // New shots inherit the current scene as an editable starting point: prompt,
  // scene tokens, references, LoRAs, duration and routing. Only render history
  // and seam bookkeeping are new-shot state.
  delete c.refined; delete c.take; delete c.hold; delete c.card_no; delete c.seed;
  c.merge = false; c.continue = false; c.continue_audio = false; delete c.continue_from;
  return normalizeSegment(c);
}
export function duplicateSegment(seg) {
  const c = structuredClone(seg || DEFAULT_SEGMENT());
  delete c.take; delete c.hold; delete c.card_no;
  return normalizeSegment(c);
}
export function durationFrames(seconds) {
  const raw = Math.max(1, Math.round(Number(seconds || DEFAULT_DURATION_S) * FPS));
  const k = Math.max(0, Math.round((raw - 5) / 17));
  return 17 * k + 5;
}
export function actualSeconds(seconds) { return durationFrames(seconds) / FPS; }
export function aspectDimensions(aspect, shortEdge) {
  const m = String(aspect || "16:9").match(/([0-9.]+)\s*:\s*([0-9.]+)/);
  let w = 16, h = 9; if (m) { w = Number(m[1]); h = Number(m[2]); }
  const s = snap(clampNum(shortEdge, MIN_SHORT_EDGE, MAX_SHORT_EDGE, NATIVE_SHORT_EDGE));
  let width, height;
  if (w >= h) { height = s; width = s * w / h; } else { width = s; height = s * h / w; }
  return { width: snap(width), height: snap(height) };
}
export function scopeKind(asset) { return asset?.kind === "audio" || asset?.track === "sound" ? "audio" : asset?.kind; }
export function scopeOptions(asset) {
  if (scopeKind(asset) === "audio") return AUDIO_TAKES;
  if (asset?.kind === "image") return IMAGE_TAKES;
  return VIDEO_TAKES;
}
export function loraModes(entry) {
  const m = array(entry?.modes).filter((x) => CHECKPOINTS.includes(x));
  return m.length ? m : CHECKPOINTS;
}
export function loraModeLabel(entry) {
  const m = loraModes(entry); return m.length === 2 ? "Both" : m[0].toUpperCase();
}
export function findLora(container, name) { return array(container?.loras).find((e) => e.name === name) || null; }
export function addLora(container, name, triggers = []) {
  if (!name) return null;
  container.loras ||= [];
  let entry = findLora(container, name);
  if (entry) { entry.enabled = true; return entry; }
  entry = normalizeLora({ name, strength: 1, enabled: true, triggers });
  container.loras.push(entry); return entry;
}
export function removeLora(container, name) {
  if (!Array.isArray(container?.loras)) return;
  const i = container.loras.findIndex((e) => e.name === name);
  if (i >= 0) container.loras.splice(i, 1);
}
export function isLikelyTurboAdapter(name) {
  return /(?:turbo|distill|lightx2v)/i.test(String(name || ""));
}
export function turboAdapterState(data, target="global") {
  const turbo=data?.turbo||DEFAULT_TURBO(),configuredName=String(turbo.lora||"").trim();
  const containers=[data];
  if(target!=="global"&&data?.segments?.[Number(target)])containers.push(data.segments[Number(target)]);
  const entries=containers.flatMap((container)=>array(container?.loras));
  const active=(entry)=>entry&&entry.enabled!==false&&Number(entry.strength??1)!==0;
  const configuredEntry=configuredName?entries.find((entry)=>entry?.name===configuredName&&active(entry)):null;
  const detectedEntry=entries.find((entry)=>active(entry)&&isLikelyTurboAdapter(entry?.name));
  return {configuredName,detectedName:String(detectedEntry?.name||""),name:configuredName||String(detectedEntry?.name||""),configured:!!configuredName,active:!!configuredEntry||(!configuredName&&!!detectedEntry),source:configuredName?"configured":detectedEntry?"active_stack":"none"};
}
export function turboPreset(name) {
  return /(?:4step[_ -]?v1(?:\.0)?|v1(?:\.0)?[_ -]?768p)/i.test(name || "") ? { strength: 1, shift_video: 6, shift_audio: 3, recipe: "lightx2v-v1" }
    : /lightx2v/i.test(name || "") ? { strength: 0.6, shift_video: 6, shift_audio: 3, recipe: "lightx2v-legacy" }
    : { strength: 1, shift_video: 12, shift_audio: 3 };
}
export function faceOn(data, seg) {
  if (!data.face?.on) return false;
  if (seg?.face === "off") return false;
  return true;
}
export function isClip(seg) { return seg?.kind === "clip"; }
export function isHeld(seg) { return !isClip(seg) && seg?.hold === true; }
export function takeOn(seg) { return seg?.take && String(seg.take.filename || "").trim() ? seg.take : null; }
export function isKept(seg) { return isHeld(seg) && !!takeOn(seg); }
export function attachTakes(data, reports) {
  let landed = false;
  for (const report of reports || []) {
    const i = Number(report.segment) - 1;
    const seg = data.segments?.[i];
    if (!seg || isClip(seg)) continue;
    seg.take = {
      filename: [report.subfolder, report.filename].filter(Boolean).join("/") + (report.type === "output" ? " [output]" : ""),
      duration_s: Number(report.duration_s || seg.duration_s || DEFAULT_DURATION_S),
      has_audio: report.has_audio !== false,
      width: Number(report.width || 0) || undefined,
      height: Number(report.height || 0) || undefined,
    };
    if (report.seed !== undefined && report.seed !== null) seg.seed = Number(report.seed);
    landed = true;
  }
  return landed;
}

// ----- durable workflow state + explicit subject removal -------------------
function escapeRegex(value) { return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
export function stripSubjectMention(text, handle) {
  const cleanHandle = normalizeSubjectHandle(handle || "character");
  const re = new RegExp(`@${escapeRegex(cleanHandle)}(?!-[0-9])(?![A-Za-z0-9_])`, "g");
  return String(text ?? "")
    .replace(re, "")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function stripFromRefined(refined, handle) {
  if (!refined || typeof refined !== "object" || Array.isArray(refined)) return refined;
  const out = { ...refined };
  if (typeof out.body === "string") out.body = stripSubjectMention(out.body, handle);
  if (out.sections && typeof out.sections === "object" && !Array.isArray(out.sections)) {
    out.sections = Object.fromEntries(Object.entries(out.sections).map(([key, value]) => [key, typeof value === "string" ? stripSubjectMention(value, handle) : value]));
  }
  return out;
}
export function removeSubject(data, handleOrSubject) {
  const handle = normalizeSubjectHandle(typeof handleOrSubject === "string" ? handleOrSubject : handleOrSubject?.handle || "character");
  data.subjects = array(data.subjects).filter((subject) => subject?.handle !== handle);
  data.prompt = stripSubjectMention(data.prompt, handle);
  if (typeof data.soundscape === "string") data.soundscape = stripSubjectMention(data.soundscape, handle);
  if (typeof data.music === "string") data.music = stripSubjectMention(data.music, handle);
  if (data.refined) data.refined = stripFromRefined(data.refined, handle);
  const cleanAuditions = (container) => {
    if (!container?.cast_auditions || typeof container.cast_auditions !== "object") return;
    const next = {};
    for (const [role, config] of Object.entries(container.cast_auditions)) {
      if (String(role) === handle || !config || typeof config !== "object") continue;
      const candidates = array(config.candidates).map((value) => String(value || "").replace(/^@/, "")).filter((value) => value && value !== handle && value !== role);
      if (candidates.length) next[role] = { ...config, candidates };
    }
    container.cast_auditions = next;
  };
  cleanAuditions(data);
  for (const segment of array(data.segments)) {
    if (typeof segment.prompt === "string") segment.prompt = stripSubjectMention(segment.prompt, handle);
    if (typeof segment.soundscape === "string") segment.soundscape = stripSubjectMention(segment.soundscape, handle);
    if (typeof segment.music === "string") segment.music = stripSubjectMention(segment.music, handle);
    if (segment.refined) segment.refined = stripFromRefined(segment.refined, handle);
    cleanAuditions(segment);
  }
  return data;
}

export function dataRichness(raw) {
  const data = normalizeData(raw);
  let score = 0;
  score += String(data.prompt || "").trim().length;
  score += Object.keys(object(data.models)).filter((key) => key !== "devices" && data.models[key]).length * 30;
  score += Object.keys(object(data.models?.devices)).length * 8;
  score += array(data.subjects).length * 50;
  score += array(data.assets).length * 35;
  score += array(data.loras).length * 25;
  score += Math.max(0, array(data.segments).length - 1) * 20;
  for (const segment of array(data.segments)) {
    score += String(segment.prompt || "").trim().length;
    score += String(segment.director_prompt || "").trim().length;
    score += array(segment.assets).length * 35;
    score += array(segment.loras).length * 25;
    score += Object.keys(object(segment.scene_palette)).length * 18;
    const director = object(segment.director);
    score += array(director.beats).length * 20;
    score += array(director.camera_points).length * 18;
    score += Object.keys(object(director.timeline?.media)).length * 16;
    if (String(director.environment_id || "").trim()) score += 12;
    if (String(director.edit?.type || "none") !== "none") score += 22;
  }
  score += Object.keys(object(data.scene_palette)).length * 18;
  score += array(data.director_environments).length * 22;
  score += Object.keys(object(data.thumbnail_overrides?.scene)).length * 8;
  return score;
}

function stripLiteralMention(text, handle) {
  const cleanHandle = String(handle ?? "").trim().replace(/^@/, "");
  if (!cleanHandle) return String(text ?? "");
  const re = new RegExp(`@${escapeRegex(cleanHandle)}(?![A-Za-z0-9_-])`, "g");
  return String(text ?? "")
    .replace(re, "")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function stripLiteralFromRefined(refined, handle) {
  if (!refined || typeof refined !== "object" || Array.isArray(refined)) return refined;
  const out = { ...refined };
  if (typeof out.body === "string") out.body = stripLiteralMention(out.body, handle);
  if (out.sections && typeof out.sections === "object" && !Array.isArray(out.sections)) {
    out.sections = Object.fromEntries(Object.entries(out.sections).map(([key, value]) => [key, typeof value === "string" ? stripLiteralMention(value, handle) : value]));
  }
  return out;
}
export function removeAsset(data, assetOrHandle) {
  const handle = String(typeof assetOrHandle === "string" ? assetOrHandle : assetOrHandle?.handle || "").trim().replace(/^@/, "");
  if (!handle) return data;
  data.assets = array(data.assets).filter((asset) => asset?.handle !== handle && asset !== assetOrHandle);
  // A reference can also be part of a Cast definition. Removing the card must
  // detach it there too or the next queue would retain an invisible stale
  // @handle and fail in the subject compiler. If a custom subject had no
  // description or other identity source at all, remove that now-unanchored
  // subject (and its prompt mentions) instead of leaving a broken Cast entry.
  const orphanedSubjects = [];
  for (const subject of array(data.subjects)) {
    subject.from = array(subject.from).filter((value) => String(value || "").trim().replace(/^@/, "") !== handle);
    for (const key of ["motion", "voice", "replaces"]) {
      if (String(subject[key] || "").trim().replace(/^@/, "") === handle) delete subject[key];
    }
    if (!subject.from.length && !subject.motion && !subject.replaces && !String(subject.description || "").trim()) orphanedSubjects.push(subject.handle);
  }
  data.prompt = stripLiteralMention(data.prompt, handle);
  if (typeof data.soundscape === "string") data.soundscape = stripLiteralMention(data.soundscape, handle);
  if (typeof data.music === "string") data.music = stripLiteralMention(data.music, handle);
  if (data.refined) data.refined = stripLiteralFromRefined(data.refined, handle);
  for (const segment of array(data.segments)) {
    if (Array.isArray(segment.assets)) segment.assets = segment.assets.filter((asset) => asset?.handle !== handle && asset !== assetOrHandle);
    if (typeof segment.prompt === "string") segment.prompt = stripLiteralMention(segment.prompt, handle);
    if (typeof segment.soundscape === "string") segment.soundscape = stripLiteralMention(segment.soundscape, handle);
    if (typeof segment.music === "string") segment.music = stripLiteralMention(segment.music, handle);
    if (segment.refined) segment.refined = stripLiteralFromRefined(segment.refined, handle);
    if (segment.continue_from === handle) delete segment.continue_from;
  }
  for (const subjectHandle of orphanedSubjects) removeSubject(data, subjectHandle);
  return data;
}
