const CONTROL_MODES = new Set(["fixed", "increment", "decrement", "randomize"]);

function valuesOf(widget) {
  const values = widget?.options?.values;
  return Array.isArray(values) ? values.map(String) : [];
}

export function variationLifecycleWidget(node, target) {
  if (!target) return null;
  const widgets = Array.isArray(node?.widgets) ? node.widgets : [];
  const index = widgets.indexOf(target);
  if (index >= 0) {
    // Current ComfyUI represents control-after-generate as a companion combo
    // immediately after its numeric target. Match by behavior, not its display
    // name, because several controls can coexist on one node.
    for (const candidate of widgets.slice(index + 1, index + 4)) {
      const values = valuesOf(candidate);
      if (values.length && [...CONTROL_MODES].every((mode) => values.includes(mode))) return candidate;
      if (candidate?.serialize !== false && candidate?.options?.serialize !== false) break;
    }
  }
  // Direct lifecycle callbacks remain valid for frontends that expose only the
  // schema widget. Supporting both forms keeps saved widget positions intact.
  return target;
}

export function installVariationQueueLifecycle({node,target,hasVariations,currentIndex,setIndex,onQueued,onAdvanced}={}) {
  const lifecycle = variationLifecycleWidget(node, target);
  if (!lifecycle || !target) return () => {};
  const previousBefore = lifecycle.beforeQueued;
  const previousAfter = lifecycle.afterQueued;
  const companion = lifecycle !== target;
  const previousMode = companion ? lifecycle.value : undefined;
  if (companion) lifecycle.value = "fixed";
  let queuedStep = null;

  lifecycle.beforeQueued = function(...args) {
    const result = previousBefore?.apply(this, args);
    if (hasVariations?.()) {
      queuedStep = Math.max(0, Math.trunc(Number(currentIndex?.()) || 0));
      target.value = queuedStep;
      onQueued?.(queuedStep);
    } else {
      queuedStep = null;
      onQueued?.(null);
    }
    return result;
  };
  lifecycle.afterQueued = function(...args) {
    const result = previousAfter?.apply(this, args);
    if (queuedStep !== null) {
      setIndex?.(queuedStep + 1);
      onAdvanced?.(queuedStep + 1);
    }
    queuedStep = null;
    onQueued?.(null);
    return result;
  };
  return () => {
    lifecycle.beforeQueued = previousBefore;
    lifecycle.afterQueued = previousAfter;
    if (companion && lifecycle.value === "fixed") lifecycle.value = previousMode;
  };
}
