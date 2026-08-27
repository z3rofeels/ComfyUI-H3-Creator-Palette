export const DEFAULT_PRESTAGE_HANDOFF = Object.freeze({
  mode: "review",
  phase: "ready",
  destination: "first_frame",
  batch_count: 1,
  selection_policy: "first",
  slots: Object.freeze({ first_frame: "", last_frame: "", reference: "" }),
});

const MODES = new Set(["review", "auto", "image_only", "bypass"]);
const PHASES = new Set(["ready", "review", "idle"]);
const DESTINATIONS = new Set(["first_frame", "reference", "last_frame", "new_shot", "none"]);
const POLICIES = new Set(["first", "last", "seeded"]);
const SLOTS = new Set(["first_frame", "last_frame", "reference"]);

export function normalizePreStageHandoff(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const mode = MODES.has(value.mode) ? value.mode : DEFAULT_PRESTAGE_HANDOFF.mode;
  const destination = DESTINATIONS.has(value.destination) ? value.destination : DEFAULT_PRESTAGE_HANDOFF.destination;
  const slots = value.slots && typeof value.slots === "object" ? value.slots : {};
  return {
    mode,
    phase: PHASES.has(value.phase) ? value.phase : DEFAULT_PRESTAGE_HANDOFF.phase,
    destination: mode === "auto" && destination === "none" ? "first_frame" : destination,
    batch_count: Math.max(1, Math.min(16, Math.trunc(Number(value.batch_count) || 1))),
    selection_policy: POLICIES.has(value.selection_policy) ? value.selection_policy : DEFAULT_PRESTAGE_HANDOFF.selection_policy,
    slots: {
      first_frame: typeof slots.first_frame === "string" ? slots.first_frame : "",
      last_frame: typeof slots.last_frame === "string" ? slots.last_frame : "",
      reference: typeof slots.reference === "string" ? slots.reference : "",
    },
  };
}

export function preStageNeedsCreatorGate(handoff) {
  const value = normalizePreStageHandoff(handoff);
  return value.mode !== "bypass" && value.phase !== "idle";
}

export function togglePreStageSlot(handoff, slot, imageKey) {
  const value = normalizePreStageHandoff(handoff);
  if (!SLOTS.has(slot)) return value;
  const key = typeof imageKey === "string" ? imageKey : "";
  value.slots[slot] = value.slots[slot] === key ? "" : key;
  return value;
}

export function preStageSlotsForImage(handoff, imageKey) {
  const value = normalizePreStageHandoff(handoff), key = String(imageKey || "");
  return [...SLOTS].filter((slot) => key && value.slots[slot] === key);
}

export function preStageOutputPath(image) {
  if (!image || typeof image !== "object") return "";
  const path = [image.subfolder, image.filename].filter(Boolean).join("/");
  return path + (image.type === "output" ? " [output]" : "");
}

export function pickPreStageCandidate(images, policy = "first", seed = 0) {
  const rows = Array.isArray(images) ? images.filter((row) => row?.filename) : [];
  if (!rows.length) return null;
  if (policy === "last") return rows.at(-1);
  if (policy === "seeded") {
    const n = Number.isFinite(Number(seed)) ? Math.trunc(Math.abs(Number(seed))) : 0;
    return rows[n % rows.length];
  }
  return rows[0];
}
