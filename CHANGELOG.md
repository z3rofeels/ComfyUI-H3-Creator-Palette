# Changelog

## v3.14.1 — Native H3 Timeline Guides + Seamless Cast Flow

- Added an opt-in **H3 Pin** to Director reference blocks. A pinned image, short video, or audio reference remains a normal Ref2VA reference and is additionally anchored at the block's exact start frame through H3's native arbitrary-frame guide conditioning.
- Preserved pins through shot duplication, save/reload, chained segments, merged multi-shot passes, handle renaming, canonical Shot Inspector, and the real queue compiler. Unpinned references remain byte-for-byte on their prior path.
- Added compatibility handling for current native `MiniMaxH3AddGuide` cores and older visual-anchor layouts; audio pins fail with a clear update instruction on cores that predate native audio guides.
- Repaired editor `@character` swapping: entering Swap mode now makes one click on another Cast card perform the replacement while preserving `+` / `-` role markers and audition state.
- Added a visible current-shot role selector with **Swap role** and **Audition** controls to every Cast Studio entry route, plus direct Use/Swap and Audition actions in the Character Inspector. Normal Cast Studio entry remains click-to-edit.
- Preserved category resolution, full-pool Scene/Cast stepping, explicit shortlist behavior, Creator/PreStage paths, references, LoRAs, Director, rendering profiles, and every existing accelerator option.
- Prepared the first public Registry release as `zf-h3-creator-palette` under publisher `z3rofeels`, with current ComfyUI v0.34.0 compatibility metadata, matching icon/banner assets, and a clean Manager publishing workflow.

## v3.14.0 — H3 Render Intelligence + LightX2V v1.0

- Added a live pre-queue H3 workload floor using ComfyUI's exact temporal, video-patch, and stereo-audio row geometry; it accounts for steps, merged passes, two-pass regeneration, face repair, held takes, and archive bypass without inventing elapsed-time claims.
- Added per-pass target-row readouts and a compact node-status workload badge so expensive duration/resolution/pass combinations are visible before Queue.
- Added runtime registration diagnostics for Spectrum, FirstBlockCache, TeaCache, EasyCache, Sage, Comfy Kitchen, Chunk FFN, FP16 accumulation, and H3-Optimizations.
- Added an explicit, filename-gated LightX2V H3 Turbo 4-step v1.0 recipe: 4 steps, CFG 1.0, video shift 6, audio shift 3, and full adapter strength. Existing generic/legacy LightX2V and other Turbo behavior is preserved.
- Added a Spectrum + MultiGPU compatibility warning and an explicit native-768 one-pass action; neither changes a workflow unless the user clicks it.
- Added current-core guidance for the native INT8 ConvRot H3 VAE path and the ComfyUI EasyCache audio-carry fix.
- Preserved every Creator, PreStage, Cast, Reference, Director, Prompt Palette, LoRA, routing, refinement, output, and accelerator path.

## v3.13.4 — Canonical Category Resolution Hotfix

- Repaired boundary-stripped Scene tokens so visible `LOCATION`, `CLOTHING`, `CAMERA`, and other canonical category labels retain their structured selection instead of becoming literal or blank output.
- Moved selected category prose expansion ahead of wildcard resolution for canonical RAW, H3 FORMAT, Shot Inspector previews, Director/refined fields, and the real queue path.
- Made `+` / `-` reliably walk the complete live preset pool for its Scene slot without shortlist setup; explicit full-pool markers always win over saved shortlist data.
- Added an explicit prepared-versus-active Scene shortlist state so selecting candidates alone does not silently activate shortlist batching; legacy saved active shortlists remain compatible.
- Added recovery migration that restores invisible semantic boundaries on load while preserving the authored `+` / `-` direction.

## v3.13.3 — Global Undo/Redo + Persistent UI State + z3rofeels UX Cohesion

