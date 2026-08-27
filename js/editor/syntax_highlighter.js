import { createDomRangeForOffsets } from "./editor_surface.js";

function supportsNativeHighlights(editor) {
  return !!(editor?.dataset?.ppEditorSurface === "single" && globalThis.CSS?.highlights && globalThis.Highlight);
}

function styleForDecoration(decoration) {
  if (decoration.kind === "wildcard") return `color:${decoration.color};text-shadow:0 0 0.35px currentColor;`;
  if (decoration.kind === "error") return "color:var(--wg-danger,#d86f70);text-decoration-line:underline;text-decoration-style:dashed;text-decoration-color:var(--wg-danger,#d86f70);";
  if (decoration.kind === "weight") return "color:color-mix(in srgb,var(--wg-accent,#d49a52) 82%,var(--wg-prompt-text,#f1eee8));text-shadow:0 0 0.35px currentColor;";
  if (decoration.kind === "modifier") return "color:var(--wg-success,#78b58b);text-shadow:0 0 0.35px currentColor;";
  if (decoration.kind === "bracket") return "color:var(--wg-accent,#d49a52);text-shadow:0 0 0.35px currentColor;";
  if (decoration.kind === "pipe") return "color:color-mix(in srgb,var(--wg-prompt-text,#f1eee8) 50%,transparent);";
  if (decoration.kind === "comment") return "color:var(--wg-text-faint,#8f887e);";
  if (decoration.kind === "h3_scene_token") return `color:color-mix(in srgb,${decoration.color} 78%,white 22%);background-color:color-mix(in srgb,${decoration.color} 22%,transparent);font-weight:850;text-decoration-line:underline;text-decoration-thickness:2px;text-decoration-color:color-mix(in srgb,${decoration.color} 72%,transparent);text-underline-offset:3px;`;
  if (decoration.kind === "h3_scene_variation") return `color:color-mix(in srgb,${decoration.color} 82%,white 18%);background-color:color-mix(in srgb,${decoration.color} 22%,transparent);font-weight:900;text-decoration-line:underline;text-decoration-thickness:2px;text-decoration-color:color-mix(in srgb,${decoration.color} 72%,transparent);text-underline-offset:3px;`;
  if (decoration.kind === "h3_cast_mention") return `color:color-mix(in srgb,${decoration.color} 82%,white 18%);background-color:color-mix(in srgb,${decoration.color} 16%,transparent);font-weight:850;text-decoration-line:underline;text-decoration-thickness:2px;text-decoration-color:color-mix(in srgb,${decoration.color} 68%,transparent);text-underline-offset:3px;`;
  if (decoration.kind === "h3_cast_variation") return `color:color-mix(in srgb,${decoration.color} 88%,white 12%);background-color:color-mix(in srgb,${decoration.color} 16%,transparent);font-weight:900;text-decoration-line:underline;text-decoration-thickness:2px;text-decoration-color:color-mix(in srgb,${decoration.color} 68%,transparent);text-underline-offset:3px;`;
  if (decoration.kind === "h3_media_mention") return `color:color-mix(in srgb,${decoration.color} 82%,white 18%);background-color:color-mix(in srgb,${decoration.color} 12%,transparent);font-weight:750;`;
  return "";
}

function priorityForDecoration(decoration) {
  // H3 semantic tokens intentionally sit above Prompt Palette's generic syntax
  // colors. This matters most for +/- audition markers, which are ordinary
  // punctuation to the generic parser but part of CAST/SCENE to Creator.
  if (decoration.kind === "error") return 4;
  if (String(decoration.kind || "").startsWith("h3_")) return 3;
  return 0;
}

const escapeFallbackText = (value) => String(value ?? "").replace(/[&<>]/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;",
}[char]));

/**
 * Paint the same decoration ranges into the textarea compatibility overlay.
 *
 * Native CSS Highlights consume ``decorations`` directly. The older overlay
 * previously reused only Prompt Palette's generic parser HTML, so host-added
 * semantic ranges such as Creator's CAST / CLOTHING / CAMERA tokens vanished
 * in browser engines that genuinely require the compatibility surface.
 */
