import * as S from "./z3_h3_state.js";
import { describeH3Resolution, resolveH3Canvas } from "./h3_canvas.js";

// Exact target rows from current ComfyUI H3 packing. Text, keyframe and
// reference rows are reported as an unknown add-on instead of being guessed.
export const AUDIO_LATENT_FPS = 40;
export const NATIVE_BASELINE_SECONDS = 6;
export const NATIVE_BASELINE_STEPS = 20;

export function videoLatentFrames(frames) {
  const n = Math.max(5, Math.trunc(Number(frames) || 5));
  return n <= 5 ? 2 : Math.trunc((n - 5) / 17) * 5 + 2;
}

export function targetRows(width, height, frames) {
  const f = Math.max(5, Math.trunc(Number(frames) || 5));
  const video = videoLatentFrames(f) * Math.trunc(Number(width) / 32) * Math.trunc(Number(height) / 32);
  const audioFrames = Math.round((f / S.FPS) * AUDIO_LATENT_FPS);
  const audio = audioFrames * 2;
  return { video, audio, total: video + audio, videoLatentFrames: videoLatentFrames(f), audioLatentFrames: audioFrames };
}

function generatedRuns(data) {
  const rows = Array.isArray(data?.segments) ? data.segments : [];
  const playable = (row) => row?.kind !== "clip" && !(row?.hold === true && row?.take?.filename);
  if (data?.render === "single") {
    const selected = rows.filter(playable);
    return selected.length ? [selected] : [];
  }
  const runs = [];
  for (const row of rows) {
    if (!playable(row)) continue;
    if (row?.merge && runs.length) runs[runs.length - 1].push(row);
    else runs.push([row]);
  }
  return runs;
}

function runFrames(run) {
  const seconds = run.reduce((sum, row) => sum + Math.max(0, Number(row?.duration_s || S.DEFAULT_DURATION_S)), 0);
  return S.durationFrames(seconds);
}

const attentionUnits = (rows, steps) => Number(rows) * Number(rows) * Math.max(0, Number(steps));

export function planH3Workload(data, widgets = {}) {
  if (data?.archive_stitch?.enabled) return { bypass: true, runs: [], attentionRatio: 0, targetRows: 0, scheduledEvaluations: 0 };
  const steps = Math.max(1, Math.trunc(Number(widgets.steps) || 20));
  const resolution = describeH3Resolution(data?.aspect || "16:9", data?.short_edge || 768, {
    upscale: data?.upscale || "two_pass", sampleEdge: data?.sample_edge || 768,
  });
  const runs = generatedRuns(data).map((run, index) => {
    const frames = runFrames(run);
    const first = targetRows(resolution.first.width, resolution.first.height, frames);
    const target = targetRows(resolution.target.width, resolution.target.height, frames);
    const refineFraction = resolution.twoPass ? Math.max(0.01, Math.min(0.99, Number(data?.refine_denoise ?? .5))) : 0;
    const faceEnabled = data?.face?.on === true && !run.every((row) => row?.face === "off");
    const faceCanvas = faceEnabled ? resolveH3Canvas("1:1", Number(data?.face?.canvas || 512)) : null;
    const faceRows = faceCanvas ? targetRows(faceCanvas.width, faceCanvas.height, frames) : null;
    const faceFraction = faceEnabled ? Math.max(.01, Math.min(.99, Number(data?.face?.denoise ?? .45))) : 0;
    const scheduledEvaluations = steps * (1 + refineFraction + faceFraction);
    const units = attentionUnits(first.total, steps)
      + (resolution.twoPass ? attentionUnits(target.total, steps * refineFraction) : 0)
      + (faceRows ? attentionUnits(faceRows.total, steps * faceFraction) : 0);
    return { index, cards: run.length, frames, seconds: frames / S.FPS, first, target, faceRows, refineFraction, faceEnabled, scheduledEvaluations, units };
  });
  const baselineCanvas = resolveH3Canvas("16:9", 768);
  const baselineFrames = S.durationFrames(NATIVE_BASELINE_SECONDS);
  const baselineRows = targetRows(baselineCanvas.width, baselineCanvas.height, baselineFrames).total;
  const baselineUnits = attentionUnits(baselineRows, NATIVE_BASELINE_STEPS);
  const units = runs.reduce((sum, run) => sum + run.units, 0);
  return {
    bypass: false, runs, resolution, steps,
    targetRows: runs.reduce((sum, run) => sum + run.target.total, 0),
    scheduledEvaluations: runs.reduce((sum, run) => sum + run.scheduledEvaluations, 0),
    attentionRatio: baselineUnits ? units / baselineUnits : 0,
    adaptive: data?.aspect_source !== "pill",
  };
}

export function formatWorkloadRatio(value) {
  const n = Number(value) || 0;
  return `${n < 10 ? n.toFixed(1) : Math.round(n)}× native-shot attention floor`;
}
