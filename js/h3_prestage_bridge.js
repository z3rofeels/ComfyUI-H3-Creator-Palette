/* Creator <-> PreStage hand-off.
 *
 * PreStage is an output node, so a blank card can be present in a workflow even
 * when the user is queueing the Creator. Keep the two tools independent at
 * render time, but seed a PreStage from the shot that created it so "Pre-Stage"
 * means "make a still for what I am authoring now", not "spawn an empty second
 * prompt editor".
 */
import * as S from "./z3_h3_state.js";
import { expandSceneTokens, castMentionRanges } from "./h3_prompt_tokens.js";
import { normalizePreStageHandoff, preStageOutputPath } from "./h3_prestage_handoff.js";
import { activeCreatorBody } from "./h3_workspace_runtime.js";

const CREATOR = "Z3MiniMaxH3CreatorV3";
const PRESTAGE = "Z3MiniMaxH3PreStage";

const clone = (value) => {
  try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
};

function clean(value) { return String(value ?? "").trim(); }

function activeScenePrompt(body) {
  const data = body?.data || {};
  const segment = body?.target === "global" ? null : data.segments?.[Number(body?.target)];
  const ownScene = segment?.scene_palette || {};
  const globalPrompt = clean(expandSceneTokens(data.prompt, data.scene_palette || {}, { suppress: Object.keys(ownScene) }));
  if (!segment || segment.kind === "clip") return globalPrompt;
  const shotPrompt = clean(expandSceneTokens(segment.prompt, ownScene));
  return [globalPrompt, shotPrompt].filter(Boolean).join("\n");
}

function citedSubjects(prompt, subjects) {
  const text = String(prompt || "");
  const handles = (subjects || []).map((subject) => clean(subject?.handle).replace(/^@/, "")).filter(Boolean);
  const cited = new Set(castMentionRanges(text, handles).map((row) => row.handle));
  return (subjects || []).filter((subject) => cited.has(clean(subject?.handle).replace(/^@/, "")));
}

function plainImagePrompt(prompt, subjects) {
  let body = String(prompt || "");
  const anchors = [];
  for (const subject of citedSubjects(body, subjects)) {
    const handle = clean(subject.handle).replace(/^@/, "");
    const name = clean(subject.display_name) || handle.replaceAll("_", " ");
    const description = clean(subject.description);
    const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A Cast mention can have a terminal +/- variation marker. A media handle
    // such as @img-1 is a different namespace and must never be consumed as
    // a Cast member named "img".
    body = body.replace(new RegExp(`@${escaped}(?!-[0-9])(?:[+-](?![A-Za-z0-9_])|(?![A-Za-z0-9_+\\-]))`, "g"), name);
    anchors.push(description ? `${name}: ${description}` : name);
  }
  return [anchors.length ? `Character continuity: ${anchors.join("; ")}.` : "", body]
    .filter(Boolean).join("\n").trim();
}

function candidateAssets(body) {
  const data = body?.data || {};
  const globalAssets = Array.isArray(data.assets) ? data.assets : [];
  const segment = body?.target === "global" ? null : data.segments?.[Number(body?.target)];
  const shotAssets = Array.isArray(segment?.assets) ? segment.assets : [];
  const byHandle = new Map();
  for (const asset of [...globalAssets, ...shotAssets]) {
    if (asset?.handle && !byHandle.has(asset.handle)) byHandle.set(asset.handle, asset);
  }
  return byHandle;
}

function h3Context(body, prompt) {
  const subjects = citedSubjects(prompt, body?.data?.subjects || []).map(clone);
  const required = new Set();
  for (const subject of subjects) {
    for (const handle of subject.from || []) if (handle) required.add(String(handle).replace(/^@/, ""));
    for (const key of ["motion", "voice", "replaces"]) {
      if (subject[key]) required.add(String(subject[key]).replace(/^@/, ""));
    }
  }
  const assets = candidateAssets(body);
  // File handles use a hyphen by design (@img-1, @vid-2). Preserve directly
  // cited reference media as well as files that define a cited subject.
  for (const match of String(prompt || "").matchAll(/@([A-Za-z]+-\d+)\b/g)) required.add(match[1]);
  const picked = [];
  for (const handle of required) {
    const asset = assets.get(handle);
    if (!asset) continue;
    const copy = clone(asset);
    // A character can only be built from reference media. Existing keyframes
    // remain facts about the source shot and must not silently become identity refs.
    if (subjects.some((s) => (s.from || []).includes(handle) || s.motion === handle || s.voice === handle || s.replaces === handle)) {
      copy.role = "reference";
    }
    picked.push(copy);
  }
  return { subjects, assets: picked };
}

