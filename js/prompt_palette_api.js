import { api } from "../../scripts/api.js";

async function readApiJson(response, { allowNotFound = false } = {}) {
  let data = {};
  const text = await response.text();
  if (text) {
    try { data = JSON.parse(text); }
    catch { throw new Error(`Creator Palette received an invalid server response (${response.status})`); }
  }
  if (!response.ok) {
    if (allowNotFound && response.status === 404) return null;
    throw new Error(data?.error || data?.message || `Creator Palette request failed (${response.status})`);
  }
  return data;
}

function promptPaletteUrl(path) {
  return typeof api.apiURL === "function" ? api.apiURL(path) : path;
}

async function fetchApiResult(path, options) {
  try {
    return await readApiJson(await api.fetchApi(path, options));
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

function safeIntegerSeed(value, fallback = 0) {
  if (typeof value === "bigint") {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    return Number(value < 0n ? 0n : value > max ? max : value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === "string" && /^[+]?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
  }
  return Math.max(0, Math.trunc(Number(fallback) || 0));
}

const API = {
  thumbnailUrl(file, suffix = "") {
    return promptPaletteUrl(`/z3_minimax_creator/palette/thumb?file=${encodeURIComponent(file)}${suffix}`);
  },
  async list() {
    return (await readApiJson(await api.fetchApi("/z3_minimax_creator/palette/list"))).items || [];
  },
  async categories() {
    return await readApiJson(await api.fetchApi("/z3_minimax_creator/palette/categories"));
  },
  async search(q) {
    return (await readApiJson(await api.fetchApi(`/z3_minimax_creator/palette/search?q=${encodeURIComponent(q)}`))).items || [];
  },
  async preview(name) {
    return await readApiJson(await api.fetchApi(`/z3_minimax_creator/palette/preview?name=${encodeURIComponent(name)}`));
  },
  async content(name) {
    return await readApiJson(
      await api.fetchApi(`/z3_minimax_creator/palette/content?name=${encodeURIComponent(name)}`),
      { allowNotFound: true },
    );
  },
  async save(name, content) {
    return await fetchApiResult("/z3_minimax_creator/palette/save", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content }),
    });
  },
  async del(name) {
    return await fetchApiResult("/z3_minimax_creator/palette/delete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  },
  async setThumbnail(name, file) {
    const form = new FormData();
    form.append("name", name);
    form.append("file", file, file.name);
    return await fetchApiResult("/z3_minimax_creator/palette/set_thumbnail", { method: "POST", body: form });
  },
  async removeThumbnail(name) {
    return await fetchApiResult("/z3_minimax_creator/palette/remove_thumbnail", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  },
  async resolve(text, seed, mode, { signal } = {}) {
    const data = await readApiJson(await api.fetchApi("/z3_minimax_creator/palette/resolve", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, seed, mode }),
      ...(signal ? { signal } : {}),
    }));
    return { resolved: data.resolved || "", tokenStats: data.token_stats || null };
  },
  async resolveVariations(text, seed, mode, count = 4, { signal } = {}) {
    const data = await readApiJson(await api.fetchApi("/z3_minimax_creator/palette/resolve_variations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, seed: safeIntegerSeed(seed), mode, count }),
      ...(signal ? { signal } : {}),
    }));
    return Array.isArray(data.variations) ? data.variations : [];
  },
  async libraryHealth({ signal } = {}) {
    return await readApiJson(await api.fetchApi("/z3_minimax_creator/palette/library_health", signal ? { signal } : undefined));
  },
  async libraryAction(action, source = "", target = "") {
    return await fetchApiResult("/z3_minimax_creator/palette/library_action", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, source, target }),
    });
  },
  async libraryBatch(action, sources = [], destination = "") {
    return await fetchApiResult("/z3_minimax_creator/palette/library_batch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, sources, destination }),
    });
  },
  async refreshWildcards() {
    return await readApiJson(await api.fetchApi("/z3_minimax_creator/palette/refresh", { method: "POST" }));
  },
  async setPath(path) {
    return await fetchApiResult("/z3_minimax_creator/palette/set_path", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  },
  async countCombinatorial(text, seed, maxPrompts) {
    const data = await readApiJson(await api.fetchApi("/z3_minimax_creator/palette/count_combinatorial", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, seed, max_prompts: maxPrompts }),
    }));
    return { count: data.count || 0, truncated: !!data.truncated, cap: data.cap || 5000 };
  },
};

export { API };
