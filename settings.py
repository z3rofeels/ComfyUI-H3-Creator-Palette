"""Preferences that belong to this ComfyUI rather than to a workflow.

The line this file draws: a workflow says what the piece *is* — the prompt, the
references, the duration. This says how this machine writes it. Two people
opening the same `.json` should get the same shot, and should not also be made
to agree about how many megabytes it may take or which folder on their own disk
it lands in.

Encoding quality was the first thing on this side of the line; the output
folders followed it, for the same reason and one more. A prefix stored per node
meant every node was a place the answer could differ, so a workflow with a
Creator, a Timeline and a pre-stage in it had three, and moving a project to
another machine carried someone else's folder names along with it.

So it is not in `creator_data` and it is not a widget. It is one small JSON file
that the settings page writes and the save node reads.

**Where it lives, and why not under `user/default/`.** The picker's favorites go
through the frontend's userdata API, which files them per ComfyUI user. This
cannot: it is read while a queued prompt executes, and an execution has no
request behind it and therefore no user. A file that the settings page wrote to
one place and the node read from another would be a setting that silently does
nothing. One file beside `user/`, read the same way by both.

This file decides what a setting is *allowed* to be; `js/minimax_creator/
settings.js` decides what the page *offers*. They are not mirrors and there is
no mirror test: the encoder's whole scale is legal here, so a value typed into
the file by hand is honoured and shown, while the page offers the four points on
it worth choosing between.

Nothing here imports torch or ComfyUI at module scope, so preferences remain
portable and lightweight outside a running render process.
"""

import json
import os

from . import outputs

FILE = "z3_minimax_creator.settings.json"

# libx264's own scale, verbatim: 0 is (near) lossless and 51 is unwatchable.
# Refusing anything outside it here means the number reaching the encoder is
# always a number the encoder has an answer for.
MIN_CRF = 0
MAX_CRF = 51

# What libx264 picks when nothing tells it otherwise, which is exactly what this
# pack wrote before the setting existed. Passing it explicitly changes no file.
DEFAULT_CRF = 23

# Where the two kinds of file land under ComfyUI's output directory. Prefixes,
# not folders: core's `filename_prefix` names the folder *and* the stem every
# file in it is numbered off, and expands `%year%`-style tokens per render.
# `outputs.py` owns what one is allowed to be.
DEFAULT_VIDEO_PREFIX = outputs.VIDEO_PREFIX
DEFAULT_IMAGE_PREFIX = outputs.IMAGE_PREFIX

DEFAULTS = {
    "video_crf": DEFAULT_CRF,
    "video_prefix": DEFAULT_VIDEO_PREFIX,
    "image_prefix": DEFAULT_IMAGE_PREFIX,
    # Whether the sampler row draws the two flow-shift pills. Off by default:
    # most rows never leave the checkpoints' own schedule, and two more numbers
    # on every node is a cost only the people dialling schedules should pay.
    # Nothing queued ever reads this — it is a UI preference — but it lives
    # here because it is per-machine like everything else in this file, and one
    # settings page writing one file beats a second store for one boolean.
    "show_shift_pills": False,
    # Whether the node faces offer the controls most rows never touch — the
    # turbo lead-in, and the two accelerators that trade something subtle
    # enough that a row wearing them is not a row anybody set by accident.
    # Off by default, for the same reason as the pills above: the sampler row
    # should be the length of the decisions actually being made.
    #
    # It hides rather than disables, and it never hides something that is on.
    # A control in force keeps its pill whatever this says — the rule the
    # shift pills and the custom quality row already live by — so switching
    # this off can never quietly change what a render does.
    "advanced": False,
    # Whether the preview sidecar plays a clip the moment it has one — the
    # finished render and animated TinyVAE step previews while it samples.
    # UI-only: playback changes nothing about the queued graph.
    "autoplay_previews": True,
    # The docked TinyVAE sidecar is a machine/UI preference. The hidden-mode
    # choice below decides whether turning it off leaves an attachable one-frame
    # check stream or skips KJNodes' wrapper entirely.
    "preview_sidecar": True,
    # TinyVAE decode/transport preferences. These are deliberately machine
    # settings: preview cost should follow the GPU and browser displaying it,
    # not travel with the creative workflow.
    "preview_frames": 1024,
    "preview_max_resolution": 640,
    "preview_jpeg_quality": 78,
    "preview_fps": 24,
    "preview_info": "standard",
    # Armed keeps a one-frame stream available while the window is hidden, so
    # it can attach mid-render. Off is the zero-overhead hardware option.
    "preview_hidden_mode": "armed",
    # Optional beta UI. Off means no Seed Hunt control, queue wrapper, or
    # behavioral change is active. Enabling it only exposes the Lab; a hunt
    # still has to be started explicitly by the user.
    "seed_hunt_beta": False,
    # Whether a reference's scope is written into the prompt for the model as
    # well as into the refiner's glossary. Off by default: it is the behaviour
    # every render had before it existed, and the sentences cost tokens a
    # refined piece is already spending better.
    #
    # This one does reach the render, which is the line the rest of this file
    # draws and the reason it is worth naming out loud: two people opening the
    # same `.json` get the same shot only if they agree about it. It sits here
    # anyway because it is a statement about how you prompt — some people write
    # the scope into their own prose and want no second copy of it — and a
    # per-node copy would make that one answer into a dozen.
    "define_refs": False,
    # How many of a turbo render's opening steps run on the un-distilled
    # weights — the turbo LoRA held off the model for those steps and patched
    # on for the rest. 0 is off, which is what every render did before this
    # existed. See `render.LeadIn` for what it builds and why.
    #
    # This reaches the render, like `define_refs` and for a related reason: it
    # is a statement about how you use a distillation rather than about this
    # piece. The LoRA, the steps and the schedule are all still the workflow's;
    # this only says where in that schedule the distillation takes over.
    "turbo_lead_in": 0,
    # Local model/device choices are machine-specific by definition. Creator
    # still serializes an explicit workflow choice, but new/partially restored
    # nodes can recover from these defaults after a frontend reload.
    "model_defaults": {},
    # Local model choices for PreStage's three generation modes. These are
    # machine defaults only; explicit values stored in a workflow always win.
    "prestage_model_defaults": {},
}

