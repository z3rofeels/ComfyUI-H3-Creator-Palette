function normalizedName(value) {
  return String(value ?? "").trim().replace(/\\/g, "/");
}

function cleanWords(value) {
  return Array.isArray(value) ? value.map((word) => String(word ?? "").trim()).filter(Boolean) : [];
}

export function normalizeLoraLibraryRows(value) {
  const rows = [], seen = new Set();
  for (const candidate of Array.isArray(value) ? value : []) {
    if (!candidate || typeof candidate !== "object") continue;
    const name = normalizedName(candidate.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    rows.push({ ...candidate, name });
  }
  return rows;
}

export function loraLibraryIdentity(row) {
  const name = normalizedName(row?.name);
  const parts = name.split("/").filter(Boolean);
  const filename = parts.at(-1) || name;
  const folder = parts.slice(0, -1).join("/");
  const stem = filename.replace(/\.[^.]+$/, "");
  const metadataTitle = String(row?.title ?? "").trim();
  const comparable = (value) => String(value ?? "").trim().toLocaleLowerCase();
  const distinctMetadataTitle = metadataTitle
    && comparable(metadataTitle) !== comparable(filename)
    && comparable(metadataTitle) !== comparable(stem)
      ? metadataTitle
      : "";
  return { name, filename, folder, metadataTitle: distinctMetadataTitle };
}

export function loraLibrarySelection(row) {
  const identity = loraLibraryIdentity(row);
  if (!identity.name) throw new Error("This LoRA entry has no filename.");
  const trainedWords = cleanWords(row?.trained_words);
  return {
    name: identity.name,
    triggers: trainedWords.length ? trainedWords : cleanWords(row?.triggers),
  };
}