export function creatorPreStageSnapshot(body) {
  const prompt = activeScenePrompt(body);
  const context = h3Context(body, prompt);
  return {
    prompt,
    imagePrompt: plainImagePrompt(prompt, body?.data?.subjects || []),
    subjects: context.subjects,
    assets: context.assets,
    peer: {
      node_id: body?.node?.id ?? null,
      target: body?.target ?? 0,
    },
  };
}

function ensurePreStageShape(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  data.version = 1;
  data.arch ||= "krea2";
  data.prompt = String(data.prompt || "");
  data.refs = Array.isArray(data.refs) ? data.refs : [];
  data.loras = Array.isArray(data.loras) ? data.loras : [];
  data.minimax = data.minimax && typeof data.minimax === "object" ? data.minimax : {};
  data.minimax.request = data.minimax.request && typeof data.minimax.request === "object" ? data.minimax.request : {};
  data.minimax.request.assets = Array.isArray(data.minimax.request.assets) ? data.minimax.request.assets : [];
  data.minimax.request.loras = Array.isArray(data.minimax.request.loras) ? data.minimax.request.loras : [];
  data.minimax.request.models = data.minimax.request.models && typeof data.minimax.request.models === "object" ? data.minimax.request.models : {};
  data.handoff = normalizePreStageHandoff(data.handoff);
  return data;
}

export function applyCreatorSnapshotToPreStageNode(node, creatorBody) {
  if (!node || !creatorBody) return false;
  const dataWidget = node.widgets?.find((widget) => widget.name === "prestage_data");
  const textWidget = node.widgets?.find((widget) => widget.name === "text");
  if (!dataWidget || !textWidget) return false;
  let current = {};
  try { current = JSON.parse(String(dataWidget.value || "{}")); } catch {}
  const data = ensurePreStageShape(current);
  const snap = creatorPreStageSnapshot(creatorBody);
  data.prompt = snap.imagePrompt;
  data.peer = snap.peer;
  data.minimax.request.prompt = snap.prompt;
  data.minimax.request.subjects = snap.subjects;
  data.minimax.request.assets = snap.assets;
  const visible = data.arch === "minimax" ? snap.prompt : snap.imagePrompt;
  dataWidget.value = JSON.stringify(data);
  textWidget.value = visible;
  node.properties ||= {};
  node.properties.z3_prestage_peer = snap.peer;
  node.properties.wg_text = visible;
  node.properties.prompt_palette_prompt_state = { version: 1, source_text: visible };
  node.graph?.setDirtyCanvas?.(true, true);
  return true;
}

function creatorBodies(graph) {
  return (graph?._nodes || graph?.nodes || [])
    .filter((node) => node?.comfyClass === CREATOR && node?._z3CreatorBody)
    .map((node) => node._z3CreatorBody);
}

function persistPreStagePeer(prestageBody, creator, { updateTarget = true } = {}) {
  if (!prestageBody?.node || !creator?.node) return creator || null;
  const current = prestageBody?.data?.peer && typeof prestageBody.data.peer === "object" ? prestageBody.data.peer : {};
  const activeTarget = Number(creator.target);
  const preservedTarget = Number(current.target);
  const target = updateTarget
    ? (Number.isInteger(activeTarget) && activeTarget >= 0 ? activeTarget : 0)
    : (Number.isInteger(preservedTarget) && preservedTarget >= 0 ? preservedTarget : (Number.isInteger(activeTarget) && activeTarget >= 0 ? activeTarget : 0));
  const peer = { node_id: creator.node.id ?? null, target };
  prestageBody.data ||= {};
  prestageBody.data.peer = peer;
  prestageBody.node.properties ||= {};
  prestageBody.node.properties.z3_prestage_peer = peer;
  return creator;
}

export function findCreatorForPreStage(prestageBody, { repair = true } = {}) {
  const graph = prestageBody?.node?.graph;
  const creators = creatorBodies(graph);
  const peerId = prestageBody?.data?.peer?.node_id ?? prestageBody?.node?.properties?.z3_prestage_peer?.node_id;
  if (peerId != null) {
    const linked = creators.find((body) => String(body.node?.id) === String(peerId));
    if (linked) return repair ? persistPreStagePeer(prestageBody, linked, { updateTarget: false }) : linked;
  }

  // If the stored link went stale, the Creator the user is actively editing is
  // the safest recovery target. This matters in real workflows with more than one
  // Creator: Image Lab should not become a dead end just because an old peer id
  // no longer exists after duplication/import. We only accept an active Creator
  // that lives on this exact graph.
  const active = activeCreatorBody?.();
  if (active?.node?.graph === graph && active?.node?.comfyClass === CREATOR)
    return repair ? persistPreStagePeer(prestageBody, active) : active;

  // Old v3.1.x PreStages had no peer metadata. A single Creator is unambiguous.
  if (creators.length === 1) return repair ? persistPreStagePeer(prestageBody, creators[0]) : creators[0];
  return null;
}

