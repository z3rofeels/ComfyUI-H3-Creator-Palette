let surfaceCounter = 0;
const EDITOR_SENTINEL = "\u200b";

function logicalText(root) {
  return String(root?.textContent || "").split(EDITOR_SENTINEL).join("");
}

function logicalLength(root) { return logicalText(root).length; }

function clampOffset(value, length) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(length, Math.trunc(numeric)));
}

function selectionBelongsTo(root, selection) {
  if (!selection?.anchorNode || !selection?.focusNode) return false;
  return root.contains(selection.anchorNode) && root.contains(selection.focusNode);
}

function readLiveSelection(root, fallbackStart = 0, fallbackEnd = 0) {
  const selection = window.getSelection?.();
  if (!selectionBelongsTo(root, selection)) return { start: fallbackStart, end: fallbackEnd, direction: "none" };
  try {
    const anchorRange = document.createRange();
    anchorRange.selectNodeContents(root);
    anchorRange.setEnd(selection.anchorNode, selection.anchorOffset);
    const focusRange = document.createRange();
    focusRange.selectNodeContents(root);
    focusRange.setEnd(selection.focusNode, selection.focusOffset);
    const anchorRaw = anchorRange.toString();
    const focusRaw = focusRange.toString();
    const anchor = anchorRaw.split(EDITOR_SENTINEL).join("").length;
    const focus = focusRaw.split(EDITOR_SENTINEL).join("").length;
    return {
      start: Math.min(anchor, focus),
      end: Math.max(anchor, focus),
      direction: anchor <= focus ? "forward" : "backward",
    };
  } catch {
    return { start: fallbackStart, end: fallbackEnd, direction: "none" };
  }
}

function textPointAtOffset(root, requestedOffset) {
  const target = clampOffset(requestedOffset, logicalLength(root));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let node = walker.nextNode();
  let lastText = null;
  while (node) {
    lastText = node;
    let localLogical = 0;
    for (let raw = 0; raw <= node.data.length; raw++) {
      if (consumed + localLogical === target) return { node, offset: raw };
      if (raw < node.data.length && node.data[raw] !== EDITOR_SENTINEL) localLogical += 1;
    }
    consumed += localLogical;
    node = walker.nextNode();
  }
  if (lastText) {
    const sentinelAt = lastText.data.lastIndexOf(EDITOR_SENTINEL);
    return { node: lastText, offset: sentinelAt >= 0 ? sentinelAt : lastText.data.length };
  }
  const empty = document.createTextNode(EDITOR_SENTINEL);
  root.appendChild(empty);
  return { node: empty, offset: 0 };
}

