"""MiniMax H3 Motion Context archive compatibility inside Creator Palette.

This integrates the useful, non-duplicative part of noEmbryo's
``H3 Motion Context Clip Stitcher``: final assembly of numbered
NikoDemon80 ``h3_motion_context_av_v1`` safetensor archives. Creator Palette
already owns its *generated* motion-continuation seams and streams its own reel
straight to disk, so rebuilding that path would be a regression. This module is
for archives made outside Creator Palette.

The boundary algorithm is adapted from noEmbryo/ComfyUI-noEmbryo's MIT-licensed
``stitcher.py``: linear video dissolve + equal-power audio crossfade over the
chosen H3 context length. The implementation here adds Creator's spill/reel
streaming so the final movie is never concatenated into one giant IMAGE tensor.
See THIRD_PARTY_NOTICES.md.
"""

from __future__ import annotations

import glob
import logging
import os
import re
from typing import Iterable

import torch

from comfy_api.latest import io

from . import spill
from .timeline import REEL_TYPE

try:
    from safetensors.torch import load_file as st_load
except Exception:  # pragma: no cover - ComfyUI normally ships safetensors
    st_load = None

try:
    import torchaudio
except Exception:  # pragma: no cover - only needed if archive rates disagree
    torchaudio = None

LOG = logging.getLogger("z3.minimax.h3_motion_context_archive")
CONTEXT_LENGTHS = ["5", "22", "39", "56"]


def _resolve_folder(path: str) -> str:
    import folder_paths

    raw = str(path or "").strip().strip('"').strip("'") or "h3_context"
    candidates = [raw, os.path.join(folder_paths.get_output_directory(), raw)]
    for candidate in candidates:
        if os.path.isdir(candidate):
            return os.path.abspath(candidate)
    raise FileNotFoundError(
        "H3 Motion Context archive folder was not found: "
        f"{raw}. Use an absolute path or a path relative to ComfyUI/output."
    )


def _clip_number(path: str) -> int:
    match = re.search(r"(?:^|_)(\d{5})(?:\.safetensors)$",
                      os.path.basename(path), re.IGNORECASE)
    return int(match.group(1)) if match else -1


def _find_files(folder: str, pattern: str, first_clip: int, last_clip: int):
    pattern = str(pattern or "clip_*.safetensors").strip() or "clip_*.safetensors"
    found = []
    for path in glob.glob(os.path.join(folder, pattern)):
        if not os.path.isfile(path) or not path.lower().endswith(".safetensors"):
            continue
        index = _clip_number(path)
        if index < int(first_clip) or index < 0:
            continue
        if int(last_clip) > 0 and index > int(last_clip):
            continue
        found.append((index, path))
    found.sort(key=lambda pair: pair[0])
    if not found:
        raise FileNotFoundError(
            f"No numbered H3 Motion Context .safetensors matched '{pattern}' in {folder}."
        )
    expected = found[0][0]
    for index, _ in found:
        if index != expected:
            raise ValueError(
                f"H3 Motion Context archive is missing clip {expected:05d}; "
                "stitching across a gap is disabled so the timeline cannot silently lie."
            )
        expected += 1
    return found


def archive_fingerprint(folder: str, pattern: str, first_clip: int, last_clip: int,
                        context_length: int, fps: float):
    try:
        root = _resolve_folder(folder)
        files = _find_files(root, pattern, first_clip, last_clip)
        stamps = tuple((path, os.stat(path).st_mtime_ns, os.path.getsize(path))
                       for _, path in files)
        return stamps + ((int(context_length), float(fps)),)
    except Exception:
        return float("nan")


