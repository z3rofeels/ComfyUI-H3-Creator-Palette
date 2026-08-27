"""The MiniMax H3 Creator node.

One node, one prompt box, one video — and no sockets at all. Media is chosen in
the UI and loaded from ComfyUI/input by filename; the weights are chosen the same
way and loaded by `models.emit_links` inside the subgraph; and the finished clip
is muxed, saved and played in the node body rather than handed to whatever the
user wired downstream. What the user attaches decides the mode, and the mode
decides which of the two checkpoints is loaded — FL2VA and Ref2VA are separate
weights, so routing the right one is the node's job rather than the user's, and
only the routed one is built. The routing can be pinned from the UI (`checkpoint`
in the blob) when you want the other weights on the same payload;
`compile._resolve_checkpoint` owns which pins are allowed.

**One node, one shot or twenty.** This was two nodes — a Creator that made one
clip and a Timeline that made several — and they were never two things. A Creator
render *is* a one-segment timeline: same payload shape and same emitted graph.
So the blob is the piece's, always: a
global prompt, one canvas, one set of weights, and a strip of segments. A lone
generation is a strip with one card on it, and the face the node wears follows
the strip rather than a mode anyone has to pick.

Workflows saved while they were two nodes hold the old shape. `compile.as_piece`
reads one as the one-shot piece it always was — see there for which fields move
and which deliberately do not.

**This node owns the sampler.** It used to hand out conditioning and let the
graph do the sampling, which meant every workflow re-assembled the same six
nodes behind it and got to choose wrong: the H3 templates sample with
`res_multistep` and decode sound with `VAEDecodeAudio`, and a hand-wired graph
that picked the defaults instead was quietly worse. Owning it also puts the two
optional accelerators somewhere they can be switched on, which they cannot be
from outside a node that ends at conditioning.

It has to own it for a second reason as well, which is what forced the Timeline
to be a node that builds graphs: segment 2 starts from segment 1's *decoded* last
frame, so the chain has a data dependency that only exists downstream of
sampling. Returning conditioning N times would not express it, and feeding the
result back into the node's own input would be a cycle the executor refuses to
run. So `execute` compiles the blob to one payload per pass, hands them to
`render.emit`, and returns that subgraph through the `expand` mechanism.

The node is also an *output* node, which is the other half of having no sockets:
`render.emit_tail` writes the file and stamps this node's id on the save node, so
the result is reported back against the node the user is looking at.

`creator_data` is the UI's serialised state and is managed entirely by `js/`. It
is a normal widget only so it round-trips through saved workflows; hand-editing
it is supported (that is how phase 1 was tested) but the frontend will overwrite
it.
"""

import json

from comfy_api.latest import ComfyExtension, io

from . import (accel, archive_stitcher, canvas, compile as compiler, facepass, hires, media,
               models, outputs, prestage, render, settings, timeline, palette_runtime)
from .wildcard_index import get_index

DEFAULT_DATA = json.dumps({
    "version": 3,
    # The standing description every segment inherits. Empty on a fresh node,
    # and on a piece of one shot there is nothing for it to stand over — the
    # writing happens on the card.
    "prompt": "",
    "aspect": "16:9",
    "aspect_source": "pill",
    "short_edge": canvas.NATIVE_SHORT_EDGE,
    "upscale": "two_pass",
    "sample_edge": canvas.NATIVE_SHORT_EDGE,
    "refine_denoise": 0.5,
    "face": {"on": False, "canvas": 512, "denoise": 0.45},
    # Where the finished clip lands under output/. See `outputs`.
    "output_prefix": outputs.VIDEO_PREFIX,
    # Which files to load. Empty here rather than guessed: a fresh node has no
    # idea what is on this machine, and the UI fills it from the listing route.
    "models": {},
    # Optional final-media compatibility mode for external H3 Motion Context
    # AV archives. Off by default; normal Creator generation remains untouched.
    "archive_stitch": {"enabled": False, "folder": "h3_context",
                       "pattern": "clip_*.safetensors", "first_clip": 1,
                       "last_clip": 0, "context_length": 22, "fps": 24},
    # One card, because one shot is what a node dropped on the canvas is for.
    # The strip grows from here; nothing about the blob changes when it does.
    "segments": [
        {"prompt": "", "assets": [], "loras": [], "duration_s": 6, "checkpoint": "auto"},
    ],
}, indent=2)