export function createDomRangeForOffsets(root, start, end = start) {
  const textLength = logicalLength(root);
  const safeStart = clampOffset(start, textLength);
  const safeEnd = clampOffset(end, textLength);
  const from = textPointAtOffset(root, Math.min(safeStart, safeEnd));
  const to = textPointAtOffset(root, Math.max(safeStart, safeEnd));
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

function setLiveSelection(root, start, end = start, direction = "forward") {
  const length = logicalLength(root);
  const safeStart = clampOffset(start, length);
  const safeEnd = clampOffset(end, length);
  const selection = window.getSelection?.();
  if (!selection) return;
  const range = createDomRangeForOffsets(root, safeStart, safeEnd);
  selection.removeAllRanges();
  selection.addRange(range);
  if (direction === "backward" && typeof selection.setBaseAndExtent === "function") {
    const from = textPointAtOffset(root, safeEnd);
    const to = textPointAtOffset(root, safeStart);
    selection.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
  }
}

export function shouldUseSingleSurfaceEditor({
  cssHighlights = !!globalThis.CSS?.highlights,
  highlightConstructor = !!globalThis.Highlight,
  rangeSupport = !!globalThis.document?.createRange,
  selectionSupport = !!globalThis.window?.getSelection,
} = {}) {
  // Match Prompt Palette's proven editor contract: capability detection, not
  // browser-name detection. Modern Firefox supports the same single editable
  // surface and CSS Highlights pipeline as Chromium. Forcing Gecko onto the
  // legacy textarea + mirror creates two independent wrapping engines, which
  // is what caused doubled selection glyphs and displaced carets in portable.
  return !!(cssHighlights && highlightConstructor && rangeSupport && selectionSupport);
}

function supportsSingleSurfaceEditor() {
  return shouldUseSingleSurfaceEditor();
}

function editorOwnsSelection(root) {
  const selection = globalThis.window?.getSelection?.();
  return document.activeElement === root || selectionBelongsTo(root, selection);
}

function ensureEditorSentinel(root) {
  if (!root) return;
  if (String(root.textContent || "").includes(EDITOR_SENTINEL)) return;
  // Never flatten or replace the active contenteditable DOM just to recover the
  // end-of-document anchor. Appending one invisible text node preserves every
  // existing text node, browser selection and IME composition range.
  root.appendChild(document.createTextNode(EDITOR_SENTINEL));
}

function replaceLogicalRange(root, start, end, replacement = "") {
  const sourceLength = logicalLength(root);
  const safeStart = clampOffset(Math.min(start, end), sourceLength);
  const safeEnd = clampOffset(Math.max(start, end), sourceLength);
  const range = createDomRangeForOffsets(root, safeStart, safeEnd);
  range.deleteContents();
  const text = String(replacement ?? "").replace(/\r\n?/g, "\n").split(EDITOR_SENTINEL).join("");
  if (text) range.insertNode(document.createTextNode(text));
  ensureEditorSentinel(root);
  return { start: safeStart, end: safeEnd, insertedEnd: safeStart + text.length, text };
}

function replacementWindow(oldText, newText) {
  const oldValue = String(oldText ?? ""), nextValue = String(newText ?? "");
  let prefix = 0;
  const prefixLimit = Math.min(oldValue.length, nextValue.length);
  while (prefix < prefixLimit && oldValue[prefix] === nextValue[prefix]) prefix++;
  let suffix = 0;
  const suffixLimit = Math.min(oldValue.length - prefix, nextValue.length - prefix);
  while (suffix < suffixLimit && oldValue[oldValue.length - 1 - suffix] === nextValue[nextValue.length - 1 - suffix]) suffix++;
  return {
    prefix,
    suffix,
    oldEnd: oldValue.length - suffix,
    newEnd: nextValue.length - suffix,
    replacement: nextValue.slice(prefix, nextValue.length - suffix),
  };
}

function mapOffsetAcrossReplacement(offset, oldText, newText) {
  const oldValue = String(oldText ?? ""), nextValue = String(newText ?? "");
  const point = clampOffset(offset, oldValue.length);
  const window = replacementWindow(oldValue, nextValue);
  if (point <= window.prefix) return point;
  if (point >= window.oldEnd) return clampOffset(nextValue.length - (oldValue.length - point), nextValue.length);
  // The caret/selection was inside the replaced region. Keep it at the closest
  // corresponding insertion point rather than throwing it to the end.
  const relative = point - window.prefix;
  return window.prefix + Math.min(relative, window.replacement.length);
}

function installTextareaCompatibility(root) {
  const state = { start: 0, end: 0, direction: "none" };
  let composing = false;

  const refreshSelection = () => {
    const current = readLiveSelection(root, state.start, state.end);
    const length = logicalLength(root);
    state.start = clampOffset(current.start, length);
    state.end = clampOffset(current.end, length);
    state.direction = current.direction;
    return state;
  };

  const applySelection = () => {
    if (editorOwnsSelection(root)) setLiveSelection(root, state.start, state.end, state.direction);
  };

  const stabilize = () => {
    if (root.isConnected === false) return false;
    // Editor 2B invariant: liveness/visual refresh may repair the sentinel, but
    // it must never normalize/replace the active editor DOM. CSS Highlights can
    // span multiple text nodes safely, so there is no reason to flatten while
    // the user is typing, pasting, selecting or composing.
    if (!composing) ensureEditorSentinel(root);
    const current = readLiveSelection(root, state.start, state.end);
    const length = logicalLength(root);
    state.start = clampOffset(current.start, length);
    state.end = clampOffset(current.end, length);
    state.direction = current.direction;
    return true;
  };

  Object.defineProperty(root, "value", {
    configurable: true,
    get() { return logicalText(root); },
    set(value) {
      const text = String(value ?? "").replace(/\r\n?/g, "\n").split(EDITOR_SENTINEL).join("");
      const currentText = logicalText(root);
      // Same-value UI/state refreshes are strict no-ops. They cannot rewrite a
      // text node, selection, composition range or browser undo boundary.
      if (currentText === text) {
        if (!composing) ensureEditorSentinel(root);
        return;
      }
      // A hidden-widget/library refresh during IME must never destroy the active
      // composition. The final composition input will immediately become the
      // canonical prompt value, so stale external projection is intentionally
      // ignored until composition ends.
      if (composing && editorOwnsSelection(root)) return;

      const active = editorOwnsSelection(root);
      const before = active ? refreshSelection() : { start: 0, end: 0, direction: "none" };
      if (!active) {
        // Off-focus target/shot switches may replace the dormant surface cheaply.
        root.textContent = text + EDITOR_SENTINEL;
        state.start = state.end = text.length;
        state.direction = "none";
        return;
      }

      // Active editor: patch only the changed logical window. Never replace or
      // flatten the whole contenteditable tree while it owns focus/selection.
      // This keeps unaffected browser text nodes, IME state and hit-testing
      // geometry intact even when an external component projects a new value.
      const window = replacementWindow(currentText, text);
      replaceLogicalRange(root, window.prefix, window.oldEnd, window.replacement);
      state.start = mapOffsetAcrossReplacement(before.start, currentText, text);
      state.end = mapOffsetAcrossReplacement(before.end, currentText, text);
      state.direction = before.direction;
      setLiveSelection(root, state.start, state.end, state.direction);
    },
  });

  Object.defineProperty(root, "selectionStart", {
    configurable: true,
    get() { return refreshSelection().start; },
    set(value) {
      const length = root.value.length;
      const next = clampOffset(value, length);
      state.start = next;
      if (state.end < next) state.end = next;
      state.direction = "forward";
      applySelection();
    },
  });

  Object.defineProperty(root, "selectionEnd", {
    configurable: true,
    get() { return refreshSelection().end; },
    set(value) {
      const length = root.value.length;
      const next = clampOffset(value, length);
      state.end = next;
      if (state.start > next) state.start = next;
      state.direction = "forward";
      applySelection();
    },
  });

  Object.defineProperty(root, "selectionDirection", {
    configurable: true,
    get() { return refreshSelection().direction; },
    set(value) { state.direction = value === "backward" ? "backward" : value === "forward" ? "forward" : "none"; applySelection(); },
  });

  root.setSelectionRange = (start, end = start, direction = "forward") => {
    const length = root.value.length;
    state.start = clampOffset(Math.min(start, end), length);
    state.end = clampOffset(Math.max(start, end), length);
    state.direction = direction === "backward" ? "backward" : "forward";
    setLiveSelection(root, state.start, state.end, state.direction);
  };

  root.select = () => root.setSelectionRange(0, root.value.length, "forward");

  root.setRangeText = (replacement, start = root.selectionStart, end = root.selectionEnd, selectionMode = "preserve") => {
    const source = root.value;
    const safeStart = clampOffset(Math.min(start, end), source.length);
    const safeEnd = clampOffset(Math.max(start, end), source.length);
    const oldSelection = refreshSelection();
    const mutation = replaceLogicalRange(root, safeStart, safeEnd, replacement);
    const insertedEnd = mutation.insertedEnd;
    if (selectionMode === "select") root.setSelectionRange(safeStart, insertedEnd);
    else if (selectionMode === "start") root.setSelectionRange(safeStart, safeStart);
    else if (selectionMode === "end") root.setSelectionRange(insertedEnd, insertedEnd);
    else {
      const delta = mutation.text.length - (safeEnd - safeStart);
      const map = (pos) => pos <= safeStart ? pos : pos >= safeEnd ? pos + delta : insertedEnd;
      root.setSelectionRange(map(oldSelection.start), map(oldSelection.end), oldSelection.direction);
    }
  };

  let correctingSelection = false;
  const onSelectionChange = () => {
    const selection = window.getSelection?.();
    if (!selectionBelongsTo(root, selection) || correctingSelection) return;
    const current = refreshSelection();
    try {
      const anchorRange = document.createRange();
      anchorRange.selectNodeContents(root);
      anchorRange.setEnd(selection.anchorNode, selection.anchorOffset);
      const focusRange = document.createRange();
      focusRange.selectNodeContents(root);
      focusRange.setEnd(selection.focusNode, selection.focusOffset);
      const crossedSentinel = anchorRange.toString().includes(EDITOR_SENTINEL) || focusRange.toString().includes(EDITOR_SENTINEL);
      if (crossedSentinel) {
        correctingSelection = true;
        setLiveSelection(root, current.start, current.end, current.direction);
        queueMicrotask(() => { correctingSelection = false; });
      }
    } catch { /* selection is still safely clamped by the compatibility getters */ }
  };
  document.addEventListener("selectionchange", onSelectionChange);

  const insertPlainText = (text, inputType = "insertText") => {
    const start = root.selectionStart;
    const end = root.selectionEnd;
    root.setRangeText(text, start, end, "end");
    root.dispatchEvent(new InputEvent("input", { bubbles: true, inputType, data: text }));
  };

  const onBeforeInput = (event) => {
    event.stopPropagation();
    if (event.inputType !== "insertParagraph" && event.inputType !== "insertLineBreak") return;
    event.preventDefault();
    insertPlainText("\n", event.inputType);
  };

  const onPaste = (event) => {
    event.stopPropagation();
    const text = event.clipboardData?.getData("text/plain");
    if (text == null) return;
    event.preventDefault();
    insertPlainText(text.replace(/\r\n?/g, "\n"), "insertFromPaste");
  };

  const onDrop = (event) => {
    event.stopPropagation();
    const text = event.dataTransfer?.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    root.focus({ preventScroll: true });
    insertPlainText(text.replace(/\r\n?/g, "\n"), "insertFromDrop");
  };

  const onInputStabilize = () => {
    // Do not normalize/replace DOM after input. Only recover the invisible end
    // anchor if the browser removed it, then remember the live logical selection.
    if (!composing) ensureEditorSentinel(root);
    refreshSelection();
  };
  const onCompositionStart = (event) => { composing = true; root.dataset.ppEditorComposing = "1"; event.stopPropagation(); };
  const onCompositionEnd = (event) => {
    composing = false;
    delete root.dataset.ppEditorComposing;
    event.stopPropagation();
    ensureEditorSentinel(root);
    refreshSelection();
  };
  const onKeyDown = (event) => {
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && String(event.key).toLowerCase() === "a") {
      event.preventDefault();
      root.select();
    }
  };
  root.addEventListener("beforeinput", onBeforeInput);
  root.addEventListener("paste", onPaste);
  root.addEventListener("drop", onDrop);
  root.addEventListener("input", onInputStabilize);
  root.addEventListener("compositionstart", onCompositionStart);
  root.addEventListener("compositionend", onCompositionEnd);
  const onKeyBubbleStop = (event) => event.stopPropagation();
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("keyup", onKeyBubbleStop);
  root.addEventListener("keypress", onKeyBubbleStop);

  return {
    recover() { return stabilize(); },
    composing: () => composing,
    cleanup() {
      document.removeEventListener("selectionchange", onSelectionChange);
      root.removeEventListener("beforeinput", onBeforeInput);
      root.removeEventListener("paste", onPaste);
      root.removeEventListener("drop", onDrop);
      root.removeEventListener("input", onInputStabilize);
      root.removeEventListener("compositionstart", onCompositionStart);
      root.removeEventListener("compositionend", onCompositionEnd);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("keyup", onKeyBubbleStop);
      root.removeEventListener("keypress", onKeyBubbleStop);
    },
  };
}

