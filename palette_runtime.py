"""Canonical Creator Palette prompt resolution runtime.

The saved creator blob is always authored RAW source.  Resolution happens only
on deep runtime copies immediately before Preview/Queue compilation so semantic
scene calls, Cast roles, wildcards and optional H3 formatting can never rewrite
the user's editor text.

v3.13.0C deliberately keeps Preview and Queue on the same functions.  The
Resolved Output inspector requests RAW and H3 variants from ``resolve_variants``;
normal generation calls ``resolve_piece``. Both enter the exact same selection
and prose-resolution pipeline below.
"""
from __future__ import annotations

import copy
from typing import Any

from .wildcard_index import get_index
from .wildcard_resolver import WildcardResolver
from . import scene_tokens, scene_variations, cast_variations, variation_catalog, h3_autoformat


def _text(value: Any) -> str:
    return value if isinstance(value, str) else "" if value is None else str(value)


def _mode(value: str) -> str:
    return value if value in {"entire text as one", "line by line"} else "entire text as one"


def _resolve(resolver: WildcardResolver, value: Any, seed: int, mode: str) -> str:
    text = _text(value)
    if not text:
        return ""
    if mode == "line by line":
        return "\n".join(resolver.resolve_lines(text, seed=seed))
    return resolver.resolve(text, seed=seed)


def resolve_text(value: Any, seed: int, processing_mode: str = "entire text as one") -> tuple[str, list[str]]:
    """Resolve one Prompt Palette text field without changing any H3 state."""
    mode = _mode(processing_mode)
    resolver = WildcardResolver(get_index())
    resolved = _resolve(resolver, value, int(seed), mode)
    return resolved, sorted(set(resolver.used_names))


def _selection_snapshot(data: dict, variation_index: int, *, pack=None, catalog=None) -> tuple[dict, dict, dict]:
    """Choose concrete Scene/Cast variation records on a deep copy.

    Explicit +/- calls and saved auditions are *selection* operations. They must
    run before category/wildcard prose is expanded because they decide which
    character/category record owns the prose for this queue item.  Scene and
    Cast share one immutable editable-pack snapshot so a library refresh can
    never split one preview/queue across two pack revisions.
    """
    if pack is None or catalog is None:
        pack, catalog = variation_catalog.live_snapshot()
    scene_pools = variation_catalog.scene_rows(catalog)
    piece, _variation_delta = scene_variations.apply(data, int(variation_index), pools=scene_pools)
    cast_pool = variation_catalog.cast_pool(piece, pack=pack)
    piece = cast_variations.apply(piece, int(variation_index), pool=cast_pool)
    return piece, pack, catalog


def _resolve_selected_raw(selected: dict, seed: int, processing_mode: str,
                          *, library=None) -> tuple[dict, list[str]]:
    """Resolve the canonical runtime RAW copy after semantic selection.

    All category/Cast variation choices are already fixed in ``selected``.
    This stage resolves the selected category records and every authored
    wildcard-bearing prose field once. It deliberately does *not* perform H3
    formatting, so RAW and H3 FORMAT can branch from byte-identical resolved
    authoring state instead of independently re-running random/sequence logic.
    """
    mode = _mode(processing_mode)
    piece = copy.deepcopy(selected)
    # H3 FORMAT is a later transformation. Keeping the intermediate explicitly
    # RAW also prevents compile.py from applying Context-IR to this branch.
    piece["h3_auto_format"] = False

    used: set[str] = set()
    library = library if library is not None else get_index().preview_view()
    try:
        sequence_step = max(0, int(piece.pop("_resolution_variation_index", 0)))
    except (TypeError, ValueError):
        sequence_step = 0

    def resolve_value(value: Any, s: int) -> str:
        resolver = WildcardResolver(library, sequence_step=sequence_step)
        resolved = _resolve(resolver, value, int(s), mode)
        used.update(resolver.used_names)
        return resolved

    def apply_scene_palette(container: dict, s: int) -> None:
        """Resolve wildcard prose in the concrete category records selected above."""
        palette = container.get("scene_palette")
        if not isinstance(palette, dict):
            return
        for offset, slot in enumerate(sorted(palette)):
            item = palette.get(slot)
            if isinstance(item, dict) and isinstance(item.get("prompt"), str):
                item["prompt"] = resolve_value(item.get("prompt"), s + offset)

    apply_scene_palette(piece, int(seed) + 1000)
    for i, segment in enumerate(piece.get("segments") or []):
        if isinstance(segment, dict) and segment.get("kind") != "clip":
            apply_scene_palette(segment, int(seed) + 2000 + i * 37)

    def effective_palette(container: dict) -> dict:
        shared = piece.get("scene_palette") if isinstance(piece.get("scene_palette"), dict) else {}
        own = container.get("scene_palette") if isinstance(container.get("scene_palette"), dict) else {}
        return {**shared, **own} if container is not piece else shared

    def apply(obj: dict, key: str, s: int, *, scene_palette=None) -> None:
        if key not in obj or not isinstance(obj.get(key), str):
            return
        source = obj.get(key)
        if scene_palette is not None:
            source = scene_tokens.expand(source, scene_palette)
        obj[key] = resolve_value(source, s)

    def apply_refined(obj: dict, s: int, scene_palette: dict) -> None:
        refined = obj.get("refined")
        if not isinstance(refined, dict) or refined.get("enabled") is False:
            return
        apply(refined, "body", s, scene_palette=scene_palette)
        sections = refined.get("sections")
        if isinstance(sections, dict):
            for offset, key in enumerate(sorted(sections)):
                apply(sections, key, s + 1 + offset, scene_palette=scene_palette)

    # Resolve semantic category text before wildcards. This makes the runtime
    # RAW snapshot genuinely canonical and keeps Inspector, Queue and every
    # downstream prompt-bearing field on the same text. compile.py still accepts
    # compact tokens for direct/legacy callers, but the normal pipeline no
    # longer relies on a later display-specific expansion.
    shared_palette = effective_palette(piece)
    apply(piece, "prompt", seed, scene_palette=shared_palette)
    apply(piece, "soundscape", seed + 201, scene_palette=shared_palette)
    apply(piece, "music", seed + 202, scene_palette=shared_palette)
    apply(piece, "prompt_override", seed + 203, scene_palette=shared_palette)
    apply(piece, "director_prompt", seed + 204, scene_palette=shared_palette)
    apply_refined(piece, seed + 205, shared_palette)

    # Cast identity/wardrobe prose participates in the same wildcard snapshot.
    # compile.py later substitutes cited @handles with <Subject N> and emits the
    # full resolved descriptions into subject definitions.
    subjects = piece.get("subjects")
    if isinstance(subjects, list):
        for i, subject in enumerate(subjects):
            if not isinstance(subject, dict):
                continue
            apply(subject, "description", seed + 400 + i * 13)
            apply(subject, "clothing", seed + 401 + i * 13)

    segments = piece.get("segments")
    if isinstance(segments, list):
        for i, segment in enumerate(segments):
            if not isinstance(segment, dict) or segment.get("kind") == "clip":
                continue
            seg_seed = int(segment.get("seed", seed + i)) if isinstance(segment.get("seed", seed + i), int) else seed + i
            palette = effective_palette(segment)
            apply(segment, "prompt", seg_seed, scene_palette=palette)
            apply(segment, "soundscape", seg_seed + 301, scene_palette=palette)
            apply(segment, "music", seg_seed + 302, scene_palette=palette)
            apply(segment, "prompt_override", seg_seed + 303, scene_palette=palette)
            apply(segment, "director_prompt", seg_seed + 304, scene_palette=palette)
            apply_refined(segment, seg_seed + 305, palette)

    return piece, sorted(used)


