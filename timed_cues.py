"""Author-friendly timing cues for Creator prompts.

MiniMax H3 can be told *when* an action/dialogue beat happens in ordinary prompt
text, but a LoRA is patched onto a model before the sampler runs. Therefore a
LoRA cannot honestly switch on at 4.0 seconds inside one sampler pass. Creator
solves that mismatch without inventing a fake frame switch:

    Bill enters the store. At 4 sec *inflate_lora Bill eats the cookies.

is transiently expanded at compile time into two chained generation passes. The
first pass runs 0-4s without the timed LoRA. The second starts at 4s, inherits the
previous picture/audio seam, and carries the LoRA. The authored workflow remains
one shot and the expansion is deterministic/cacheable.

Supported timed-LoRA syntax:
  * ``At 4 sec *foo ...`` or ``At 4s *foo ...`` activates ``foo`` from 4s on.
  * ``*+foo`` is the explicit activate form.
  * ``*-foo`` deactivates it at that cue.
  * ``*{folder/My LoRA.safetensors}`` allows spaces/full paths.

Plain timing cues with no ``*LoRA`` token are left in the prompt. They are scene
performance direction, not a request to change the model stack.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import os
import re


# "At 4 sec", "at 4.5s", "At 00:04.000". The leading word is required so a
# stray dimension such as "4 sec exposure" is never interpreted as a cut.
_CUE_RE = re.compile(
    r"\bAt\s+(?:(?P<minutes>\d{1,3}):(?P<clocksec>\d{2}(?:\.\d{1,3})?)|"
    r"(?P<seconds>\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds))\b"
    r"\s*[,;:\-–—]?\s*",
    re.IGNORECASE,
)

# Braced form may contain spaces; simple form intentionally does not. A LoRA
# filename/path already works naturally when it uses underscores/hyphens.
_LORA_RE = re.compile(
    r"\*(?P<op>[+-]?)(?:\{(?P<braced>[^{}]+)\}|(?P<plain>[A-Za-z0-9_./\\-]+))"
)

_CUT_RE = re.compile(r"\b(?:hard\s+cut|smash\s+cut|cut(?:s)?\s+to|transition(?:s)?\s+to|dissolve(?:s)?\s+to|fade(?:s)?\s+to)\b", re.I)


@dataclass(frozen=True)
class Directive:
    name: str
    enabled: bool


@dataclass(frozen=True)
class Cue:
    at: float
    text: str
    directives: tuple[Directive, ...]


def _cue_seconds(match: re.Match[str]) -> float:
    if match.group("seconds") is not None:
        return float(match.group("seconds"))
    return int(match.group("minutes")) * 60.0 + float(match.group("clocksec"))


def _strip_directives(text: str) -> tuple[str, tuple[Directive, ...]]:
    directives: list[Directive] = []

    def repl(match: re.Match[str]) -> str:
        raw = (match.group("braced") or match.group("plain") or "").strip()
        if raw:
            directives.append(Directive(raw, match.group("op") != "-"))
        return ""

    cleaned = _LORA_RE.sub(repl, str(text or ""))
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+([,.;:!?])", r"\1", cleaned).strip(" ,;:-–—\t\n")
    return cleaned.strip(), tuple(directives)


def parse(text: str) -> tuple[str, list[Cue]]:
    """Return preamble and ordered cues found in ``text``.

    The original timing phrase belongs to authoring and is removed from cue text
    only when a timed LoRA causes compile-time pass expansion. Callers that only
    want timing analysis can use the offsets from :func:`analysis` below.
    """
    source = str(text or "")
    matches = list(_CUE_RE.finditer(source))
    if not matches:
        return source.strip(), []
    preamble = source[:matches[0].start()].strip()
    cues: list[Cue] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(source)
        body = source[match.end():end].strip()
        clean, directives = _strip_directives(body)
        cues.append(Cue(_cue_seconds(match), clean, directives))
    return preamble, cues



def normalize_times(text: str) -> str:
    """Normalize friendly ``At 4 sec`` cues to H3's documented clock style.

    This does not add shot/cut markers and therefore does not invent an edit. It
    is only a mechanical time-format translation; explicit cut language remains
    the user's own prose.
    """
    source = str(text or "")
    def repl(match: re.Match[str]) -> str:
        total_ms = int(round(_cue_seconds(match) * 1000))
        minutes, rest = divmod(total_ms, 60_000)
        seconds, ms = divmod(rest, 1000)
        return f"At {minutes:02d}:{seconds:02d}.{ms:03d}, "
    return _CUE_RE.sub(repl, source)

def _norm_name(value: str) -> str:
    return str(value or "").replace("\\", "/").strip().casefold()


def _name_keys(value: str) -> set[str]:
    norm = _norm_name(value)
    base = os.path.basename(norm)
    stem = os.path.splitext(base)[0]
    return {key for key in (norm, base, stem) if key}


def _entry_map(global_entries, segment_entries):
    rows = []
    for entry in list(global_entries or []) + list(segment_entries or []):
        if not isinstance(entry, dict) or not entry.get("name"):
            continue
        rows.append(entry)
    mapping: dict[str, dict] = {}
    for entry in rows:
        for key in _name_keys(entry.get("name")):
            mapping[key] = entry
    return mapping


def _find_entry(mapping: dict[str, dict], name: str) -> dict | None:
    for key in _name_keys(name):
        if key in mapping:
            return mapping[key]
    return None


def _timed_entry_names(cues: list[Cue], mapping: dict[str, dict]) -> tuple[set[str], list[str]]:
    names: set[str] = set()
    missing: list[str] = []
    for cue in cues:
        for directive in cue.directives:
            entry = _find_entry(mapping, directive.name)
            if entry is None:
                missing.append(directive.name)
            else:
                names.add(str(entry.get("name")))
    return names, missing


def has_timed_lora(text: str) -> bool:
    _preamble, cues = parse(text)
    return any(cue.directives for cue in cues)


def _copy_assets_for_beat(assets, first: bool, last: bool):
    out = []
    for asset in assets or []:
        if not isinstance(asset, dict):
            continue
        role = asset.get("role")
        if role == "first_frame" and not first:
            continue
        if role == "last_frame" and not last:
            continue
        out.append(deepcopy(asset))
    return out


def _clean_non_timed(entries, timed_names: set[str]):
    return [deepcopy(entry) for entry in entries or []
            if isinstance(entry, dict) and str(entry.get("name")) not in timed_names]


def _build_segment(base: dict, *, prompt: str, duration: float, loras: list[dict], first: bool, last: bool, continued: bool):
    seg = deepcopy(base)
    seg["prompt"] = prompt.strip()
    # Synthetic timed segments already contain the Director contribution in the
    # split prompt above.  Removing the sidecar field prevents compile.py from
    # appending the same Director prose a second time.
    seg.pop("director_prompt", None)
    seg["duration_s"] = float(duration)
    seg["loras"] = deepcopy(loras)
    seg["assets"] = _copy_assets_for_beat(base.get("assets"), first, last)
    # Timed adapter changes require separate sampler passes. Never carry a merge
    # flag across the synthetic boundary or the union stack would be patched for
    # the whole run and defeat the feature.
    seg["merge"] = False
    seg.pop("continue_from", None)
    if continued:
        seg["continue"] = True
        seg["continue_audio"] = True
    # User-authored transition words are a request for a real cut, not a seam.
    if _CUT_RE.search(prompt or ""):
        seg["continue"] = False
        seg["continue_audio"] = False
    if first:
        # Preserve the original seam *into* the authored shot.
        seg["continue"] = bool(base.get("continue"))
        seg["continue_audio"] = bool(base.get("continue_audio"))
        if base.get("continue_from") is not None:
            seg["continue_from"] = base.get("continue_from")
        # Keep the authored seam into the shot, but never preserve ``merge``.
        # A timed adapter shot needs its own sampler boundary from its first
        # frame so a Global LoRA can be overridden without retroactively
        # changing the previous shot's model stack.
        seg["merge"] = False
    return seg


def expand_piece(data: dict) -> dict:
    """Return ``data`` or a deep-copied piece with timed-LoRA shots expanded.

    Idempotent for normal authored data. Synthetic segments are tagged only in
    the transient copy, so calling this twice does not split them a second time.
    """
    if not isinstance(data, dict):
        return data
    segments = data.get("segments")
    if not isinstance(segments, list) or not segments:
        return data
    if any(isinstance(seg, dict) and seg.get("_timed_cue_generated") for seg in segments):
        return data

    plans = []
    any_timed = False
    for index, segment in enumerate(segments):
        if not isinstance(segment, dict) or segment.get("kind") == "clip":
            plans.append(None)
            continue
        # Director beats live in ``director_prompt`` so the visual timeline stays
        # optional and separate from the user's main Prompt Palette text.  Timed
        # LoRA directives authored there must still become real sampler splits,
        # exactly like directives typed directly into ``prompt``.  Parse the
        # transient combined authoring text only at the compiler boundary; normal
        # non-timed Director text is still joined later by compile.py.
        authored = "\n\n".join(
            part.strip() for part in (
                str(segment.get("prompt") or ""),
                str(segment.get("director_prompt") or ""),
            ) if part and part.strip()
        )
        preamble, cues = parse(authored)
        directives = [directive for cue in cues for directive in cue.directives]
        if not directives:
            plans.append(None)
            continue
        mapping = _entry_map(data.get("loras"), segment.get("loras"))
        timed_names, missing = _timed_entry_names(cues, mapping)
        if missing:
            missing_text = ", ".join(sorted(set(missing), key=str.casefold))
            raise ValueError(
                f"shot {index + 1} has timed LoRA cue(s) for {missing_text}, but no matching "
                "LoRA is active in Global or this shot. Add it in LoRAs first, then use "
                "*name or *{full/path.safetensors} in the prompt."
            )
        if not timed_names:
            plans.append(None)
            continue
        plans.append((preamble, cues, mapping, timed_names))
        any_timed = True

    if not any_timed:
        return data

    piece = deepcopy(data)
    expanded = []

    for index, base in enumerate(piece.get("segments") or []):
        plan = plans[index]
        if plan is None:
            expanded.append(base)
            continue
        preamble, cues, mapping_original, timed_names = plan
        duration = float(base.get("duration_s", 6) or 0)
        if duration <= 0:
            raise ValueError(f"shot {index + 1} has no usable duration for timed LoRA cues")
        last_time = -1.0
        for cue in cues:
            if cue.at <= last_time:
                raise ValueError(f"shot {index + 1} timed cues must be strictly increasing")
            if cue.at <= 0 or cue.at >= duration:
                raise ValueError(
                    f"shot {index + 1} timed cue at {cue.at:g}s must be after 0s and before "
                    f"the shot end at {duration:g}s"
                )
            last_time = cue.at

        original_global = [entry for entry in data.get("loras") or [] if isinstance(entry, dict) and entry.get("name")]
        mapping = _entry_map(original_global, data.get("segments", [])[index].get("loras"))
        global_names = {str(entry.get("name")) for entry in original_global}
        local_base = _clean_non_timed(base.get("loras"), timed_names)
        # A first timed directive can be either activation or deactivation.
        # Activation means "off until this boundary". Deactivation means the
        # adapter was intentionally on before the boundary, so preserve its
        # authored enabled state during the opening beat and remove it there.
        first_directive: dict[str, Directive] = {}
        for cue in cues:
            for directive in cue.directives:
                entry = _find_entry(mapping, directive.name)
                if entry is None:
                    continue
                name = str(entry.get("name"))
                first_directive.setdefault(name, directive)
        active: dict[str, dict] = {}
        for name, directive in first_directive.items():
            entry = _find_entry(mapping, name)
            if directive.enabled or entry is None or entry.get("enabled") is False:
                continue
            initial = deepcopy(entry)
            initial["enabled"] = True
            active[name] = initial
        boundaries = [0.0] + [cue.at for cue in cues] + [duration]
        texts = [preamble] + [cue.text for cue in cues]
        directives_by_beat = [()] + [cue.directives for cue in cues]

        for beat in range(len(boundaries) - 1):
            for directive in directives_by_beat[beat]:
                entry = _find_entry(mapping, directive.name)
                if entry is None:
                    continue
                name = str(entry.get("name"))
                if directive.enabled:
                    activated = deepcopy(entry)
                    activated["enabled"] = True
                    active[name] = activated
                else:
                    active.pop(name, None)
            start, end = boundaries[beat], boundaries[beat + 1]
            beat_duration = end - start
            if beat_duration < 0.2:
                raise ValueError(
                    f"shot {index + 1} has only {beat_duration:.3f}s between timed cues; "
                    "Creator needs at least 0.2s per generated timed pass"
                )
            prompt = (texts[beat] or "").strip()
            if not prompt:
                raise ValueError(
                    f"shot {index + 1} has no prompt text for the timed interval "
                    f"{start:g}-{end:g}s. Describe what happens before/after each At N sec cue."
                )
            # A shot-local entry with the same name overrides Global in
            # ``merge_loras``. For a timed LoRA inherited from Global we must
            # therefore emit an explicit disabled override while it is meant to
            # be off, rather than removing the Global adapter from the entire
            # piece (which would unexpectedly change unrelated shots).
            timed_overrides = list(active.values())
            for name in timed_names:
                if name not in global_names or name in active:
                    continue
                original = _find_entry(mapping, name)
                if original is None:
                    continue
                disabled = deepcopy(original)
                disabled["enabled"] = False
                timed_overrides.append(disabled)
            loras = local_base + timed_overrides
            synthetic = _build_segment(
                base,
                prompt=prompt,
                duration=beat_duration,
                loras=loras,
                first=beat == 0,
                last=beat == len(boundaries) - 2,
                continued=beat > 0,
            )
            synthetic["_timed_cue_generated"] = True
            synthetic["_timed_from_shot"] = index + 1
            synthetic["_timed_at_s"] = start
            expanded.append(synthetic)

    piece["segments"] = expanded
    return piece


def analysis(text: str, duration: float) -> dict:
    """Lightweight backend-independent timing metadata for inspection."""
    source = str(text or "")
    preamble, cues = parse(source)
    return {
        "duration": float(duration),
        "preamble": preamble,
        "cues": [
            {
                "at": cue.at,
                "text": cue.text,
                "loras": [
                    {"name": directive.name, "enabled": directive.enabled}
                    for directive in cue.directives
                ],
            }
            for cue in cues
        ],
    }