def _load_archive(path: str):
    if st_load is None:
        raise RuntimeError("safetensors is unavailable in this ComfyUI Python environment")
    data = st_load(path, device="cpu")
    if "video" not in data or "audio" not in data:
        raise ValueError(
            f"{path} is not an h3_motion_context_av_v1-style archive: "
            "expected 'video' and 'audio' tensors"
        )
    video, audio = data["video"], data["audio"]
    if video.ndim != 5:
        raise ValueError(f"{path}: expected video [B,C,T,H,W], got {tuple(video.shape)}")
    if audio.ndim != 4:
        raise ValueError(f"{path}: expected audio [B,C,2,T], got {tuple(audio.shape)}")
    if int(video.shape[0]) != 1 or int(audio.shape[0]) != 1:
        raise ValueError(f"{path}: only batch-size-1 H3 Motion Context archives are supported")
    return video, audio


def _decode_video(vae, latent):
    images = vae.decode(latent)
    if images.ndim == 5:
        images = images.reshape(-1, *images.shape[-3:])
    elif images.ndim != 4:
        raise RuntimeError(f"H3 video VAE returned unexpected shape {tuple(images.shape)}")
    return images.float().clamp(0, 1).cpu()


def _decode_audio(audio_vae, latent):
    audio = audio_vae.decode(latent)
    if audio.ndim != 3:
        raise RuntimeError(f"H3 audio VAE returned unexpected shape {tuple(audio.shape)}")
    # Current ComfyUI audio VAE decode convention is [B, samples, channels].
    audio = audio.movedim(-1, 1).float().cpu()
    rate = int(getattr(audio_vae, "audio_sample_rate_output",
                       getattr(audio_vae, "audio_sample_rate", 32000)))
    return {"waveform": audio, "sample_rate": rate}


def _resample(audio, target_rate: int):
    if audio is None or int(audio["sample_rate"]) == int(target_rate):
        return audio
    if torchaudio is None:
        raise RuntimeError(
            f"H3 archive audio rates differ ({audio['sample_rate']} vs {target_rate}) "
            "but torchaudio is unavailable to resample them"
        )
    waveform = torchaudio.functional.resample(
        audio["waveform"], int(audio["sample_rate"]), int(target_rate))
    return {"waveform": waveform, "sample_rate": int(target_rate)}


def _blend_video(previous, current, length: int):
    if previous.shape[-3:] != current.shape[-3:]:
        raise ValueError(
            "H3 Motion Context clips decoded to different geometry; all clips in one "
            f"archive stitch must match ({tuple(previous.shape[-3:])} vs "
            f"{tuple(current.shape[-3:])})"
        )
    if length == 1:
        alpha = torch.full((1, 1, 1, 1), 0.5, dtype=previous.dtype)
    else:
        alpha = torch.linspace(0.0, 1.0, length, dtype=previous.dtype).view(length, 1, 1, 1)
    return previous * (1.0 - alpha) + current[:length] * alpha


def _blend_audio(previous, current, count: int):
    count = min(int(count), int(previous.shape[-1]), int(current.shape[-1]))
    if count <= 0:
        return previous[..., :0]
    theta = torch.linspace(0.0, 1.5707963267948966, count,
                           dtype=previous.dtype).view(1, 1, count)
    return previous[..., :count] * torch.cos(theta) + current[..., :count] * torch.sin(theta)


def _audio_dict(waveform, rate):
    return None if waveform is None else {"waveform": waveform, "sample_rate": int(rate)}


