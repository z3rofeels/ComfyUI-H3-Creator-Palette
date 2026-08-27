"""Seed-stepped structured scene variations for Creator Palette batches.

A visible ``+`` or ``-`` immediately after a semantic editor token walks the
full preset catalog. ``scene_auditions`` provides a curated per-slot shortlist.
Both modes share Creator Palette's queue variation index, independent of the video
noise seed. Run zero always uses the current selection; later queued runs advance
the chosen catalog or shortlist while unrelated scene slots and Cast remain fixed.
"""
from __future__ import annotations

import copy
from collections.abc import Mapping

from . import scene_tokens, variation_catalog


def marker_direction(text: str, slot: str) -> int:
    return scene_tokens.variation_direction(text, slot)


def _same(a, b) -> bool:
    if not isinstance(a, Mapping) or not isinstance(b, Mapping):
        return False
    aid, bid = str(a.get("id") or ""), str(b.get("id") or "")
    if aid and bid:
        return aid == bid
    return str(a.get("prompt") or "").strip() == str(b.get("prompt") or "").strip()


def _compact(row: Mapping) -> dict:
    return {
        key: row.get(key, "")
        for key in ("id", "title", "prompt", "category", "subcategory", "visual", "note")
        if row.get(key) not in (None, "")
    }


def _audition_row(container: Mapping, slot: str, selected: Mapping, options: list[dict], delta: int):
    configs = container.get("scene_auditions")
    if not isinstance(configs, Mapping):
        return None
    raw = configs.get(slot)
    if not isinstance(raw, Mapping):
        return None
    # New workflows distinguish a prepared shortlist from the explicit
    # Shortlist audition mode. Legacy configs did not store a mode, so absence
    # remains active for backward compatibility; newly-authored prepared pools
    # use ``mode: prepared`` and cannot silently override Fixed/All behavior.
    mode = str(raw.get("mode") or "").strip().lower()
    if mode and mode != "shortlist":
        return None
    current_id = str(selected.get("id") or "").strip()
    by_id = {str(row.get("id") or "").strip(): row for row in options if str(row.get("id") or "").strip()}
    candidates = []
    seen = set()
    for value in raw.get("candidates") or []:
        candidate_id = str(value or "").strip()
        if not candidate_id or candidate_id == current_id or candidate_id in seen:
            continue
        row = by_id.get(candidate_id)
        if row is not None:
            candidates.append(row)
            seen.add(candidate_id)
    if not candidates:
        return None
    try:
        direction_value = int(raw.get("direction", 1) or 1)
    except (TypeError, ValueError):
        direction_value = 1
    direction = -1 if direction_value < 0 else 1
    ordered = candidates if direction > 0 else list(reversed(candidates))
    sequence = [selected, *ordered]
    return sequence[delta % len(sequence)]


def _vary_container(container: dict, delta: int, pools: dict[str, list[dict]]) -> None:
    if not isinstance(container, dict):
        return
    palette = container.get("scene_palette")
    if not isinstance(palette, dict):
        return
    source = str(container.get("prompt") or "")
    for slot, selected in list(palette.items()):
        if not isinstance(selected, Mapping):
            continue
        options = pools.get(slot) or []
        if not options:
            continue
        direction = marker_direction(source, slot)
        if direction:
            index = next((i for i, row in enumerate(options) if _same(row, selected)), -1)
            if index >= 0:
                row = options[(index + direction * delta) % len(options)]
            elif delta == 0:
                # The preset may have been imported from a pack that is no longer
                # active. The first queued item must still be exactly what the
                # user authored; subsequent items walk the current live pool.
                row = selected
            else:
                ordered = options if direction > 0 else list(reversed(options))
                row = ordered[(delta - 1) % len(ordered)]
        else:
            row = _audition_row(container, slot, selected, options, delta)
            if row is None:
                continue
        # Preserve only metadata the frontend understands; no giant catalog is
        # serialized into the workflow.
        palette[slot] = _compact(row)


def apply(piece: dict, step: int = 0, pools: dict[str, list[dict]] | None = None) -> tuple[dict, int]:
    """Deep-copy ``piece`` and apply +/- scene stepping for queue ``step``."""
    out = copy.deepcopy(piece)
    try:
        delta = max(0, int(step))
    except (TypeError, ValueError):
        delta = 0
    pools = pools if isinstance(pools, dict) else variation_catalog.scene_rows()
    _vary_container(out, delta, pools)
    for segment in out.get("segments") or []:
        if isinstance(segment, dict) and segment.get("kind") != "clip":
            _vary_container(segment, delta, pools)
    return out, delta
