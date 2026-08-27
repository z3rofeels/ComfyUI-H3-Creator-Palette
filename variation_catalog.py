"""Live editable-pack pools used only by Creator batch variations.

The saved Creator blob remains the authoring source of truth.  `+` / `-` markers
mean "walk the whole current reusable pool", so the queue-time resolver needs to
read the user's editable H3 pack rather than the shipped starter JSON.  This
module is deliberately isolated from model loading/sampling and falls back to the
shipped catalog if the live pack store is unavailable.
"""
from __future__ import annotations

import json
import re
import unicodedata
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from collections.abc import Mapping

_HERE = Path(__file__).resolve().parent
_FALLBACK_CATALOG = _HERE / "js" / "prompt_library_catalog.json"

SCENE_CATEGORY_ALIASES = {
    "location": {"location", "locations", "environment", "environments", "place", "places"},
    "wardrobe": {"wardrobe props", "wardrobe", "clothing", "clothes", "outfit", "outfits", "fashion", "apparel", "costume", "costumes"},
    "prop": {"wardrobe props", "prop", "props", "object", "objects", "item", "items"},
    "action": {"action", "actions", "motion", "movement", "performance"},
    "camera": {"camera", "cameras", "shot", "shots", "cinematography"},
    "lighting": {"lighting", "light", "lights", "illumination"},
    "dialogue": {"dialogue performance", "dialogue", "speech", "audio"},
    "ambience": {"audio", "foley", "ambience", "ambient", "sound", "sounds"},
    "music": {"audio", "music", "score", "soundtrack"},
}

SCENE_SLOT_ALIASES = {
    "location": "location", "locations": "location", "environment": "location", "environments": "location", "place": "location", "places": "location",
    "wardrobe": "wardrobe", "clothing": "wardrobe", "clothes": "wardrobe", "outfit": "wardrobe", "outfits": "wardrobe", "fashion": "wardrobe", "apparel": "wardrobe", "costume": "wardrobe", "costumes": "wardrobe",
    "prop": "prop", "props": "prop", "object": "prop", "objects": "prop", "item": "prop", "items": "prop",
    "action": "action", "actions": "action", "motion": "action", "movement": "action",
    "camera": "camera", "cameras": "camera", "shot": "camera", "shots": "camera", "cinematography": "camera",
    "lighting": "lighting", "light": "lighting", "lights": "lighting", "illumination": "lighting",
    "dialogue": "dialogue", "dialog": "dialogue", "speech": "dialogue", "voice": "dialogue",
    "ambience": "ambience", "ambient": "ambience", "audio": "ambience", "foley": "ambience", "sound": "ambience",
    "music": "music", "score": "music", "scores": "music", "soundtrack": "music", "soundtracks": "music",
}

WARDROBE_LABELS = {"wardrobe", "clothing", "clothes", "outfit", "outfits", "fashion", "apparel", "costume", "costumes", "look", "looks"}
PROP_LABELS = {"prop", "props", "object", "objects", "item", "items"}
DIALOGUE_LABELS = {"dialogue", "dialog", "speech", "speaking", "voice", "voices"}
MUSIC_LABELS = {"music", "score", "soundtrack"}


def _label(value) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[_-]+", " ", str(value or "").strip().lower()))


def canonical_slot(value) -> str | None:
    return SCENE_SLOT_ALIASES.get(_label(value))


def scene_row_matches(slot: str, category: str, row: Mapping) -> bool:
    """Classify editable-pack rows without depending on one exact display label.

    An optional ``slot`` field is the unambiguous current pack authoring form.
    Existing packs remain valid through normalized category/subcategory aliases.
    """
    explicit = canonical_slot(row.get("slot"))
    if explicit:
        return explicit == slot
    category_name = _label(category)
    if category_name not in SCENE_CATEGORY_ALIASES.get(slot, set()):
        return False
    subcategory = _label(row.get("subcategory"))
    if category_name == "wardrobe props":
        if slot == "wardrobe":
            return subcategory in WARDROBE_LABELS
        if slot == "prop":
            return subcategory in PROP_LABELS
    if category_name == "audio":
        if slot == "dialogue":
            return subcategory in DIALOGUE_LABELS
        if slot == "music":
            return subcategory in MUSIC_LABELS
        if slot == "ambience":
            return subcategory not in DIALOGUE_LABELS | MUSIC_LABELS
    if slot == "ambience":
        return subcategory not in MUSIC_LABELS | DIALOGUE_LABELS
    return True


