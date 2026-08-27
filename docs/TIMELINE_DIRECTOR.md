# Storyboard Timeline Director

The Director is an optional floating workspace for planning and inspecting a Creator Palette timeline. It does not replace Prompt Palette, Cast Studio, References, Shot Options, the V3 workflow state, or the backend compiler.

## Workspace

- A zoomable, frame-snapped time ruler covers the complete sequence.
- Duration-scaled shot cards can be reordered and retimed.
- The active shot has a source shelf with real thumbnails, filenames, `@handles`, roles, and direct source inspection.
- Image drops near a shot boundary become first/last-frame anchors; center drops become references. Their timeline blocks are draggable and resizable instead of collapsing to anonymous markers.
- START and END remain native H3 keyframes pinned to the real first/final frame. Their resizable windows express how long the opening composition or landing transition should guide Director prose.
- A Reference block can optionally enable **H3 Pin**. It remains in the ordinary Ref2VA pool and is additionally anchored at the block's exact start frame. Moving the block moves the anchor; disabling H3 Pin restores the previous reference-only path.
- Video and audio blocks can be placed, dragged, and trimmed against the ruler. Current ComfyUI can pin image, valid short-video, and audio guides through `MiniMaxH3AddGuide`; older cores receive a clear update instruction for audio pins instead of silently ignoring them.
- Action, dialogue, voiceover, sound, LoRA, and transition beats appear at their shot-relative time and can be dragged to retime or clicked to edit. The form confirms persistence before closing, then exposes the same event in the track and the inspector's Timed Events desk.
- Camera points are numbered consistently across the timeline, composition field, and sequence list. Any of those surfaces reopens the editor for timing, framing, movement, amplitude, speed, or X/Y composition; points can also be dragged to recompose or retime.
- The shot inspector shows authored text and the exact backend-compiled H3 prompt.

The Director mixes these elements visually without inventing another execution system. Media continues to use Creator's existing reference/keyframe attachments, every `@handle` is resolved to the real H3 `<Picture N>`, `<Video N>`, or `<Audio N>` slot at compile time, and normal Queue remains the renderer.

## Guided tabs

- **References**: T2VA, I2VA, L2VA, FL2VA, and Ref2VA setup, environment sets, Cast/voice mapping, and frame grabs.
- **Camera**: timed framing/movement points plus optional stabilization, lens, depth, and focus direction.
- **Edit**: Ref2VA insertion, replacement, targeted edit, relighting, performance transfer, and continuation direction.
- **Checks**: local timing/reference/camera/audio validation and the real prompt-preview compiler.

Director intent never overrides missing media. The actual H3 route is derived from the references really connected to the shot, so planning labels cannot misrepresent the queued payload.

`segment.director` is workflow metadata. `segment.director_prompt` is its compact natural-language contribution. Media placement lives under `segment.director.timeline.media`; `pin: true` is compacted into the queue request only when explicitly enabled. Merged shots offset pins onto the single pass timeline and rename their handles with the merged reference pool, so Preview and Queue consume the same positions.

## Appearance

The main ComfyUI node uses a quiet border by default so the editor stays readable on a busy graph. **Setup / Settings → Theme Studio → Accent node border** is an optional theme preference for users who want the brighter branded outline.

The interaction model was reviewed against [ComfyUI-MiniMaxH3-Director](https://github.com/seesee75-commits/ComfyUI-MiniMaxH3-Director), itself based on the LTX Director timeline idea. Creator Palette's implementation uses its own state, media, timing, and compiler systems; it does not vendor that project's backend.