export function renderFallbackDecorationLines(sourceText, decorations = []) {
  const source = String(sourceText ?? "");
  const sourceDecorations = Array.isArray(decorations) ? decorations : [];
  const rows = [];
  for (let start = 0; start <= source.length;) {
    const newline = source.indexOf("\n", start);
    const end = newline < 0 ? source.length : newline;
    const active = [];
    const boundaries = new Set([start, end]);
    for (let order = 0; order < sourceDecorations.length; order++) {
      const decoration = sourceDecorations[order];
      const from = Number(decoration?.start), to = Number(decoration?.end);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || from < 0 || to > source.length) continue;
      const clippedStart = Math.max(start, from), clippedEnd = Math.min(end, to);
      if (clippedEnd <= clippedStart) continue;
      active.push({ decoration, from, to, order, priority: priorityForDecoration(decoration) });
      boundaries.add(clippedStart); boundaries.add(clippedEnd);
    }
    const points = [...boundaries].sort((a, b) => a - b);
    const parts = [];
    for (let index = 0; index < points.length - 1; index++) {
      const from = points[index], to = points[index + 1];
      if (to <= from) continue;
      const winner = active
        .filter((row) => row.from <= from && row.to >= to)
        .sort((a, b) => b.priority - a.priority || b.order - a.order)[0];
      const text = escapeFallbackText(source.slice(from, to));
      const style = winner ? styleForDecoration(winner.decoration) : "";
      parts.push(style ? `<span style="${style}">${text}</span>` : text);
    }
    rows.push(parts.join(""));
    if (newline < 0) break;
    start = newline + 1;
    if (start > source.length) break;
  }
  return rows.length ? rows : [""];
}

function hashStyle(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createSyntaxHighlighter(editor, fallbackLayer) {
  const native = supportsNativeHighlights(editor);
  if (!native) return { native: false, render() { return false; }, reset() {}, clear() {} };

  const prefix = String(editor.dataset.ppEditorId || "pp-editor").replace(/[^a-zA-Z0-9_-]/g, "-");
  const styleElement = document.createElement("style");
  styleElement.dataset.promptPaletteEditorHighlights = prefix;
  document.head.appendChild(styleElement);
  const registered = new Set();
  if (fallbackLayer) fallbackLayer.style.display = "none";

  function clearRegistry() {
    for (const name of registered) CSS.highlights.delete(name);
    registered.clear();
    styleElement.textContent = "";
  }

  function render(decorations = [], sourceText = editor.value) {
    try {
      clearRegistry();
      if (!sourceText || !decorations.length) return true;
      const groups = new Map();
      for (const decoration of decorations) {
        const start = Number(decoration.start);
        const end = Number(decoration.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0 || end > sourceText.length) continue;
        const style = styleForDecoration(decoration);
        if (!style) continue;
        const priority = priorityForDecoration(decoration);
        const key = `${priority}\u0000${style}`;
        if (!groups.has(key)) groups.set(key, { style, priority, ranges: [] });
        groups.get(key).ranges.push({ start, end });
      }
      const rules = [];
      let order = 0;
      for (const { style, priority, ranges } of groups.values()) {
        const name = `${prefix}-${hashStyle(`${priority}:${style}`)}-${order++}`;
        const domRanges = [];
        for (const item of ranges) {
          try { domRanges.push(createDomRangeForOffsets(editor, item.start, item.end)); } catch { /* one bad range must not drop the editor */ }
        }
        if (!domRanges.length) continue;
        const highlight = new Highlight(...domRanges);
        if ("priority" in highlight) highlight.priority = priority;
        CSS.highlights.set(name, highlight);
        registered.add(name);
        rules.push(`[data-pp-editor-id="${prefix}"]::highlight(${name}){${style}}`);
      }
      styleElement.textContent = rules.join("\n");
      return true;
    } catch (error) {
      console.warn("Prompt Palette: native syntax highlighting repaint failed; keeping the single editable surface visible", error);
      clearRegistry();
      // 3.13.0B: a native single-surface editor must never reveal the legacy
      // mirror. Doing so paints a second copy of every glyph with independent
      // wrapping and is the root of the portable double-text/caret drift bug.
      // A failed Highlight repaint therefore degrades to plain editable text
      // until the next render instead of activating a second text layer.
      if (fallbackLayer) fallbackLayer.style.display = "none";
      return true;
    }
  }

  return {
    native: true,
    render,
    reset() { clearRegistry(); },
    clear() {
      clearRegistry();
      styleElement.remove();
      if (fallbackLayer) fallbackLayer.style.display = "";
    },
  };
}