def _schema():
    """Current-only v3 schema for the z3rofeels H3 creator.

    `creator_data` owns the complete piece. `text` is a synchronized backing
    widget for Prompt Palette's editor surface; the frontend maps it onto the
    currently selected shot/global prompt. H3 render controls remain ordinary
    schema inputs so queued workflows are deterministic and inspectable.
    """
    import comfy.samplers

    return io.Schema(
        node_id="Z3MiniMaxH3CreatorV3",
        display_name="MiniMax H3 Creator Palette",
        category="z3rofeels/Video",
        description=(
            "Complete local MiniMax H3 creator by z3rofeels: Prompt Palette editing, "
            "wildcards, categorized prompt building, @ media references, cast, LoRAs, "
            "timeline shots, local refinement, pre-stage stills, H3 routing, sampling, "
            "acceleration, decode and save in one node."
        ),
        enable_expand=True,
        is_output_node=True,
        inputs=[
            io.String.Input("creator_data", multiline=True, default=DEFAULT_DATA),
            io.String.Input("text", display_name="Prompt Palette text", multiline=True,
                            default="", dynamic_prompts=False),
            io.Combo.Input("processing_mode", display_name="Prompt Palette processing",
                           options=["entire text as one", "line by line"],
                           default="entire text as one"),
            io.Int.Input("seed", default=0, min=0, max=0xffffffffffffffff,
                         control_after_generate=True),
            io.Int.Input("steps", default=20, min=1, max=10000),
            io.Float.Input("cfg", default=1.0, min=0.0, max=100.0, step=0.1, round=0.01),
            io.Combo.Input("sampler_name", options=comfy.samplers.KSampler.SAMPLERS,
                           default="res_multistep"),
            io.Combo.Input("scheduler", options=comfy.samplers.KSampler.SCHEDULERS,
                           default="simple"),
            # H3's own release schedule. The custom UI keeps these in Advanced
            # and does not present them as quality controls.
            io.Float.Input("shift_video", default=render.SHIFT_DEFAULTS[0], min=0.01,
                           max=100.0, step=0.01,
                           tooltip="Advanced: H3 video sigma shift. Release default is 12."),
            io.Float.Input("shift_audio", default=render.SHIFT_DEFAULTS[1], min=0.01,
                           max=100.0, step=0.01,
                           tooltip="Advanced: H3 audio sigma shift. Release default is 3."),
            io.Combo.Input("block_cache", options=accel.BLOCK_CACHE_MODES, default="off"),
            io.Boolean.Input("spectrum", default=False),
            io.Float.Input("spectrum_blend", default=0.5, min=0.0, max=1.0, step=0.01),
            io.Combo.Input("attention", options=accel.ATTENTION_MODES, default="default",
                           tooltip="default, KJNodes sage, or core comfy-kitchen attention."),
            io.Boolean.Input("chunk_ffn", default=False),
            io.Boolean.Input("fp16_accumulation", default=False),
            # IMPORTANT: append internal/frontend-managed inputs at the END of
            # the widget schema. ComfyUI workflow widget_values are positional;
            # inserting a widget above long-lived controls shifts old workflows.
            io.Int.Input("variation_index", display_name="Scene variation step",
                         default=0, min=0, max=1000000, advanced=True,
                         control_after_generate=True),
            # Added after every v3.12.7 widget so older positional workflow
            # arrays retain their exact meaning. The custom frontend presents
            # these together in one H3-specific optimization section.
            io.Combo.Input("h3_memory", options=accel.H3_MEMORY_MODES, default="off",
                           tooltip="Optional Zironic/H3-Optimizations memory path."),
            io.Combo.Input("h3_sparse", options=accel.H3_SPARSE_MODES, default="off",
                           tooltip="Optional fixed-density H3 video attention preset."),
            io.Boolean.Input("h3_sparse_edges", default=False,
                             tooltip="Keep 30 percentage points more video KV in the first and last two steps."),
        ],
        outputs=[],
        hidden=[io.Hidden.unique_id],
    )

