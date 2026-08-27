const semanticPrompt = (value) => {
  const source = String(value ?? "");
  return [
    ...(source.match(/@[A-Za-z][A-Za-z0-9_-]*[+]?/g) || []),
    ...(source.match(/\u2063[^\u2063]+\u2063[ \t]*[+-]?/g) || []),
  ];
};

export function sidebarStateSignature(body) {
  if (!body?.data) return "detached";
  const data = body.data;
  const target = body.target === "global" ? "global" : Math.max(0, Math.trunc(Number(body.target) || 0));
  const active = target === "global" ? data : (data.segments?.[target] || {});
  return JSON.stringify({
    node: body.node?.id ?? body.node?.uuid ?? "creator",
    target,
    promptSemantics: semanticPrompt(data.prompt),
    activePromptSemantics: target === "global" ? [] : semanticPrompt(active.prompt),
    scenePalette: data.scene_palette || {},
    activeScenePalette: target === "global" ? {} : (active.scene_palette || {}),
    sceneAuditions: data.scene_auditions || {},
    activeSceneAuditions: target === "global" ? {} : (active.scene_auditions || {}),
    castAuditions: data.cast_auditions || {},
    activeCastAuditions: target === "global" ? {} : (active.cast_auditions || {}),
    subjects: data.subjects || [],
    assets: data.assets || [],
    activeAssets: target === "global" ? [] : (active.assets || []),
    loras: data.loras || [],
    activeLoras: target === "global" ? [] : (active.loras || []),
    activeTiming: target === "global" ? null : {
      kind: active.kind || "shot", duration_s: active.duration_s, continue: active.continue,
      continue_audio: active.continue_audio, merge: active.merge, hold: active.hold,
    },
    thumbnailOverrides: data.thumbnail_overrides || {},
  });
}