- Added transaction-backed global Creator history for workflow edits and reversible Library mutations, including atomic pack imports.
- Separated workflow generation state, reusable Library state, and local presentation preferences.
- Added persistent Cast/Shot Inspector/editor/autocomplete presentation preferences without serializing caret, focus, hover, or temporary menu state.
- Reorganized Creator Settings into Creator, Library, Cast, References, Variations, Appearance, Performance, Advanced, and About.
- Added consistent focus-visible, button, radius, and workspace cohesion polish while preserving semantic colors and Editor 2 DOM ownership.


## v3.13.2 — Reference Workspace + Canonical Shot Inspector

- Promoted References to stable reusable Library records with thumbnail gallery, drag/drop addition, global/per-shot assignment, roles, influence metadata, notes, missing-file detection, relink/replace/remove, workflow-local fallbacks, and Cast identity-reference links.
- Replaced scattered Shot Options inspection with one canonical Shot Inspector for Shot, Prompt, Cast, Scene, References, LoRAs, and Variation state; RAW/H3 previews call the same prompt-resolution/compiler pipeline used by generation.
- Reserved compiler media citations (`@img-N`, `@vid-N`, `@aud-N`, and legacy/compiler-valid `@name-N`) away from Cast `+/-` semantics across Python and frontend token handling, fixing the `@img-1` -> `@img1` corruption class.
- Kept reusable Reference Library handles separate from workflow compiler handles so assigning/relinking a reusable record cannot create a dangling prompt citation.
- Fixed PreStage reference replacement to preserve an existing cited workflow handle and authored RAW text, and added detached-reference recovery that recreates the exact missing handle without rewriting the prompt.
- Extended Pack Safety/Trash to References, including stable-ID merge/collision handling, Cast-linked reference export portability, and safe Replace Selected Reference Group behavior.

## v3.13.1B — Pack Manager Safety + Trash

- Replaced dangerous generic pack replacement with explicit **Append**, **Merge**, and **Replace Selected Group** operations.
- Added stable-ID import previews with new/update/collision/delete counts and affected Cast/category groups before commit.
- Added reusable Library **Trash**, restore, Empty Trash, and deliberate permanent-delete paths.
- Added pack provenance so deleting an imported pack removes only records owned by that pack; unrelated Library content and workflow-local Cast copies remain intact.
- Hardened collision handling for stable IDs, `@handles`, same-name/different-ID records, moved groups, and legacy packs.
- Added transaction journaling and rollback snapshots in preparation for the later global Undo/Redo phase.
- Old workflows now keep a usable workflow-local Cast copy when its reusable pack record no longer exists, without resurrecting the deleted Library record.

## v3.13.1A — Cast Studio 2

- Rebuilt Cast Studio as Groups | Character Gallery | Character Inspector.
- Added unified library/workflow cards, contextual actions, favorites, usage badges, safe delete paths, and persistent thumbnails.
- Added collapsible Identity, Appearance, Wardrobe, Prompting, Reference, and Metadata inspector sections with explicit Save/Duplicate/Delete and dirty-state tracking.
- Extended reusable Cast metadata while preserving legacy compiler fields and stable IDs.


## Unreleased

- Public issue reports and community fixes will be collected here before the next release.

## 3.13.0D — PreStage Handoff Recovery