def _fingerprint(blob):
    """Re-run when piece media, editable inputs, or archive files change."""
    try:
        data = json.loads(blob)
        piece = compiler.as_piece(data)
        archive_cfg = archive_stitcher.config_from_piece(data)
        archive_stamp = None
        if archive_cfg.get("enabled"):
            archive_stamp = archive_stitcher.archive_fingerprint(
                archive_cfg["folder"], archive_cfg["pattern"],
                archive_cfg["first_clip"], archive_cfg["last_clip"],
                archive_cfg["context_length"], archive_cfg["fps"],
            )
        return (blob, timeline.stamps(piece), get_index().fingerprint(), archive_stamp)
    except Exception:
        return (blob, (), get_index().fingerprint(), None)


def _safe_subject_handle(value, fallback="character"):
    """Map display-style cast names to the v3 subject identifier grammar."""
    import re
    import unicodedata

    raw = str(value or "").strip().lstrip("@")
    raw = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode("ascii")
    handle = re.sub(r"[^A-Za-z0-9_]+", "_", raw)
    handle = re.sub(r"_+", "_", handle).strip("_")
    if not handle or not handle[0].isalpha():
        handle = f"Character_{handle}".strip("_")
    return (handle[:32].rstrip("_") or fallback)


def _migrate_subject_handles(data):
    """Repair old/display-name subject handles and every @mention that cites them."""
    import re

    subjects_raw = data.get("subjects") if isinstance(data, dict) else None
    if not isinstance(subjects_raw, list) or not subjects_raw:
        return data

    renames = []
    used = set()
    seen_originals = set()
    for index, subject in enumerate(subjects_raw):
        if not isinstance(subject, dict):
            continue
        old = str(subject.get("handle") or "").strip().lstrip("@")
        base = _safe_subject_handle(old, f"Character_{index + 1}")
        handle = base
        suffix = 2
        while handle in used:
            tail = f"_{suffix}"
            suffix += 1
            handle = f"{base[:max(1, 32 - len(tail))]}{tail}"
        used.add(handle)
        subject["handle"] = handle
        if old not in seen_originals:
            seen_originals.add(old)
            if old and old != handle:
                renames.append((old, handle))

    if not renames:
        return data
    renames.sort(key=lambda pair: len(pair[0]), reverse=True)

    def walk(value):
        if isinstance(value, str):
            for old, new in renames:
                value = re.sub(rf"@{re.escape(old)}(?!-[0-9])(?![A-Za-z0-9_])", f"@{new}", value)
            return value
        if isinstance(value, list):
            return [walk(item) for item in value]
        if isinstance(value, dict):
            return {key: walk(item) for key, item in value.items()}
        return value

    # Preserve the already-normalized handle fields after recursively updating text.
    migrated = walk(data)
    for migrated_subject, original_subject in zip(migrated.get("subjects", []), subjects_raw):
        if isinstance(migrated_subject, dict) and isinstance(original_subject, dict):
            migrated_subject["handle"] = original_subject.get("handle")
    return migrated


