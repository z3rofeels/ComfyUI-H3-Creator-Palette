const targets = new Map();
const subscribers = new Set();
let activeId = null;
let sequence = 0;

function targetId(node) {
  const id = node?.id ?? node?.graph?.getNodeId?.(node);
  return id == null ? `pp-${++sequence}` : String(id);
}

function currentTarget() {
  const direct = activeId && targets.get(activeId);
  if (direct) return direct;
  return [...targets.values()].sort((a, b) => b.touchedAt - a.touchedAt)[0] || null;
}

function publicTarget(target = currentTarget()) {
  if (!target) return null;
  return {
    id: target.id,
    nodeId: target.node?.id == null ? null : String(target.node.id),
    title: String(target.node?.title || target.node?.comfyClass || "Prompt Palette"),
    comfyClass: String(target.node?.comfyClass || ""),
  };
}

function emitTargetChanged() {
  const snapshot = publicTarget();
  for (const callback of Array.from(subscribers)) {
    try { callback(snapshot); }
    catch (error) { console.error("Prompt Palette: command target subscriber failed", error); }
  }
}

export function registerPromptPaletteCommandTarget(node, handlers = {}) {
  const id = targetId(node);
  targets.set(id, { id, node, handlers, touchedAt: Date.now() });
  activeId = id;
  emitTargetChanged();
  return {
    id,
    activate() {
      const target = targets.get(id);
      if (!target) return;
      target.touchedAt = Date.now();
      const changed = activeId !== id;
      activeId = id;
      if (changed) emitTargetChanged();
    },
    cleanup() {
      targets.delete(id);
      if (activeId === id) {
        activeId = [...targets.entries()].sort((a, b) => b[1].touchedAt - a[1].touchedAt)[0]?.[0] || null;
      }
      emitTargetChanged();
    },
  };
}

export function invokePromptPaletteCommand(command, ...args) {
  const target = currentTarget();
  const fn = target?.handlers?.[command];
  if (typeof fn !== "function") return false;
  target.touchedAt = Date.now();
  fn(...args);
  return true;
}

/**
 * Read data from the active Prompt Palette node without exposing the node itself.
 * Query handlers must be side-effect free; mutation stays on invokePromptPaletteCommand.
 */
export function queryPromptPaletteCommand(command, ...args) {
  const target = currentTarget();
  const fn = target?.handlers?.[command];
  if (typeof fn !== "function") return { ok: false, value: null, target: publicTarget(target) };
  target.touchedAt = Date.now();
  try {
    return { ok: true, value: fn(...args), target: publicTarget(target) };
  } catch (error) {
    console.error(`Prompt Palette: command query '${command}' failed`, error);
    return { ok: false, value: null, target: publicTarget(target), error };
  }
}

export function getActivePromptPaletteCommandTarget() {
  return publicTarget();
}

export function listPromptPaletteCommandTargets() {
  const active = currentTarget();
  return [...targets.values()]
    .sort((a, b) => (a === active ? -1 : b === active ? 1 : b.touchedAt - a.touchedAt))
    .map((target) => publicTarget(target));
}

export function activatePromptPaletteCommandTarget(id) {
  const key = String(id ?? "");
  const target = targets.get(key);
  if (!target) return false;
  target.touchedAt = Date.now();
  const changed = activeId !== key;
  activeId = key;
  if (changed) emitTargetChanged();
  return true;
}

export function onPromptPaletteCommandTargetChanged(callback) {
  if (typeof callback !== "function") return () => {};
  subscribers.add(callback);
  try { callback(publicTarget()); } catch {}
  return () => subscribers.delete(callback);
}

export function promptPaletteCommandTargetCount() {
  return targets.size;
}