- Repaired the PreStage → Image Lab → Creator handoff so the exact selected still is attached to the linked Creator shot as Start, End, or Reference without inserting tokens into or rewriting the user-authored prompt.
- Added one-click **Use selected → Creator** and **Use + Video** actions, plus a clear destination selector and direct gallery handoff actions; marked Start/End/Reference remains available for multi-frame setups.
- Hardened stale PreStage peer recovery: an exact saved Creator link stays authoritative, while a missing/deleted link can safely repair to the actively edited Creator on the same graph instead of leaving Image Lab stuck.
- Fixed the Creator-side bypass bug by updating both Creator and PreStage state. **Enable Video · Bypass PreStage** now persists instead of having PreStage silently recreate the video gate on refresh/load.
- Made **Release Creator + Enable Video** prominent in the PreStage node, Image Lab, and flow controls, with an explicit **Re-link Creator** recovery action.
- Removed the redundant generated-image result surface from the main PreStage UI; Image Lab is now the sole PreStage result-review surface, while saved images remain available through normal ComfyUI assets/output handling.
- Hardened suppression of ComfyUI's stock node image preview for PreStage by clearing preview state during execution and background redraw, preventing duplicate bottom-of-node previews.
- Added atomic multi-frame handoff so Start/End/Reference assignments commit to Creator together and preserve existing authored prompt text exactly.
- Browser-smoke-tested Image Lab selection/handoff, event isolation, stale-link repair, exact target preservation, two-sided bypass persistence, direct Reference/Start/End handoffs, keyboard Enter handoff, Use + Video, Creator-only queueing, and absence of a main-node result preview.

## 3.13.0B — Visual Prompt Editor 2: Typing Engine Hardening

- Made the native Visual Prompt Editor a strict single editable surface: semantic highlighting, autocomplete, Library/Cast projection and liveness refreshes can repaint metadata without rebuilding the active contenteditable DOM or restoring an old caret.
- Replaced whole-editor active value rewrites with minimal changed-range patches and same-value no-ops, preserving unaffected text nodes, selections and caret geometry while the editor owns focus.
- Removed autocomplete selection restoration from both `@` Cast and `$` Scene calls. Arrow/Home/End updates now observe native navigation on the next animation frame, and stale async `$` results are discarded instead of rewinding the caret.
- Hardened IME/composition, multiline paste/drop, selection replacement and textarea-compatible `setRangeText` so edits mutate only the requested logical range and never flatten the editor during active input.
- Kept `@Handle+` / `@Handle-` and committed Scene category `+` / `-` modifiers inside the same semantic highlight range as their token, preserving color and editability at every boundary.
- Prevented the legacy highlight mirror from becoming visible behind a native single-surface editor when a CSS Highlight repaint fails; the editor now degrades to readable plain text instead of double-rendered glyphs.
- Added a CSS fail-safe that hides the compatibility mirror whenever a native single-surface editor is present, while retaining geometry-matched transparent-text fallback behavior for older WebViews without CSS Highlights.
- Interaction-smoke-tested rapid `@p` typing, mixed `@/$/+/-` syntax, token-boundary edits, character-by-character Backspace, Delete, arrows, Home/End, multiline paste, Ctrl+A/C/X/Z/Y, undo/redo, IME simulation, wildcard-adjacent editing, live Cast/Library/category refreshes, asynchronous autocomplete changes, semantic modifier ranges and native/fallback text-layer geometry.

## 3.13.0 — State Integrity + Editor 2

- Removed static starter-Cast fallback from the live Cast Studio and `@` autocomplete path, so deleted/replaced packs cannot reappear as ghost characters when the reusable Library is empty or temporarily unavailable.
- Added stable workflow Cast `record_id` identity independent of display names and `@handles`, plus stable reusable Cast IDs for newly saved characters and backward-compatible migration for older workflows/packs.
- Hardened old-workflow Cast hydration: stale reusable links are explicitly unlinked while preserving the workflow-local character, linked records synchronize by stable identity, and duplicate linked workflow copies are collapsed instead of producing unusable shadow entries.
- Added Library integrity audit/repair endpoints and Settings controls for duplicate Cast IDs/handles, duplicate starter preset IDs, stale local thumbnails and orphan thumbnail files. Repair creates an automatic rollback ZIP before changing reusable data.
- Reworked `@` and `$` autocomplete onto one caret-safe interaction contract: no `keyup` repaint loop, composition/IME awareness, stale async-result rejection, shared keyboard navigation, exact-match priority, and compact menus that never take editor focus.
- Made same-value writes to the single-surface Prompt Palette editor a true no-op so workflow/UI refreshes cannot reset the live browser selection while the user types. Plain-text normalization now waits for IME composition to finish.
- Fixed reusable Cast cache identity/deduplication and stopped stale `preset_id` links from silently binding to a different character that happens to reuse the old handle.
- Fixed duplicate prompt-preset insertion in the editable pack store and added deterministic Cast ID sanitization for modern stable identities.

