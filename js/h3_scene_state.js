import { sceneToken, hasSceneToken, migrateLegacyScenePrompt, stripSceneTokenForMove } from "./h3_prompt_tokens.js";

// Pure scene-palette state helpers. No DOM/ComfyUI dependency so swap behavior can
// be regression-tested independently from the workspace UI.

const clean = (value) => String(value ?? "").trim();

export function normalizeSceneSelections(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [slot, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const prompt = clean(raw.prompt);
    if (!prompt) continue;
    out[String(slot)] = {
      id: clean(raw.id),
      title: clean(raw.title),
      prompt,
      category: clean(raw.category),
      subcategory: clean(raw.subcategory),
      visual: clean(raw.visual),
      note: clean(raw.note),
      ...(raw.thumbnail && typeof raw.thumbnail === "object" && !Array.isArray(raw.thumbnail) ? { thumbnail: { ...raw.thumbnail } } : {}),
      ...(clean(raw.thumbnail_handle) ? { thumbnail_handle: clean(raw.thumbnail_handle) } : {}),
    };
  }
  return out;
}

function tidyPrompt(value) {
  return String(value ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function appendChunk(prompt, chunk) {
  const base = tidyPrompt(prompt);
  const next = clean(chunk);
  if (!next) return base;
  if (!base) return next;
  return `${base}\n\n${next}`;
}

export function applySceneSelection(prompt, selections, slot, preset) {
  const key = clean(slot);
  if (!key) throw new Error("scene slot is required");
  const nextPrompt = clean(preset?.prompt);
  if (!nextPrompt) throw new Error(`scene preset for ${key} has no prompt text`);
  const currentSelections = normalizeSceneSelections(selections);
  const previous = currentSelections[key];
  const token = sceneToken(key);
  let text = String(prompt ?? "");

  // v3.4.1 source prompts carry one tiny semantic token per structured slot.
  // Legacy v3.3/v3.4 workflows may still contain the expanded prose; convert
  // that exact generated chunk in-place so upgrading immediately cleans the
  // editor without moving the user's free-written text around it.
  if (!hasSceneToken(text, key)) {
    if (previous?.prompt && text.includes(previous.prompt)) text = text.replace(previous.prompt, token);
    else text = appendChunk(text, token);
  }

  const nextSelections = {
    ...currentSelections,
    [key]: {
      id: clean(preset?.id),
      title: clean(preset?.title) || key,
      prompt: nextPrompt,
      category: clean(preset?.category),
      subcategory: clean(preset?.subcategory),
      visual: clean(preset?.visual),
      note: clean(preset?.note),
      ...(preset?.thumbnail && typeof preset.thumbnail === "object" && !Array.isArray(preset.thumbnail) ? { thumbnail: { ...preset.thumbnail } } : {}),
      ...(clean(preset?.thumbnail_handle) ? { thumbnail_handle: clean(preset.thumbnail_handle) } : {}),
    },
  };
  return { prompt: tidyPrompt(text), selections: nextSelections };
}

export function removeSceneSelection(prompt, selections, slot) {
  const key = clean(slot);
  const currentSelections = normalizeSceneSelections(selections);
  const previous = currentSelections[key];
  let text = String(prompt ?? "");
  // Remove the semantic token and its category-owned +/- marker together.
  // The marker is not ordinary prompt punctuation and must never be orphaned.
  text = stripSceneTokenForMove(text, key, 0).text;
  // Backward compatibility for an older workflow that has not been mounted in
  // the frontend yet and therefore still carries the expanded generated chunk.
  if (previous?.prompt && text.includes(previous.prompt)) text = text.replace(previous.prompt, "");
  const nextSelections = { ...currentSelections };
  delete nextSelections[key];
  return { prompt: tidyPrompt(text), selections: nextSelections };
}

export function reconcileSceneSelections(prompt, selections) {
  const text = String(prompt ?? "");
  const current = normalizeSceneSelections(selections);
  const next = {};
  for (const [slot, preset] of Object.entries(current)) {
    // A live token is the source of truth. Keep legacy expanded chunks only
    // until migration gets a chance to compact them on mount.
    if (hasSceneToken(text, slot) || (preset.prompt && text.includes(preset.prompt))) next[slot] = preset;
  }
  return next;
}

export function migrateSceneSelections(prompt, selections) {
  const normalized = normalizeSceneSelections(selections);
  const migrated = migrateLegacyScenePrompt(prompt, normalized);
  return { prompt: tidyPrompt(migrated.prompt), selections: normalizeSceneSelections(migrated.selections) };
}

export function sceneSelectionFor(selections, slot) {
  return normalizeSceneSelections(selections)[clean(slot)] || null;
}
