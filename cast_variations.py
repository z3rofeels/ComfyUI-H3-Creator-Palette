"""Role-based Cast auditions for Creator Palette batch variations.

Two independent authoring modes share the same queue variation index:

* ``@Role+`` / ``@Role-`` walks the **entire current reusable Cast library**
  (plus Creator-only Cast members), anchored at the role currently in the
  prompt. No shortlist setup is required.
* ``cast_auditions`` is an optional curated shortlist. Step zero keeps the
  current role, then only the chosen candidates audition in the requested
  direction.

An explicit +/- marker always wins over a saved shortlist. Runtime-only Cast
records needed by a pack-wide audition are injected into the copied piece only;
they are never written back into the workflow. Creator-only +/- markers never
reach H3.
"""
from __future__ import annotations

import re
from collections.abc import Mapping

from . import variation_catalog


def _handle(value) -> str:
    return str(value or "").strip().lstrip("@")


def _replace_role(text: str, role: str, selected: str, *, marker: bool = False) -> str:
    suffix = r"[ \t]*[+-]" if marker else ""
    pattern = re.compile(rf"@{re.escape(role)}(?!-[0-9])(?![A-Za-z0-9_]){suffix}" + (r"(?![A-Za-z0-9_])" if marker else ""))
    return pattern.sub(f"@{selected}", str(text or ""))


def _explicit_markers(container: dict, handles: list[str], step: int) -> tuple[set[str], set[str]]:
    source = str(container.get("prompt") or "")
    varied: set[str] = set()
    selected_handles: set[str] = set()
    if not handles:
        return varied, selected_handles
    order_index = {handle: index for index, handle in enumerate(handles)}
    # Horizontal spacing only: a marker can never jump to the next editor line.
    for match in list(re.finditer(r"@([A-Za-z][A-Za-z0-9_]*)(?!-[0-9])[ \t]*([+-])(?![A-Za-z0-9_])", source)):
        role, sign = match.group(1), match.group(2)
        if role not in order_index:
            continue
        start = order_index[role]
        direction = 1 if sign == "+" else -1
        selected = handles[(start + direction * step) % len(handles)]
        source = _replace_role(source, role, selected, marker=True)
        varied.add(role)
        selected_handles.add(selected)
    # Creator-only +/- must never leak to H3, but only *known Cast handles*
    # are Creator variation syntax. Media handles deliberately contain a
    # hyphen (for example @img-1 / @vid-2 / @aud-1). A generic @word- regex
    # would misread that hyphen as a decrement marker and corrupt @img-1 into
    # @img1. Strip markers one declared Cast handle at a time instead. Unknown
    # or stale @mentions remain untouched so the compiler can report the real
    # missing subject/media error.
    for handle in handles:
        source = re.sub(
            rf"(@{re.escape(handle)})(?![A-Za-z0-9_])[ \t]*[+-](?![A-Za-z0-9_])",
            r"\1",
            source,
        )
    container["prompt"] = source
    return varied, selected_handles


def _audition_configs(container: dict, handles: list[str], step: int, skip: set[str]) -> set[str]:
    configs = container.get("cast_auditions")
    selected_handles: set[str] = set()
    if not isinstance(configs, Mapping):
        return selected_handles
    known = set(handles)
    source = str(container.get("prompt") or "")
    for raw_role, raw in configs.items():
        role = _handle(raw_role)
        if role in skip or role not in known or not isinstance(raw, Mapping):
            continue
        candidates = []
        for value in raw.get("candidates") or []:
            candidate = _handle(value)
            if candidate and candidate != role and candidate in known and candidate not in candidates:
                candidates.append(candidate)
        if not candidates:
            continue
        try:
            direction_value = int(raw.get("direction", 1) or 1)
        except (TypeError, ValueError):
            direction_value = 1
        direction = -1 if direction_value < 0 else 1
        ordered = candidates if direction > 0 else list(reversed(candidates))
        sequence = [role, *ordered]
        selected = sequence[step % len(sequence)]
        source = _replace_role(source, role, selected, marker=False)
        selected_handles.add(selected)
    container["prompt"] = source
    return selected_handles


def _apply_container(container: dict, handles: list[str], step: int) -> set[str]:
    if not isinstance(container, dict):
        return set()
    explicit, chosen = _explicit_markers(container, handles, step)
    chosen.update(_audition_configs(container, handles, step, explicit))
    return chosen


def apply(piece: dict, step: int = 0, pool: tuple[list[str], dict[str, dict]] | None = None) -> dict:
    try:
        index = max(0, int(step))
    except (TypeError, ValueError):
        index = 0

    handles, definitions = pool if pool is not None else variation_catalog.cast_pool(piece)
    selected: set[str] = set()
    selected.update(_apply_container(piece, handles, index))
    for segment in piece.get("segments") or []:
        if isinstance(segment, dict) and segment.get("kind") != "clip":
            selected.update(_apply_container(segment, handles, index))

    # Pack-wide auditions can select a reusable character that was not already
    # added to this Creator. Inject only the characters actually selected for
    # this queued item. This keeps H3 subject numbering/state as small and stable
    # as possible and never mutates the saved workflow.
    subjects = piece.setdefault("subjects", [])
    existing = {_handle(row.get("handle")) for row in subjects if isinstance(row, Mapping)}
    for handle in handles:
        if handle not in selected or handle in existing:
            continue
        definition = definitions.get(handle)
        if isinstance(definition, Mapping):
            subjects.append(dict(definition))
            existing.add(handle)
    return piece