def _h3_from_resolved_raw(raw_piece: dict) -> dict:
    """Transform one already-resolved RAW runtime copy into H3 FORMAT."""
    piece = copy.deepcopy(raw_piece)
    piece["h3_auto_format"] = True
    h3_autoformat.format_container(piece)
    for segment in piece.get("segments") or []:
        if isinstance(segment, dict) and segment.get("kind") != "clip":
            h3_autoformat.format_container(segment)
    return piece


def _resolve_selected_piece(selected: dict, seed: int, processing_mode: str,
                            *, library=None, auto_format: bool | None = None) -> tuple[dict, list[str]]:
    """Resolve one selected queue item through the canonical RAW -> H3 branch."""
    authored_h3 = selected.get("h3_auto_format") is True
    use_h3 = authored_h3 if auto_format is None else bool(auto_format)
    raw, used = _resolve_selected_raw(selected, seed, processing_mode, library=library)
    return (_h3_from_resolved_raw(raw) if use_h3 else raw), used

def resolve_piece(data: dict, seed: int, processing_mode: str = "entire text as one",
                  variation_index: int = 0) -> tuple[dict, list[str]]:
    """Return the exact deep-copied runtime piece used by normal generation."""
    selected, _pack, _catalog = _selection_snapshot(data, int(variation_index))
    selected["_resolution_variation_index"] = max(0, int(variation_index or 0))
    return _resolve_selected_piece(selected, int(seed), processing_mode)


def resolve_variants(data: dict, seed: int, processing_mode: str = "entire text as one",
                     variation_index: int = 0) -> tuple[dict, dict, list[str]]:
    """Resolve RAW and H3 FORMAT from one canonical selection snapshot.

    Used by the Resolved Output inspector.  Both variants see the identical Cast
    audition, category variation, +/- step, wildcard library revision and seed.
    The only difference is the final ``h3_auto_format`` transformation flag.
    """
    step = max(0, int(variation_index or 0))
    selected, _pack, _catalog = _selection_snapshot(data, step)
    selected["_resolution_variation_index"] = step
    library = get_index().preview_view()
    raw, used = _resolve_selected_raw(selected, int(seed), processing_mode, library=library)
    h3 = _h3_from_resolved_raw(raw)
    return raw, h3, used


RESOLUTION_ORDER = (
    "authored_raw",
    "semantic_variation_selection",
    "category_record_resolution",
    "wildcard_resolution",
    "optional_h3_format",
    "compiler_semantic_resolution",
)


def resolve_for_sampling(data: dict, sampling_seed: int,
                         processing_mode: str = "entire text as one",
                         variation_index: int = 0,
                         seed_hunt: dict | None = None) -> tuple[dict, list[str]]:
    """Resolve authored choices while allowing Seed Hunt to vary noise only."""
    if not isinstance(seed_hunt, dict):
        return resolve_piece(data, int(sampling_seed), processing_mode, variation_index)
    try:
        prompt_seed = max(0, int(seed_hunt.get("prompt_seed", sampling_seed)))
    except (TypeError, ValueError):
        prompt_seed = int(sampling_seed)
    segments = data.get("segments") if isinstance(data, dict) else None
    if isinstance(segments, list) and segments and isinstance(segments[0], dict):
        try:
            segments[0]["seed"] = max(0, int(seed_hunt.get("segment_prompt_seed", prompt_seed)))
        except (TypeError, ValueError):
            segments[0]["seed"] = prompt_seed
    resolved, used = resolve_piece(data, prompt_seed, processing_mode, variation_index)
    resolved_segments = resolved.get("segments") if isinstance(resolved, dict) else None
    if isinstance(resolved_segments, list) and resolved_segments and isinstance(resolved_segments[0], dict):
        resolved_segments[0].pop("seed", None)
    return resolved, used
