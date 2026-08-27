# Security policy

## Supported version

Security fixes target the newest published Creator Palette release.

## Reporting a vulnerability

Please do not publish an exploit, credential, private workflow, or personal media in a public issue. Use GitHub's private vulnerability reporting for this repository when available. If it is unavailable, open a minimal issue asking the maintainer for a private contact channel without including sensitive details.

For ordinary crashes, malformed pack imports, or local-path disclosure in logs, use the bug template after sanitizing attachments.

## Trust boundaries

Creator Palette is local ComfyUI software. It does not include telemetry, cloud inference, a hosted API, model downloads, or a runtime package installer. It reads and writes only through ComfyUI's configured local media/model/user paths and its own local pack/settings routes.

Treat workflows, JSON packs, wildcard text, media, thumbnails, model files, and third-party custom nodes as untrusted until you have reviewed their source and provenance. This repository does not distribute third-party models or custom-node packages.