def _render(blob, text, processing_mode, seed, steps, cfg, sampler_name, scheduler,
            block_cache, spectrum, spectrum_blend, unique_id,
            shift_video=render.SHIFT_DEFAULTS[0],
            shift_audio=render.SHIFT_DEFAULTS[1],
            attention="default", chunk_ffn=False,
            fp16_accumulation=False, variation_index=0,
            h3_memory="off", h3_sparse="off", h3_sparse_edges=False):
    """The whole of what either node id does. See the module docstring."""
    try:
        raw_data = _migrate_subject_handles(json.loads(blob))
    except json.JSONDecodeError as exc:
        raise ValueError(f"the node's data is not valid JSON: {exc}") from exc

    # PreStage and Creator are both output nodes, so ComfyUI has no socket edge
    # that can order them.  The frontend writes this small, persisted gate while
    # a still is being generated or reviewed.  Returning UI-only output keeps
    # the video half genuinely stopped: the user can inspect a whole still
    # batch and explicitly choose what becomes a keyframe/reference first.
    prestage_gate = raw_data.get("prestage_gate") if isinstance(raw_data, dict) else None
    if isinstance(prestage_gate, dict) and prestage_gate.get("active"):
        return io.NodeOutput(ui={
            "mmc_creator_idle": [{
                "reason": "prestage_review",
                "message": str(prestage_gate.get("message") or
                               "Creator is waiting for a PreStage image to be reviewed."),
                "prestage_node_id": prestage_gate.get("node_id"),
            }]
        })

    # Queue variation is injected transiently into creator_data by the V3
    # frontend immediately before graphToPrompt(). This avoids relying on the
    # renderer-specific widget store for a hidden counter, so Nodes 2 and
    # Classic queue exactly the same scene/cast audition step. The field never
    # becomes authored workflow state.
    queue_variation = raw_data.pop("_queue_variation_index", None) if isinstance(raw_data, dict) else None
    seed_hunt = raw_data.pop("_seed_hunt", None) if isinstance(raw_data, dict) else None
    try:
        effective_variation = max(0, int(queue_variation if queue_variation is not None else variation_index))
    except (TypeError, ValueError):
        try:
            effective_variation = max(0, int(variation_index or 0))
        except (TypeError, ValueError):
            effective_variation = 0

    data = compiler.as_piece(raw_data)

    # External H3 Motion Context archives are already sampled AV latents. Creator
    # Palette already owns its own live continuation/reel path, so archive mode
    # deliberately bypasses prompt compilation, Qwen and the DiT and loads only
    # the two VAEs needed to decode/stitch those files.
    archive_cfg = archive_stitcher.config_from_piece(data)
    if archive_cfg["enabled"]:
        return archive_stitcher.emit_archive(
            data,
            models.Weights.from_blob(data),
            unique_id,
            filename_prefix=outputs.video(data, settings.video_prefix()),
        )

    # Prompt Palette's visible editor is synchronized into the active card by
    # the frontend. Keep a conservative one-card fallback for API/manual queues.
    if text and len(data.get("segments") or []) == 1 and not data["segments"][0].get("prompt"):
        data["segments"][0]["prompt"] = text
    # Seed Hunt changes sampler noise while keeping wildcard and audition prose
    # fixed. The helper removes its transient prompt-seed contract immediately
    # after resolution, before normal V3 compilation continues.
    data, _wildcards_used = palette_runtime.resolve_for_sampling(
        data, int(seed), processing_mode, effective_variation, seed_hunt)

    # The piece as this queue will make it, which is not always the piece on the
    # strip: a card held back is not sampled, and a card playing a kept take is
    # spliced from the file it already has. `rendered_piece` hands back the blob
    # itself when neither is in play, so a strip that never touched any of this
    # compiles to exactly what it always did.
    piece = compiler.rendered_piece(data)

    # One payload per pass, and a pass is a run of merged segments — usually one
    # segment long, and on a piece of one shot there is exactly one of each. How
    # the piece is *compiled* is the only thing the merging changes; what is
    # built from the result is the same loop either way. `render.emit` wires each
    # payload to the one before it, and a pass holding several segments simply
    # has no seam inside it to wire.
    payloads = compiler.timeline_payloads(piece, image_size_lookup=media.image_size)
    segments = compiler.timeline_segments(piece)
    runs = compiler.timeline_runs(piece)
    # Whether this render is the strip the user is looking at, or part of one.
    # A held card is dropped from the rendered piece, so a shorter piece is a
    # render of part of a strip — which is a different thing from a piece that
    # happens to be short, and everything that used to read "one payload" as
    # "one lone generation" needs to be told which it has.
    whole_piece = len(segments) == len(compiler.timeline_segments(data))
    labels = timeline.labels(runs, segments, whole_piece)

    machine_settings = settings.load()
    graph = render.emit(
        payloads, labels,
        models.Weights.from_blob(data),
        render.Sampling(seed=seed, steps=steps, cfg=cfg,
                        sampler_name=sampler_name, scheduler=scheduler,
                        shift_video=shift_video, shift_audio=shift_audio),
        accel.Settings(block_cache=block_cache, spectrum=spectrum,
                       spectrum_blend=spectrum_blend,
                       attention=attention,
                       chunk_ffn=chunk_ffn,
                       fp16_accumulation=fp16_accumulation,
                       h3_memory=h3_memory,
                       h3_sparse=h3_sparse,
                       h3_sparse_edges=h3_sparse_edges),
        unique_id,
        # Resolved here rather than inside the save node: a prefix that cannot be
        # used should stop the queue before anything is sampled, not after —
        # `get_save_image_path` raising at the end of a render costs the user the
        # render.
        filename_prefix=outputs.video(data, settings.video_prefix()),
        # Which card each pass is, and what seed it runs on. Both are read off
        # the run's first segment because both are properties of the generation
        # rather than of a card: a pass holding three shots is one sampler call
        # with one seed, and it is the one card the strip would send you to.
        cards=[int(segments[start].get("card_no") or start + 1)
               for start, _ in runs],
        seeds=[compiler.segment_seed(segments[start], start) for start, _ in runs],
        # See `render.emit`: a card shot by itself is one payload and is still
        # one card of a piece, so the take it makes is worth keeping and the
        # number it announces is worth saying.
        whole_piece=whole_piece,
        # Preview visibility and preview availability are deliberately separate.
        # If the sidecar was hidden when this queue was built, arm only KJNodes' cheap
        # single-frame stream. The frontend can then attach mid-generation without
        # cancelling/requeueing; a sidecar already enabled gets the full animation.
        preview_enabled=models.preview_config(machine_settings),
        # Read off `data` and not off `piece`: the turbo switch is a property of
        # the piece as it stands, and a render holding cards back does not
        # change which LoRA is the distillation. Reading the setting here rather
        # than inside `emit` is the same rule the output prefix follows — the
        # file on disk is consulted once per queue, above the graph.
        lead_in=render.LeadIn.of(data))
    return render.expanded(graph)


