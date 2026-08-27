// Exact frontend mirror of canvas.py for MiniMax H3 generation canvases.
// Keep this pure so resolution labels, status readouts and Inspector all agree
// with the backend sampler/refine targets.

export const CANVAS_MULTIPLE = 32;
export const NATIVE_SHORT_EDGE = 768;
export const NATIVE_MAX_PIXELS = 768 * 1344;
export const MIN_SHORT_EDGE = 384;
export const MAX_SHORT_EDGE = 2048;
export const VIDEO_MAX_SHORT_EDGE = 896;
export const VIDEO_RESOLUTION_EDGES = Object.freeze([384, 512, 640, 704, 768, 832, 896]);
export const MIN_RATIO = 9 / 16;
export const MAX_RATIO = 21 / 9;

export const ASPECT_PRESETS = {
  "21:9": 21 / 9,
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "1:1": 1,
  "3:4": 3 / 4,
  "9:16": 9 / 16,
};

const snap = (value) => Math.max(CANVAS_MULTIPLE, Math.floor(Number(value) / CANVAS_MULTIPLE + 0.5) * CANVAS_MULTIPLE);

export function ratioForAspect(aspect) {
  if (ASPECT_PRESETS[aspect]) return ASPECT_PRESETS[aspect];
  const match = String(aspect || "16:9").match(/([0-9.]+)\s*:\s*([0-9.]+)/);
  if (!match) return ASPECT_PRESETS["16:9"];
  const a = Number(match[1]), b = Number(match[2]);
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : ASPECT_PRESETS["16:9"];
}

export function clampRatio(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return ASPECT_PRESETS["16:9"];
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

export function resolveH3Canvas(aspectOrRatio, shortEdge) {
  const rawRatio = typeof aspectOrRatio === "number" ? aspectOrRatio : ratioForAspect(aspectOrRatio);
  const ratio = clampRatio(rawRatio);
  const edge = Math.max(MIN_SHORT_EDGE, Math.min(MAX_SHORT_EDGE, Math.trunc(Number(shortEdge) || NATIVE_SHORT_EDGE)));
  const maxPixels = NATIVE_MAX_PIXELS * Math.pow(edge / NATIVE_SHORT_EDGE, 2);
  let width, height;
  if (ratio >= 1) {
    width = edge * ratio;
    height = edge;
  } else {
    width = edge;
    height = edge / ratio;
  }
  if (width * height > maxPixels) {
    const scale = Math.sqrt(maxPixels / (width * height));
    width *= scale;
    height *= scale;
  }
  width = snap(width);
  height = snap(height);
  while (width * height > maxPixels && Math.max(width, height) > CANVAS_MULTIPLE) {
    if (width >= height) width -= CANVAS_MULTIPLE;
    else height -= CANVAS_MULTIPLE;
  }
  return { width, height, ratio, shortEdge: edge, maxPixels };
}

export function normalizeVideoTargetEdge(value) {
  const raw = Number(value);
  const edge = Number.isFinite(raw) ? raw : NATIVE_SHORT_EDGE;
  return snap(Math.max(MIN_SHORT_EDGE, Math.min(VIDEO_MAX_SHORT_EDGE, edge)));
}

export function firstPassEdge(sampleEdge, targetEdge) {
  const target = normalizeVideoTargetEdge(targetEdge);
  const ceiling = Math.min(target, NATIVE_SHORT_EDGE);
  const raw = Number(sampleEdge);
  const edge = Number.isFinite(raw) ? raw : ceiling;
  return snap(Math.max(MIN_SHORT_EDGE, Math.min(ceiling, edge)));
}

export function videoResolutionOptions(aspect, current) {
  const values = [...VIDEO_RESOLUTION_EDGES];
  const custom = normalizeVideoTargetEdge(current);
  if (!values.includes(custom)) values.push(custom);
  values.sort((a, b) => a - b);
  const labels = {384:"Draft",512:"Fast",640:"Balanced",704:"High",768:"Standard",832:"Large",896:"Maximum"};
  return values.map((edge) => {
    const resolved = resolveH3Canvas(aspect, edge);
    const mp=resolved.width*resolved.height/1_000_000,mpText=mp>=.95&&mp<1.1?"1.0 MP":`${mp.toFixed(mp<1?2:1)} MP`,native=edge===NATIVE_SHORT_EDGE;
    return [String(edge), `${labels[edge]||"Custom"} (${mpText}) · ${resolved.width}×${resolved.height} · ${native?"H3 native (768px)":`${edge}px short edge${edge>NATIVE_SHORT_EDGE?" · above native":""}`}${native?" · recommended":""}`];
  });
}

export function firstPassResolutionOptions(aspect, targetEdge, current) {
  const target = normalizeVideoTargetEdge(targetEdge);
  const ceiling = Math.min(target, NATIVE_SHORT_EDGE);
  const values = VIDEO_RESOLUTION_EDGES.filter((edge) => edge <= ceiling);
  const custom = firstPassEdge(current, target);
  if (!values.includes(custom)) values.push(custom);
  values.sort((a, b) => a - b);
  const labels = {384: "very low VRAM", 512: "fast", 640: "balanced", 704: "high", 768: "native"};
  return values.map((edge) => {
    const resolved = resolveH3Canvas(aspect, edge);
    return [String(edge), `${resolved.width}×${resolved.height} · ${labels[edge] || `${edge}px`}`];
  });
}

export function describeH3Resolution(aspect, targetEdge, {upscale="two_pass", sampleEdge=NATIVE_SHORT_EDGE}={}) {
  const normalizedTarget = normalizeVideoTargetEdge(targetEdge);
  const target = resolveH3Canvas(aspect, normalizedTarget);
  const normalizedFirst = firstPassEdge(sampleEdge, normalizedTarget);
  const firstEdge = upscale === "two_pass" && normalizedFirst < normalizedTarget ? normalizedFirst : normalizedTarget;
  const first = resolveH3Canvas(target.ratio, firstEdge);
  const twoPass = first.width !== target.width || first.height !== target.height;
  return { target, first, twoPass };
}