export function bindPreStageToActiveCreator(prestageBody) {
  const graph = prestageBody?.node?.graph;
  const active = activeCreatorBody?.();
  if (!active?.node || active.node.graph !== graph || active.node.comfyClass !== CREATOR)
    return { ok: false, message: "Select the Creator you want to receive PreStage images, then try again." };
  persistPreStagePeer(prestageBody, active);
  prestageBody.commit?.(false);
  return { ok: true, creator: active };
}

export function pullCreatorIntoPreStage(prestageBody) {
  const creator = findCreatorForPreStage(prestageBody);
  if (!creator) return { ok: false, message: "No unambiguous Creator is linked to this PreStage." };
  const snap = creatorPreStageSnapshot(creator);
  const data = ensurePreStageShape(prestageBody.data);
  data.prompt = snap.imagePrompt;
  data.peer = snap.peer;
  data.minimax.request.prompt = snap.prompt;
  data.minimax.request.subjects = snap.subjects;
  data.minimax.request.assets = snap.assets;
  prestageBody.data = data;
  const visible = data.arch === "minimax" ? snap.prompt : snap.imagePrompt;
  prestageBody.commit(false);
  const guard = prestageBody.node?._ppPromptStateGuard;
  if (guard) guard.commit(visible, { notify: true, dirty: true });
  else if (prestageBody.textWidget) {
    prestageBody.textWidget.value = visible;
    prestageBody.textWidget.callback?.(visible, prestageBody.node?.graph?.canvas, prestageBody.node);
  }
  prestageBody.syncPrompt(false);
  return { ok: true, message: visible ? "Pulled the active Creator shot and Cast." : "Linked to Creator; its active shot is currently blank." };
}

function gateOwnedBy(prestageBody, gate) {
  const own = prestageBody?.node?.id;
  return gate?.node_id == null || own == null || String(gate.node_id) === String(own);
}

export function setCreatorPreStageGate(prestageBody, active, message = "") {
  const creator = findCreatorForPreStage(prestageBody);
  if (!creator) return { ok: false, message: "No unambiguous Creator is linked to this PreStage." };
  const current = creator.data?.prestage_gate;
  if (active) {
    const next = {
      active: true,
      node_id: prestageBody?.node?.id ?? null,
      mode: prestageBody?.data?.handoff?.mode || "review",
      message: message || "Creator is waiting while you generate and review PreStage images.",
    };
    if (current?.active && String(current.node_id) === String(next.node_id) && current.mode === next.mode && current.message === next.message) return { ok: true, creator };
    creator.data.prestage_gate = next;
  } else if (current && gateOwnedBy(prestageBody, current)) {
    delete creator.data.prestage_gate;
  } else return { ok: true, creator };
  creator.commitData?.(false, { skipHistory: true, historyLabel: "PreStage gate" });
  return { ok: true, creator };
}

function creatorTargetIndex(prestageBody, creator) {
  const preferred = Number(prestageBody?.data?.peer?.target);
  if (Number.isInteger(preferred) && preferred >= 0 && preferred < creator.data.segments.length) return preferred;
  const active = Number(creator.target);
  if (Number.isInteger(active) && active >= 0 && active < creator.data.segments.length) return active;
  return 0;
}

function promptSnapshot(creator) {
  return {
    global: String(creator?.data?.prompt || ""),
    shots: (creator?.data?.segments || []).map((segment) => String(segment?.prompt || "")),
  };
}

function authoredPromptsPreserved(creator, before) {
  if (String(creator?.data?.prompt || "") !== before.global) return false;
  const segments = creator?.data?.segments || [];
  return before.shots.every((prompt, index) => String(segments[index]?.prompt || "") === prompt);
}

function ensureCreatorTargetSegment(prestageBody, creator, destination) {
  let index = creatorTargetIndex(prestageBody, creator);
  if (destination === "new_shot") {
    const base = creator.data.segments[index] || S.DEFAULT_SEGMENT();
    const created = S.cloneSegment(base);
    // Carry ordinary identity/style references into the new shot, but never
    // inherit the prior shot's opening/closing keyframes.
    created.assets = (created.assets || []).filter((row) => row?.role === "reference");
    creator.data.segments.push(created);
    index = creator.data.segments.length - 1;
  }
  const segment = creator.data.segments[index] || (creator.data.segments[index] = S.DEFAULT_SEGMENT());
  segment.assets = Array.isArray(segment.assets) ? segment.assets : [];
  return { index, segment };
}

