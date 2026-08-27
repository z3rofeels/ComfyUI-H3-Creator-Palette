import { normalizeSubjectHandle } from "./z3_h3_state.js";

function displayName(item) {
  return String(item?.display_name || item?.name || item?.handle || "Character")
    .trim().replaceAll("_", " ");
}

/**
 * Find case-insensitive display-name or normalized-handle collisions across
 * the workflow Cast and reusable Cast pack. The caller still decides whether
 * to edit, rename, or intentionally create a variation.
 */
export function findCastDuplicateCandidates({
  subjects = [], presets = [], displayName: requestedName = "", handle = "", current = null,
} = {}) {
  const requestedHandle = normalizeSubjectHandle(handle || requestedName || "Character");
  const requestedLabel = String(requestedName || handle || "").trim().replaceAll("_", " ").toLowerCase();
  const seen = new Set(), rows = [];
  const add = (kind, item, itemHandle, itemName, group) => {
    if (!item || item === current) return;
    const normalized = normalizeSubjectHandle(itemHandle || itemName || "Character");
    const label = String(itemName || itemHandle || "").trim().replaceAll("_", " ");
    if (normalized.toLowerCase() !== requestedHandle.toLowerCase()
      && (!requestedLabel || label.toLowerCase() !== requestedLabel)) return;
    const key = `${kind}:${normalized.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ kind, item, handle: normalized, name: label || normalized, group: String(group || "Custom / My Cast") });
  };
  for (const subject of subjects || []) add("creator", subject, subject.handle, displayName(subject), subject.preset_group);
  for (const preset of presets || []) add("library", preset, preset.handle || preset.id, preset.name, preset.group);
  return rows;
}

export function findAvailableCastHandle({ value = "Character", subjects = [], presets = [], current = null } = {}) {
  const base = normalizeSubjectHandle(value || "Character"), used = new Set();
  for (const subject of subjects || []) if (subject && subject !== current) used.add(normalizeSubjectHandle(subject.handle).toLowerCase());
  for (const preset of presets || []) {
    const presetHandle = normalizeSubjectHandle(preset?.handle || preset?.name || "Character");
    const presetId = String(preset?.id || preset?.handle || "");
    const ownsPreset = current && (String(current.preset_id || "") === presetId || normalizeSubjectHandle(current.handle) === presetHandle);
    if (!ownsPreset) used.add(presetHandle.toLowerCase());
  }
  let handle = base, suffix = 2;
  while (used.has(handle.toLowerCase())) {
    const tail = `_${suffix++}`;
    handle = `${base.slice(0, Math.max(1, 32 - tail.length))}${tail}`;
  }
  return handle;
}