# How far the lead-in may reach. Not a hard truth about the model — it is the
# point past which the idea stops being a lead-in: the distillation is what the
# remaining steps are for, and a render that spends most of its schedule on the
# base weights at turbo step counts is a bad 20-step render, not a fast one.
MAX_LEAD_IN = 4


def clean(raw):
    """A settings blob -> the settings this pack will use. Unknown keys dropped.

    Raises ValueError on a key that is present and unusable, so the route can
    refuse it rather than store a value the node would then ignore. A missing
    key is not an error: it is the default, and a file written by an older
    version is missing every key added since.
    """
    if not isinstance(raw, dict):
        raise ValueError("settings must be an object")
    clean_settings = dict(DEFAULTS)
    if "video_crf" in raw and raw["video_crf"] is not None:
        crf = raw["video_crf"]
        # `True` is an int in Python and would sail through as crf 1.
        if isinstance(crf, bool) or not isinstance(crf, (int, float)) or crf != int(crf):
            raise ValueError("video_crf must be a whole number")
        crf = int(crf)
        if not MIN_CRF <= crf <= MAX_CRF:
            raise ValueError(f"video_crf must be between {MIN_CRF} and {MAX_CRF}")
        clean_settings["video_crf"] = crf
    if "turbo_lead_in" in raw and raw["turbo_lead_in"] is not None:
        lead = raw["turbo_lead_in"]
        # `True` is an int in Python and would sail through as a one-step
        # lead-in, the same trap `video_crf` sets above.
        if isinstance(lead, bool) or not isinstance(lead, (int, float)) or lead != int(lead):
            raise ValueError("turbo_lead_in must be a whole number of steps")
        lead = int(lead)
        if not 0 <= lead <= MAX_LEAD_IN:
            raise ValueError(f"turbo_lead_in must be between 0 and {MAX_LEAD_IN}")
        clean_settings["turbo_lead_in"] = lead
    if "model_defaults" in raw and raw["model_defaults"] is not None:
        defaults = raw["model_defaults"]
        if not isinstance(defaults, dict):
            raise ValueError("model_defaults must be an object")
        allowed = {"fl2va", "ref2va", "clip", "vae", "audio_vae", "preview", "sam3", "dtype", "route"}
        cleaned_models = {}
        for key in allowed:
            value = defaults.get(key)
            if value is None or value == "":
                continue
            if not isinstance(value, str):
                raise ValueError(f"model_defaults.{key} must be text")
            cleaned_models[key] = value.strip()
        devices = defaults.get("devices")
        if devices is not None:
            if not isinstance(devices, dict):
                raise ValueError("model_defaults.devices must be an object")
            cleaned_models["devices"] = {}
            for key, value in devices.items():
                if not isinstance(key, str) or not isinstance(value, str):
                    raise ValueError("model_defaults.devices values must be text")
                if value.strip():
                    cleaned_models["devices"][key] = value.strip()
        clean_settings["model_defaults"] = cleaned_models


    if "prestage_model_defaults" in raw and raw["prestage_model_defaults"] is not None:
        defaults = raw["prestage_model_defaults"]
        if not isinstance(defaults, dict):
            raise ValueError("prestage_model_defaults must be an object")
        allowed = {
            "krea2": {"model", "turbo_model", "clip", "vae"},
            "ideogram4": {"model", "uncond_model", "clip", "vae"},
            "minimax": {"fl2va", "ref2va", "clip", "vae", "audio_vae", "preview", "dtype"},
        }
        cleaned = {}
        for arch, keys in allowed.items():
            block = defaults.get(arch)
            if block is None:
                continue
            if not isinstance(block, dict):
                raise ValueError(f"prestage_model_defaults.{arch} must be an object")
            picked = {}
            for key in keys:
                value = block.get(key)
                if value in (None, ""):
                    continue
                if not isinstance(value, str):
                    raise ValueError(f"prestage_model_defaults.{arch}.{key} must be text")
                picked[key] = value.strip()
            cleaned[arch] = picked
        dtype = defaults.get("dtype")
        if dtype not in (None, ""):
            if not isinstance(dtype, str):
                raise ValueError("prestage_model_defaults.dtype must be text")
            cleaned["dtype"] = dtype.strip()
        clean_settings["prestage_model_defaults"] = cleaned

    for flag in ("show_shift_pills", "define_refs", "autoplay_previews", "advanced", "preview_sidecar", "seed_hunt_beta"):
        if flag in raw and raw[flag] is not None:
            if not isinstance(raw[flag], bool):
                raise ValueError(f"{flag} must be true or false")
            clean_settings[flag] = raw[flag]
    preview_ranges = {
        "preview_frames": (1, 1024),
        "preview_max_resolution": (128, 1024),
        "preview_jpeg_quality": (20, 100),
        "preview_fps": (1, 60),
    }
    for key, (minimum, maximum) in preview_ranges.items():
        if key not in raw or raw[key] is None:
            continue
        value = raw[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value != int(value):
            raise ValueError(f"{key} must be a whole number")
        value = int(value)
        if not minimum <= value <= maximum:
            raise ValueError(f"{key} must be between {minimum} and {maximum}")
        clean_settings[key] = value
    if "preview_info" in raw and raw["preview_info"] is not None:
        info = raw["preview_info"]
        if info not in ("minimal", "standard", "detailed"):
            raise ValueError("preview_info must be minimal, standard, or detailed")
        clean_settings["preview_info"] = info
    if "preview_hidden_mode" in raw and raw["preview_hidden_mode"] is not None:
        mode = raw["preview_hidden_mode"]
        if mode not in ("off", "armed"):
            raise ValueError("preview_hidden_mode must be off or armed")
        clean_settings["preview_hidden_mode"] = mode
    for key, fallback in (("video_prefix", DEFAULT_VIDEO_PREFIX),
                          ("image_prefix", DEFAULT_IMAGE_PREFIX)):
        if key in raw and raw[key] is not None:
            # `outputs.clean` is what the save nodes are held to, so a prefix
            # that would be refused at the end of a render is refused here
            # instead — while it is still a field somebody is editing.
            try:
                clean_settings[key] = outputs.clean(raw[key], fallback)
            except outputs.PrefixError as exc:
                raise ValueError(f"{key}: {exc}") from exc
    return clean_settings


def path():
    """The settings file. Imported lazily so this module stays standalone."""
    import folder_paths

    return os.path.join(folder_paths.get_user_directory(), FILE)


def load():
    """The stored settings, with every key filled in.

    A file that cannot be read or cannot be understood reads as the defaults —
    which is what this pack did before anyone opened the settings page, and what
    the page will show, so a value that did not survive is visibly gone rather
    than quietly in force.
    """
    try:
        with open(path(), "r", encoding="utf-8") as handle:
            return clean(json.load(handle))
    except (OSError, ValueError):
        return dict(DEFAULTS)


def save(raw):
    """Store a settings patch and hand back the whole stored file. Raises
    ValueError on a value this pack will not write.

    A patch, not a replacement: the settings page sends the one field somebody
    just edited, and every field it did not send is one somebody chose earlier.
    `clean` starts from the defaults — it has to, since it is also what reads a
    file written by an older version — so the merge happens here, over what is
    on disk, or typing a video folder would quietly put the stills folder back.
    """
    if not isinstance(raw, dict):
        raise ValueError("settings must be an object")
    stored = clean({**load(), **raw})
    target = path()
    os.makedirs(os.path.dirname(target), exist_ok=True)
    # Written whole and moved into place: the save node reads this file while
    # renders are queued, and a half-written one would read as the defaults.
    temporary = f"{target}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(stored, handle, indent=2)
    os.replace(temporary, target)
    return stored


def video_crf():
    """The quality target for every video this pack writes."""
    return load()["video_crf"]


def video_prefix():
    """Where finished renders land, unless the blob names somewhere itself."""
    return load()["video_prefix"]


def image_prefix():
    """Where pre-stage stills land, unless the blob names somewhere itself."""
    return load()["image_prefix"]


def define_refs():
    """Whether the compiler writes each reference's scope into the prompt."""
    return load()["define_refs"]


def turbo_lead_in():
    """How many opening steps a turbo render samples without the distillation."""
    return load()["turbo_lead_in"]