class Z3MiniMaxH3CreatorV3(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return _schema()

    @classmethod
    def fingerprint_inputs(cls, creator_data, **kwargs):
        return _fingerprint(creator_data)

    @classmethod
    def execute(cls, creator_data, text, processing_mode, seed, steps, cfg,
                sampler_name, scheduler, variation_index=0, block_cache="off", spectrum=False,
                spectrum_blend=0.5, shift_video=render.SHIFT_DEFAULTS[0],
                shift_audio=render.SHIFT_DEFAULTS[1], attention="default",
                chunk_ffn=False, fp16_accumulation=False,
                h3_memory="off", h3_sparse="off", h3_sparse_edges=False) -> io.NodeOutput:
        return _render(
            creator_data, text, processing_mode, seed, steps, cfg,
            sampler_name, scheduler, block_cache, spectrum, spectrum_blend,
            cls.hidden.unique_id, shift_video=shift_video, shift_audio=shift_audio,
            attention=attention, chunk_ffn=chunk_ffn,
            fp16_accumulation=fp16_accumulation, variation_index=variation_index,
            h3_memory=h3_memory, h3_sparse=h3_sparse,
            h3_sparse_edges=h3_sparse_edges,
        )


class MiniMaxCreatorPaletteExtension(ComfyExtension):
    async def get_node_list(self):
        return [Z3MiniMaxH3CreatorV3, *timeline.NODES, *prestage.NODES,
                *hires.NODES, *facepass.NODES, *archive_stitcher.NODES, *models.NODES]


async def comfy_entrypoint() -> MiniMaxCreatorPaletteExtension:
    return MiniMaxCreatorPaletteExtension()