def stitched_blocks(files, video_vae, audio_vae, overlap: int, fps: float,
                    report: list[str]) -> Iterable[tuple[torch.Tensor, dict | None]]:
    """Yield final-media blocks without assembling the complete movie in RAM."""
    crossfade = int(overlap) > 0 and len(files) > 1
    target_rate = None
    prev_tail_images = prev_tail_wave = None

    for position, (index, path) in enumerate(files):
        video_latent, audio_latent = _load_archive(path)
        images = _decode_video(video_vae, video_latent)
        del video_latent
        audio = _decode_audio(audio_vae, audio_latent) if audio_vae is not None else None
        del audio_latent

        decoded = int(images.shape[0])
        is_last = position == len(files) - 1
        if audio is not None:
            if target_rate is None:
                target_rate = int(audio["sample_rate"])
            audio = _resample(audio, target_rate)

        if not crossfade:
            report.append(f"clip_{index:05d}: decoded={decoded} frames · plain append")
            yield images, audio
            continue

        if decoded < 2 * overlap:
            raise ValueError(
                f"Clip {index:05d} has {decoded} decoded frames; a {overlap}-frame "
                f"Motion Context dissolve needs at least {2 * overlap}."
            )

        sample_overlap = 0
        if audio is not None:
            sample_overlap = max(1, int(round((overlap / float(fps)) * target_rate)))
            if sample_overlap >= int(audio["waveform"].shape[-1]):
                raise ValueError(
                    f"Clip {index:05d} audio is too short for a {overlap}-frame "
                    "synchronized crossfade."
                )

        head_images, body_images, tail_images = (
            images[:overlap], images[overlap:-overlap], images[-overlap:])
        head_wave = body_wave = tail_wave = None
        if audio is not None:
            wave = audio["waveform"]
            head_wave, body_wave, tail_wave = (
                wave[..., :sample_overlap], wave[..., sample_overlap:-sample_overlap],
                wave[..., -sample_overlap:])

        if position == 0:
            opening = torch.cat([head_images, body_images], dim=0)
            opening_wave = (torch.cat([head_wave, body_wave], dim=-1)
                            if audio is not None else None)
            yield opening, _audio_dict(opening_wave, target_rate)
            prev_tail_images, prev_tail_wave = tail_images, tail_wave
        else:
            blend_images = _blend_video(prev_tail_images, images, overlap)
            blend_wave = (_blend_audio(prev_tail_wave, audio["waveform"], sample_overlap)
                          if audio is not None and prev_tail_wave is not None else None)
            yield blend_images, _audio_dict(blend_wave, target_rate)
            if is_last:
                final_images = torch.cat([body_images, tail_images], dim=0)
                final_wave = (torch.cat([body_wave, tail_wave], dim=-1)
                              if audio is not None else None)
                yield final_images, _audio_dict(final_wave, target_rate)
            else:
                yield body_images, _audio_dict(body_wave, target_rate)
                prev_tail_images, prev_tail_wave = tail_images, tail_wave

        kept = decoded if is_last else decoded - overlap
        audio_seconds = (0.0 if audio is None else
                         audio["waveform"].shape[-1] / float(target_rate))
        report.append(
            f"clip_{index:05d}: decoded={decoded} · dissolve={overlap} frames "
            f"({overlap / float(fps):.3f}s) · contributes≈{kept} · audio={audio_seconds:.3f}s"
        )


