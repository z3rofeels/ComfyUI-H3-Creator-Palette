function cleanName(value) {
  return String(value ?? "").trim().replace(/\\/g, "/");
}

export function h3CheckpointFormat(value) {
  const name = cleanName(value), lower = name.toLowerCase();
  if (!name) return { id: "unset", label: "Not selected", quantized: false, base: true };
  if (lower.endsWith(".gguf")) return { id: "gguf", label: "GGUF", quantized: true, base: true };
  if (/(?:int8.*convrot|convrot.*int8)/.test(lower)) {
    return { id: "int8_convrot", label: `${lower.includes("pruned") ? "Pruned " : ""}INT8 ConvRot`, quantized: true, base: true };
  }
  if (/nvfp4|fp4/.test(lower)) return { id: "nvfp4", label: "NVFP4", quantized: true, base: true };
  if (/fp8/.test(lower)) return { id: "fp8", label: "FP8", quantized: true, base: true };
  if (/bf16|bfloat16/.test(lower)) return { id: "bf16", label: "BF16", quantized: false, base: true };
  if (/fp16|float16/.test(lower)) return { id: "fp16", label: "FP16", quantized: false, base: true };
  return { id: "base", label: "Base checkpoint", quantized: false, base: true };
}

export function h3SelectedModelProfile(models = {}) {
  const route = ["fl2va", "ref2va"].includes(models?.route) ? models.route : "auto";
  const selected = [
    ["FL2VA", cleanName(models?.fl2va)],
    ["Ref2VA", cleanName(models?.ref2va)],
  ].filter(([role, name]) => name && (route === "auto" || role.toLowerCase() === route));
  const formats = selected.map(([role, name]) => ({ role, name, ...h3CheckpointFormat(name) }));
  const ids = [...new Set(formats.map((item) => item.id))];
  const labels = [...new Set(formats.map((item) => item.label))];
  const hasConvRot = formats.some((item) => item.id === "int8_convrot");
  const allConvRot = formats.length > 0 && formats.every((item) => item.id === "int8_convrot");
  const formatLabel = labels.length === 1 ? labels[0] : labels.length > 1 ? "Mixed base formats" : "Base checkpoint";
  const buttonLabel = allConvRot ? "INT8 ConvRot · Base" : "Base model";
  const selection = formats.map((item) => `${item.role}: ${item.label}`).join(" · ");
  let guidance;
  if (allConvRot) {
    guidance = `${formatLabel} base weights detected. ConvRot is the checkpoint's INT8 quantization format, not a Turbo mode. Use this Base profile for normal H3 sampling and leave UNet dtype on default unless you are deliberately testing a cast override. Full Turbo and Hybrid remain optional and require a separate Turbo/distillation adapter; their step presets are unchanged.`;
  } else if (hasConvRot) {
    guidance = `${selection}. These are base checkpoint formats even though one route uses INT8 ConvRot. Turbo and Hybrid still require a separate Turbo/distillation adapter and use the same Turbo step presets.`;
  } else if (formats.length) {
    guidance = `${selection}. Quantization and precision do not turn a base checkpoint into Turbo; Turbo and Hybrid require a separate distillation adapter or merged distillation checkpoint.`;
  } else {
    guidance = "Choose the local FL2VA/Ref2VA checkpoints under Models / Devices. Their precision format is separate from the optional Turbo adapter profile.";
  }
  return { route, formats, ids, hasConvRot, allConvRot, formatLabel, buttonLabel, selection, guidance };
}
