/**
 * Shared interaction contract for Prompt Editor semantic calls.
 *
 * Data lookup deliberately remains separate: @ resolves Cast, $ resolves Scene
 * presets.  Only interaction semantics live here so neither system can drift
 * into a different keyboard / variation UX again.
 */
export const SEMANTIC_CALL_ACTIONS = Object.freeze([
  Object.freeze({ id: "fixed", label: "Add", direction: 0 }),
  Object.freeze({ id: "plus", label: "+", direction: 1 }),
  Object.freeze({ id: "minus", label: "−", direction: -1 }),
]);

export function actionDirection(action, fallback = 0) {
  const row = SEMANTIC_CALL_ACTIONS.find((item) => item.id === action);
  return row ? row.direction : (Number(fallback) < 0 ? -1 : Number(fallback) > 0 ? 1 : 0);
}

export function directionGlyph(direction, fixed = "Add") {
  return Number(direction) > 0 ? "+" : Number(direction) < 0 ? "−" : fixed;
}

export function nextSemanticIndex(index, delta, length) {
  const size = Math.max(0, Number(length) || 0);
  if (!size) return 0;
  return (Math.max(0, Number(index) || 0) + Number(delta || 0) + size) % size;
}

export function semanticFooter(prefix, direction, { create = false } = {}) {
  const verb = directionGlyph(direction, "add").toLowerCase();
  return `↑↓ choose · Enter ${verb} · type ${prefix}name+ / ${prefix}name−${create ? " · create when missing" : ""} · Esc close`;
}

/**
 * One keyboard contract for both @ and $.  Returns true when the event was
 * consumed.  Callers supply their own render/commit/close functions and keep
 * data-domain logic isolated.
 */
export function handleSemanticCallKey(event, menuState, { render, commit, close } = {}) {
  if (!menuState) return false;
  const length = Array.isArray(menuState.items) ? menuState.items.length : 0;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    menuState.index = nextSemanticIndex(menuState.index, event.key === "ArrowDown" ? 1 : -1, length);
    render?.();
    return true;
  }
  if ((event.key === "Enter" || event.key === "Tab") && length) {
    event.preventDefault();
    event.stopPropagation();
    commit?.(menuState.index, "default");
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close?.();
    return true;
  }
  return false;
}

/** Capture the textarea-compatible logical selection without touching focus. */
export function captureSemanticEditorSelection(editor) {
  if (!editor) return null;
  const value = String(editor.value ?? "");
  const start = Math.max(0, Math.min(Number(editor.selectionStart ?? value.length) || 0, value.length));
  const end = Math.max(start, Math.min(Number(editor.selectionEnd ?? start) || start, value.length));
  return { value, start, end, direction: editor.selectionDirection || "forward" };
}

/**
 * Restore a selection only when the editor still contains the exact source that
 * was captured. This makes autocomplete rendering/layout side-effect free while
 * refusing to undo a real keystroke, mouse click, IME commit or programmatic edit.
 */
export function restoreSemanticEditorSelection(editor, snapshot, { defer = false } = {}) {
  if (!editor || !snapshot || typeof editor.setSelectionRange !== "function") return false;
  const run = () => {
    if (String(editor.value ?? "") !== snapshot.value) return false;
    if (document.activeElement !== editor && !editor.contains?.(document.activeElement)) return false;
    const currentStart = Number(editor.selectionStart ?? snapshot.start);
    const currentEnd = Number(editor.selectionEnd ?? snapshot.end);
    if (currentStart === snapshot.start && currentEnd === snapshot.end) return true;
    editor.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction || "forward");
    return true;
  };
  if (defer) { queueMicrotask(run); return true; }
  return run();
}

export function semanticNavigationKey(key) {
  return ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(String(key || ""));
}
