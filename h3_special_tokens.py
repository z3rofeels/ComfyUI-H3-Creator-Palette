"""Canonical MiniMax H3 tokenizer tokens used in final prompts.

The IDs mirror ComfyUI's ``MiniMaxQwenSDTokenizer`` special-token table.  This
node does not patch or replace ComfyUI's tokenizer; it only makes sure prompts
arrive at that tokenizer with the exact spellings it recognizes.
"""

SPECIAL_TOKEN_IDS = {
    "<d>": 151669,
    "</d>": 151670,
    "<|cutoff|>": 151671,
    "<|lyrics_start|>": 151672,
    "<|lyrics_end|>": 151673,
    "<|caption_start|>": 151674,
    "<|caption_end|>": 151675,
}

# The prompt guide previously exposed the friendly spelling without pipes.
# Keep authored workflows valid while always handing core the canonical token.
PROMPT_TOKEN_ALIASES = {
    "<cutoff>": "<|cutoff|>",
}


def canonicalize_prompt_tokens(text):
    """Return *text* with supported friendly spellings made H3-canonical."""
    value = str(text or "")
    for alias, canonical in PROMPT_TOKEN_ALIASES.items():
        value = value.replace(alias, canonical)
    return value