## 3.12.29 — Optional H3 Auto Format

- Changed H3 Auto Format from an always-on backend behavior into the existing guide-bar pill's explicit workflow toggle, off by default.
- Raw mode keeps the editor fully functional: wildcards, full Scene-category prose, Cast definitions, media references, LoRA triggers, special tokens, `+`/`-` batching, previews, variations, Seed Hunt and final Queue all share the same resolution path.
- Raw mode preserves resolved editor order and omits automatic mode instructions, `[Shot 1]` insertion, Context-IR field wrappers, summary and retention-analysis synthesis. Plain-language support for enabled Cast, references, keyframes, soundscape and music remains available.
- Auto Format mode preserves the previous `h3_autoformat` and Context-IR behavior exactly and is saved/reloaded with the workflow.
- Fixed semantic-token expansion consuming the separator after a category when no `+`/`-` marker was present, which could join a resolved category directly to the following wildcard or word in Raw mode.

## 3.12.28 — Portable caret and selection fix

- Ported Prompt Palette's current capability-based single-surface editor selection into Creator Palette instead of excluding Firefox by browser name.
- Removed the portable-only two-layout path on modern Firefox: prompt glyphs, semantic colors, wrapping, hit-testing, selection and the caret now share one editable surface.
- Kept Creator Palette's long-session liveness recovery around the proven Prompt Palette surface, so the earlier idle/remount typing repair remains active.
- Tightened the true legacy overlay's box, font, wrapping, tab and scrollbar geometry for older WebViews that genuinely lack CSS Highlights.

## 3.12.27 — Portable / Firefox semantic editor hotfix

- Restored Creator CAST, Location, Clothing, Prop, Action, Camera, Lighting, Dialogue, Ambience and Music colors in the textarea compatibility renderer used by Firefox and browser builds without native CSS Highlights.
- Made the compatibility overlay consume the same prioritized semantic decoration ranges as the working Desktop renderer, including category and character `+` / `-` variation markers.
- Prevented Firefox's system selection paint from revealing the transparent textarea glyphs over the colored overlay, removing the doubled and slightly offset text seen while selecting or replacing `@Character` calls.
- Kept the Desktop/native-highlight renderer unchanged.

## 3.12.26 — Category wildcard production fix

- Resolved wildcard syntax inside selected Scene category metadata before Auto Format emits the category prose, keeping the saved editable source untouched.
- Fixed shot-scoped Location, Clothing, Camera, Lighting and other category overrides when the Shared preset contains a wildcard: the compiler can now remove the resolved Shared value instead of sending both values to H3.
- Kept category metadata and emitted prompt prose on the same immutable queue snapshot, so full multiword category prompts, batch `+` / `-` variations and the final Context-IR stay in sync.
- Smoke-checked every starter category, nested/sequence/brace wildcard syntax, fictional Cast substitution, semantic `$` / `@` calls, and the final production H3 prompt.

## 3.12.25 — Editor wake and long-session reliability

- Prevented the main prompt editor from becoming non-editable after a long idle period, browser suspension, or a ComfyUI DOM-widget detach/remount.
- Added a lightweight editor liveness guard that repairs accidental `disabled`, `readonly`, `inert`, and lost `contenteditable` state without touching supplied-clip locking.
- Routed Firefox through the established real-textarea overlay editor instead of the more fragile editable-DOM surface; syntax coloring, wildcard/category interactions, undo/redo, and prompt persistence remain available.
- Rechecks editor health when the page wakes, regains focus, refreshes from the hidden workflow value, or repaints after a renderer remount.

## 3.12.24 — Verified Director actions and camera editing

