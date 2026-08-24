# MiniMax H3 Creator Palette for ComfyUI

> **Community beta · v3.12.21**  
> A complete local MiniMax H3 creation workspace for ComfyUI, built to keep prompting, Cast, references, LoRAs, shot planning, previews, still preparation, sampling, assembly, and output in one cohesive place.

**Made for the community by [z3rofeels](https://github.com/z3rofeels).**

Creator Palette started from a simple goal: make MiniMax H3 feel like a creative tool instead of a collection of disconnected controls scattered across a workflow. The package brings those pieces together into one visual authoring system while keeping the underlying ComfyUI workflow local, inspectable, and optional where possible.

> [!IMPORTANT]
> ## Beta notice
> Creator Palette is currently **beta software**. The included features are functional in the setups I can test, but this is a large node with many model paths, optional integrations, frontend states, GPU combinations, and ComfyUI versions. I cannot guarantee that every feature will behave perfectly on every machine.
>
> If you find a bug—especially a **show-stopper**, broken queue path, save/reload problem, or reproducible UI issue—please [open an issue](https://github.com/z3rofeels/ComfyUI-MiniMax-Creator-Palette/issues/new/choose). Good bug reports are one of the most useful ways users can help Creator Palette become more reliable for everyone.

Creator Palette does **not** bundle or download MiniMax models, LoRAs, VAEs, LLMs, third-party custom nodes, or generated media.

---

## Table of contents

- [What Creator Palette is](#what-creator-palette-is)
- [What is included](#what-is-included)
- [Feature overview](#feature-overview)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Main Creator workspace](#main-creator-workspace)
  - [Prompt Palette editor](#prompt-palette-editor)
  - [Quick controls](#quick-controls)
  - [Scene Builder and semantic categories](#scene-builder-and-semantic-categories)
  - [Cast Studio](#cast-studio)
  - [Auditions, shortlists, and batching](#auditions-shortlists-and-batching)
  - [Reference Manager](#reference-manager)
  - [Canonical Shot Inspector](#canonical-shot-inspector)
  - [Media browser](#media-browser)
  - [LoRA Manager](#lora-manager)
  - [Storyboard Timeline Director](#storyboard-timeline-director)
  - [Seed Hunt Lab](#seed-hunt-lab)
  - [Theme Studio](#theme-studio)
  - [Undo, Redo, and history](#undo-redo-and-history)
- [Prompt syntax](#prompt-syntax)
- [Starter packs and safe importing](#starter-packs-and-safe-importing)
- [MiniMax H3 routes and references](#minimax-h3-routes-and-references)
- [Models and inference profiles](#models-and-inference-profiles)
- [Canvas, sampling, and acceleration](#canvas-sampling-and-acceleration)
- [TinyVAE live preview](#tinyvae-live-preview)
- [PreStage and Image Lab](#prestage-and-image-lab)
- [Optional local refiner](#optional-local-refiner)
- [Persistence and recovery](#persistence-and-recovery)
- [Privacy and local-first behavior](#privacy-and-local-first-behavior)
- [Troubleshooting](#troubleshooting)
- [Bug reports and feature requests](#bug-reports-and-feature-requests)
- [Development and tests](#development-and-tests)
- [Prompt Palette](#prompt-palette)
- [Credits](#credits)
- [License](#license)

---

## What Creator Palette is

**MiniMax H3 Creator Palette** is an all-in-one authoring and generation workspace for local MiniMax H3 workflows inside ComfyUI.

Instead of requiring a large collection of helper nodes for every creative decision, Creator Palette gives you one main surface for:

- writing and resolving prompts;
- reusable characters and Cast;
- semantic scene categories;
- image, video, and audio references;
- first/last-frame workflows;
- LoRAs and timed LoRA cues;
- shot planning and timeline continuation;
- route inspection and validation;
- sampling and quality controls;
- live TinyVAE previews;
- still generation and review through PreStage;
- optional local prompt refinement;
- multi-shot assembly, decode, mux, and save.

The basic workflow stays intentionally simple. Advanced systems are there when you want them, and optional/beta features are disabled or unobtrusive until you turn them on.

---

## What is included

The package currently registers two nodes:

### MiniMax H3 Creator Palette

`Z3MiniMaxH3CreatorV3`

The main H3 video creation workspace containing the editor, scene system, Cast, references, LoRAs, timeline, sampling, preview, refinement hooks, output assembly, and advanced Creator tools.

### MiniMax H3 PreStage

`Z3MiniMaxH3PreStage`

An optional still-preparation companion with Prompt Palette authoring, batch image generation, Image Lab review, shortlisting, Start/End/Reference assignment, and deliberate handoff into Creator.


## Feature overview

### Creative authoring

- Embedded **Prompt Palette** editor designed specifically for the H3 Creator workflow.
- Natural-language prompting alongside reusable semantic tokens.
- `$location`, `$clothing`, `$props`, `$action`, `$camera`, `$lighting`, `$dialogue`, `$ambience`, and `$music` scene slots.
- Compiler-safe `@Character_Name` Cast mentions.
- Wildcard support including nested and stepping calls.
- Timed direction cues and timed LoRA cues.
- Prompt variation without destructively replacing the source prompt.
- Shared compiler path for Inspector, Preview, variations, PreStage, and Queue.

### Cast and scene variation

- Reusable **Cast Studio** with character names, handles, descriptions, clothing, groups, thumbnails, and prompt insertion.
- Synced Cast records between Creator, Sidebar, and Cast Studio.
- Full-category **Scene auditions**.
- Full-library **Cast auditions**.
- Fixed, All Forward, All Reverse, and hand-picked Shortlist behavior.
- Independent audition roles so changing one Cast role does not unexpectedly mutate another.
- `+` / `-` variation markers for deterministic forward/reverse batch stepping.
- Thumbnail support for visual recognition of characters and scene starters.

### References and shot control

- Canonical **H3 Reference Manager** for Start frame, End frame, visual references, video, audio, role, scope, contribution, and replacement.
- Shared/global and per-shot reference scope.
- Canonical **Shot Inspector** showing the actual effective H3 route and current Creator state.
- Reference conflict/warning checks before generation.
- Save/reload structural audit surfaced directly in the Inspector.
- T2VA, I2VA, L2VA, FL2VA, and Ref2VA route support based on the real media payload.
- Up to H3's supported multimodal reference counts where the selected route permits them.

### Timeline and directing

- Multi-shot generated timeline.
- Supplied local footage on the same timeline.
- Per-shot prompts, seeds, LoRAs, references, models, duration, continuation, sound, and face-pass options.
- Optional floating **Storyboard Timeline Director**.
- Duration-scaled shot cards and ruler.
- Timed beats and timing inspector.
- Camera keypoints and guided Ref2VA edit planning.
- Route checks and compiled-prompt inspection.
- First/last-frame continuation and seam assembly.
- H3 Motion Context archive compatibility mode for external numbered AV archives.

### Rendering and performance

- Base, Full Turbo, and Hybrid base → Turbo inference profiles.
- INT8 ConvRot-aware model guidance.
- Direct one-pass or local two-pass high-resolution rendering.
- Final resolution and first-pass resolution kept separate.
- Sampler, scheduler, CFG, steps, attention backend, sigma controls, and caching options.
- Optional Spectrum, FirstBlockCache family, KJNodes Chunk FFN, and FP16 accumulation paths when available.
- Optional MultiGPU and GGUF controls when compatible providers are installed.
- Optional H3-Optimizations interoperability for memory and sparse-attention controls.
- TinyVAE live sampling preview with configurable workload when supported by the local setup.

### Reliability and workflow safety

- Creator-level **Undo / Redo** across structured Creator changes.
- Native prompt-editor Undo / Redo for text editing.
- Up to 80 Creator history checkpoints with edit coalescing.
- Save/reload normalization and structural round-trip auditing.
- Primary Creator state plus rotating recovery backups.
- Safer pack import with preview-before-apply.
- Explicit **Append** vs **Replace** behavior.
- Import/reset safety backup ZIP and one-click rollback support.
- Creator data, machine preferences, packs, thumbnails, and histories kept in clearly separated storage paths.

### New optional beta: Seed Hunt Lab

- Compare **1–4 real H3 draft renders** using different seeds.
- Sequential or random unique seeds.
- Temporary draft resolution, duration, and step controls.
- Drafts queue **one at a time**, not simultaneously.
- 2×2 comparison gallery.
- TinyVAE draft previews when configured.
- Lock a winning seed back into the main Creator.
- **Lock + final render** to immediately run the original full-quality workflow.
- Final workflow settings remain isolated from temporary draft overrides.
- Wildcard/audition prose is frozen during the hunt so the comparison actually tests seeds instead of silently changing prompts.

---

## Requirements

- **Python 3.10+**
- A current ComfyUI build with native MiniMax H3 support and the V3 `comfy_api.latest` extension schema.
- Your own compatible MiniMax H3 model files and VAE(s) in ComfyUI's normal model folders.
- A reasonably current ComfyUI frontend capable of rendering the extension in Nodes 1 and Nodes 2 workflows.

Optional features detect companion custom nodes/providers at runtime. You do **not** need every optional package installed to use Creator Palette.

Normal Creator operation does not require GGUF, MultiGPU, KJNodes, cache/attention packs, H3-Optimizations, TinyVAE preview, SAM3, or a local refiner model.

---

## Installation

### Git clone

Clone the repository into your ComfyUI `custom_nodes` folder:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/z3rofeels/ComfyUI-MiniMax-Creator-Palette.git
```

### Manual install

Extract the release archive so the structure looks like this:

```text
ComfyUI/
└── custom_nodes/
    └── ComfyUI-MiniMax-Creator-Palette/
        ├── __init__.py
        ├── creator_node.py
        ├── pyproject.toml
        └── js/
```

Then:

1. Restart ComfyUI.
2. Hard-refresh the browser if the UI was already open.
3. Add **z3rofeels → Video → MiniMax H3 Creator Palette**.
4. Add **MiniMax H3 PreStage** only if you want the still-preparation workflow.

No separate `pip install` step is required for Creator Palette itself because the package currently declares no additional Python dependencies.

---

## Quick start

For a basic H3 generation you only need the main Creator node.

1. Add **MiniMax H3 Creator Palette**.
2. Open **Models / Devices** and choose your local H3 text encoder, diffusion model/checkpoint, VAE, and route-specific models.
3. Write a normal prompt in the embedded Prompt Palette editor.
4. Choose **Length**, **Aspect**, **Resolution**, **Steps**, **Sampler**, and **Scheduler** from the quick controls.
5. Add Start/End frames or references only when the shot needs them.
6. Open **Inspect** to see the compiled prompt, effective route, warnings, and shot state.
7. Queue through ComfyUI normally.

That is the core workflow.

Timeline, Director, Cast auditions, Scene auditions, Seed Hunt, PreStage, local Refine, face repair, two-pass output, TinyVAE preview, Motion Context archives, and optional acceleration providers can all remain unused until you need them.

---

# Main Creator workspace

## Prompt Palette editor

Prompt Palette is the primary text authoring surface inside Creator Palette. It is integrated specifically for H3 instead of exposing the separate generic conditioning/rail UI from the standalone Prompt Palette node.

You can combine ordinary prose with:

- semantic `$category` calls;
- `@Cast` mentions;
- local reference handles;
- wildcards such as `__weather__`;
- timed direction;
- timed LoRA instructions.

The source prompt remains editable. Resolution for preview, variation, PreStage, inspection, and final queueing happens through the same Creator compiler rather than permanently replacing your authoring syntax.

---

## Quick controls

The quick-control row is the normal place to experiment without digging through Setup.

### Length

Use H3-compatible presets or a custom duration/frame value. Native generated lengths use the legal H3 frame pattern; supplied footage can retain arbitrary timeline durations.

### Aspect

Includes common presets such as:

- 16:9
- 9:16
- 1:1
- 4:3
- 3:4
- 21:9
- custom ratios within the supported canvas envelope

### Resolution

Named presets show the exact resulting canvas for the selected aspect. The standard 768 px short-edge option is labeled **H3 native / Recommended**.

Final resolution, first-pass resolution, and direct/two-pass rendering are separate controls. Creator does not silently treat a preview or sampler resolution as the final output size.

### Sampling

Quick controls expose the active:

- steps;
- sampler;
- scheduler;
- attention backend.

The values are the real workflow values and are serialized with the node.

---

## Scene Builder and semantic categories

The MiniMax Scene Builder turns reusable prompt ideas into semantic scene slots rather than forcing you to remember large blocks of text.

Canonical scene slots are:

`location`, `clothing`, `props`, `action`, `camera`, `lighting`, `dialogue`, `ambience`, and `music`.

Custom packs can use friendly category/subcategory names while assigning an explicit canonical `slot` underneath. This keeps variation, auditioning, batching, and compiler behavior deterministic even when your library is heavily customized.

For a scene token:

- **Fixed** keeps the current starter.
- **All +** cycles forward through the full live pool.
- **All −** cycles backward through the full live pool.
- **Shortlist** lets you choose a hand-picked audition pool.

Scene tokens can carry their own category colors and thumbnails for fast visual recognition.

---

## Cast Studio

Cast Studio is the reusable character workspace for Creator Palette.

Each Cast member can store:

- display name;
- compiler-safe `@handle`;
- group;
- appearance / identity description;
- default clothing;
- notes;
- thumbnail.

Cast members stay synchronized across the Creator, Sidebar, Cast Studio, and reusable pack data.

Names shown to the user can remain natural while the underlying `@handle` stays compiler-safe. This prevents invalid subject syntax from reaching H3 while keeping the visual UI readable.

You can insert a Cast member into the current prompt, edit the reusable record, remove only the prompt mention, or remove the character from the active Creator without automatically deleting the reusable preset.

---

## Auditions, shortlists, and batching

Creator Palette uses one consistent mental model for Scene and Cast variation.

### Fixed

Use exactly the selected value.

### All + / All −

Cycle through the complete live category or Cast pool in deterministic forward/reverse order.

### Shortlist

Build a smaller hand-picked pool for targeted auditions.

This works independently per scene slot and per Cast role, so auditioning clothing does not need to randomize location, and auditioning one character role does not have to replace every other character in the prompt.

The current-start rotation behavior is preserved so batch sequences begin from the active choice rather than unexpectedly jumping to the beginning of the library.

---

## Reference Manager

The **H3 Reference Manager** is the canonical visual workspace for H3 reference state.

It provides one place to see and edit:

- Start frame;
- End frame;
- visual references;
- video references;
- audio references;
- reference role;
- shared/global vs per-shot scope;
- contribution/track behavior;
- reference sizing;
- replacement and removal;
- prompt handle insertion.

The Manager also validates the selected shot and surfaces reference conflicts or routing warnings before you spend time generating.

Shared references remain available to the Creator without being treated as active in every shot automatically. The selected shot must actually use them.

---

## Canonical Shot Inspector

**Inspect** is the place to verify what Creator Palette will really send into the H3 backend.

For each shot it can show:

- actual effective H3 route;
- duration and frame count;
- current Cast roles;
- current scene build;
- active reference roles;
- LoRA state;
- route/reference warnings;
- canonical compiled prompt;
- save/reload structural health.

This is intentionally a view of the real Creator state—not a second renderer with a separate interpretation of your workflow.

When something does not look right, inspect the shot before queueing. It is usually the fastest way to determine whether the issue is authoring, reference scope, route selection, or backend execution.

---

## Media browser

Creator Palette includes a local Media browser for ComfyUI Input and Renders.

Use it to:

- attach images, videos, and audio;
- browse recent local output;
- keep favorites/shelves;
- assign reference roles;
- replace existing media without rebuilding the shot.

Media paths remain local to your ComfyUI environment.

---

## LoRA Manager

LoRAs can be applied globally or per shot.

Creator Palette supports:

- active LoRA stack management;
- local library browsing;
- trigger text;
- strengths;
- FL2VA / Ref2VA targeting;
- per-shot LoRAs;
- timed LoRA cues;
- Turbo/distillation adapter assignment;
- restored folder filters and exact filename/subfolder identity.

A normal active LoRA and the configured **Turbo adapter** are separate roles. Creator Palette labels them separately so using a LoRA does not silently imply that the Turbo schedule is active.

---

## Storyboard Timeline Director

The optional floating **Storyboard Timeline Director** is a visual planning surface over the same Creator state.

It can provide:

- shot ruler and duration-scaled cards;
- generated shots and supplied footage;
- timed beats;
- media tracks;
- camera keypoints;
- guided Ref2VA edit intent;
- timing inspection;
- route checks;
- Creator-level Undo/Redo;
- compiled-prompt inspection.

Director does not replace the Creator backend. It edits and inspects the same canonical data used by the main node.

See [`docs/TIMELINE_DIRECTOR.md`](docs/TIMELINE_DIRECTOR.md) for additional details.

---

## Seed Hunt Lab

> [!WARNING]
> **Seed Hunt is an optional beta feature and is OFF by default.**

Enable it under:

**Setup / Settings → Optional beta → Seed Hunt Lab**

Seed Hunt is designed for one thing: compare a few cheap(er) draft seeds before committing to the full final render.

### How it works

- Choose **1–4 drafts**.
- Pick sequential seeds or random unique seeds.
- Choose a temporary draft short edge, duration, and step count.
- Click **Start Seed Hunt** inside the Lab.
- Creator queues the drafts **one at a time**.
- Compare completed drafts in the 2×2 gallery.
- Click **Lock this seed** to return the winner to Creator.
- Or choose **Lock + final render** to lock it and immediately run the original full workflow.

### Important behavior

Enabling Seed Hunt does **not** hijack ComfyUI's normal Queue button. Normal Queue still runs the normal final Creator workflow.

Two, three, or four drafts still require roughly two, three, or four times the work of one draft. They run sequentially so Creator is not attempting to keep multiple active H3 renders in VRAM at once.

Draft-only settings are temporary. They do not overwrite your final:

- resolution;
- duration;
- steps;
- sampler;
- scheduler;
- LoRAs;
- model route;
- references;
- authored timeline;
- normal final-quality settings.

Wildcard and audition prose is frozen across the Seed Hunt candidates so you are comparing **noise seeds**, not accidentally comparing different prompt resolutions.

A low-resolution or short draft is a guide. H3 is still generative, so a full final render is not guaranteed to reproduce every tiny visual detail from a draft perfectly.

---

## Theme Studio

Creator Palette includes **Prompt Palette Theme Studio** so the entire suite can share one visual language.

The active appearance can drive:

- Creator;
- Sidebar;
- Storyboard;
- Preview surfaces;
- embedded Prompt Palette editor;
- semantic category colors.

Theme Studio supports:

- built-in themes;
- custom themes;
- day/night pairing;
- font family;
- editor font size;
- UI scale;
- corner radius;
- hue/saturation adjustments;
- category color pins;
- prompt text color behavior;
- Prompt Palette v4 theme import/export;
- clipboard copy/paste;
- appearance reset without resetting H3 workflow settings.

Standalone Prompt Palette and Creator Palette can therefore share compatible visual theme packs without forcing you to keep both nodes installed.

---

## Undo, Redo, and history

Creator Palette has two complementary history layers.

### Prompt editor history

Normal typing uses the Prompt Palette editor's native Undo/Redo behavior, including keyboard shortcuts.

### Creator-level history

Structured actions—such as changing scene starters, Cast, references, shots, or other Creator state—use Creator-level Undo/Redo.

The Creator history keeps up to **80** recent structured checkpoints and coalesces rapid repeated edits where appropriate.

Undo/Redo controls are available from the main Creator UI and the Storyboard Director.

This history is separate from the safety backup system used for pack imports and serialized workflow recovery.

---

# Prompt syntax

Creator Palette intentionally allows readable prompt authoring instead of requiring one rigid syntax.

You can mix ordinary prose with reusable calls.

### Cast

```text
@Orin_Vex walks through the station.
```

Cast handles use compiler-safe letters, digits, and underscores and begin with a letter.

### Semantic scene calls

```text
$location
$clothing
$camera
$lighting
```

### Wildcards

```text
__weather__
```

Wildcards resolve at queue time and may contain nested calls when the configured wildcard data supports them.

### Timed direction

Creator Palette can insert timed shot direction without requiring you to memorize backend formatting.

### Timed LoRA cues

Timed LoRA activation can be attached to the shot through the LoRA workflow.

Inspector shows the compiled result so you can verify what H3 actually receives.

---

## Starter packs and safe importing

Creator Palette uses the `z3_minimax_h3_pack_v1` pack format for reusable Scene and Cast data.

See [`docs/PACKS.md`](docs/PACKS.md) for pack-authoring details.

### Import safety

Pack import is deliberately defensive.

Before applying an import, Creator Palette can inspect it and show what is about to change.

You can then choose the appropriate behavior:

- **Append** — safely add imported content without overwriting unrelated existing IDs.
- **Replace** — replace only the imported/matching section instead of wiping the entire pack.

The Pack Manager can work with:

- full packs;
- Cast-only packs;
- individual Cast records;
- scene categories/sections;
- individual prompt items.

### Automatic rollback

Before a destructive import/reset path, Creator Palette creates a local safety backup ZIP when supported by the current backend state.

The Pack Manager exposes **Restore latest safety backup** so an accidental import, reset, or deletion does not have to mean losing the previous library.

When building your own packs, explicit semantic `slot` values are recommended because display categories can then be renamed freely without breaking H3 scene behavior.

---

## MiniMax H3 routes and references

Creator Palette supports the normal H3 route families according to the actual media attached to the shot:

- **T2VA** — text-driven generation;
- **I2VA** — first frame;
- **L2VA** — last frame;
- **FL2VA** — first + last frame;
- **Ref2VA** — multimodal reference generation/editing.

The Director can store an authoring intent, but it cannot force a route that the real payload does not support. The **Shot Inspector** shows both the planned state and the effective route.

Creator Palette also includes compatibility handling for combined Start/End + ordinary visual reference payloads on supported ComfyUI H3 builds, addressing the `cond_video_rows` / `all_video_rows` mismatch seen in older Creator Palette versions.

---

## Models and inference profiles

Model selectors use your local ComfyUI model folders.

Compatible optional providers may add GGUF or per-component device controls.

### Base model

Turbo is off and Creator uses the selected released base checkpoint path.

### INT8 ConvRot · Base

When selected FL2VA/Ref2VA filenames identify INT8 ConvRot weights, Creator labels the Base profile accordingly.

**INT8 ConvRot is quantization, not Turbo.**

The ConvRot checkpoints remain base weights and use the normal Base sampling path unless you separately enable a Turbo/distillation adapter workflow.

Leave **UNet dtype** on **default** unless you intentionally need a cast override so ComfyUI can follow the checkpoint's quantization metadata.

### Full Turbo

Uses a configured switchable Turbo/distillation LoRA or an appropriate merged distillation checkpoint and applies the Turbo step profile.

### Hybrid · base → Turbo

Allows the base model to own the opening part of the schedule before handing later steps to a switchable Turbo adapter.

Sampler and scheduler remain independently selectable. Turbo step presets change step behavior; they are not a hidden second quality slider.

---

## Canvas, sampling, and acceleration

Setup exposes the complete rendering contract.

### Canvas

- fixed or adaptive aspect;
- final output resolution;
- direct one-pass mode;
- two-pass high-resolution mode;
- first-pass/sampler resolution;
- second-pass denoise;
- optional face-repair canvas and denoise.

### Sampling

Depending on your local ComfyUI build/providers, Creator Palette can expose:

- steps;
- CFG;
- sampler;
- scheduler;
- attention backend;
- FirstBlockCache family;
- Spectrum and blend;
- KJNodes Chunk FFN;
- KJNodes FP16 accumulation;
- video/audio sigma shifts.

H3 release sigma defaults are backend controls, not generic quality sliders.

### Optional H3-Optimizations provider

When separately installed, [Zironic/H3-Optimizations](https://github.com/Zironic/H3-Optimizations) can expose Creator-side controls for supported memory-preservation and sparse-attention paths.

These controls are **off by default**. Creator Palette does not bundle source or binaries from that project.

Saved requests for a missing optional provider fail clearly rather than pretending an optimization ran.

Creator also blocks known mutually incompatible combinations where possible and validates important execution constraints again on the backend.

---

## TinyVAE live preview

Live sampling preview can use KJNodes' Model Preview Override when that separate node pack and a compatible H3 TinyVAE / `taeh3` decoder are installed.

Preview affects sampling visibility only. It does **not** replace the final VAE render.

Preview controls include:

- frames per update;
- preview proxy size;
- preview playback FPS;
- JPEG transfer quality;
- information density;
- autoplay;
- attachable hidden mode;
- true zero-overhead mode;
- Fast, Balanced, and Full Clip profiles.

**Zero-overhead mode** leaves the preview wrapper out of jobs queued while Preview is off.

**Attachable mode** retains a lightweight stream so Preview can be opened during an active render when the provider supports it.

Seed Hunt can also consume TinyVAE progress previews for its draft comparison cards.

---

## PreStage and Image Lab

**MiniMax H3 PreStage** is the optional still-preparation companion.

It uses the same Prompt Palette authoring foundation and can preserve local Krea 2, Ideogram 4, and MiniMax H3 still-generation paths when the required local models/nodes exist.

Generated stills are saved under the normal ComfyUI output tree and remain available through standard Assets/history behavior as well as Creator Palette's own image-review tools.

### PreStage workflow modes

#### Review, then video

The safe default. Creator pauses before video sampling, PreStage generates the still batch, and you deliberately choose what gets handed to Creator.

#### Image only

Generate/save stills while keeping the Creator video stage paused.

#### Auto image → video

Opt-in unattended flow. PreStage selects the configured First, Last, or deterministic Seeded result, shows a short cancel window, attaches it, and queues Creator.

#### Bypass PreStage

Skip the still stage and release Creator immediately.

### Batch generation

PreStage can generate:

- 1
- 2
- 4
- 8
- 16

images per configured batch.

### Image Lab

The movable, theme-synchronized **Image Lab** provides:

- large selected-image preview;
- keyboard/arrow navigation;
- workflow-saved gallery of up to 64 recent results;
- starred shortlist;
- All / Shortlist filters;
- persistent **Start**, **End**, and **Reference** assignment slots;
- thumbnail badges and filenames showing active assignment;
- quick hover actions;
- batch generation controls;
- one consolidated Flow dialog;
- **Prepare Creator** without queueing video;
- **Make Video** to apply assignments and queue Creator;
- **Run Creator only** when PreStage should be skipped;
- new-shot creation;
- ordered shortlist video auditions that hold prompt variation and seed steady;
- non-destructive gallery removal;
- path copy;
- direct Renders access.

Start, End, and Reference can be assigned to **different images at the same time**. The slot board is workflow-persistent, so the handoff remains visible after reload.

PreStage stores local output-relative media paths instead of embedding large raw images inside the workflow JSON.

---

## Optional local refiner

Creator Palette can optionally use a separately supplied local Qwen3-VL 4B/8B text model to rewrite a shot or timeline into H3-oriented structured prose.

This is not H3's own conditioning encoder.

The package does not download the refiner model, does not require an API key, and does not upload your prompt. The local model is loaded for the request and released afterward.

The Refiner shortcut is hidden from the main toolbar by default but remains available from Setup when configured.

---

## Persistence and recovery

Creator Palette treats save/reload behavior as part of the feature set, not an afterthought.

### Workflow state

Creative state saved with the workflow includes things such as:

- prompts;
- shots;
- quick controls;
- sampling profile;
- Cast;
- scene choices;
- references;
- LoRAs;
- UI presentation state.

### Machine preferences

Machine/device/preview preferences are stored separately through Creator Palette's backend settings store so a workflow does not need to overwrite every machine-specific choice.

### Recovery copies

Creator keeps a serialized recovery copy of structured Creator state and rotates the previous valid backup when the current state changes.

If a primary serialized copy is invalid during recovery, Creator can fall back to the latest healthy backup instead of immediately discarding the entire authored workflow.

### Round-trip audit

The canonical Shot Inspector can surface whether the normalized Creator state survives a serialize/parse round trip without structural loss.

### Pack recovery

Pack imports/resets use their own safety backup mechanism and rollback path, separate from Creator-level Undo/Redo.

---

## Privacy and local-first behavior

Creator Palette is designed for local ComfyUI workflows.

There is:

- no telemetry;
- no hosted prompt service;
- no cloud inference built into the node;
- no paid API requirement;
- no runtime package installer;
- no automatic model downloader;
- no bundled generated media.

Your local models, prompts, packs, references, thumbnails, and generated media remain under your control.

Optional integrations only become relevant when you separately install/configure those providers.

---

## Troubleshooting

### The custom UI looks missing or raw widgets appear

Restart ComfyUI and hard-refresh the browser. If the problem remains, check the browser console for a frontend module error and include it in a bug report.

### A picker opens but the choice does not apply

Update Creator Palette, restart ComfyUI, hard-refresh, and test the same workflow again. Include the exact picker and frontend version if reporting it.

### A saved sampler or attention backend changed

Check whether an inference profile changed the active sampling preset. After the initial profile transition, Creator should preserve your subsequent sampler/scheduler choices with the workflow.

### Final resolution does not match what I expected

Check:

- Final output resolution;
- Aspect source;
- High-resolution mode;
- first-pass resolution.

Adaptive media aspect can intentionally change dimensions. Inspector shows the exact queue contract.

### Wildcards appear literally in the final prompt

Confirm the wildcard exists under Creator Palette's configured wildcard root and that the prompt contains a complete `__name__` call.

### “No Turbo adapter” appears while a LoRA is active

A normal LoRA and the configured Turbo adapter are different roles. Open **Configure Turbo adapter**, link/select the intended distillation LoRA, then choose Full Turbo or Hybrid.

### Preview is unavailable

Final rendering can still work normally. Live preview requires a separately installed compatible preview provider plus a suitable H3 TinyVAE decoder.

### An optional provider is missing

Turn off that optional control or install/configure its upstream package separately. Creator Palette does not automatically install third-party node packs.

### H3 reports `cond_video_rows` or `all_video_rows` shape mismatch

Use Creator Palette **3.12.19 or newer**. Those releases contain the combined Start/End + ordinary reference payload repair for affected H3 layouts.

### Seed Hunt is enabled but normal Queue does not make drafts

That is intentional. Open **Seed Hunt Lab** and click **Start Seed Hunt**. The normal ComfyUI Queue button always remains the normal final Creator workflow.

---

## Bug reports and feature requests

If Creator Palette finds an edge case on your machine, please report it instead of assuming someone else already has.

**Bug tracker:**  
https://github.com/z3rofeels/ComfyUI-MiniMax-Creator-Palette/issues

A useful report includes:

- Creator Palette version;
- ComfyUI version/commit;
- ComfyUI frontend version;
- Nodes 1 or Nodes 2;
- GPU and VRAM;
- operating system;
- Python version;
- exact feature/settings being used;
- clear reproduction steps;
- relevant browser/backend error;
- sanitized workflow when possible.

Please remove private prompts, personal media, usernames, tokens, and sensitive/local filesystem information before uploading screenshots or workflows.

Feature requests are welcome too. The priority is keeping the systems already here dependable, understandable, and useful rather than adding buttons simply for the sake of having more buttons.

Community testing on hardware and combinations I do not own is genuinely valuable. If you find a show-stopper, a reproducible report can directly help improve the next build.

---

## Development and tests

Repository architecture and invariants are documented in:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/CORE_COMPATIBILITY.md`](docs/CORE_COMPATIBILITY.md)
- [`docs/PACKS.md`](docs/PACKS.md)
- [`docs/TIMELINE_DIRECTOR.md`](docs/TIMELINE_DIRECTOR.md)

Run the local suite with:

```bash
python -m unittest discover -s tests -p 'test_*.py' -v
node --experimental-vm-modules tests/frontend_semantics.cjs
node --experimental-vm-modules tests/frontend_entry_link.cjs
node --experimental-vm-modules tests/frontend_choice_picker.cjs
node --experimental-vm-modules tests/frontend_seed_hunt.cjs
python scripts/release_audit.py .
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request.

Fixes, focused testing, reproducible bug reports, and compatibility information are all welcome.

---

## Prompt Palette

Creator Palette contains its own integrated H3-focused Prompt Palette authoring surface, so the separate node is **not required** for Creator Palette to run.

If you want the same style of visual prompt editing, reusable libraries, resolver tools, themes, and prompt-building workflow in your **other ComfyUI graphs**, check out my standalone project:

### [Prompt Palette by z3rofeels](https://github.com/z3rofeels/comfyui-promptpalette)

*Why install it?* Creator Palette is specialized around MiniMax H3. Standalone Prompt Palette brings the broader prompt-authoring workflow to other models and normal ComfyUI pipelines too.

---

## Credits

Creator Palette is a community project built on top of a larger open-source ecosystem.

**Creator Palette as a complete package—including its integrated workflow, visual design, Creator/PreStage experience, custom authoring systems, reliability work, and ongoing maintenance—is created and assembled by [z3rofeels](https://github.com/z3rofeels).**

Important upstream work, adaptations, and design references include:

- [z3rofeels/comfyui-promptpalette](https://github.com/z3rofeels/comfyui-promptpalette) — Prompt Palette editor, resolver, library, theme, and authoring foundation.
- [cicalooo/ComfyUI-H3-PowerLoraStack](https://github.com/cicalooo/ComfyUI-H3-PowerLoraStack) — adapted H3-safe LoRA support.
- [Zironic/H3-Optimizations](https://github.com/Zironic/H3-Optimizations) — optional separately installed runtime provider integration.
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) and the many custom-node authors whose public work makes local creative workflows like this possible.

Thank you to the developers who share useful work publicly, and to the users who test Creator Palette, report problems, and help make it better.

---

## License

See [`LICENSE`](LICENSE) for the license covering MiniMax H3 Creator Palette.

Third-party components, adapted portions, upstream notices, and their applicable license information are documented in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and any license files retained with those components, including `h3lora/LICENSE`.

---

**Made for the community by [z3rofeels](https://github.com/z3rofeels).**