function installEditorLivenessGuard(editor, { singleSurface = false, recoverSurface = null } = {}) {
  if (!editor?.addEventListener) return { recover() { return false; }, cleanup() {} };
  let composing = false;
  let repairing = false;
  let repairQueued = false;

  const lockedByShotMode = () => !!editor.closest?.(".clip-disabled");
  const recover = ({ focus = false } = {}) => {
    if (repairing || editor.isConnected === false) return false;
    repairing = true;
    try {
      // Prompt editing is never disabled at the element level. Supplied clip
      // cards use their parent .clip-disabled state, so repairing these flags
      // cannot accidentally enable an editor that should be unavailable.
      editor.removeAttribute?.("inert");
      editor.removeAttribute?.("disabled");
      editor.removeAttribute?.("readonly");
      if ("disabled" in editor) editor.disabled = false;
      if ("readOnly" in editor) editor.readOnly = false;
      if (singleSurface && editor.getAttribute?.("contenteditable") !== "true") editor.setAttribute("contenteditable", "true");
      if (singleSurface && !composing) recoverSurface?.();
      if (focus && !lockedByShotMode() && document.activeElement !== editor) {
        try { editor.focus({ preventScroll: true }); } catch { editor.focus?.(); }
      }
      return !lockedByShotMode();
    } finally {
      repairing = false;
    }
  };

  const queueRecover = () => {
    if (repairing || repairQueued) return;
    repairQueued = true;
    queueMicrotask(() => { repairQueued = false; recover(); });
  };
  const onPointerDown = () => recover();
  const onFocus = () => recover();
  const onCompositionStart = () => { composing = true; };
  const onCompositionEnd = () => { composing = false; recover(); };
  const onVisibility = () => { if (document.visibilityState !== "hidden") recover(); };
  const onPageShow = () => recover();
  const onWindowFocus = () => recover();

  editor.addEventListener("pointerdown", onPointerDown, true);
  editor.addEventListener("focus", onFocus, true);
  editor.addEventListener("compositionstart", onCompositionStart);
  editor.addEventListener("compositionend", onCompositionEnd);
  document.addEventListener?.("visibilitychange", onVisibility);
  globalThis.window?.addEventListener?.("pageshow", onPageShow);
  globalThis.window?.addEventListener?.("focus", onWindowFocus);
  const observer = typeof MutationObserver === "function" ? new MutationObserver(queueRecover) : null;
  observer?.observe(editor, { attributes: true, attributeFilter: ["contenteditable", "disabled", "readonly", "inert"] });
  recover();

  return {
    recover,
    cleanup() {
      observer?.disconnect();
      editor.removeEventListener("pointerdown", onPointerDown, true);
      editor.removeEventListener("focus", onFocus, true);
      editor.removeEventListener("compositionstart", onCompositionStart);
      editor.removeEventListener("compositionend", onCompositionEnd);
      document.removeEventListener?.("visibilitychange", onVisibility);
      globalThis.window?.removeEventListener?.("pageshow", onPageShow);
      globalThis.window?.removeEventListener?.("focus", onWindowFocus);
    },
  };
}