- Replaced the timed-beat modal's pointer-event shim with a real form-submit transaction. **Add to timeline** now validates, persists once, verifies the beat survived V3 normalization, redraws the Director, and shows a visible success or failure state.
- Added a mounted frontend interaction test that fills and submits the real beat editor and proves the visible action creates persistent marker data and fires the timeline refresh.
- Added a Timed Events desk inside the shot inspector. Every saved action, dialogue, voiceover, sound, transition, and LoRA cue is visible and reopens for editing; the Beats readout now opens the authoring flow instead of an unrelated timing summary.
- Rebuilt camera keypoints as editable records. Timeline markers, composition-field points, and sequence cards all open the same editor for time, framing, movement, amplitude, speed, and X/Y composition.
- Added verified single-transaction camera persistence, numbered timeline/stage markers, drag-to-recompose, drag-to-retime, deliberate deletion, path clearing, and visible save notices.
- Gave the complete Director workspace a quieter z3rofeels product pass: branded header, compact transport console, clearer shot readouts, colored/iconic track headers, richer beat markers, a camera workbench, responsive editors, and restrained shadows without the distracting border glow.

## 3.12.23 — Director media desk and beat repair

- Fixed **Add beat** for Action, Dialogue, Voiceover, Sound, LoRA, Camera, and Transition cues; validation now stays inside the editor instead of rendering a literal `null` beside the button.
- Rebuilt Director media lanes around real source-linked thumbnails, filenames, handles, role badges, time ranges, and source inspection instead of tiny anonymous blue markers.
- Added a per-shot source shelf plus drag-and-drop placement across Pictures, Reference video, and Audio/music tracks without duplicating attached files.
- Made image/reference guidance windows, video clips, and audio clips draggable and resizable. Start and End frames remain honestly pinned to H3's opening/final keyframe slots while their visible intervals control Director guidance prose.
- Made timed beat and camera markers draggable on the ruler, with prompt regeneration, workflow persistence, history checkpoints, and click-to-edit preserved.
- Added backend/frontend contract coverage for Director beat saves, media timing, image thumbnails, H3 picture-label substitution, and the optional node-border accent.
- Replaced the distracting always-on accent border with a quiet node border by default; **Theme Studio → Accent node border** restores it for users who want it.

## 3.12.22 — Complete Seed Hunt sequencing

- Fixed completed Seed Hunt MP4s being ignored when ComfyUI reports them from an expanded Creator child, which left the Lab stuck after draft one and showed only the last TinyVAE still.
- One **Start Seed Hunt** action now submits exactly the selected one-to-four drafts as separate sequential `1`-run jobs, independent of the user's normal ComfyUI batch count.
- Completed draft cards replace their live proxy still with a playable saved MP4, and duplicate expanded-node results can no longer advance or overwrite the next candidate.
- Fixed **Stop after current** and disabling the optional beta during a hunt: both finish the active draft without submitting another, then return Seed Hunt to its off/idle state.
- Kept Seed Hunt's workflow-saved Lab preferences, temporary controls, draft takes, and queue orchestration isolated from normal Creator generation.

## 3.12.21 — Seed Hunt launch-link hotfix

- Fixed Seed Hunt Lab rendering `[object HTMLDivElement]` where its launch row belonged, which discarded the **Start Seed Hunt** and **Stop after current** buttons and made the beta appear disconnected from its draft backend flow.
- Added a frontend mount/click regression test proving the visible Lab button calls Seed Hunt orchestration, plus the existing queue-contract test proving that orchestration submits temporary draft parameters and restores final controls.
- Clarified inside the Lab that enabling the beta deliberately does not hijack normal ComfyUI Queue: use **Start Seed Hunt** for drafts; normal Queue remains the normal final Creator workflow.

## 3.12.20 — Optional Seed Hunt Lab beta

