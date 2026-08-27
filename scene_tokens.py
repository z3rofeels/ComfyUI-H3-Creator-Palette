"""Compact author-facing scene tokens for MiniMax Creator Palette.

The frontend saves structured scene choices as invisible-boundary words such as
``LOCATION`` or ``CAMERA`` instead of repeating the full preset prose in the
editable prompt. This module expands those tokens at execution time. Older
workflows that still contain the prose are valid too; expansion is additive and
never guesses at free-written text.
"""
from __future__ import annotations

import re
from typing import Mapping, Iterable

BOUNDARY = "\u2063"  # Unicode INVISIBLE SEPARATOR
SLOT_LABELS = {
    "location": "LOCATION",
    "wardrobe": "CLOTHING",
    "prop": "PROP",
    "action": "ACTION",
    "camera": "CAMERA",
    "lighting": "LIGHT",
    "dialogue": "DIALOGUE",
    "ambience": "AUDIO",
    "music": "MUSIC",
}
LABEL_SLOTS = {label: slot for slot, label in SLOT_LABELS.items()}
TOKEN_RE = re.compile(
    re.escape(BOUNDARY) + "(" + "|".join(map(re.escape, SLOT_LABELS.values())) + ")" + re.escape(BOUNDARY)
)
UNKNOWN_TOKEN_RE = re.compile(re.escape(BOUNDARY) + r"[A-Z][A-Z0-9 _/-]{1,31}" + re.escape(BOUNDARY))


def _visible_token_re(slot: str, *, marker: bool = False) -> re.Pattern[str] | None:
    """Return the recovery pattern for a boundary-stripped semantic token.

    Some frontend/editor save paths can preserve the visible ``LOCATION`` word
    while dropping its zero-width separators.  A visible label is only treated
    as semantic when that slot exists in the accompanying palette, so ordinary
    prose such as ``camera`` is never guessed at or rewritten.
    """
    label = SLOT_LABELS.get(str(slot or "").strip())
    if not label:
        return None
    suffix = r"(?:[ \t]*[+-])?" if marker else ""
    return re.compile(rf"(?<![A-Za-z0-9_]){re.escape(label)}(?![A-Za-z0-9_]){suffix}")


def token(slot: str) -> str:
    label = SLOT_LABELS.get(str(slot or "").strip())
    return f"{BOUNDARY}{label}{BOUNDARY}" if label else ""


def palette_prompts(value) -> dict[str, str]:
    if not isinstance(value, Mapping):
        return {}
    out: dict[str, str] = {}
    for slot, item in value.items():
        if not isinstance(item, Mapping):
            continue
        prompt = str(item.get("prompt") or "").strip()
        if prompt:
            out[str(slot)] = prompt
    return out


def _tidy(value: str) -> str:
    text = re.sub(r"[ \t]+\n", "\n", str(value or ""))
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def expand(text, palette, suppress: Iterable[str] = ()) -> str:
    """Expand known semantic words to their selected H3 prose.

    ``suppress`` removes a Shared token when a shot owns that same slot. Missing
    or corrupt tokens are removed rather than leaked to MiniMax as mystery text.
    """
    source = str(text or "")
    configured: set[str] = set()
    if isinstance(palette, Mapping):
        configured = {str(slot) for slot in palette}
        prompts = dict(palette) if all(isinstance(v, str) for v in palette.values()) else palette_prompts(palette)
    else:
        prompts = {}
    blocked = {str(slot) for slot in (suppress or ())}

    def replacement(match: re.Match[str]) -> str:
        groups = match.groupdict()
        label = groups.get("bounded") or groups.get("visible")
        slot = LABEL_SLOTS.get(label)
        if not slot or slot in blocked:
            return ""
        return str(prompts.get(slot) or "")

    # +/- immediately after a semantic token is Creator Palette batch metadata,
    # not prose for H3. Consume it together with the token.
    # Whitespace belongs to the author's sentence. Consume it only when it is
    # part of a +/- variation suffix; the old optional-sign expression ate the
    # separator even when no marker existed and could join a resolved category
    # directly onto the next wildcard/text in Raw mode.
    bounded_part = (
        re.escape(BOUNDARY)
        + "(?P<bounded>" + "|".join(map(re.escape, SLOT_LABELS.values())) + ")"
        + re.escape(BOUNDARY) + r"(?:[ \t]*[+-])?"
    )
    visible_labels = [SLOT_LABELS[slot] for slot in configured | blocked if slot in SLOT_LABELS]
    visible_part = ""
    if visible_labels:
        visible_part = (
            r"|(?<![A-Za-z0-9_" + re.escape(BOUNDARY) + r"])(?P<visible>"
            + "|".join(map(re.escape, visible_labels))
            + r")(?![A-Za-z0-9_" + re.escape(BOUNDARY) + r"])(?:[ \t]*[+-])?"
        )
    # One substitution pass is important: prompt prose inserted for a category
    # is output, not fresh syntax to scan recursively (for example a legitimate
    # preset sentence containing the uppercase word CAMERA).
    source = re.compile(bounded_part + visible_part).sub(replacement, source)
    source = UNKNOWN_TOKEN_RE.sub("", source)
    return _tidy(source)


def contains(text, slot: str) -> bool:
    marker = token(slot)
    if marker and marker in str(text or ""):
        return True
    visible = _visible_token_re(slot)
    return bool(visible and visible.search(str(text or "")))


def variation_direction(text, slot: str) -> int:
    """Return +/- direction for bounded or recovered visible scene syntax."""
    source = str(text or "")
    marker = token(slot)
    if marker:
        match = re.search(re.escape(marker) + r"[ \t]*([+-])", source)
        if match:
            return 1 if match.group(1) == "+" else -1
    visible = _visible_token_re(slot)
    if visible is None:
        return 0
    match = re.search(visible.pattern + r"[ \t]*([+-])", source)
    return (1 if match.group(1) == "+" else -1) if match else 0