function compilerMediaMentions(value, out = new Set()) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/@([A-Za-z]+-\d+)(?![A-Za-z0-9_-])/g)) out.add(match[1]);
    return out;
  }
  if (Array.isArray(value)) { for (const row of value) compilerMediaMentions(row, out); return out; }
  if (value && typeof value === "object") {
    // Asset objects contain the handle as metadata, not authored prose. Their
    // filename/notes also must not make a missing prompt citation look present.
    if (typeof value.handle === "string" && typeof value.kind === "string" && "filename" in value) return out;
    for (const row of Object.values(value)) compilerMediaMentions(row, out);
  }
  return out;
}

function allCreatorAssets(data) {
  return [
    ...(Array.isArray(data?.assets) ? data.assets : []),
    ...((data?.segments || []).flatMap((segment) => Array.isArray(segment?.assets) ? segment.assets : [])),
  ];
}

function workflowClaimsHandle(value, handle, skip = null) {
  if (value === skip) return false;
  if (typeof value === "string") {
    if (value === handle || value === `@${handle}`) return true;
    const escaped = String(handle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`@${escaped}(?![A-Za-z0-9_-])`).test(value);
  }
  if (Array.isArray(value)) return value.some((row) => workflowClaimsHandle(row, handle, skip));
  if (value && typeof value === "object") return Object.values(value).some((row) => workflowClaimsHandle(row, handle, skip));
  return false;
}

function recoverLegacyPreStageHandle(creator, segment, asset, origin) {
  // v3.13.0D and earlier could replace a PreStage image by deleting @img-1's
  // asset and creating @img-2 while deliberately preserving RAW. Repair that
  // exact historical shape only when the mapping is unambiguous:
  //   * this is the PreStage-owned image being handed off now;
  //   * exactly one image handle is cited by this shot but unattached;
  //   * the replacement handle is not referenced anywhere else;
  //   * the missing handle is not already owned by another Creator asset.
  // We restore the asset identity instead of rewriting authored prompt text.
  if (!creator?.data || !segment || !asset || String(asset.prestage_origin ?? origin) !== String(origin)) return null;
  const attachedForShot = new Set([
    ...(creator.data.assets || []).map((row) => String(row?.handle || "")),
    ...(segment.assets || []).map((row) => String(row?.handle || "")),
  ].filter(Boolean));
  const missing = [...compilerMediaMentions(segment)]
    .filter((handle) => /^img-\d+$/i.test(handle) && !attachedForShot.has(handle));
  if (missing.length !== 1) return null;
  const wanted = missing[0], current = String(asset.handle || "");
  if (!current || current === wanted) return null;
  if (workflowClaimsHandle(creator.data, current, asset)) return null;
  if (allCreatorAssets(creator.data).some((row) => row !== asset && String(row?.handle || "") === wanted)) return null;
  asset.handle = wanted;
  return { from: current, to: wanted };
}

function upsertPreStageImage(prestageBody, creator, segment, image, destination) {
  const filename = preStageOutputPath(image);
  if (!filename) throw new Error("The selected PreStage result has no saved filename.");
  const role = destination === "reference" ? "reference" : destination === "last_frame" ? "last_frame" : "first_frame";
  const origin = String(prestageBody?.node?.id ?? "");

  // Replacing a PreStage result must preserve the workflow handle. Older builds
  // removed @img-1 and created @img-2 for the replacement while intentionally
  // leaving RAW untouched; any explicit @img-1 citation then became a dangling
  // compiler reference. Keep one authoritative asset object/handle and mutate
  // only its media payload instead. This fixes the invalid state without ever
  // rewriting the user's authored prompt.
  let asset = null;
  if (role === "first_frame" || role === "last_frame") {
    const matching = segment.assets.filter((row) => row?.role === role);
    asset = matching.find((row) => row?.prestage_origin === origin)
      || matching.find((row) => row?.kind === "image")
      || matching[0]
      || null;
    if (asset) segment.assets = segment.assets.filter((row) => row === asset || row?.role !== role);
  } else {
    const matching = segment.assets.filter((row) => row?.role === "reference" && row?.prestage_origin === origin);
    asset = matching[0] || null;
    if (asset) segment.assets = segment.assets.filter((row) => row === asset || !(row?.role === "reference" && row?.prestage_origin === origin));
  }

  if (!asset) {
    asset = S.createAsset("image", filename, creator.data, role);
    segment.assets.push(asset);
  } else {
    asset.kind = "image";
    asset.filename = filename;
    asset.role = role;
    delete asset.track;
    delete asset.trim;
    // A PreStage replacement is a new media source. Preserve only the workflow
    // handle that RAW may cite; detach stale reusable-record metadata so the
    // Reference Workspace never claims this new file is still the old Library
    // record.
    delete asset.library_ref_id;
    delete asset.reference_name;
    delete asset.subject_role;
    delete asset.strength;
    delete asset.notes;
    delete asset.global_active;
  }
  asset.prestage_origin = origin;
  const recoveredHandle = recoverLegacyPreStageHandle(creator, segment, asset, origin);
  return { asset, filename, role, recoveredHandle };
}

