import {
  applyPromptPaletteThemeScope,
  clearLegacyPromptPaletteGlobalTheme,
  applyPromptPaletteNodeChrome,
  onPromptPaletteAppearanceChanged,
} from "./prompt_palette_shared.js";
import { readSuiteAppearanceSnapshot } from "./editor/suite_appearance.js";

const SURFACE_SELECTOR = [
  ".z3h3",
  ".z3h3-right-shade",
  ".z3h3-right-drawer",
  ".z3h3-preview-sidecar",
  ".z3h3-director-dock",
  ".z3h3-backdrop",
  ".z3h3-modal",
  ".z3h3-studio-backdrop",
  ".z3h3-cast-studio",
  ".z3h3-quick-menu",
  ".z3h3-mention-menu",
  ".z3h3-scene-call-menu",
  ".z3h3-sidebar-root",
  ".z3h3-timing-inspector",
  ".z3h3-thumbnail-browser",
].join(",");

function applySnapshot(target, snapshot) {
  if (!target?.style || !snapshot) return snapshot;
  applyPromptPaletteThemeScope(target, snapshot.colors, snapshot.typography, snapshot.effects);
  target.dataset.z3Appearance = "prompt-palette";
  return snapshot;
}

export function applyCreatorAppearance(target, node = null) {
  clearLegacyPromptPaletteGlobalTheme();
  const snapshot = readSuiteAppearanceSnapshot();
  applySnapshot(target, snapshot);
  if (node) applyPromptPaletteNodeChrome(node, snapshot.colors, { accentBorder: snapshot.theme?.nodeAccentBorder === true });
  return snapshot;
}

export function bindCreatorAppearance({ node = null, targets = [], onApplied = null } = {}) {
  let liveTargets = Array.isArray(targets) ? targets : [targets];
  const apply = () => {
    clearLegacyPromptPaletteGlobalTheme();
    const snapshot = readSuiteAppearanceSnapshot();
    for (const target of liveTargets.flat().filter(Boolean)) applySnapshot(target, snapshot);
    if (node) applyPromptPaletteNodeChrome(node, snapshot.colors, { accentBorder: snapshot.theme?.nodeAccentBorder === true });
    onApplied?.(snapshot);
    return snapshot;
  };
  const cleanup = onPromptPaletteAppearanceChanged(apply);
  apply();
  return {
    apply,
    cleanup,
    setTargets(next) { liveTargets = Array.isArray(next) ? next : [next]; apply(); },
  };
}

let installed = false;
let observer = null;
let appearanceCleanup = null;

function themedSurfaces(root = document) {
  if (!root?.querySelectorAll) return [];
  const out = [];
  if (root.matches?.(SURFACE_SELECTOR)) out.push(root);
  out.push(...root.querySelectorAll(SURFACE_SELECTOR));
  return out;
}

function refreshDocumentSurfaces() {
  const snapshot = readSuiteAppearanceSnapshot();
  for (const target of themedSurfaces(document)) applySnapshot(target, snapshot);
}

/**
 * Theme body-mounted Creator surfaces (Storyboard, Setup, Cast Studio, Preview,
 * context menus, etc.) without leaking Prompt Palette variables onto :root.
 */
export function installCreatorAppearanceRuntime() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  clearLegacyPromptPaletteGlobalTheme();
  appearanceCleanup = onPromptPaletteAppearanceChanged(refreshDocumentSurfaces);
  observer = new MutationObserver((records) => {
    const snapshot = readSuiteAppearanceSnapshot();
    for (const record of records) {
      for (const added of record.addedNodes || []) {
        if (!(added instanceof HTMLElement)) continue;
        for (const target of themedSurfaces(added)) applySnapshot(target, snapshot);
      }
    }
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  refreshDocumentSurfaces();
}

export function destroyCreatorAppearanceRuntime() {
  observer?.disconnect(); observer = null;
  appearanceCleanup?.(); appearanceCleanup = null;
  installed = false;
}