- Added a disabled-by-default **Seed Hunt Lab (beta)** switch under Setup / Settings → Optional beta. When off, it adds no toolbar control and changes no queue behavior.
- Added one-to-four sequential H3 draft auditions for the active generated shot, with clear time/cost warnings, unique sequential or random seeds, configurable draft edge/length/steps, and a stop-after-current action.
- Added a cohesive two-by-two draft gallery that receives TinyVAE sampling updates when the optional Preview Override is available, then keeps each completed MP4 visible for comparison.
- Added **Lock this seed** and **Lock + final render** actions. Single-shot workflows lock the Creator seed and its control-after-generate mode; multi-shot workflows lock only the auditioned shot.
- Kept final resolution, duration, steps, sampler, scheduler, LoRAs, model route, prompt variation, and authored workflow data isolated from draft-only overrides. Seed Hunt freezes wildcard/audition prose so the candidates compare noise seeds rather than different prompts.
- Prevented draft takes from attaching to the authored timeline, queued drafts one at a time to avoid multiplying active-render VRAM, and added frontend/backend contract tests for draft isolation and seed locking.

## 3.12.19 — Combined frame/reference payload repair

- Fixed MiniMax H3 tensor row mismatches when one shot contains a Start and/or End frame together with ordinary visual references, including complete PreStage Image Lab slot handoffs.
- Extended Creator's existing H3 payload compatibility wrapper beyond timeline seams to normal REF2VA shots that combine keyframes and references.
- Made combined visual-condition rebuilding defensive and idempotent across ComfyUI 0.33.3, newer core layouts, partially updated Desktop installations, and compatible optional sampling wrappers.
- Preserved Spectrum, preview override, LoRAs, batching, reference ordering, prompt labels, and all separate Start/End/Reference controls.

## 3.12.18 — Frontend foundation hotfix

- Fixed an unmatched parenthesis in the optional PreStage Image Lab module that prevented the entire Creator frontend extension from loading and exposed raw JSON/native widgets instead.
- Removed a cache-sensitive new named-import dependency from PreStage UI while preserving persistent Start, End, and Reference frame assignment.
- Added a complete 94-module frontend entry-graph test that links and evaluates the real entry point, then verifies the custom ComfyUI extension registers successfully.
- Kept the existing Creator/PreStage UI foundation and all deliberate frame handoff, batch, shortlist, audition, Assets, bypass, and generation modes intact.

## 3.12.17 — Deliberate frame handoff

- Fixed Image Lab's Flow dialog opening behind its own sidecar by raising Creator Palette modal layers above the lab.
- Added visible queued/generating/error/released status so Generate, Flow, and Creator-release actions no longer appear inert.
- Made automatic behavior unmistakable: Auto buttons say **Generate N + Video**, while Review and Image-only generation never silently queue video.
- Added workflow-persistent Start, End, and Reference slots in Image Lab with selected-state buttons, thumbnail badges, filenames, and individual clear controls.
- Added one-click **Prepare Creator** and **Make Video** actions that send every assigned slot together, plus **New shot** and **Run Creator only** paths.
- Kept batch curation, shortlist audition, Renders access, copy-path, gallery history, explicit bypass, and the standard ComfyUI Assets output intact.

## 3.12.16 — Image Lab routing hotfix

- Fixed PreStage results from expanded save children being ignored by Image Lab because their execution IDs include the parent node prefix.
- Kept the standard ComfyUI image result for Assets/history while preventing the stock canvas preview from attaching a giant image below PreStage.
- Removed all inline image thumbnails from the PreStage node; it now shows only a compact ready/auto status with an Image Lab shortcut.
- Replaced the always-expanded flow matrix with a slim saved summary and one Flow dialog, preserving Review, Auto, Image only, Bypass, destinations, batch counts, and deterministic selection.
- Reduced empty Image Lab height and simplified its persistent controls while keeping generation, curation, shortlist, handoff, audition, copy-path, Renders, and history actions.

## 3.12.15 — PreStage Image Lab

