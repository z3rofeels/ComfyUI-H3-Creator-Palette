import * as H from "./z3_h3_api.js";
import { subscribeCreatorBody } from "./h3_workspace_runtime.js";
import { saveMachineSettings } from "./h3_settings_store.js";

const PREVIEW_EVENT = "kj_preview_override";
const SIDE_GAP = 10;
const DEFAULT_WIDTH = 340;
const PREVIEW_PREFS_KEY = "z3.minimaxCreator.previewPrefs.v1";

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const button = (text, fn, cls = "z3h3-btn") => {
  const node = el("button", cls, text);
  node.type = "button";
  node.addEventListener("pointerdown", (event) => event.stopPropagation());
  node.addEventListener("click", async (event) => {
    event.stopPropagation();
    try { await fn?.(event); } catch (error) {
      console.error("MiniMax Creator preview action failed", error);
      node.dataset.error = "1"; node.title = error?.message || String(error);
      setTimeout(() => delete node.dataset.error, 1600);
    }
  });
  return node;
};
const select = (options, value) => { const node=document.createElement("select");for(const row of options){const [key,label]=Array.isArray(row)?row:[row,row],option=document.createElement("option");option.value=String(key);option.textContent=String(label);option.selected=String(key)===String(value);node.append(option);}return node; };
const checkbox = (checked) => { const node=document.createElement("input");node.type="checkbox";node.checked=!!checked;return node; };
const field = (label, control, hint="") => { const node=el("label","z3h3-field");node.append(el("span",null,label),control);if(hint)node.append(el("small","z3h3-note",hint));return node; };
const section = (title, ...children) => { const node=el("section","z3h3-section");node.append(el("h3",null,title),...children.filter(Boolean));return node; };
function settingsModal(title){const back=el("div","z3h3-backdrop"),box=el("div","z3h3-modal wide"),head=el("div","z3h3-modal-head"),body=el("div","z3h3-modal-body"),close=()=>back.remove();head.append(el("div",null,title),el("div","z3h3-spacer"),button("Close",close));box.append(head,body);back.append(box);document.body.append(back);back.addEventListener("mousedown",event=>{if(event.target===back)close();});return {body,close};}

function eventDetail(event) {
  return event?.detail || event || {};
}

function belongsToCreator(nodeId, creatorId) {
  const child = String(nodeId ?? "");
  const parent = String(creatorId ?? "");
  return child === parent || child.startsWith(`${parent}.`);
}

function bestTinyVae(files) {
  const names = Array.isArray(files) ? files : [];
  const scored = names.map((name) => {
    const lower = String(name).toLowerCase();
    let score = 0;
    if (lower.includes("taeh3")) score += 100;
    if (lower.includes("taehv")) score += 90;
    if (lower.includes("minimax")) score += 50;
    if (lower.includes("h3")) score += 40;
    if (lower.includes("tiny")) score += 10;
    return { name, score };
  }).filter((row) => row.score > 0);
  scored.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
  return scored[0]?.name || "";
}

function formatMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n)} ms/step` : "";
}

function dataUrl(payload) {
  if (!payload?.image) return "";
  const mime = String(payload.mime || "image/jpeg");
  return `data:${mime};base64,${payload.image}`;
}

function readPreviewPrefs(body) {
  const workflow = body?.node?.properties?.z3_preview_prefs;
  if (workflow && typeof workflow === "object" && !Array.isArray(workflow)) return { ...workflow };
  try { return JSON.parse(localStorage.getItem(PREVIEW_PREFS_KEY) || "{}") || {}; }
  catch { return {}; }
}

function writePreviewPrefs(body, patch) {
  const base = readPreviewPrefs(body);
  const next = { ...base, ...(patch && typeof patch === "object" ? patch : {}) };
  try { localStorage.setItem(PREVIEW_PREFS_KEY, JSON.stringify(next)); } catch {}
  if (body?.node) {
    body.node.properties ||= {};
    body.node.properties.z3_preview_prefs = { ...next };
    body.node.graph?.setDirtyCanvas?.(true, true);
  }
  return next;
}

export class H3PreviewSidecar {
  constructor(body) {
    this.body = body;
    this.node = body.node;
    this.enabled = true;
    this.autoplay = true;
    this.available = false;
    this.decoder = "";
    this.previewFrames = 1024;
    this.previewMaxResolution = 640;
    this.previewJpegQuality = 78;
    this.previewFps = 24;
    this.previewInfo = "standard";
    this.previewHiddenMode = "armed";
    this.destroyed = false;
    this.lastPreview = null;
    this.lastFinal = null;
    this.active = false;
    this._raf = 0;
    this._settingsRevision = 0;
    const initialPrefs = readPreviewPrefs(this.body);
    this.manualPosition = initialPrefs.preview_position && typeof initialPrefs.preview_position === "object" ? {...initialPrefs.preview_position} : null;
    this._drag = null;

    this.toggleButton = button("Preview", () => this.toggle(), "z3h3-btn z3h3-preview-toggle");
    this.toggleButton.title = "Open or hide the TinyVAE preview. If a render is already running, Start Preview attaches to its armed check stream without requeueing.";
    this.toggleButton.setAttribute("aria-pressed", "true");

    this.root = el("aside", "z3h3-preview-sidecar");
    this.root.hidden = true;
    this.root.dataset.state = "idle";

    const head = el("header", "z3h3-preview-head");
    this.head = head;
    head.title = "Drag to move the preview. Double-click to dock beside the Creator again.";
    const brand = el("div", "z3h3-preview-brand");
    brand.append(el("b", null, "H3 Preview"), el("small", null, "TinyVAE live decode"));
    this.statePill = el("span", "z3h3-preview-state", "Ready");
    this.dockButton = button("↺", () => this.resetPosition(), "z3h3-preview-close");
    this.dockButton.title = "Dock Preview beside the Creator again";
    this.closeButton = button("×", () => this.setEnabled(false), "z3h3-preview-close");
    this.closeButton.title = "Turn Preview off";
    this.closeButton.setAttribute("aria-label", "Turn Preview off");
    head.append(brand, this.statePill, this.dockButton, this.closeButton);

    this.viewport = el("div", "z3h3-preview-viewport");
    this.empty = el("div", "z3h3-preview-empty");
    this.emptyIcon = el("div", "z3h3-preview-empty-icon", "▶");
    this.emptyTitle = el("b", null, "Preview is ready");
    this.emptyText = el("small", null, "Queue a render to watch the H3 video resolve here.");
    this.empty.append(this.emptyIcon, this.emptyTitle, this.emptyText);
    this.viewport.append(this.empty);

    this.progress = el("div", "z3h3-preview-progress");
    this.progressBar = el("i");
    this.progress.append(this.progressBar);
    this.meta = el("div", "z3h3-preview-meta");
    this.metaPrimary = el("div");
    this.metaSecondary = el("small");
    this.meta.append(this.metaPrimary, this.metaSecondary);

    this.actions = el("footer", "z3h3-preview-actions");
    this.modelsButton = button("Preview setup", () => this.openSettings(), "z3h3-btn");
    this.rendersButton = button("Open Renders", () => this.body.openMedia?.("output"), "z3h3-btn");
    this.actions.append(this.modelsButton, this.rendersButton);

    this.root.append(head, this.viewport, this.progress, this.meta, this.actions);
    document.body.append(this.root);
    this.installDragging();

    this._onPreview = (event) => this.handleLive(eventDetail(event));
    H.api.addEventListener?.(PREVIEW_EVENT, this._onPreview);
    this._onResize = () => this.schedulePosition();
    globalThis.addEventListener?.("resize", this._onResize, { passive: true });
    globalThis.addEventListener?.("scroll", this._onResize, { passive: true, capture: true });
    this._workspaceUnsubscribe = subscribeCreatorBody((activeBody) => {
      this.active = activeBody === this.body;
      this.syncChrome();
      if (this.active && this.body.lastOutput?.mmc_video?.length) this.showFinal(this.body.lastOutput);
    });

    this.refreshFromServer({ autoConfigure: true });
  }

  async refreshFromServer({ autoConfigure = false } = {}) {
    const revision = this._settingsRevision;
    try {
      const settingsResult = await H.readSettings();
      if (this.destroyed || revision !== this._settingsRevision) return;
      const settings = settingsResult.settings || {};
      this.enabled = settings.preview_sidecar !== false;
      this.autoplay = settings.autoplay_previews !== false;
      this.previewFrames = Number(settings.preview_frames || 1024);
      this.previewMaxResolution = Number(settings.preview_max_resolution || 640);
      this.previewJpegQuality = Number(settings.preview_jpeg_quality || 78);
      this.previewFps = Number(settings.preview_fps || 24);
      this.previewInfo = ["minimal","standard","detailed"].includes(settings.preview_info)?settings.preview_info:"standard";
      this.previewHiddenMode = settings.preview_hidden_mode === "off" ? "off" : "armed";
      const modelBlock = this.body.data.models || (this.body.data.models = {});
      this.decoder = String(modelBlock.preview || "");
      if (!this.enabled) {
        this.available = false;
        this.syncChrome();
        return;
      }
      const modelsResult = await H.listModels();
      if (this.destroyed || revision !== this._settingsRevision) return;
      this.available = modelsResult.preview_override === true;
      if (autoConfigure && this.available && !this.decoder) {
        const picked = bestTinyVae(modelsResult.files?.preview);
        if (picked) {
          modelBlock.preview = picked;
          this.decoder = picked;
          this.body.commitData?.();
        }
      }
      this.syncChrome();
      this.syncInfoVisibility();
      this.renderIdleState();
    } catch (error) {
      if (this.destroyed) return;
      this.enabled = true;
      this.available = false;
      this.syncChrome();
      this.showMessage("Preview setup unavailable", error?.message || String(error), "warn");
    }
  }

  async setEnabled(enabled) {
    const value = !!enabled;
    const revision = ++this._settingsRevision;
    this.enabled = value;
    this.syncChrome();
    // Hiding the window never mutates the current render. Armed mode keeps a
    // lightweight stream attachable; zero-overhead mode applies on next queue.
    if (!value) this.hideMedia();
    else if (this.lastPreview) this.renderLive(this.lastPreview);
    else if (this.lastFinal) this.showFinal({ mmc_video: [this.lastFinal] });
    try {
      await saveMachineSettings({ preview_sidecar: value, autoplay_previews: this.autoplay });
      if (revision !== this._settingsRevision) return;
      if (value) await this.refreshFromServer({ autoConfigure: true });
    } catch (error) {
      this.showMessage("Could not save Preview setting", error?.message || String(error), "warn");
    }
  }

  syncInfoVisibility() {
    this.meta.hidden = this.previewInfo === "minimal";
  }

  async openSettings() {
    const {body,close}=settingsModal("H3 TinyVAE Preview Settings");
    const loading=el("div","z3h3-note","Reading TinyVAE models and machine preview settings…");body.append(loading);
    try{
      const [settingsResult,modelsResult]=await Promise.all([H.readSettings(),H.listModels()]),settings=settingsResult.settings||{},files=modelsResult.files?.preview||[];
      const enabled=checkbox(settings.preview_sidecar!==false),autoplay=checkbox(settings.autoplay_previews!==false),frames=select([[1,"1 frame · fastest still"],[4,"4 frames · very fast motion check"],[8,"8 frames · fast"],[16,"16 frames · balanced"],[32,"32 frames · smoother"],[64,"64 frames · detailed motion"],[1024,"Full clip · heaviest / best context"]],settings.preview_frames||1024),resolution=select([[256,"256 px · lowest transfer"],[384,"384 px · fast"],[512,"512 px · balanced"],[640,"640 px · sharp sidecar"],[768,"768 px · high detail"]],settings.preview_max_resolution||640),quality=select([[50,"50 · smallest JPEG"],[65,"65 · fast"],[78,"78 · balanced"],[90,"90 · high fidelity"]],settings.preview_jpeg_quality||78),fps=select([[4,"4 fps · lowest browser work"],[6,"6 fps · fast"],[12,"12 fps · smooth enough"],[24,"24 fps · source speed"]],settings.preview_fps||24),info=select([["minimal","Minimal · state and progress only"],["standard","Standard · step, size and FPS"],["detailed","Detailed · timing, decoder and decode limits"]],settings.preview_info||"standard"),hidden=select([["armed","Attachable · 1-frame check while hidden"],["off","Zero overhead while Preview is off"]],settings.preview_hidden_mode||"armed"),decoder=select([["","— choose taeh3 / H3 TinyVAE —"],...files.map(name=>[name,name])],this.body.data.models?.preview||""),status=el("div","z3h3-note good","Changes save automatically and apply to the next queued render."),profiles=el("div","z3h3-tabs"),grid=el("div","z3h3-shot-options-grid");
      const controls={enabled,autoplay,frames,resolution,quality,fps,info,hidden};
      const applyLocal=()=>{this.enabled=enabled.checked;this.autoplay=autoplay.checked;this.previewFrames=Number(frames.value);this.previewMaxResolution=Number(resolution.value);this.previewJpegQuality=Number(quality.value);this.previewFps=Number(fps.value);this.previewInfo=info.value;this.previewHiddenMode=hidden.value;this.syncInfoVisibility();this.syncChrome();};
      const save=async()=>{applyLocal();status.textContent="Saving preview settings…";status.className="z3h3-note";try{await saveMachineSettings({preview_sidecar:enabled.checked,autoplay_previews:autoplay.checked,preview_frames:Number(frames.value),preview_max_resolution:Number(resolution.value),preview_jpeg_quality:Number(quality.value),preview_fps:Number(fps.value),preview_info:info.value,preview_hidden_mode:hidden.value});status.textContent="Saved. These hardware preferences apply to the next queue and survive reloads.";status.className="z3h3-note good";}catch(error){status.textContent=`Could not save preview settings: ${error.message||error}`;status.className="z3h3-error";}};
      const profile=(values)=>async()=>{frames.value=String(values.frames);resolution.value=String(values.resolution);quality.value=String(values.quality);fps.value=String(values.fps);info.value=values.info;await save();};
      profiles.append(button("Fast preview",profile({frames:4,resolution:384,quality:65,fps:6,info:"minimal"})),button("Balanced 16 GB",profile({frames:16,resolution:512,quality:78,fps:12,info:"standard"}),"z3h3-btn primary"),button("Full clip",profile({frames:1024,resolution:640,quality:78,fps:24,info:"detailed"})));
      for(const control of Object.values(controls))control.addEventListener("change",save);
      decoder.addEventListener("change",async()=>{this.body.data.models ||= {};if(decoder.value)this.body.data.models.preview=decoder.value;else delete this.body.data.models.preview;this.decoder=decoder.value;this.body.commitData?.();status.textContent="Saving decoder selection…";await this.body.persistModelDefaults?.(status);this.available=modelsResult.preview_override===true;this.renderIdleState();});
      const decoderNote=modelsResult.preview_override?"KJNodes Model Preview Override is installed. taeh3 is recommended for MiniMax H3.":"KJNodes Model Preview Override is not installed; settings will remain saved, but live TinyVAE decoding cannot run yet.";
      grid.append(section("Decode workload",field("Frames decoded per sampling update",frames,"Small counts preview only the opening motion. Full clip gives the most context and costs the most decode time."),field("Maximum preview resolution",resolution,"Limits the proxy sent to the browser; it never changes final output resolution."),field("Preview playback FPS",fps,"Changes preview playback/transport only, not generated video timing."),field("JPEG quality",quality,"Higher values improve the proxy image and increase transfer/browser work.")),section("Display & behavior",field("Show Preview sidecar",enabled,"When off, the selected hidden mode controls whether any TinyVAE wrapper is queued."),field("Autoplay animated previews",autoplay),field("Information shown",info),field("When Preview is off",hidden,"Attachable allows Start Preview during a running job. Zero overhead requires requeueing after Preview is enabled.")));
      body.replaceChildren(el("div","z3h3-model-default-note","These are machine preferences, not creative workflow settings. They control TinyVAE decode and browser transport only; final VAE quality, length, resolution and sampling remain unchanged."),section("Hardware profiles",profiles),grid,section("TinyVAE decoder",field("Preview decoder",decoder,decoderNote)),status,el("div","z3h3-tabs"));
      body.lastChild.append(button("Done",close,"z3h3-btn primary"));applyLocal();
    }catch(error){loading.className="z3h3-error";loading.textContent=error.message||String(error);}
  }

  installDragging() {
    const start = (event) => {
      if (event.button !== 0 || event.target?.closest?.("button")) return;
      const rect = this.root.getBoundingClientRect();
      this._drag = { pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      this.head.setPointerCapture?.(event.pointerId);
      this.root.dataset.moving = "1";
      event.preventDefault(); event.stopPropagation();
    };
    const move = (event) => {
      if (!this._drag || event.pointerId !== this._drag.pointerId) return;
      const vw = Math.max(320, document.documentElement.clientWidth || globalThis.innerWidth || 1280);
      const vh = Math.max(240, document.documentElement.clientHeight || globalThis.innerHeight || 720);
      const rect = this.root.getBoundingClientRect();
      const left = Math.max(8, Math.min(event.clientX - this._drag.dx, vw - rect.width - 8));
      const top = Math.max(8, Math.min(event.clientY - this._drag.dy, vh - Math.min(rect.height, vh - 16) - 8));
      this.manualPosition = { left: Math.round(left), top: Math.round(top) };
      this.root.style.left = `${this.manualPosition.left}px`; this.root.style.top = `${this.manualPosition.top}px`;
      event.preventDefault(); event.stopPropagation();
    };
    const end = (event) => {
      if (!this._drag || event.pointerId !== this._drag.pointerId) return;
      this.head.releasePointerCapture?.(event.pointerId); this._drag = null; delete this.root.dataset.moving;
      if (this.manualPosition) writePreviewPrefs(this.body, { preview_position: this.manualPosition });
      event.preventDefault(); event.stopPropagation();
    };
    const reset = (event) => { if (event.target?.closest?.("button")) return; event.preventDefault(); this.resetPosition(); };
    this.head.addEventListener("pointerdown", start);
    this.head.addEventListener("pointermove", move);
    this.head.addEventListener("pointerup", end);
    this.head.addEventListener("pointercancel", end);
    this.head.addEventListener("dblclick", reset);
    this._dragCleanup = () => { this.head.removeEventListener("pointerdown", start); this.head.removeEventListener("pointermove", move); this.head.removeEventListener("pointerup", end); this.head.removeEventListener("pointercancel", end); this.head.removeEventListener("dblclick", reset); };
  }

  resetPosition() {
    this.manualPosition = null; writePreviewPrefs(this.body, { preview_position: null }); this.schedulePosition();
  }

  toggle() {
    this.setEnabled(!this.enabled);
  }

  syncChrome() {
    this.toggleButton.textContent = this.enabled ? "Preview On" : "Start Preview";
    this.toggleButton.classList.toggle("on", this.enabled);
    this.toggleButton.title = this.enabled
      ? `Hide Preview. ${this.previewHiddenMode==="armed"?"Future H3 jobs keep a lightweight check stream armed so you can reopen it during generation.":"Zero-overhead mode omits preview decoding from future jobs queued while hidden."}`
      : this.previewHiddenMode==="armed"
        ? "Start Preview now — including during an already-running H3 generation that was queued with the armed check stream."
        : "Enable Preview for the next queue. Zero-overhead mode cannot attach to a job that was queued while Preview was off.";
    this.toggleButton.setAttribute("aria-pressed", String(this.enabled));
    const visible = this.enabled && this.active;
    this.root.hidden = !visible;
    if (visible) {
      this.root.classList.add("open");
      this.schedulePosition();
      this.startTracking();
    } else {
      this.root.classList.remove("open");
      this.stopTracking();
    }
  }

  startTracking() {
    if (this._raf || this.destroyed || !this.enabled) return;
    const tick = () => {
      this._raf = 0;
      if (this.destroyed || !this.enabled) return;
      this.position();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  stopTracking() {
    if (!this._raf) return;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  schedulePosition() {
    if (!this.enabled || this.destroyed) return;
    this.position();
  }

  position() {
    const anchor = this.body.root?.getBoundingClientRect?.();
    if (!anchor || !Number.isFinite(anchor.left) || anchor.width < 1 || anchor.height < 1) {
      this.root.style.visibility = "hidden";
      return;
    }
    const vw = Math.max(320, document.documentElement.clientWidth || globalThis.innerWidth || 1280);
    const vh = Math.max(240, document.documentElement.clientHeight || globalThis.innerHeight || 720);
    const width = Math.min(DEFAULT_WIDTH, Math.max(280, vw - 24));
    let left = anchor.right + SIDE_GAP;
    let side = "right";
    if (left + width > vw - 8 && anchor.left - SIDE_GAP - width >= 8) {
      left = anchor.left - SIDE_GAP - width;
      side = "left";
    }
    left = Math.max(8, Math.min(left, vw - width - 8));
    let top = Math.max(8, Math.min(anchor.top, vh - 220));
    if (this.manualPosition) {
      left = Math.max(8, Math.min(Number(this.manualPosition.left)||8, vw - width - 8));
      top = Math.max(8, Math.min(Number(this.manualPosition.top)||8, vh - 220));
      side = "free";
    }
    const maxHeight = Math.max(220, Math.min(Math.max(anchor.height, 300), vh - top - 8));
    this.root.dataset.side = side;
    this.root.style.width = `${width}px`;
    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.top = `${Math.round(top)}px`;
    this.root.style.maxHeight = `${Math.round(maxHeight)}px`;
    this.root.style.visibility = anchor.bottom < 0 || anchor.top > vh ? "hidden" : "visible";
  }

  renderIdleState() {
    if (!this.enabled || this.lastPreview || this.lastFinal) return;
    if (!this.available) {
      this.showMessage("Install KJNodes for live preview", "Rendering still works normally. The sidecar needs Model Preview Override for TinyVAE decoding.", "warn");
      return;
    }
    if (!this.decoder) {
      this.showMessage("Choose a TinyVAE decoder", "Pick taeh3 / H3 TinyVAE in Models → Preview decoder. If one matching decoder is installed, Preview selects it automatically.", "warn");
      return;
    }
    this.showMessage("Preview is ready", `TinyVAE · ${this.decoder}`, "ready");
  }

  showMessage(title, text, state = "idle") {
    this.root.dataset.state = state;
    this.viewport.replaceChildren(this.empty);
    this.emptyTitle.textContent = title;
    this.emptyText.textContent = text || "";
    this.statePill.textContent = state === "warn" ? "Setup" : "Ready";
    this.progressBar.style.width = "0%";
    this.metaPrimary.textContent = "";
    this.metaSecondary.textContent = "";
  }

  hideMedia() {
    const media = this.viewport.querySelector("video, img");
    if (media?.tagName === "VIDEO") {
      try { media.pause(); } catch {}
      media.removeAttribute("src");
      try { media.load(); } catch {}
    }
    this.viewport.replaceChildren(this.empty);
  }

  clearMedia() {
    this.hideMedia();
    this.lastPreview = null;
    this.lastFinal = null;
  }

  renderLive(payload) {
    if (!payload || !this.enabled || !this.active) return false;
    const src = dataUrl(payload);
    if (!src) return false;
    this.root.dataset.state = "sampling";
    this.statePill.textContent = "Sampling";

    const mime = String(payload.mime || "image/jpeg");
    let media;
    if (mime.startsWith("video/")) {
      media = document.createElement("video");
      media.muted = true;
      media.loop = true;
      media.playsInline = true;
      media.autoplay = this.autoplay;
      media.preload = "auto";
      media.src = src;
      if (this.autoplay) media.play().catch(() => {});
    } else {
      media = document.createElement("img");
      media.alt = "MiniMax H3 TinyVAE live preview";
      media.src = src;
    }
    media.className = "z3h3-preview-media";
    this.viewport.replaceChildren(media);

    const step = Number(payload.step || 0), total = Number(payload.total || 0);
    const pct = total > 0 ? Math.max(0, Math.min(100, step / total * 100)) : 0;
    this.progressBar.style.width = `${pct}%`;
    const dims = payload.w && payload.h ? `${payload.w}×${payload.h} preview proxy` : "TinyVAE preview proxy";
    this.metaPrimary.textContent = total ? `Step ${step} of ${total}` : "Live TinyVAE preview";
    const details=this.previewInfo==="detailed"?[dims,formatMs(payload.avg_step_ms),payload.fps?`${payload.fps} fps preview`:"",`${this.previewFrames===1024?"full clip":`${this.previewFrames} frames`} · ${this.previewMaxResolution}px max`,this.decoder?String(this.decoder).split(/[\\/]/).pop():""]:[dims,payload.fps?`${payload.fps} fps preview`:""];
    this.metaSecondary.textContent = details.filter(Boolean).join(" · ");
    this.syncInfoVisibility();
    this.schedulePosition();
    return true;
  }

  handleLive(payload) {
    if (!this.active || !belongsToCreator(payload.node_id, this.node.id)) return;
    if (!dataUrl(payload)) return;
    // Cache even while the sidecar is hidden. If the user remembers Preview in
    // the middle of a long run, Start Preview can show this frame immediately
    // and then continue with subsequent KJNodes updates.
    this.lastPreview = payload;
    this.lastFinal = null;
    if (!this.enabled) return;
    this.renderLive(payload);
  }

  showFinal(output) {
    if (!this.enabled || !this.active) return false;
    const video = (output?.mmc_video || [])[0];
    if (!video) return false;
    this.lastFinal = video;
    this.lastPreview = null;
    this.root.dataset.state = "finished";
    this.statePill.textContent = "Finished";
    const media = document.createElement("video");
    media.controls = true;
    media.loop = true;
    media.playsInline = true;
    media.preload = "metadata";
    media.src = H.viewUrl(video);
    media.className = "z3h3-preview-media final";
    this.viewport.replaceChildren(media);
    this.progressBar.style.width = "100%";
    this.metaPrimary.textContent = String(video.filename || "Rendered video").split(/[\\/]/).pop();
    const takes = output?.mmc_takes?.length || 0,finalDimensions=video.width&&video.height?`${video.width}×${video.height}`:"";
    this.metaSecondary.textContent = [finalDimensions,"Final VAE render", takes ? `${takes} shot take${takes === 1 ? "" : "s"} saved` : "", "ready in Renders"].filter(Boolean).join(" · ");
    this.syncInfoVisibility();
    if (this.autoplay) media.play().catch(() => {});
    this.schedulePosition();
    return true;
  }

  destroy() {
    this.destroyed = true;
    this.stopTracking();
    H.api.removeEventListener?.(PREVIEW_EVENT, this._onPreview);
    this._workspaceUnsubscribe?.();
    this._dragCleanup?.();
    globalThis.removeEventListener?.("resize", this._onResize);
    globalThis.removeEventListener?.("scroll", this._onResize, true);
    this.clearMedia();
    this.root.remove();
  }
}

export function installPreviewSidecar(body) {
  return new H3PreviewSidecar(body);
}
