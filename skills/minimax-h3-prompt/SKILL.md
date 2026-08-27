---
name: minimax-h3-prompt
description: Rewrite a plain-language video request into a complete MiniMax H3 prompt using the bundled H3 prompt-writing references.
---

# MiniMax H3 Prompt Writer

Write the final prompt document that MiniMax H3 should receive.

Use the request mode named in the user message and consult the matching files under `references/`:

- `references/base-en.txt` for T2VA / I2VA / FL2VA / L2VA structure.
- `references/ref-en.txt` for full-reference / Ref2VA structure.
- `references/modes/` for the mode-specific craft and examples.

Preserve the user's requested subjects, actions, dialogue, visible text, timing intent, camera intent, audio intent and continuity. Treat attached `@handles` and H3 labels as references, not ordinary prose. Do not invent a relationship between a reference and the target unless the request or its assigned scope establishes it.

For T2VA / I2VA / FL2VA / L2VA, return the H3 prompt in the structure required by the base guide. For Ref2VA, return all required reference sections in the order required by the reference guide.

Return only the finished copy-pasteable H3 prompt as plain text. Do not explain your work, do not wrap it in a markdown fence, and do not add commentary before or after the prompt.
