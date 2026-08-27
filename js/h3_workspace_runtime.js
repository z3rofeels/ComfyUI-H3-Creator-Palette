// Small shared registry for the Creator workspace surfaces.
// The node body, left sidebar and right settings drawer communicate through this
// module rather than reaching into one another's DOM or ComfyUI internals.
const bodies = new Set();
const listeners = new Set();
let activeBody = null;

function bodyAlive(body) {
  if (!body) return false;
  // ComfyUI may temporarily detach DOM widgets while remounting/virtualizing them.
  // The graph relationship is the stable lifetime signal; DOM connectivity is only
  // a presentation detail.
  return !!body.node?.graph || !!body.root?.isConnected;
}

function emit(reason = "change") {
  for (const listener of [...listeners]) {
    try { listener(activeBody, reason); } catch (error) { console.error("MiniMax Creator workspace listener failed", error); }
  }
}

export function setActiveCreatorBody(body, reason = "active") {
  if (body && !bodies.has(body)) bodies.add(body);
  if (activeBody === body) { emit(reason); return; }
  activeBody = body || null;
  emit(reason);
}

export function registerCreatorBody(body) {
  if (!body) return () => {};
  bodies.add(body);
  const activate = () => setActiveCreatorBody(body, "active");
  body.root?.addEventListener("pointerdown", activate, true);
  body.root?.addEventListener("focusin", activate, true);
  if (!activeBody) setActiveCreatorBody(body, "registered");
  return () => {
    body.root?.removeEventListener("pointerdown", activate, true);
    body.root?.removeEventListener("focusin", activate, true);
    bodies.delete(body);
    if (activeBody === body) {
      activeBody = [...bodies].find(bodyAlive) || null;
      emit("removed");
    }
  };
}

export function notifyCreatorBodyChanged(body, reason = "data") {
  if (body && bodies.has(body) && (!activeBody || activeBody === body)) activeBody = body;
  emit(reason);
}

export function activeCreatorBody() {
  if (bodyAlive(activeBody)) return activeBody;
  activeBody = [...bodies].find(bodyAlive) || null;
  return activeBody;
}

export function subscribeCreatorBody(listener) {
  listeners.add(listener);
  try { listener(activeCreatorBody(), "subscribe"); } catch (error) { console.error(error); }
  return () => listeners.delete(listener);
}
