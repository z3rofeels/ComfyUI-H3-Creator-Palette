# Creator Palette packs

Creator Palette packs are local, portable JSON or ZIP files containing prompt categories and optional reusable Cast records. They do not contain models, LoRAs, checkpoints, VAEs, LLMs, generated media, or online download instructions.

The shipped neutral starter catalog demonstrates every supported scene slot: Location, Clothing, Props, Action, Camera, Lighting, Dialogue, Ambience, and Music. Export only the sections you want when building a separate community pack.

## Import safely

1. Open the **MiniMax Scene Builder** sidebar.
2. Choose **Pack** / **Pack Manager**.
3. Select **Import pack** and choose a `.json` or exported `.zip`.
4. Review the category, Cast, conflict, and removal counts.
5. Choose an import mode:

   - **Append safely** adds new IDs and keeps your existing entry when an ID conflicts. This is recommended for normal use.
   - **Replace imported sections** replaces only the non-empty categories or Cast section carried by the import. Unrelated sections survive.
   - **Advanced: Replace EVERYTHING** swaps the full live pack. Use it only when you intend a complete replacement.

Every import creates a local rollback ZIP. Pack Manager can undo the latest import. Export first when a pack matters to you; the automatic rollback is a safety net, not a version-control system.

## Export

Pack Manager can export the complete pack or the complete Cast bank. Section menus can export one category, subcategory, prompt item, or Cast preset. Local thumbnails are included in ZIP exports.

Exports are ordinary local files. Share only material you created or have permission to redistribute. Check thumbnails and prose for personal data before posting a pack publicly.

## Edit outside ComfyUI

Use any plain-text editor. Save UTF-8 JSON and keep the top-level format string exactly as shown:

```json
{
  "format": "z3_minimax_h3_pack_v1",
  "name": "My Local Pack",
  "version": 1,
  "catalog": {
    "version": 1,
    "name": "My Local Pack",
    "models": [
      {
        "id": "my-local-pack",
        "name": "My Local Pack",
        "kind": "video",
        "accent": "#32b9d6",
        "categories": [
          {
            "id": "my-locations",
            "name": "My Locations",
            "visual": "interior",
            "prompts": [
              {
                "id": "my-location-reading-room",
                "title": "Reading room",
                "prompt": "a quiet reading room with tall shelves and soft daylight",
                "note": "Neutral interior",
                "slot": "location",
                "subcategory": "Interiors"
              }
            ]
          }
        ]
      }
    ]
  },
  "cast": [],
  "meta": {
    "author": "Your name",
    "license": "Your chosen terms"
  }
}
```

### Required and recommended fields

- `format`: must be `z3_minimax_h3_pack_v1`.
- `name`: pack display name.
- `catalog.models[].categories[]`: category containers.
- Category `id`: stable, unique identifier. Prefix IDs with your name or pack name to prevent conflicts.
- Prompt `id`: stable and unique inside its category.
- Prompt `title`: short UI label.
- Prompt `prompt`: raw text inserted/resolved by Creator Palette.
- Prompt `slot`: recommended for custom categories. Supported scene slots are `location`, `clothing`, `props`, `action`, `camera`, `lighting`, `dialogue`, `ambience`, and `music`.
- `subcategory`: optional folder label.
- `note` and `visual`: optional UI hints.
- `cast`: an array of reusable Cast records, or `[]` when the pack has none.

Explicit `slot` values are the safest way to make custom category names participate in swapping, auditioning, `+`/`-` stepping, and batch variation. Category names are presentation; slots are behavior.

## Wildcards inside pack prompts

Prompt text may contain Creator Palette wildcard calls such as `__weather__` or nested calls. Wildcard files remain separate local text files under the Creator Palette wildcard root. Exporting a prompt pack does not silently copy unrelated wildcard folders into it, so include setup instructions when a shared pack depends on separately authored wildcard text.

## Validation tips

- Use unique lowercase IDs with hyphens.
- Keep one semantic purpose per prompt.
- Do not place checkpoint or LoRA filenames in prompt fields.
- Test **Append safely** against an existing pack before publishing.
- Test the category in an audition gallery and in a batch with `+` and `-`.
- Export the imported result and confirm it can be imported again.
- Never include identifiable-person likeness data or media without permission.
