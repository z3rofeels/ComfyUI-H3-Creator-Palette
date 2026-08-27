"""Deterministic authoring -> MiniMax H3 body formatting.

Creator Palette's editor is intentionally loose: users can type fragments, drop
semantic scene tokens anywhere, and mix them with @cast/media mentions.  H3's
compiler should never be equally loose.  This module turns that authoring state
into a stable scene description before Context-IR is assembled.

This is deliberately not an LLM rewrite.  It is the always-available baseline:
free direction is preserved, structured visual slots are emitted once in H3's
most useful order, ambience/music are routed to their dedicated Context-IR
fields, and whitespace/fragments are made readable.  The optional local refiner
can still elaborate further, but generation never depends on it being installed.
"""
from __future__ import annotations

import re
from collections.abc import Mapping

from . import scene_tokens

VISUAL_ORDER = ("location", "wardrobe", "prop", "action", "camera", "lighting", "dialogue")
AUDIO_SLOT = "ambience"
MUSIC_SLOT = "music"


def _palette(value) -> dict[str, dict]:
    if not isinstance(value, Mapping):
        return {}
    out = {}
    for slot, item in value.items():
        if isinstance(item, Mapping) and str(item.get("prompt") or "").strip():
            out[str(slot)] = dict(item)
    return out


def _sentences(value: str) -> str:
    """Make casual fragments readable without inventing scene content."""
    text = str(value or "")
    text = text.replace(scene_tokens.BOUNDARY, "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s*\n+\s*", " ", text).strip()
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    if text and text[-1] not in ".!?\">":
        text += "."
    return text


def _remove_known_chunks(source: str, palette: Mapping[str, dict]) -> str:
    """Strip our own generated prose/tokens, leaving only user-authored direction."""
    # Expand bounded and boundary-stripped recovery tokens first. The known
    # category chunks are removed below and re-emitted once in canonical order.
    text = scene_tokens.expand(source, palette)
    for slot, item in palette.items():
        chunk = str(item.get("prompt") or "").strip()
        if chunk:
            text = text.replace(chunk, " ")
    text = scene_tokens.UNKNOWN_TOKEN_RE.sub(" ", text)
    return _sentences(text)


def format_prompt(source: str, palette_value) -> str:
    """Return one stable H3 scene body from free text + structured visual slots."""
    palette = _palette(palette_value)
    free = _remove_known_chunks(source, palette)
    parts = [free] if free else []
    for slot in VISUAL_ORDER:
        prompt = str(palette.get(slot, {}).get("prompt") or "").strip()
        if prompt:
            parts.append(_sentences(prompt))
    return "\n".join(part for part in parts if part).strip()


def route_audio(container: dict) -> None:
    """Move structured AUDIO/MUSIC choices into H3's dedicated fields.

    Explicit text already typed into soundscape/music remains first and the
    structured choice follows it.  The token itself is removed from the body by
    ``format_prompt`` so audio isn't described twice in two Context-IR sections.
    """
    palette = _palette(container.get("scene_palette"))
    for slot, key in ((AUDIO_SLOT, "soundscape"), (MUSIC_SLOT, "music")):
        chunk = str(palette.get(slot, {}).get("prompt") or "").strip()
        if not chunk:
            continue
        existing = str(container.get(key) or "").strip()
        if chunk in existing:
            continue
        container[key] = "\n".join(part for part in (existing, _sentences(chunk)) if part)


def format_container(container: dict) -> None:
    if not isinstance(container, dict):
        return
    container["prompt"] = format_prompt(container.get("prompt"), container.get("scene_palette"))
    route_audio(container)