- Restored the standard ComfyUI `images` execution result alongside the private PreStage result, allowing saved stills to appear in normal asset/history surfaces.
- Added a movable, theme-synchronized Image Lab sidecar with large preview, arrow/keyboard navigation, a 64-image workflow gallery, and persistent open/filter/position state.
- Added starred shortlists, All/Shortlist filters, copy-path and non-destructive gallery removal tools.
- Added compact thumbnail hover menus for start frame, reference, end frame, new timeline shot, and immediate MiniMax video audition.
- Added ordered shortlist audition queueing that holds seed and prompt variation steady between candidates.
- Added sidecar shortcuts for one-image and configured batches, image-only generation, automatic image → video, and full PreStage bypass without removing any existing workflow mode.
- Hardened repeated PreStage handoff so start/end frames replace the prior candidate, PreStage references replace only their own prior audition candidate, and new shots never inherit stale keyframes.

## 3.12.14 — PreStage review and deterministic handoff

- Added explicit Review, Auto image → video, Image only, and Bypass PreStage modes.
- Creator now pauses at a real backend gate while stills are generated/reviewed instead of relying on output-node execution order.
- Added a persistent, workflow-saved PreStage result gallery with 1–16 image batches and deliberate First, Last, or repeatable Seeded automatic selection.
- Added handoff targets for current-shot start frame, reference, end frame, or a new timeline shot, plus a file-only option that does not mutate Creator.
- Added separate **Use image** and **Use + make video** actions, a four-second auto-video cancel window, and recovery controls on both nodes.

## 3.12.13 — ConvRot profile clarity and LoRA picker fix

- Inference profiles now identify selected INT8 ConvRot H3 checkpoints as quantized base weights and explain that their optional Turbo/Hybrid adapter settings and step presets are unchanged.
- Models / Devices now shows live format guidance whenever FL2VA or Ref2VA selections change, without adding a redundant ConvRot-as-Turbo mode.
- Fixed the Creator and PreStage LoRA pickers so each card is bound to the exact installed filename it displays, including its subfolder when names collide.
- Fixed restored LoRA folder filters showing all-folder results under a saved folder label, and ignored stale results from overlapping scans.
- LoRA library responses now bypass browser caches so a rescan cannot repaint outdated names.

All notable public changes are documented here. This project uses semantic-style release versions and keeps detailed implementation history in Git commits and pull requests.

## 3.12.12 — Public community beta

- Prepared a clean GitHub/Comfy Registry repository with current V3 metadata, tests, issue templates, contribution/security guidance, and manual publishing workflow.
- Replaced development-only starter residue with a small neutral catalog and five fictional non-human Cast examples.
- Added an importable Community Basics combo pack plus external JSON pack-authoring documentation.
- Unified Scene and Cast audition galleries around one tested Fixed / All / Shortlist forward/reverse sequence contract.
- Fixed scene-category and Cast batch resolution so complete live pools, custom explicit slots, current-start rotation, and independent roles remain deterministic.
- Fixed wildcard calls from the editor or library so nested text and stepping modes resolve into final raw H3 prose without destroying saved source syntax.
- Added accessible, functional quick pickers for length, aspect, final resolution, steps, sampler, scheduler, and attention, including custom values.
- Made workflow sampling profiles persist through reload and workflow save/load while keeping machine preferences separately namespaced.
- Clarified Full model, Full Turbo, and Hybrid profiles and distinguished a normal active LoRA from the configured Turbo adapter role.
- Added full TinyVAE preview workload/settings controls and moved optional authoring/provider shortcuts into Setup.
- Added optional interoperability controls for a separately installed H3-Optimizations provider; all remain off by default and no provider source is bundled.
- Isolated Creator Palette pack, wildcard, history, and settings paths from the separate Prompt Palette node.
- Matched current ComfyUI H3 special-token handling and retained one backend compiler path for Inspector, Preview, variations, PreStage, and Queue.
- Preserved local media/reference routing, LoRAs, timeline continuation, output assembly, PreStage, local refine, and optional acceleration features.