class Z3MiniMaxH3MotionContextArchiveReel(io.ComfyNode):
    """Internal final-media bridge for external H3 Motion Context archives."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="Z3MiniMaxH3MotionContextArchiveReel",
            display_name="MiniMax H3 Motion Context Archive Stitcher",
            category="MiniMax/internal",
            description=(
                "Creator-integrated final assembly for NikoDemon80/noEmbryo H3 Motion "
                "Context AV safetensor archives. Decodes each clip once and dissolves "
                "the shared Motion Context head in picture and audio."
            ),
            is_dev_only=True,
            inputs=[
                io.Vae.Input("video_vae"),
                io.Vae.Input("audio_vae"),
                io.String.Input("folder", default="h3_context"),
                io.String.Input("pattern", default="clip_*.safetensors"),
                io.Int.Input("first_clip", default=1, min=1, max=99999),
                io.Int.Input("last_clip", default=0, min=0, max=99999),
                io.Combo.Input("context_length", options=CONTEXT_LENGTHS, default="22"),
                io.Float.Input("fps", default=24.0, min=1.0, max=240.0, step=0.001),
            ],
            outputs=[
                io.Custom(REEL_TYPE).Output(display_name="reel"),
                io.String.Output(display_name="report"),
            ],
        )

    @classmethod
    def fingerprint_inputs(cls, folder, pattern, first_clip, last_clip,
                           context_length, fps, **kwargs):
        return archive_fingerprint(folder, pattern, first_clip, last_clip,
                                   int(context_length), float(fps))

    @classmethod
    def execute(cls, video_vae, audio_vae, folder="h3_context",
                pattern="clip_*.safetensors", first_clip=1, last_clip=0,
                context_length="22", fps=24.0) -> io.NodeOutput:
        root = _resolve_folder(folder)
        files = _find_files(root, pattern, first_clip, last_clip)
        overlap = int(context_length)
        report: list[str] = []
        LOG.info("Creator H3 archive stitch: %d clip(s) from %s", len(files), root)
        spec = spill.write_av_blocks(
            stitched_blocks(files, video_vae, audio_vae, overlap, float(fps), report),
            float(fps),
        )
        seconds = int(spec["frames"]) / float(fps)
        report.append(
            f"TOTAL: {spec['frames']} frames · {seconds:.3f}s at {float(fps):.3f} fps "
            f"· {len(files)} archive clip(s)"
        )
        return io.NodeOutput([{"pass": spec}], "\n".join(report))


NODES = [Z3MiniMaxH3MotionContextArchiveReel]

DEFAULT_ARCHIVE_CONFIG = {
    "enabled": False,
    "folder": "h3_context",
    "pattern": "clip_*.safetensors",
    "first_clip": 1,
    "last_clip": 0,
    "context_length": 22,
    "fps": 24.0,
}


def config_from_piece(data):
    raw = data.get("archive_stitch") if isinstance(data, dict) else None
    raw = raw if isinstance(raw, dict) else {}
    try:
        context = int(raw.get("context_length", 22))
    except (TypeError, ValueError):
        context = 22
    if str(context) not in CONTEXT_LENGTHS:
        context = 22
    try:
        first = max(1, int(raw.get("first_clip", 1)))
    except (TypeError, ValueError):
        first = 1
    try:
        last = max(0, int(raw.get("last_clip", 0)))
    except (TypeError, ValueError):
        last = 0
    try:
        fps = min(240.0, max(1.0, float(raw.get("fps", 24.0))))
    except (TypeError, ValueError):
        fps = 24.0
    return {
        "enabled": raw.get("enabled") is True,
        "folder": str(raw.get("folder") or "h3_context").strip() or "h3_context",
        "pattern": str(raw.get("pattern") or "clip_*.safetensors").strip() or "clip_*.safetensors",
        "first_clip": first,
        "last_clip": last,
        "context_length": context,
        "fps": fps,
    }


def emit_archive(piece, weights, unique_id, filename_prefix):
    """Build the decode/stitch/save graph for Creator archive mode."""
    from comfy_execution.graph_utils import GraphBuilder

    from . import models, render, settings

    cfg = config_from_piece(piece)
    if not cfg["enabled"]:
        raise ValueError("archive stitch mode is not enabled")
    models.check_codecs(weights, audio=True)
    # Validate the file selection before VAE loaders enter the execution graph.
    root = _resolve_folder(cfg["folder"])
    _find_files(root, cfg["pattern"], cfg["first_clip"], cfg["last_clip"])

    graph = GraphBuilder()
    video_vae, audio_vae = models.emit_codecs(graph, weights, audio=True)
    stitch = graph.node(
        "Z3MiniMaxH3MotionContextArchiveReel",
        video_vae=video_vae,
        audio_vae=audio_vae,
        folder=cfg["folder"],
        pattern=cfg["pattern"],
        first_clip=cfg["first_clip"],
        last_clip=cfg["last_clip"],
        context_length=str(cfg["context_length"]),
        fps=float(cfg["fps"]),
    )
    save = graph.node(
        render.SAVE_NODE,
        reel=stitch.out(0),
        fps=float(cfg["fps"]),
        filename_prefix=filename_prefix,
        crf=settings.video_crf(),
        report=stitch.out(1),
    )
    save.set_override_display_id(unique_id)
    return render.expanded(graph)
