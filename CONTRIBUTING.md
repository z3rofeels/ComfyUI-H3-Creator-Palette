# Contributing

Thank you for helping make MiniMax H3 Creator Palette more reliable.

## Before opening an issue

1. Update ComfyUI and Creator Palette.
2. Restart ComfyUI and hard-refresh the browser.
3. Reproduce the problem in a new workflow when possible.
4. Check whether it occurs in Nodes 1, Nodes 2, or both.
5. Disable unrelated optional custom nodes if the failure is not specifically about their integration.

Use the issue templates. Never upload private prompts, personal media, model files, API keys, or full environment dumps.

## Pull requests

- Keep every integration optional. A missing companion node must not break normal Creator operation.
- Preserve workflow compatibility and existing features unless the change is an explicitly documented migration.
- Use ComfyUI's current V3 schema and supported frontend APIs. Do not add legacy node registration or deprecated widget hacks.
- Do not add telemetry, remote services, automatic model downloads, runtime package installers, generated media, or model weights.
- Keep author-facing controls honest: saved values must be the values sent to the backend.
- Validate batching, wildcard resolution, semantic categories, persistence, and compiler behavior affected by the change.
- Credit upstream implementations and preserve their notices.

Before submitting, start ComfyUI with a clean browser session, confirm the extension loads without frontend or backend errors, and exercise the affected workflow from save through reload and queue. UI changes should be checked in both Nodes 1 and Nodes 2 when applicable. Include the exact ComfyUI/frontend versions and the hardware path you validated in the pull request.