export function upgradeEditorSurface(original) {
  if (!original || !supportsSingleSurfaceEditor()) {
    const liveness = installEditorLivenessGuard(original);
    return { element: original, mode: "textarea-overlay", nativeHighlights: false, recover: liveness.recover, cleanup: liveness.cleanup };
  }

  const editor = document.createElement("div");
  editor.className = original.className;
  for (const attr of original.attributes) {
    if (attr.name === "class") continue;
    editor.setAttribute(attr.name, attr.value);
  }
  editor.removeAttribute("spellcheck");
  // ComfyUI's current keybinding guard recognizes contentEditable === "true" as a text
  // input, but not the standards-valid "plaintext-only" value. Keep this surface
  // explicitly "true" and enforce plain text ourselves in beforeinput/paste/drop so
  // Backspace, printable keys, and sidebar shortcuts never escape into the canvas.
  editor.setAttribute("contenteditable", "true");
  editor.setAttribute("spellcheck", original.spellcheck ? "true" : "false");
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-multiline", "true");
  editor.setAttribute("autocapitalize", "off");
  editor.setAttribute("autocomplete", "off");
  editor.dataset.ppEditorSurface = "single";
  editor.dataset.ppEditorId = `pp-editor-${++surfaceCounter}`;
  editor.textContent = String(original.value || "") + EDITOR_SENTINEL;
  original.replaceWith(editor);
  const compatibility = installTextareaCompatibility(editor);
  const liveness = installEditorLivenessGuard(editor, { singleSurface: true, recoverSurface: compatibility.recover });

  return {
    element: editor,
    mode: "single-surface",
    nativeHighlights: true,
    recover: liveness.recover,
    cleanup() { liveness.cleanup(); compatibility.cleanup(); },
  };
}