def _model(catalog: Mapping) -> Mapping:
    models = catalog.get("models") if isinstance(catalog, Mapping) else None
    if not isinstance(models, list) or not models:
        return {}
    return next((m for m in models if isinstance(m, Mapping) and m.get("id") == "minimax-creator-h3"), None) or next((m for m in models if isinstance(m, Mapping)), {})


@lru_cache(maxsize=1)
def _fallback_catalog() -> dict:
    try:
        return json.loads(_FALLBACK_CATALOG.read_text(encoding="utf-8"))
    except Exception:
        return {"models": []}


def live_pack() -> dict | None:
    """Read the current editable pack without creating a hard import dependency.

    `pack_store` imports ComfyUI's `folder_paths`; keeping the import lazy means
    the variation modules remain importable outside a running ComfyUI process.
    """
    try:
        from . import pack_store
        pack = pack_store.load()
        return pack if isinstance(pack, dict) else None
    except Exception:
        return None


def live_catalog() -> dict:
    pack = live_pack()
    return catalog_from_pack(pack)


def catalog_from_pack(pack: Mapping | None) -> dict:
    """Resolve a catalog from an already-read pack snapshot."""
    catalog = pack.get("catalog") if isinstance(pack, dict) else None
    return catalog if isinstance(catalog, dict) else deepcopy(_fallback_catalog())


def live_snapshot() -> tuple[dict, dict]:
    """Read the editable pack once for one queue item's Scene and Cast pools."""
    pack = live_pack()
    snapshot = pack if isinstance(pack, dict) else {}
    return snapshot, catalog_from_pack(snapshot)


def scene_rows(catalog: Mapping | None = None) -> dict[str, list[dict]]:
    """Return every current preset in each semantic Scene slot, in pack order."""
    catalog = catalog if isinstance(catalog, Mapping) else live_catalog()
    model = _model(catalog)
    out: dict[str, list[dict]] = {slot: [] for slot in SCENE_CATEGORY_ALIASES}
    for category in model.get("categories", []) or []:
        if not isinstance(category, Mapping):
            continue
        category_id = str(category.get("id") or "")
        for row in category.get("prompts", []) or []:
            if not isinstance(row, Mapping):
                continue
            for slot in out:
                if scene_row_matches(slot, category_id, row):
                    out[slot].append({**row, "category": category_id})
    return out


def _clean_handle(value) -> str:
    raw = str(value or "").strip().lstrip("@")
    try:
        raw = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode("ascii")
    except Exception:
        pass
    raw = re.sub(r"[^A-Za-z0-9_]+", "_", raw)
    raw = re.sub(r"_+", "_", raw).strip("_")
    if not raw or not raw[0].isalpha():
        raw = f"Character_{raw}".strip("_")
    return (raw[:32].rstrip("_") or "Character")


_PACK_UNSET = object()


def cast_pool(piece: Mapping, pack=_PACK_UNSET) -> tuple[list[str], dict[str, dict]]:
    """Return the full reusable Cast pool plus Creator-only Cast definitions.

    Reusable pack order defines All+/All- traversal.  If the Creator contains a
    richer live subject with the same handle (reference media, voice, motion,
    etc.), that live definition wins. Creator-only subjects are appended so a
    role can always cycle back through every Cast member available to that job.
    """
    order: list[str] = []
    definitions: dict[str, dict] = {}
    pack = (live_pack() or {}) if pack is _PACK_UNSET else (pack if isinstance(pack, Mapping) else {})
    for raw in pack.get("cast") or []:
        if not isinstance(raw, Mapping):
            continue
        handle = _clean_handle(raw.get("handle") or raw.get("id"))
        if not handle or handle in definitions:
            continue
        order.append(handle)
        definitions[handle] = {
            "handle": handle,
            "display_name": str(raw.get("name") or handle.replace("_", " ")),
            "preset_id": str(raw.get("id") or handle),
            "preset_group": str(raw.get("group") or "Custom"),
            "preset_note": str(raw.get("note") or ""),
            "takes": "person",
            "description": str(raw.get("description") or ""),
            "clothing": str(raw.get("clothing") or ""),
            "from": [],
        }
    for raw in piece.get("subjects") or []:
        if not isinstance(raw, Mapping):
            continue
        handle = _clean_handle(raw.get("handle"))
        if not handle:
            continue
        if handle not in order:
            order.append(handle)
        # Preserve the complete live Creator definition over the reusable preset.
        definitions[handle] = deepcopy(dict(raw))
    return order, definitions