export function applyPreStageImagesToCreator(prestageBody, assignments, { historyLabel = "Use PreStage image" } = {}) {
  const creator = findCreatorForPreStage(prestageBody);
  if (!creator) return { ok: false, message: "No Creator is linked. Select the target Creator, then use Re-link Creator in PreStage." };
  const rows = (Array.isArray(assignments) ? assignments : []).filter((row) => row?.image?.filename && row?.destination);
  if (!rows.length) return { ok: false, message: "Choose at least one PreStage image first." };

  const beforePrompts = promptSnapshot(creator);
  const created = [];
  let targetIndex = null;
  let targetSegment = null;
  for (const row of rows) {
    // A new-shot handoff creates exactly one destination shot. Other selected
    // roles in the same action land on that new shot rather than creating more.
    const destination = row.destination === "new_shot" && targetSegment ? "first_frame" : row.destination;
    if (!targetSegment || row.destination === "new_shot") {
      const target = ensureCreatorTargetSegment(prestageBody, creator, destination);
      targetIndex = target.index;
      targetSegment = target.segment;
    }
    created.push(upsertPreStageImage(prestageBody, creator, targetSegment, row.image, destination));
  }

  creator.target = targetIndex ?? creatorTargetIndex(prestageBody, creator);
  delete creator.data.prestage_gate;
  creator.commitData?.(true, { historyLabel });

  // The image is attached to Creator state/reference UI, never injected as an
  // @img token or replacement text. If the handoff moved to another shot, sync
  // only the view of that shot's existing prompt; its authored text is untouched.
  if (!authoredPromptsPreserved(creator, beforePrompts)) {
    console.error("MiniMax PreStage handoff changed authored prompt text unexpectedly; refusing silent prompt mutation.");
    return { ok: false, message: "PreStage stopped a handoff because Creator prompt text changed unexpectedly." };
  }
  creator.syncPrompt?.(false);
  return { ok: true, creator, assets: created.map((row) => row.asset), target: creator.target, filenames: created.map((row) => row.filename), promptPreserved: true };
}

export function applyPreStageImageToCreator(prestageBody, image, destination) {
  const label = destination === "new_shot" ? "Create shot from PreStage image" : "Use PreStage image";
  const result = applyPreStageImagesToCreator(prestageBody, [{ image, destination }], { historyLabel: label });
  if (!result.ok) return result;
  return { ...result, asset: result.assets[0], filename: result.filenames[0] };
}

function graphPreStageBody(creatorBody, nodeId) {
  if (nodeId == null) return null;
  const nodes = creatorBody?.node?.graph?._nodes || creatorBody?.node?.graph?.nodes || [];
  const node = nodes.find((candidate) => candidate?.comfyClass === PRESTAGE && String(candidate?.id) === String(nodeId));
  return node?._z3CreatorBody || null;
}

export function bypassPreStageForCreator(creatorBody) {
  if (!creatorBody?.data) return { ok: false, message: "Creator is unavailable." };
  const gate = creatorBody.data.prestage_gate;
  const prestageBody = graphPreStageBody(creatorBody, gate?.node_id);

  // Update both sides. Clearing only Creator's gate is temporary because the
  // still-live PreStage would recreate it on its next refresh/load.
  if (prestageBody?.data?.handoff) {
    prestageBody.data.handoff = normalizePreStageHandoff({ ...prestageBody.data.handoff, mode: "bypass", phase: "idle" });
    clearTimeout(prestageBody._autoTimer);
    prestageBody._autoTimer = null;
    prestageBody._autoCandidate = null;
    prestageBody.commit?.(false);
    prestageBody.imageSidecar?.sync?.();
  }
  delete creatorBody.data.prestage_gate;
  creatorBody.commitData?.(true, { historyLabel: "Bypass PreStage and enable video" });
  creatorBody.renderStageMeta?.();
  return { ok: true, prestage: prestageBody, creator: creatorBody };
}
