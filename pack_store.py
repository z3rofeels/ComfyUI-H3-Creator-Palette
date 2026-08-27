"""Editable MiniMax H3 starter-pack storage.

The shipped JSON is a *reset source*, never the live database. On first use it is
copied under ComfyUI's user directory. Every starter card and Cast preset then
becomes user-owned data: editable, deletable, exportable and replaceable without
modifying the custom-node install. Pack ZIPs are self-contained (pack.json +
small local thumbnails), which makes backups and task-specific pack swapping
portable and deterministic.
"""
from __future__ import annotations

import io
import json
import hashlib
import os
import re
import shutil
import tempfile
import uuid
import zipfile
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

import folder_paths

PACK_FORMAT = "z3_minimax_h3_pack_v1"
MAX_UPLOAD_BYTES = 32 * 1024 * 1024
MAX_THUMB_BYTES = 4 * 1024 * 1024
MAX_THUMB_PIXELS = 16_000_000
MAX_ZIP_FILES = 2000
MAX_JSON_ITEMS = 10000
SAFE_ID = re.compile(r"^[A-Za-z0-9_.-]{1,96}$")

_HERE = Path(__file__).resolve().parent
_DEFAULT = _HERE / "default_h3_pack.json"

# v3.13.3 global Library transaction snapshots.  These are separate from the
# user-facing import rollback ZIPs: every reversible Library mutation records
# an exact before/after pack + Trash snapshot so frontend global Undo/Redo can
# reverse one logical operation atomically without guessing at individual rows.
_PENDING_HISTORY_TX: dict[str, dict] = {}
_LAST_COMMITTED_TRANSACTION: dict | None = None


def _user_root() -> Path:
    getter = getattr(folder_paths, "get_user_directory", None)
    base = Path(getter()) if callable(getter) else Path(folder_paths.get_output_directory()).parent / "user"
    root = base / "z3_minimax_creator" / "h3_packs"
    root.mkdir(parents=True, exist_ok=True)
    return root


def current_dir() -> Path:
    path = _user_root() / "current"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _pack_path() -> Path:
    return current_dir() / "pack.json"


def _thumb_dir() -> Path:
    path = current_dir() / "thumbs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _trash_path() -> Path:
    return current_dir() / "trash.json"


def _journal_path() -> Path:
    return current_dir() / "mutation_journal.jsonl"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_trash() -> dict:
    path = _trash_path()
    if not path.is_file():
        return {"format": "z3_minimax_h3_trash_v1", "items": []}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        items = value.get("items") if isinstance(value, dict) else None
        if not isinstance(items, list):
            raise ValueError("trash items must be a list")
        return {"format": "z3_minimax_h3_trash_v1", "items": [row for row in items if isinstance(row, dict)]}
    except Exception:
        broken = current_dir() / f"trash.broken-{uuid.uuid4().hex[:8]}.json"
        try:
            shutil.copy2(path, broken)
        except OSError:
            pass
        value = {"format": "z3_minimax_h3_trash_v1", "items": []}
        _atomic_json(path, value)
        return value


def _save_trash(value: dict) -> dict:
    clean = {"format": "z3_minimax_h3_trash_v1", "items": [row for row in (value.get("items") or []) if isinstance(row, dict)]}
    _atomic_json(_trash_path(), clean)
    return clean


def _history_snapshot_dir() -> Path:
    path = _user_root() / "history_transactions"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _history_snapshot(name: str, pack: dict | None = None) -> str:
    """Persist an exact reversible Library+Trash snapshot.

    Pack ZIPs preserve the current thumbnail relative paths and bytes. Restore
    writes those paths back verbatim rather than re-importing them under new
    names, which keeps undo/redo stable across repeated cycles.
    """
    clean = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(name or "snapshot"))[:160]
    root = _history_snapshot_dir()
    (root / f"{clean}.zip").write_bytes(_zip_bytes(pack or load(), "pack"))
    _atomic_json(root / f"{clean}.trash.json", _load_trash())
    return clean


def _snapshot_fingerprint(pack: dict | None = None, trash: dict | None = None) -> str:
    value = {"pack": _validate_pack(pack or load()), "trash": trash or _load_trash()}
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _restore_history_snapshot(name: str) -> dict:
    clean = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(name or ""))[:160]
    if not clean:
        raise ValueError("history snapshot is missing")
    root = _history_snapshot_dir(); zip_path = root / f"{clean}.zip"; trash_path = root / f"{clean}.trash.json"
    if not zip_path.is_file() or not trash_path.is_file():
        raise ValueError("that history snapshot is no longer available")
    raw = zip_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(raw), "r") as zf:
        try:
            pack = _validate_pack(json.loads(zf.read("pack.json").decode("utf-8")))
        except KeyError as exc:
            raise ValueError("history snapshot is corrupt") from exc
        expected = set()
        for info in zf.infolist():
            rel = info.filename.replace("\\", "/")
            if rel.startswith("thumbs/") and not info.is_dir():
                base = Path(rel).name
                if not SAFE_ID.match(base):
                    continue
                target = _thumb_dir() / base
                target.write_bytes(zf.read(info))
                expected.add(f"thumbs/{base}")
    saved = save(pack)
    trash_value = json.loads(trash_path.read_text(encoding="utf-8"))
    _save_trash(trash_value if isinstance(trash_value, dict) else {"format":"z3_minimax_h3_trash_v1","items":[]})
    # Remove only managed thumbnail files that are no longer referenced by the
    # restored pack or Trash snapshot. This makes 100-record imports truly
    # atomic from the user's Library point of view.
    refs = _thumbnail_references(saved, include_trash=True)
    for candidate in _thumb_dir().glob("*"):
        rel = f"thumbs/{candidate.name}"
        if candidate.is_file() and rel not in refs:
            try: candidate.unlink()
            except OSError: pass
    return saved


def _history_label(operation: str, details: dict | None = None) -> str:
    details = details or {}; op = str(operation or "")
    if op.startswith("pack.import."):
        source = details.get("source_pack") or {}; name = source.get("name") if isinstance(source, dict) else ""
        return f'Imported "{name or "pack"}"'
    if op == "cast.upsert": return "Edited Character" if details.get("updated") else "Created Character"
    if op == "prompt.upsert": return "Edited Category Preset" if details.get("updated") else "Created Category Preset"
    if op == "reference.upsert": return "Edited Reference" if details.get("updated") else "Created Reference"
    if op == "cast.trash": return "Deleted Character"
    if op == "prompt.trash": return "Deleted Category Preset"
    if op == "reference.trash": return "Deleted Reference"
    if op == "trash.restore": return "Restored Library Item"
    if op == "pack.trash": return "Deleted Pack"
    if op == "cast.group.trash": return f'Deleted Cast Group "{details.get("group") or ""}"'.strip()
    if op == "thumbnail.set": return "Changed Thumbnail"
    if op == "thumbnail.remove": return "Removed Thumbnail"
    return op.replace(".", " ").replace("_", " ").title() or "Library Change"


def _append_journal(operation: str, *, transaction_id: str, details: dict | None = None, backup: str = "", reversible: bool = True, before_snapshot: str = "", after_snapshot: str = "", before_fingerprint: str = "", after_fingerprint: str = "") -> dict:
    row = {
        "transaction_id": str(transaction_id), "timestamp": _utc_now(), "operation": str(operation),
        "label": _history_label(operation, details), "reversible": bool(reversible), "backup": str(backup or ""),
        "before_snapshot": str(before_snapshot or ""), "after_snapshot": str(after_snapshot or ""),
        "before_fingerprint": str(before_fingerprint or ""), "after_fingerprint": str(after_fingerprint or ""),
        "details": details or {},
    }
    path = _journal_path(); path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    return row


def _new_transaction(operation: str, pack: dict, details: dict | None = None, *, backup: bool = True) -> tuple[str, str]:
    transaction_id = f"tx_{uuid.uuid4().hex}"; backup_name = ""
    if backup:
        backup_path = _create_import_backup(pack); backup_name = backup_path.name
    before = _history_snapshot(f"{transaction_id}-before", pack)
    _PENDING_HISTORY_TX[transaction_id] = {"before_snapshot": before, "before_fingerprint": _snapshot_fingerprint(pack, _load_trash())}
    return transaction_id, backup_name


def _commit_transaction(operation: str, transaction_id: str, backup_name: str, details: dict | None = None, *, reversible: bool = True) -> dict:
    global _LAST_COMMITTED_TRANSACTION
    pending = _PENDING_HISTORY_TX.pop(transaction_id, {})
    after = _history_snapshot(f"{transaction_id}-after", load())
    row = _append_journal(operation, transaction_id=transaction_id, details=details, backup=backup_name, reversible=reversible,
        before_snapshot=pending.get("before_snapshot", ""), after_snapshot=after,
        before_fingerprint=pending.get("before_fingerprint", ""), after_fingerprint=_snapshot_fingerprint())
    _LAST_COMMITTED_TRANSACTION = deepcopy(row)
    return row


def latest_transaction() -> dict | None:
    return deepcopy(_LAST_COMMITTED_TRANSACTION) if _LAST_COMMITTED_TRANSACTION else None


def transaction_by_id(transaction_id: str) -> dict | None:
    target = str(transaction_id or "")
    if not target: return None
    for row in mutation_journal(500):
        if str(row.get("transaction_id") or "") == target: return deepcopy(row)
    return None


def apply_history_transaction(transaction_id: str, direction: str) -> dict:
    row = transaction_by_id(transaction_id)
    if not row: raise ValueError("history transaction was not found")
    if not row.get("reversible"): raise ValueError("that Library action is intentionally permanent and cannot be undone")
    direction = str(direction or "undo").lower()
    if direction not in {"undo", "redo"}: raise ValueError("history direction must be undo or redo")
    key = "before_snapshot" if direction == "undo" else "after_snapshot"
    expected_key = "after_fingerprint" if direction == "undo" else "before_fingerprint"
    snapshot = str(row.get(key) or "")
    if not snapshot: raise ValueError("that Library history snapshot is unavailable")
    # Never let an older history item silently wipe a newer Library mutation.
    # Global history applies transactions in stack order, so a mismatch means
    # state changed outside that stack (another tab/client or a newer action).
    expected = str(row.get(expected_key) or "")
    current = _snapshot_fingerprint()
    if expected and current != expected:
        raise ValueError("the reusable Library changed after this history action; Undo/Redo was cancelled instead of overwriting newer Library work")
    saved = _restore_history_snapshot(snapshot)
    return {"pack": saved, "transaction": row, "direction": direction, "fingerprint": _snapshot_fingerprint()}


def mutation_journal(limit: int = 50) -> list[dict]:
    path = _journal_path()
    if not path.is_file():
        return []
    rows = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                value = json.loads(line)
            except Exception:
                continue
            if isinstance(value, dict):
                rows.append(value)
    except OSError:
        return []
    return rows[-max(1, min(int(limit or 50), 500)):][::-1]


def _atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
    finally:
        try:
            if os.path.exists(name):
                os.remove(name)
        except OSError:
            pass


def _default_pack() -> dict:
    with _DEFAULT.open("r", encoding="utf-8") as handle:
        return _validate_pack(json.load(handle))


def ensure_current() -> None:
    if _pack_path().is_file():
        return
    _atomic_json(_pack_path(), _default_pack())


def _clean_prompt(item: dict) -> dict:
    if not isinstance(item, dict):
        raise ValueError("starter entry must be an object")
    out = {}
    for key in ("id", "title", "prompt", "note", "visual", "subcategory", "slot", "thumbnail", "source_pack", "source_pack_id"):
        if key in item and item[key] is not None:
            out[key] = str(item[key]).strip()
    if not out.get("id"):
        out["id"] = f"user-{uuid.uuid4().hex[:12]}"
    if not SAFE_ID.match(out["id"]):
        raise ValueError("starter id may contain only letters, digits, dot, dash and underscore")
    if not out.get("title"):
        raise ValueError("starter title cannot be empty")
    if not out.get("prompt"):
        raise ValueError("starter prompt cannot be empty")
    if not out.get("slot"):
        out.pop("slot", None)
    return out


def _destination_scene_slot(category_id, subcategory):
    """Resolve a recognized import destination without erasing custom slots."""
    try:
        from .variation_catalog import scene_row_matches
    except (ImportError, ModuleNotFoundError):
        return None
    probe = {"subcategory": subcategory}
    for slot in ("location", "wardrobe", "prop", "action", "camera", "lighting", "dialogue", "ambience", "music"):
        if scene_row_matches(slot, category_id, probe):
            return slot
    return None


def _clean_cast(item: dict) -> dict:
    if not isinstance(item, dict):
        raise ValueError("Cast entry must be an object")
    out = {}
    # Cast Studio 2 keeps its authoring metadata beside the legacy compiler
    # fields. Older packs remain valid; newer fields are optional and JSON-safe.
    for key in (
        "id", "handle", "name", "group", "description", "note", "clothing",
        "thumbnail", "variant_of", "subject_type", "prompt_base",
        "identity_anchor", "physical_traits", "consistency_notes",
        "permanent_look", "positive_anchors", "negative_notes", "source_pack", "source_pack_id",
        "created_at", "modified_at",
    ):
        if key in item and item[key] is not None:
            out[key] = str(item[key]).strip()
    if "use_scene_clothing" in item:
        out["use_scene_clothing"] = bool(item.get("use_scene_clothing"))
    if isinstance(item.get("tags"), list):
        out["tags"] = [str(value).strip()[:64] for value in item["tags"] if str(value).strip()][:32]
    if isinstance(item.get("reference_images"), list):
        out["reference_images"] = [str(value).strip().lstrip("@")[:96] for value in item["reference_images"] if str(value).strip()][:32]
    if isinstance(item.get("reference_ids"), list):
        out["reference_ids"] = [str(value).strip()[:96] for value in item["reference_ids"] if str(value).strip()][:32]
    if isinstance(item.get("reference_roles_by_id"), dict):
        allowed_roles = {"reference", "face", "body", "appearance", "style"}
        out["reference_roles_by_id"] = {
            str(ref_id).strip()[:96]: str(role).strip()
            for ref_id, role in item["reference_roles_by_id"].items()
            if str(ref_id).strip() and str(role).strip() in allowed_roles
        }
    if isinstance(item.get("reference_roles"), dict):
        allowed_roles = {"reference", "face", "body", "appearance", "style"}
        out["reference_roles"] = {
            str(handle).strip().lstrip("@")[:96]: str(role).strip()
            for handle, role in item["reference_roles"].items()
            if str(handle).strip() and str(role).strip() in allowed_roles
        }
    handle = out.get("handle") or out.get("id") or out.get("name") or "Character"
    handle = re.sub(r"[^A-Za-z0-9_]+", "_", handle).strip("_")[:64]
    if not handle or not handle[0].isalpha():
        handle = "Character_" + (handle or "Record")
    out["handle"] = handle
    # `id` is library identity; `handle` is prompt syntax. Keep them separate
    # when modern Creator builds provide a stable id, while continuing to load
    # legacy packs that only had a handle. Never generate a random id during
    # validation because load() must be deterministic across restarts.
    cast_id = str(out.get("id") or handle).strip()
    cast_id = re.sub(r"[^A-Za-z0-9_.-]+", "_", cast_id).strip("_.-")[:96]
    out["id"] = cast_id or handle
    out.setdefault("name", handle.replace("_", " "))
    out.setdefault("group", "Custom")
    out.setdefault("description", "Adult character reference.")
    out.setdefault("note", "Custom Cast entry.")
    out.setdefault("clothing", "")
    return out




def _clean_reference(item: dict) -> dict:
    """Normalize a reusable Reference Workspace record.

    Stable `id` is Library identity. `handle` is a friendly reusable Library
    label only; workflow prompt citations always use compiler media handles such as
    img-1 / vid-2 / aud-1. The media file itself stays in
    ComfyUI Input/Output storage; the Library keeps enough metadata to relink a
    missing file safely on another machine.
    """
    if not isinstance(item, dict):
        raise ValueError("reference entry must be an object")
    out = {}
    for key in (
        "id", "handle", "name", "group", "filename", "kind", "default_role",
        "subject_role", "takes", "ref_size", "track", "notes", "thumbnail",
        "source_pack", "source_pack_id", "created_at", "modified_at",
    ):
        if key in item and item[key] is not None:
            out[key] = str(item[key]).strip()
    rid = str(out.get("id") or "").strip()
    if not rid:
        seed = f"{out.get('name','')}|{out.get('filename','')}|{out.get('handle','')}".encode("utf-8")
        rid = f"ref_{hashlib.sha256(seed).hexdigest()[:20]}"
    rid = re.sub(r"[^A-Za-z0-9_.-]+", "_", rid).strip("_.-")[:96]
    if not rid:
        raise ValueError("reference stable id is invalid")
    out["id"] = rid
    handle = str(out.get("handle") or out.get("name") or rid).strip().lstrip("@")
    handle = re.sub(r"[^A-Za-z0-9_-]+", "_", handle).strip("_-")[:64]
    if not handle:
        handle = f"ref-{rid[-12:]}"
    if not handle[0].isalpha():
        handle = f"ref-{handle}"
    out["handle"] = handle
    out.setdefault("name", handle.replace("_", " ").replace("-", " ").strip() or "Reference")
    out.setdefault("group", "References")
    out["kind"] = out.get("kind") if out.get("kind") in {"image", "video", "audio"} else "image"
    out["default_role"] = out.get("default_role") if out.get("default_role") in {"reference", "first_frame", "last_frame"} else "reference"
    out["subject_role"] = out.get("subject_role") if out.get("subject_role") in {"reference", "face", "body", "appearance", "style"} else "reference"
    out["takes"] = out.get("takes") or "full"
    out["ref_size"] = out.get("ref_size") if out.get("ref_size") in {"match", "max"} else ("max" if out["kind"] == "video" else "match")
    if out["kind"] == "video":
        out["track"] = out.get("track") if out.get("track") in {"picture", "picture+sound", "sound"} else "picture"
    else:
        out.pop("track", None)
    try:
        strength = float(item.get("strength", 1.0))
    except (TypeError, ValueError):
        strength = 1.0
    out["strength"] = max(0.0, min(2.0, strength))
    out.setdefault("filename", "")
    out.setdefault("notes", "")
    return out

def _validate_catalog(catalog: dict) -> dict:
    if not isinstance(catalog, dict):
        raise ValueError("pack catalog must be an object")
    models = catalog.get("models")
    if not isinstance(models, list) or not models:
        raise ValueError("pack catalog must contain models")
    total = 0
    out = deepcopy(catalog)
    for model in out["models"]:
        if not isinstance(model, dict):
            raise ValueError("catalog model must be an object")
        categories = model.get("categories") or []
        if not isinstance(categories, list):
            raise ValueError("model categories must be a list")
        for category in categories:
            if not isinstance(category, dict) or not str(category.get("id") or "").strip():
                raise ValueError("every category needs an id")
            prompts = category.get("prompts") or []
            if not isinstance(prompts, list):
                raise ValueError("category prompts must be a list")
            category["prompts"] = [_clean_prompt(row) for row in prompts]
            total += len(category["prompts"])
            if total > MAX_JSON_ITEMS:
                raise ValueError("pack has too many starter entries")
    return out


def _validate_pack(pack: dict) -> dict:
    if not isinstance(pack, dict):
        raise ValueError("pack must be a JSON object")
    if pack.get("format") not in (None, PACK_FORMAT):
        raise ValueError("this is not a MiniMax Creator H3 pack")
    catalog = pack.get("catalog") or ({"models": pack.get("models")} if pack.get("models") else None)
    if catalog is None:
        raise ValueError("pack is missing its catalog")
    cast = pack.get("cast") or []
    if not isinstance(cast, list):
        raise ValueError("pack cast must be a list")
    if len(cast) > MAX_JSON_ITEMS:
        raise ValueError("pack has too many Cast entries")
    references = pack.get("references") or []
    if not isinstance(references, list):
        raise ValueError("pack references must be a list")
    if len(references) > MAX_JSON_ITEMS:
        raise ValueError("pack has too many reference entries")
    return {
        "format": PACK_FORMAT,
        "name": str(pack.get("name") or "MiniMax H3 Pack")[:160],
        "version": int(pack.get("version") or 1),
        "catalog": _validate_catalog(catalog),
        "cast": [_clean_cast(row) for row in cast],
        "references": [_clean_reference(row) for row in references],
        "meta": dict(pack.get("meta") or {}),
    }


def load() -> dict:
    ensure_current()
    try:
        with _pack_path().open("r", encoding="utf-8") as handle:
            return _validate_pack(json.load(handle))
    except Exception:
        # A hand-edited broken pack should not brick the Creator. Preserve it as
        # a .broken file, then restore the shipped reset source.
        broken = current_dir() / f"pack.broken-{uuid.uuid4().hex[:8]}.json"
        try:
            shutil.copy2(_pack_path(), broken)
        except OSError:
            pass
        pack = _default_pack()
        _atomic_json(_pack_path(), pack)
        return pack


def save(pack: dict) -> dict:
    clean = _validate_pack(pack)
    _atomic_json(_pack_path(), clean)
    return clean


def reset() -> dict:
    # Reset is destructive, so preserve a self-contained rollback ZIP first.
    try:
        _create_import_backup(load())
    except Exception:
        # A backup failure must not silently permit a destructive reset.
        raise ValueError("could not create the automatic rollback backup; reset was cancelled")
    pack = _default_pack()
    shutil.rmtree(_thumb_dir(), ignore_errors=True)
    _thumb_dir().mkdir(parents=True, exist_ok=True)
    _atomic_json(_pack_path(), pack)
    return pack


def _model(pack: dict) -> dict:
    models = pack["catalog"].get("models") or []
    hit = next((m for m in models if m.get("id") == "minimax-creator-h3"), None)
    return hit or models[0]


def _category(pack: dict, category_id: str) -> dict:
    key = str(category_id or "").strip()
    for category in _model(pack).get("categories") or []:
        if str(category.get("id")) == key:
            return category
    raise KeyError(f"unknown starter category: {key}")


def upsert_prompt(category_id: str, item: dict) -> dict:
    pack = load(); category = _category(pack, category_id); clean = _clean_prompt(item); rows = category.setdefault("prompts", [])
    index = next((i for i, row in enumerate(rows) if row.get("id") == clean["id"]), -1); updated = index >= 0
    tx, backup = _new_transaction("prompt.upsert", pack)
    if updated: rows[index] = {**rows[index], **clean}
    else: rows.append(clean)
    save(pack)
    _commit_transaction("prompt.upsert", tx, backup, {"category": str(category_id or ""), "id": clean.get("id"), "title": clean.get("title"), "updated": updated}, reversible=True)
    return clean


def delete_prompt(category_id: str, item_id: str, *, permanent: bool = False) -> bool:
    return bool(delete_prompt_record(category_id, item_id, permanent=permanent).get("deleted"))


def upsert_cast(item: dict) -> dict:
    pack = load(); clean = _clean_cast(item); rows = pack.setdefault("cast", [])
    index = next((i for i, row in enumerate(rows) if (clean.get("id") and row.get("id") == clean.get("id")) or row.get("handle") == clean["handle"]), -1); updated = index >= 0
    tx, backup = _new_transaction("cast.upsert", pack)
    if updated: rows[index] = {**rows[index], **clean}
    else: rows.append(clean)
    save(pack)
    _commit_transaction("cast.upsert", tx, backup, {"id": clean.get("id"), "handle": clean.get("handle"), "name": clean.get("name"), "group": clean.get("group"), "updated": updated}, reversible=True)
    return clean


def delete_cast(handle: str, *, item_id: str = "", permanent: bool = False) -> bool:
    return bool(delete_cast_record(handle, item_id=item_id, permanent=permanent).get("deleted"))


def upsert_reference(item: dict) -> dict:
    pack = load(); clean = _clean_reference(item); rows = pack.setdefault("references", [])
    rid = str(clean.get("id") or ""); handle = str(clean.get("handle") or "").lower(); index = next((i for i, row in enumerate(rows) if str(row.get("id") or "") == rid), -1); updated = index >= 0
    collision = next((row for i, row in enumerate(rows) if i != index and str(row.get("handle") or "").lower() == handle), None)
    if collision: raise ValueError("another reusable reference already uses this Library handle")
    tx, backup = _new_transaction("reference.upsert", pack)
    if updated: rows[index] = {**rows[index], **clean}
    else: rows.append(clean)
    save(pack)
    _commit_transaction("reference.upsert", tx, backup, {"id": clean.get("id"), "handle": clean.get("handle"), "name": clean.get("name"), "group": clean.get("group"), "updated": updated}, reversible=True)
    return clean


def delete_reference_record(item_id: str, *, permanent: bool = False, reason: str = "delete") -> dict:
    item_id = str(item_id or "").strip()
    pack = load()
    rows = pack.setdefault("references", [])
    index = next((i for i, row in enumerate(rows) if str(row.get("id") or "") == item_id), -1)
    if index < 0:
        return {"deleted": False, "trashed": False, "permanent": bool(permanent)}
    record = deepcopy(rows[index])
    tx, backup = _new_transaction("reference.delete.permanent" if permanent else "reference.trash", pack)
    del rows[index]
    trash_ids = []
    if not permanent:
        trash_ids = _push_trash([_trash_entry("reference", record, reason=reason, transaction_id=tx)])
    saved = save(pack)
    details = {"kind": "reference", "id": record.get("id"), "trash_ids": trash_ids}
    _commit_transaction("reference.delete.permanent" if permanent else "reference.trash", tx, backup, details, reversible=not permanent)
    return {"deleted": True, "trashed": not permanent, "permanent": bool(permanent), "trash_ids": trash_ids, "record": record, "pack": saved}


def _thumb_owner(pack: dict, kind: str, category_id: str, item_id: str):
    if kind == "cast":
        hit = next((row for row in pack.get("cast") or [] if str(row.get("handle")) == str(item_id)), None)
        if hit is None:
            raise KeyError("Cast entry was not found")
        return hit
    category = _category(pack, category_id)
    hit = next((row for row in category.get("prompts") or [] if str(row.get("id")) == str(item_id)), None)
    if hit is None:
        raise KeyError("starter entry was not found")
    return hit


def set_thumbnail(kind: str, category_id: str, item_id: str, raw: bytes) -> str:
    if len(raw) > MAX_THUMB_BYTES: raise ValueError("thumbnail is too large (4 MB maximum)")
    from PIL import Image
    encoded = io.BytesIO()
    with Image.open(io.BytesIO(raw)) as image:
        if int(image.width) * int(image.height) > MAX_THUMB_PIXELS: raise ValueError("thumbnail dimensions are too large")
        image.seek(0); image = image.convert("RGB"); image.thumbnail((512, 512), Image.Resampling.LANCZOS); image.save(encoded, "WEBP", quality=88, method=6)
    pack = load(); owner = _thumb_owner(pack, kind, category_id, item_id); old = owner.get("thumbnail"); tx, backup = _new_transaction("thumbnail.set", pack)
    filename = f"{uuid.uuid4().hex}.webp"; path = _thumb_dir() / filename; path.write_bytes(encoded.getvalue()); owner["thumbnail"] = f"thumbs/{filename}"
    try: save(pack)
    except Exception:
        path.unlink(missing_ok=True); _PENDING_HISTORY_TX.pop(tx, None); raise
    # Keep the old thumbnail file until after the after-snapshot is captured so
    # undo has exact bytes. It can then be removed if no live/trash record uses it.
    _commit_transaction("thumbnail.set", tx, backup, {"kind": kind, "category": category_id, "id": item_id, "old": old or "", "new": owner["thumbnail"]}, reversible=True)
    if old:
        _delete_thumbnail_if_unreferenced(old, pack)
    return owner["thumbnail"]


def remove_thumbnail(kind: str, category_id: str, item_id: str) -> bool:
    pack = load(); owner = _thumb_owner(pack, kind, category_id, item_id); old = owner.get("thumbnail")
    if not old: return False
    tx, backup = _new_transaction("thumbnail.remove", pack); owner.pop("thumbnail", None); save(pack)
    _commit_transaction("thumbnail.remove", tx, backup, {"kind": kind, "category": category_id, "id": item_id, "old": old}, reversible=True)
    _delete_thumbnail_if_unreferenced(old, pack)
    return True


def thumbnail_path(relative: str) -> Path | None:
    rel = str(relative or "").replace("\\", "/").lstrip("/")
    if not rel.startswith("thumbs/"):
        return None
    path = (current_dir() / rel).resolve()
    root = current_dir().resolve()
    try:
        path.relative_to(root)
    except ValueError:
        return None
    return path if path.is_file() else None


def _prompt_rows(pack: dict):
    """Yield (category, row) for every editable starter preset."""
    for category in _model(pack).get("categories") or []:
        for row in category.get("prompts") or []:
            yield category, row


def _record_thumbnail(row: dict) -> str:
    rel = str((row or {}).get("thumbnail") or "").replace("\\", "/")
    return rel if rel.startswith("thumbs/") else ""


def _thumbnail_references(pack: dict, *, include_trash: bool = True) -> set[str]:
    refs: set[str] = set()
    for row in pack.get("cast") or []:
        rel = _record_thumbnail(row)
        if rel:
            refs.add(rel)
    for row in pack.get("references") or []:
        rel = _record_thumbnail(row)
        if rel:
            refs.add(rel)
    for _category_row, row in _prompt_rows(pack):
        rel = _record_thumbnail(row)
        if rel:
            refs.add(rel)
    if include_trash:
        for entry in _load_trash().get("items") or []:
            rel = _record_thumbnail(entry.get("record") or {})
            if rel:
                refs.add(rel)
    return refs


def _trash_entry(kind: str, record: dict, *, category: str = "", reason: str = "delete", transaction_id: str = "", source_pack_id: str = "", source_pack: str = "") -> dict:
    record = deepcopy(record)
    return {
        "trash_id": f"trash_{uuid.uuid4().hex}",
        "kind": str(kind),
        "category": str(category or ""),
        "record": record,
        "deleted_at": _utc_now(),
        "reason": str(reason or "delete"),
        "transaction_id": str(transaction_id or ""),
        "source_pack_id": str(source_pack_id or record.get("source_pack_id") or ""),
        "source_pack": str(source_pack or record.get("source_pack") or ""),
    }


def _push_trash(entries: list[dict]) -> list[str]:
    if not entries:
        return []
    trash = _load_trash()
    items = trash.setdefault("items", [])
    ids = []
    for entry in entries:
        items.append(entry)
        ids.append(str(entry.get("trash_id") or ""))
    _save_trash(trash)
    return ids


def trash_status() -> dict:
    trash = _load_trash()
    rows = trash.get("items") or []
    counts = {"cast": 0, "prompt": 0}
    for row in rows:
        kind = str(row.get("kind") or "")
        if kind in counts:
            counts[kind] += 1
    return {"count": len(rows), "counts": counts, "items": deepcopy(rows)}


def _find_cast_by_identity(rows: list[dict], *, item_id: str = "", handle: str = "") -> int:
    iid = str(item_id or "").strip()
    h = str(handle or "").strip().lower()
    if iid:
        for i, row in enumerate(rows):
            if str(row.get("id") or "").strip() == iid:
                return i
    if h:
        for i, row in enumerate(rows):
            if str(row.get("handle") or "").strip().lower() == h:
                return i
    return -1


def _delete_thumbnail_if_unreferenced(rel: str, pack: dict, *, trash: dict | None = None) -> bool:
    rel = str(rel or "").replace("\\", "/")
    if not rel.startswith("thumbs/"):
        return False
    refs = _thumbnail_references(pack, include_trash=False)
    if trash is None:
        trash = _load_trash()
    for entry in trash.get("items") or []:
        if _record_thumbnail(entry.get("record") or {}) == rel:
            refs.add(rel)
            break
    if rel in refs:
        return False
    path = thumbnail_path(rel)
    if path:
        try:
            path.unlink()
            return True
        except OSError:
            return False
    return False


def delete_cast_record(handle: str = "", *, item_id: str = "", permanent: bool = False, reason: str = "delete") -> dict:
    pack = load()
    rows = pack.setdefault("cast", [])
    index = _find_cast_by_identity(rows, item_id=item_id, handle=handle)
    if index < 0:
        return {"deleted": False, "trashed": False, "permanent": bool(permanent)}
    record = deepcopy(rows[index])
    tx, backup = _new_transaction("cast.delete.permanent" if permanent else "cast.trash", pack)
    del rows[index]
    trash_ids = []
    if not permanent:
        trash_ids = _push_trash([_trash_entry("cast", record, reason=reason, transaction_id=tx)])
    saved = save(pack)
    removed_thumb = False
    if permanent:
        removed_thumb = _delete_thumbnail_if_unreferenced(_record_thumbnail(record), saved)
    details = {"kind": "cast", "id": record.get("id"), "handle": record.get("handle"), "trash_ids": trash_ids, "thumbnail_removed": removed_thumb}
    _commit_transaction("cast.delete.permanent" if permanent else "cast.trash", tx, backup, details, reversible=not permanent)
    return {"deleted": True, "trashed": not permanent, "permanent": bool(permanent), "trash_ids": trash_ids, "record": record}


def delete_prompt_record(category_id: str, item_id: str, *, permanent: bool = False, reason: str = "delete") -> dict:
    pack = load()
    category = _category(pack, category_id)
    rows = category.setdefault("prompts", [])
    index = next((i for i, row in enumerate(rows) if str(row.get("id") or "") == str(item_id or "")), -1)
    if index < 0:
        return {"deleted": False, "trashed": False, "permanent": bool(permanent)}
    record = deepcopy(rows[index])
    tx, backup = _new_transaction("prompt.delete.permanent" if permanent else "prompt.trash", pack)
    del rows[index]
    trash_ids = []
    if not permanent:
        trash_ids = _push_trash([_trash_entry("prompt", record, category=category_id, reason=reason, transaction_id=tx)])
    saved = save(pack)
    removed_thumb = False
    if permanent:
        removed_thumb = _delete_thumbnail_if_unreferenced(_record_thumbnail(record), saved)
    details = {"kind": "prompt", "category": category_id, "id": record.get("id"), "trash_ids": trash_ids, "thumbnail_removed": removed_thumb}
    _commit_transaction("prompt.delete.permanent" if permanent else "prompt.trash", tx, backup, details, reversible=not permanent)
    return {"deleted": True, "trashed": not permanent, "permanent": bool(permanent), "trash_ids": trash_ids, "record": record}


def restore_trash_item(trash_id: str) -> dict:
    trash = _load_trash()
    items = trash.get("items") or []
    index = next((i for i, row in enumerate(items) if str(row.get("trash_id") or "") == str(trash_id or "")), -1)
    if index < 0:
        raise ValueError("Trash item was not found")
    entry = deepcopy(items[index])
    pack = load()
    record = deepcopy(entry.get("record") or {})
    kind = str(entry.get("kind") or "")
    # Validate the restore fully before opening the transaction, but do not
    # mutate pack/trash until the exact BEFORE snapshot has been captured.
    if kind == "cast":
        record = _clean_cast(record)
        rows = pack.setdefault("cast", [])
        id_match = next((row for row in rows if str(row.get("id") or "") == str(record.get("id") or "")), None)
        handle_match = next((row for row in rows if str(row.get("handle") or "").lower() == str(record.get("handle") or "").lower()), None)
        if id_match or handle_match:
            raise ValueError("Restore blocked: a live Cast record already uses this stable ID or @handle. Nothing was overwritten and the Trash item was kept.")
    elif kind == "prompt":
        category_id = str(entry.get("category") or "")
        category = _category(pack, category_id)
        rows = category.setdefault("prompts", [])
        record = _clean_prompt(record)
        if any(str(row.get("id") or "") == str(record.get("id") or "") for row in rows):
            raise ValueError("Restore blocked: a live preset already uses this stable ID. Nothing was overwritten and the Trash item was kept.")
    elif kind == "reference":
        record = _clean_reference(record)
        rows = pack.setdefault("references", [])
        if any(str(row.get("id") or "") == str(record.get("id") or "") for row in rows):
            raise ValueError("Restore blocked: a live reference already uses this stable ID. Nothing was overwritten and the Trash item was kept.")
        if any(str(row.get("handle") or "").lower() == str(record.get("handle") or "").lower() for row in rows):
            raise ValueError("Restore blocked: a live reference already uses this Library handle. Nothing was overwritten and the Trash item was kept.")
    else:
        raise ValueError("Trash item has an unknown content type")
    tx, backup = _new_transaction("trash.restore", pack)
    rows.append(record)
    saved = save(pack)
    del items[index]
    _save_trash(trash)
    _commit_transaction("trash.restore", tx, backup, {"trash_id": trash_id, "kind": kind, "restored_id": record.get("id")}, reversible=True)
    return {"pack": saved, "restored": entry}


def empty_trash() -> dict:
    trash = _load_trash()
    items = deepcopy(trash.get("items") or [])
    if not items:
        return {"emptied": 0, "thumbnails_removed": 0}
    pack = load()
    tx, backup = _new_transaction("trash.empty", pack)
    _save_trash({"format": "z3_minimax_h3_trash_v1", "items": []})
    removed = 0
    for entry in items:
        if _delete_thumbnail_if_unreferenced(_record_thumbnail(entry.get("record") or {}), pack, trash={"items": []}):
            removed += 1
    # The rollback ZIP snapshots the live Library, not the Trash payload itself.
    # Empty Trash is therefore deliberately recorded as irreversible even though
    # a live-Library safety backup exists. Future global Undo can replace this
    # with a full transaction snapshot without lying about current recoverability.
    _commit_transaction("trash.empty", tx, backup, {"emptied": len(items), "thumbnails_removed": removed}, reversible=False)
    return {"emptied": len(items), "thumbnails_removed": removed}


def permanently_delete_trash_item(trash_id: str) -> dict:
    trash = _load_trash()
    items = trash.get("items") or []
    index = next((i for i, row in enumerate(items) if str(row.get("trash_id") or "") == str(trash_id or "")), -1)
    if index < 0:
        raise ValueError("Trash item was not found")
    entry = deepcopy(items[index])
    pack = load()
    tx, backup = _new_transaction("trash.delete.permanent", pack)
    del items[index]
    _save_trash(trash)
    removed_thumb = _delete_thumbnail_if_unreferenced(_record_thumbnail(entry.get("record") or {}), pack, trash=trash)
    # As with Empty Trash, the live-Library rollback ZIP does not contain the
    # removed Trash record, so this specific destruction is not reversible.
    _commit_transaction("trash.delete.permanent", tx, backup, {"trash_id": trash_id, "thumbnail_removed": removed_thumb}, reversible=False)
    return {"deleted": True, "thumbnail_removed": removed_thumb}


def audit_integrity(pack: dict | None = None) -> dict:
    """Inspect the live reusable library without mutating it.

    The report intentionally focuses on ambiguity that can leak into the visual
    editor: duplicate Cast identities/handles, duplicate preset ids, and stale
    local thumbnail references. It is safe to call whenever Settings is open.
    """
    pack = _validate_pack(pack or load())
    issues: list[dict] = []

    cast_rows = pack.get("cast") or []
    by_id: dict[str, list[int]] = {}
    by_handle: dict[str, list[int]] = {}
    for index, row in enumerate(cast_rows):
        cid = str(row.get("id") or "").strip()
        handle = str(row.get("handle") or "").strip().lower()
        if cid:
            by_id.setdefault(cid, []).append(index)
        if handle:
            by_handle.setdefault(handle, []).append(index)
    for key, indexes in by_id.items():
        if len(indexes) > 1:
            issues.append({"kind": "duplicate_cast_id", "key": key, "count": len(indexes), "indexes": indexes})
    for key, indexes in by_handle.items():
        if len(indexes) > 1:
            issues.append({"kind": "duplicate_cast_handle", "key": key, "count": len(indexes), "indexes": indexes})

    reference_rows = pack.get("references") or []
    ref_by_id: dict[str, list[int]] = {}
    ref_by_handle: dict[str, list[int]] = {}
    for index, row in enumerate(reference_rows):
        rid = str(row.get("id") or "").strip().lower()
        handle = str(row.get("handle") or "").strip().lower()
        if rid:
            ref_by_id.setdefault(rid, []).append(index)
        if handle:
            ref_by_handle.setdefault(handle, []).append(index)
    for key, indexes in ref_by_id.items():
        if len(indexes) > 1:
            issues.append({"kind": "duplicate_reference_id", "key": key, "count": len(indexes), "indexes": indexes})
    for key, indexes in ref_by_handle.items():
        if len(indexes) > 1:
            issues.append({"kind": "duplicate_reference_handle", "key": key, "count": len(indexes), "indexes": indexes})

    prompt_total = 0
    for category in _model(pack).get("categories") or []:
        rows = category.get("prompts") or []
        prompt_total += len(rows)
        seen: dict[str, list[int]] = {}
        for index, row in enumerate(rows):
            seen.setdefault(str(row.get("id") or ""), []).append(index)
        for key, indexes in seen.items():
            if key and len(indexes) > 1:
                issues.append({
                    "kind": "duplicate_prompt_id",
                    "category": str(category.get("id") or ""),
                    "key": key,
                    "count": len(indexes),
                    "indexes": indexes,
                })

    refs = _thumbnail_references(pack)
    missing = sorted(rel for rel in refs if thumbnail_path(rel) is None)
    for rel in missing:
        issues.append({"kind": "missing_thumbnail", "key": rel})
    existing = {f"thumbs/{path.name}" for path in _thumb_dir().glob("*") if path.is_file()}
    orphaned = sorted(existing - refs)
    for rel in orphaned:
        issues.append({"kind": "orphan_thumbnail", "key": rel})

    return {
        "ok": not issues,
        "repairable": bool(issues),
        "issues": issues,
        "counts": {
            "cast": len(cast_rows),
            "references": len(reference_rows),
            "prompts": prompt_total,
            "thumbnail_refs": len(refs),
            "issues": len(issues),
        },
    }


def _unique_cast_id(value: str, used: set[str]) -> str:
    base = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "cast")).strip("_.-")[:78] or "cast"
    candidate = base
    suffix = 2
    while candidate.lower() in used:
        candidate = f"{base[:88]}-{suffix}"
        suffix += 1
    used.add(candidate.lower())
    return candidate


def _unique_cast_handle(value: str, used: set[str]) -> str:
    base = re.sub(r"[^A-Za-z0-9_]+", "_", str(value or "Character")).strip("_")[:54] or "Character"
    if not base[0].isalpha():
        base = "Character_" + base
    candidate = base[:64]
    suffix = 2
    while candidate.lower() in used:
        tail = f"_{suffix}"
        candidate = f"{base[:64-len(tail)]}{tail}"
        suffix += 1
    used.add(candidate.lower())
    return candidate


def _same_cast_character(left: dict, right: dict) -> bool:
    """Conservative duplicate test used before collapsing Cast rows."""
    left_handle = str(left.get("handle") or "").strip().lower()
    right_handle = str(right.get("handle") or "").strip().lower()
    if left_handle != right_handle:
        return False
    left_name = str(left.get("name") or "").strip().lower()
    right_name = str(right.get("name") or "").strip().lower()
    left_desc = str(left.get("description") or "").strip().lower()
    right_desc = str(right.get("description") or "").strip().lower()
    return bool(left_name and left_name == right_name) or bool(left_desc and left_desc == right_desc)


def _same_reference(left: dict, right: dict) -> bool:
    """Conservative duplicate test for reusable Reference records."""
    if str(left.get("handle") or "").strip().lower() != str(right.get("handle") or "").strip().lower():
        return False
    left_file = str(left.get("filename") or "").strip().lower()
    right_file = str(right.get("filename") or "").strip().lower()
    if left_file and left_file == right_file:
        return True
    left_name = str(left.get("name") or "").strip().lower()
    right_name = str(right.get("name") or "").strip().lower()
    return bool(left_name and left_name == right_name)


def _unique_reference_id(value: str, used: set[str]) -> str:
    base = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "ref")).strip("_.-")[:78] or "ref"
    candidate = base
    suffix = 2
    while candidate.lower() in used:
        candidate = f"{base[:88]}-{suffix}"
        suffix += 1
    used.add(candidate.lower())
    return candidate


def _unique_reference_handle(value: str, used: set[str]) -> str:
    base = re.sub(r"[^A-Za-z0-9_-]+", "_", str(value or "Reference")).strip("_-")[:54] or "Reference"
    if not base[0].isalpha():
        base = "Reference_" + base
    candidate = base[:64]
    suffix = 2
    while candidate.lower() in used:
        tail = f"_{suffix}"
        candidate = f"{base[:64-len(tail)]}{tail}"
        suffix += 1
    used.add(candidate.lower())
    return candidate


def repair_integrity() -> dict:
    """Repair library ambiguity with an automatic rollback backup.

    Distinct characters are preserved. Exact/near duplicate Cast rows collapse;
    conflicting identities receive a new stable id or unique @handle rather than
    being discarded. Duplicate prompt ids keep the latest row at the original
    slot. Missing thumbnail links and unreferenced thumbnail files are cleaned.
    """
    pack = load()
    before = audit_integrity(pack)
    if before["ok"]:
        return {"pack": pack, "report": before, "changes": [], "backup": ""}

    try:
        backup = _create_import_backup(pack)
    except Exception as exc:
        raise ValueError("could not create the automatic rollback backup; integrity repair was cancelled") from exc

    changes: list[str] = []

    # Collapse duplicate starter ids with latest data winning, while retaining
    # the first card's position so gallery ordering does not jump unexpectedly.
    for category in _model(pack).get("categories") or []:
        rows = category.get("prompts") or []
        output: list[dict] = []
        positions: dict[str, int] = {}
        for row in rows:
            key = str(row.get("id") or "")
            if key and key in positions:
                output[positions[key]] = {**output[positions[key]], **row}
                changes.append(f"Collapsed duplicate preset {category.get('id')}:{key}")
            else:
                if key:
                    positions[key] = len(output)
                output.append(row)
        category["prompts"] = output

    cast_output: list[dict] = []
    used_ids: set[str] = set()
    used_handles: set[str] = set()
    id_positions: dict[str, int] = {}
    handle_positions: dict[str, int] = {}
    for original in pack.get("cast") or []:
        row = _clean_cast(original)
        cid = str(row.get("id") or "")
        handle_key = str(row.get("handle") or "").lower()
        id_key = cid.lower()

        duplicate_index = id_positions.get(id_key)
        if duplicate_index is None:
            duplicate_index = handle_positions.get(handle_key)
        if duplicate_index is not None and _same_cast_character(cast_output[duplicate_index], row):
            # Prefer the later non-empty authored values, but keep the stable
            # identity/handle already used by workflows.
            target = cast_output[duplicate_index]
            for key, value in row.items():
                if key in {"id", "handle"}:
                    continue
                if value not in (None, ""):
                    target[key] = value
            changes.append(f"Collapsed duplicate Cast @{target.get('handle')}")
            continue

        if id_key in used_ids:
            old_id = cid
            row["id"] = _unique_cast_id(f"{cid}-copy", used_ids)
            changes.append(f"Reassigned duplicate Cast id {old_id} → {row['id']}")
        else:
            used_ids.add(id_key)

        if handle_key in used_handles:
            old_handle = row["handle"]
            row["handle"] = _unique_cast_handle(old_handle, used_handles)
            changes.append(f"Renamed duplicate Cast handle @{old_handle} → @{row['handle']}")
        else:
            used_handles.add(handle_key)

        index = len(cast_output)
        cast_output.append(row)
        id_positions[str(row.get("id") or "").lower()] = index
        handle_positions[str(row.get("handle") or "").lower()] = index
    pack["cast"] = cast_output

    # Reusable references use the same stable-id rules as Cast. Preserve distinct
    # records; collapse only conservative duplicates and rename/re-id conflicts.
    reference_output: list[dict] = []
    used_ref_ids: set[str] = set()
    used_ref_handles: set[str] = set()
    ref_id_positions: dict[str, int] = {}
    ref_handle_positions: dict[str, int] = {}
    for original in pack.get("references") or []:
        row = _clean_reference(original)
        rid = str(row.get("id") or "")
        handle_key = str(row.get("handle") or "").lower()
        id_key = rid.lower()
        duplicate_index = ref_id_positions.get(id_key)
        if duplicate_index is None:
            duplicate_index = ref_handle_positions.get(handle_key)
        if duplicate_index is not None and _same_reference(reference_output[duplicate_index], row):
            target = reference_output[duplicate_index]
            for key, value in row.items():
                if key in {"id", "handle"}:
                    continue
                if value not in (None, ""):
                    target[key] = value
            changes.append(f"Collapsed duplicate Reference @{target.get('handle')}")
            continue
        if id_key in used_ref_ids:
            old_id = rid
            row["id"] = _unique_reference_id(f"{rid}-copy", used_ref_ids)
            changes.append(f"Reassigned duplicate Reference id {old_id} → {row['id']}")
        else:
            used_ref_ids.add(id_key)
        if handle_key in used_ref_handles:
            old_handle = row["handle"]
            row["handle"] = _unique_reference_handle(old_handle, used_ref_handles)
            changes.append(f"Renamed duplicate Reference handle @{old_handle} → @{row['handle']}")
        else:
            used_ref_handles.add(handle_key)
        index = len(reference_output)
        reference_output.append(row)
        ref_id_positions[str(row.get("id") or "").lower()] = index
        ref_handle_positions[str(row.get("handle") or "").lower()] = index
    pack["references"] = reference_output

    # Remove dead thumbnail links before save; those records remain otherwise
    # untouched and can receive a new thumbnail normally from the UI.
    for row in pack.get("cast") or []:
        rel = str(row.get("thumbnail") or "").replace("\\", "/")
        if rel.startswith("thumbs/") and thumbnail_path(rel) is None:
            row.pop("thumbnail", None)
            changes.append(f"Removed missing Cast thumbnail {rel}")
    for _category_row, row in _prompt_rows(pack):
        rel = str(row.get("thumbnail") or "").replace("\\", "/")
        if rel.startswith("thumbs/") and thumbnail_path(rel) is None:
            row.pop("thumbnail", None)
            changes.append(f"Removed missing preset thumbnail {rel}")
    for row in pack.get("references") or []:
        rel = str(row.get("thumbnail") or "").replace("\\", "/")
        if rel.startswith("thumbs/") and thumbnail_path(rel) is None:
            row.pop("thumbnail", None)
            changes.append(f"Removed missing Reference thumbnail {rel}")

    save(pack)

    refs = _thumbnail_references(pack)
    for path in list(_thumb_dir().glob("*")):
        if not path.is_file():
            continue
        rel = f"thumbs/{path.name}"
        if rel not in refs:
            try:
                path.unlink()
                changes.append(f"Removed orphan thumbnail {rel}")
            except OSError:
                pass

    repaired = load()
    return {
        "pack": repaired,
        "report": audit_integrity(repaired),
        "changes": changes,
        "backup": backup.name,
    }


def _zip_bytes(pack: dict, scope: str = "pack", category_id: str = "", subcategory: str = "", item_id: str = "") -> bytes:
    export = deepcopy(pack)
    name = export.get("name", "MiniMax H3 Pack")
    if scope in ("references", "reference_item"):
        if scope == "reference_item":
            hit = next((row for row in export.get("references") or [] if str(row.get("id")) == str(item_id)), None)
            if hit is None:
                raise KeyError("Reference entry was not found")
            export["references"] = [deepcopy(hit)]
        export["catalog"] = {"models": [{"id": "minimax-creator-h3", "name": "MiniMax H3", "categories": []}]}
        export["cast"] = []
        export["name"] = f"{name} — {'Reference' if scope == 'reference_item' else 'References'}"
    elif scope in ("cast", "cast_item"):
        if scope == "cast_item":
            hit = next((row for row in export.get("cast") or [] if str(row.get("handle")) == str(item_id)), None)
            if hit is None:
                raise KeyError("Cast entry was not found")
            export["cast"] = [deepcopy(hit)]
        export["catalog"] = {"models": [{"id": "minimax-creator-h3", "name": "MiniMax H3", "categories": []}]}
        linked_ids = {str(ref_id) for row in export.get("cast") or [] for ref_id in (row.get("reference_ids") or [])}
        export["references"] = [row for row in export.get("references") or [] if str(row.get("id") or "") in linked_ids]
        export["name"] = f"{name} — {'Cast preset' if scope == 'cast_item' else 'Cast'}"
    elif scope in ("category", "prompt_item"):
        category = deepcopy(_category(export, category_id))
        if scope == "prompt_item":
            hit = next((row for row in category.get("prompts") or [] if str(row.get("id")) == str(item_id)), None)
            if hit is None:
                raise KeyError("starter entry was not found")
            category["prompts"] = [deepcopy(hit)]
        elif subcategory:
            category["prompts"] = [row for row in category.get("prompts", []) if str(row.get("subcategory") or "") == str(subcategory)]
        model = deepcopy(_model(export))
        model["categories"] = [category]
        export["catalog"] = {**export["catalog"], "models": [model]}
        export["cast"] = []
        export["references"] = []
        export["name"] = f"{name} — {category.get('name') or category_id}{(' — ' + subcategory) if subcategory else ''}"
    refs = set()
    def walk(value):
        if isinstance(value, dict):
            thumb = value.get("thumbnail")
            if isinstance(thumb, str) and thumb.startswith("thumbs/"):
                refs.add(thumb)
            for child in value.values(): walk(child)
        elif isinstance(value, list):
            for child in value: walk(child)
    walk(export)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("pack.json", json.dumps(export, ensure_ascii=False, indent=2))
        for rel in sorted(refs):
            path = thumbnail_path(rel)
            if path:
                zf.write(path, rel)
    return out.getvalue()


def export_bytes(scope="pack", category_id="", subcategory="", item_id="") -> bytes:
    return _zip_bytes(load(), scope, category_id, subcategory, item_id)


def _read_uploaded_pack(raw: bytes) -> tuple[dict, dict[str, bytes]]:
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("pack upload is too large")
    thumbs = {}
    if raw[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(raw), "r") as zf:
            infos = zf.infolist()
            if len(infos) > MAX_ZIP_FILES:
                raise ValueError("pack ZIP contains too many files")
            for info in infos:
                name = info.filename.replace("\\", "/")
                if name.startswith("/") or ".." in name.split("/"):
                    raise ValueError("pack ZIP contains an unsafe path")
            try:
                data = json.loads(zf.read("pack.json").decode("utf-8"))
            except KeyError as exc:
                raise ValueError("pack ZIP is missing pack.json") from exc
            for info in infos:
                name = info.filename.replace("\\", "/")
                if name.startswith("thumbs/") and not info.is_dir():
                    if info.file_size > MAX_THUMB_BYTES:
                        raise ValueError(f"thumbnail {name} is too large")
                    thumbs[name] = zf.read(info)
    else:
        data = json.loads(raw.decode("utf-8"))
    return _validate_pack(data), thumbs


def _install_thumbs(thumbs: dict[str, bytes], pack: dict) -> dict:
    if not thumbs:
        return pack
    mapping = {}
    from PIL import Image
    for rel, raw in thumbs.items():
        with Image.open(io.BytesIO(raw)) as image:
            if int(image.width) * int(image.height) > MAX_THUMB_PIXELS:
                raise ValueError(f"thumbnail {rel} dimensions are too large")
            image.seek(0)
            image = image.convert("RGB")
            image.thumbnail((512, 512), Image.Resampling.LANCZOS)
            filename = f"{uuid.uuid4().hex}.webp"
            image.save(_thumb_dir() / filename, "WEBP", quality=88, method=6)
            mapping[rel] = f"thumbs/{filename}"
    def walk(value):
        if isinstance(value, dict):
            if value.get("thumbnail") in mapping:
                value["thumbnail"] = mapping[value["thumbnail"]]
            for child in value.values(): walk(child)
        elif isinstance(value, list):
            for child in value: walk(child)
    walk(pack)
    return pack


def _pack_fingerprint(pack: dict) -> str:
    raw = json.dumps(_validate_pack(pack), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _pack_counts(pack: dict) -> dict:
    categories = []
    prompt_total = 0
    for category in _model(pack).get("categories") or []:
        rows = category.get("prompts") or []
        prompt_total += len(rows)
        subcats = {}
        for row in rows:
            key = str(row.get("subcategory") or "Unsorted")
            subcats[key] = subcats.get(key, 0) + 1
        categories.append({
            "id": str(category.get("id") or ""),
            "name": str(category.get("name") or category.get("id") or "Category"),
            "count": len(rows),
            "subcategories": subcats,
        })
    return {"cast": len(pack.get("cast") or []), "references": len(pack.get("references") or []), "prompts": prompt_total, "categories": categories}


def _cast_conflict(current_rows: list[dict], incoming: dict) -> bool:
    """Compatibility helper: stable ID first, @handle only as a hard collision."""
    status = _classify_cast(current_rows, incoming)
    return status["status"] in {"update", "collision"}


def _prompt_conflict(current_rows: list[dict], incoming: dict) -> bool:
    iid = str(incoming.get("id") or "").strip()
    return bool(iid) and any(str(row.get("id") or "").strip() == iid for row in current_rows)


def _incoming_category(incoming: dict, category_id: str) -> dict | None:
    categories = _model(incoming).get("categories") or []
    source = next((cat for cat in categories if str(cat.get("id")) == str(category_id)), None)
    if source is None and len(categories) == 1:
        source = categories[0]
    return source


def _category_or_none(pack: dict, category_id: str) -> dict | None:
    key = str(category_id or "").strip()
    return next((cat for cat in (_model(pack).get("categories") or []) if str(cat.get("id") or "") == key), None)


def _group_name(value) -> str:
    return str(value or "Unsorted").strip() or "Unsorted"


def _pack_source_identity(pack: dict) -> tuple[str, str, bool]:
    meta = pack.get("meta") if isinstance(pack.get("meta"), dict) else {}
    explicit = str(meta.get("pack_id") or meta.get("id") or "").strip()
    label = str(pack.get("name") or "Imported pack").strip()[:160] or "Imported pack"
    if explicit:
        clean = re.sub(r"[^A-Za-z0-9_.-]+", "_", explicit).strip("_.-")[:96]
        if clean:
            return clean, label, False
    author = str(meta.get("author") or "").strip().lower()
    lineage = f"{PACK_FORMAT}|{label.lower()}|{author}".encode("utf-8")
    return f"legacy_{hashlib.sha256(lineage).hexdigest()[:20]}", label, True


def _annotate_import_provenance(incoming: dict) -> tuple[dict, dict]:
    out = deepcopy(incoming)
    source_id, source_name, legacy = _pack_source_identity(out)
    meta = dict(out.get("meta") or {})
    meta.setdefault("pack_id", source_id)
    out["meta"] = meta
    for row in out.get("cast") or []:
        if not str(row.get("source_pack_id") or "").strip():
            row["source_pack_id"] = source_id
        if not str(row.get("source_pack") or "").strip():
            row["source_pack"] = source_name
    for _cat, row in _prompt_rows(out):
        if not str(row.get("source_pack_id") or "").strip():
            row["source_pack_id"] = source_id
        if not str(row.get("source_pack") or "").strip():
            row["source_pack"] = source_name
    for row in out.get("references") or []:
        if not str(row.get("source_pack_id") or "").strip():
            row["source_pack_id"] = source_id
        if not str(row.get("source_pack") or "").strip():
            row["source_pack"] = source_name
    return out, {"id": source_id, "name": source_name, "legacy": legacy}


def _classify_cast(current_rows: list[dict], incoming: dict) -> dict:
    iid = str(incoming.get("id") or "").strip()
    handle = str(incoming.get("handle") or "").strip().lower()
    name = str(incoming.get("name") or "").strip().lower()
    id_index = next((i for i, row in enumerate(current_rows) if iid and str(row.get("id") or "").strip() == iid), -1)
    handle_index = next((i for i, row in enumerate(current_rows) if handle and str(row.get("handle") or "").strip().lower() == handle), -1)
    name_matches = [i for i, row in enumerate(current_rows) if name and str(row.get("name") or "").strip().lower() == name]
    if id_index >= 0:
        if handle_index >= 0 and handle_index != id_index:
            return {"status": "collision", "reason": "handle_taken", "index": id_index, "other_index": handle_index, "name_collision": bool(name_matches)}
        current = current_rows[id_index]
        moved = _group_name(current.get("group")) != _group_name(incoming.get("group"))
        return {"status": "update", "reason": "stable_id", "index": id_index, "moved": moved, "name_collision": any(i != id_index for i in name_matches)}
    if handle_index >= 0:
        return {"status": "collision", "reason": "same_handle_different_id", "index": handle_index, "name_collision": bool(name_matches)}
    return {"status": "new", "reason": "new_id", "index": -1, "moved": False, "name_collision": bool(name_matches)}


def _classify_prompt(current_rows: list[dict], incoming: dict) -> dict:
    iid = str(incoming.get("id") or "").strip()
    title = str(incoming.get("title") or "").strip().lower()
    id_index = next((i for i, row in enumerate(current_rows) if iid and str(row.get("id") or "").strip() == iid), -1)
    title_matches = [i for i, row in enumerate(current_rows) if title and str(row.get("title") or "").strip().lower() == title]
    if id_index >= 0:
        current = current_rows[id_index]
        moved = _group_name(current.get("subcategory")) != _group_name(incoming.get("subcategory"))
        return {"status": "update", "reason": "stable_id", "index": id_index, "moved": moved, "name_collision": any(i != id_index for i in title_matches)}
    return {"status": "new", "reason": "new_id", "index": -1, "moved": False, "name_collision": bool(title_matches)}


def _classify_reference(current_rows: list[dict], incoming: dict) -> dict:
    iid = str(incoming.get("id") or "").strip()
    handle = str(incoming.get("handle") or "").strip().lower()
    name = str(incoming.get("name") or "").strip().lower()
    id_index = next((i for i, row in enumerate(current_rows) if iid and str(row.get("id") or "") == iid), -1)
    handle_index = next((i for i, row in enumerate(current_rows) if handle and str(row.get("handle") or "").lower() == handle), -1)
    name_matches = [i for i, row in enumerate(current_rows) if name and str(row.get("name") or "").lower() == name]
    if id_index >= 0:
        if handle_index >= 0 and handle_index != id_index:
            return {"status": "collision", "reason": "handle_taken", "index": id_index, "other_index": handle_index, "name_collision": bool(name_matches)}
        current = current_rows[id_index]
        moved = _group_name(current.get("group")) != _group_name(incoming.get("group"))
        return {"status": "update", "reason": "stable_id", "index": id_index, "moved": moved, "name_collision": any(i != id_index for i in name_matches)}
    if handle_index >= 0:
        return {"status": "collision", "reason": "same_handle_different_id", "index": handle_index, "name_collision": bool(name_matches)}
    return {"status": "new", "reason": "new_id", "index": -1, "moved": False, "name_collision": bool(name_matches)}


def _apply_reference_rows(pack: dict, rows: list[dict], *, mode: str) -> dict:
    live = pack.setdefault("references", [])
    stats = {"new": 0, "updated": 0, "collisions": 0, "name_collisions": 0, "moved": 0, "deleted": 0}
    for raw in rows:
        row = _clean_reference(raw)
        cls = _classify_reference(live, row)
        if cls.get("name_collision"):
            stats["name_collisions"] += 1
        if cls["status"] == "collision":
            stats["collisions"] += 1
            continue
        if cls["status"] == "update":
            if mode == "merge":
                idx = int(cls["index"]); live[idx] = {**live[idx], **deepcopy(row)}; stats["updated"] += 1
                if cls.get("moved"):
                    stats["moved"] += 1
            continue
        live.append(deepcopy(row)); stats["new"] += 1
    return stats


def _scope_content(incoming: dict, scope: str, category_id: str = "", subcategory: str = "") -> tuple[list[dict], list[tuple[str, dict, list[dict]]]]:
    cast_rows: list[dict] = []
    prompt_sets: list[tuple[str, dict, list[dict]]] = []
    if scope == "pack":
        cast_rows = deepcopy(incoming.get("cast") or [])
        for cat in _model(incoming).get("categories") or []:
            prompt_sets.append((str(cat.get("id") or ""), cat, deepcopy(cat.get("prompts") or [])))
        return cast_rows, prompt_sets
    if scope in ("references", "reference_item"):
        rows = deepcopy(incoming.get("references") or [])
        if scope == "reference_item": rows = rows[:1]
        if not rows:
            raise ValueError("imported file does not contain reusable Reference entries; current References were not changed")
        return [], []
    if scope in ("cast", "cast_item"):
        cast_rows = deepcopy(incoming.get("cast") or [])
        if scope == "cast_item":
            cast_rows = cast_rows[:1]
        if not cast_rows:
            raise ValueError("imported file does not contain Cast entries; current Cast was not changed")
        return cast_rows, []
    if scope in ("category", "prompt_item"):
        source = _incoming_category(incoming, category_id)
        if source is None:
            raise ValueError("imported pack does not contain this category")
        rows = deepcopy(source.get("prompts") or [])
        if subcategory:
            rows = [row for row in rows if _group_name(row.get("subcategory")) == _group_name(subcategory)] or rows
            destination_slot = _destination_scene_slot(category_id, subcategory)
            for row in rows:
                row["subcategory"] = subcategory
                if destination_slot:
                    row["slot"] = destination_slot
        if scope == "prompt_item":
            rows = rows[:1]
        if not rows:
            raise ValueError("imported category contains no presets; current section was not changed")
        prompt_sets.append((str(category_id or source.get("id") or ""), source, rows))
        return [], prompt_sets
    raise ValueError("unknown pack import scope")


def _preview_group_cast(current_rows: list[dict], rows: list[dict], group: str) -> dict:
    """Preview the *actual* Replace Selected Group semantics.

    Records in the selected group that are absent from the incoming stable-ID
    set are removed before the merge. This matters for @handle collisions: a
    handle owned only by a record that will be replaced must not be reported as
    a hard collision in the confirmation preview.
    """
    incoming_rows = [deepcopy(row) for row in rows if _group_name(row.get("group")) == group]
    current_group = [row for row in current_rows if _group_name(row.get("group")) == group]
    incoming_ids = {str(row.get("id") or "") for row in incoming_rows}
    preview_live = [
        deepcopy(row) for row in current_rows
        if _group_name(row.get("group")) != group or str(row.get("id") or "") in incoming_ids
    ]
    preview_pack = {"cast": preview_live}
    summary = _apply_cast_rows(preview_pack, incoming_rows, mode="merge")
    deleted = sum(1 for row in current_group if str(row.get("id") or "") not in incoming_ids)
    return {**summary, "kind": "cast", "category": "", "group": group, "label": f"Cast · {group}", "incoming": len(incoming_rows), "current": len(current_group), "deleted": deleted}


def _preview_group_prompt(current: dict, category_id: str, category_name: str, rows: list[dict], group: str) -> dict:
    target = _category_or_none(current, category_id)
    current_rows = target.get("prompts") or [] if target else []
    incoming_rows = [deepcopy(row) for row in rows if _group_name(row.get("subcategory")) == group]
    current_group = [row for row in current_rows if _group_name(row.get("subcategory")) == group]
    incoming_ids = {str(row.get("id") or "") for row in incoming_rows}
    preview_live = [
        deepcopy(row) for row in current_rows
        if _group_name(row.get("subcategory")) != group or str(row.get("id") or "") in incoming_ids
    ]
    # Match the backend merge exactly so same-title/different-ID notices do not
    # include a preset that the selected-group replacement is about to remove.
    summary = {"new": 0, "updated": 0, "collisions": 0, "name_collisions": 0, "moved": 0}
    for row in incoming_rows:
        cls = _classify_prompt(preview_live, row)
        if cls.get("name_collision"):
            summary["name_collisions"] += 1
        if cls["status"] == "update":
            idx = int(cls["index"]); preview_live[idx] = {**preview_live[idx], **deepcopy(row)}
            summary["updated"] += 1
            if cls.get("moved"): summary["moved"] += 1
        else:
            preview_live.append(deepcopy(row)); summary["new"] += 1
    deleted = sum(1 for row in current_group if str(row.get("id") or "") not in incoming_ids)
    return {**summary, "kind": "prompt", "category": category_id, "category_name": category_name, "group": group, "label": f"{category_name} · {group}", "incoming": len(incoming_rows), "current": len(current_group), "deleted": deleted}




def _preview_group_reference(current_rows: list[dict], rows: list[dict], group: str) -> dict:
    """Preview the exact safe replacement semantics for one Reference group."""
    group = _group_name(group)
    incoming_rows = [deepcopy(row) for row in rows if _group_name(row.get("group")) == group]
    current_group = [row for row in current_rows if _group_name(row.get("group")) == group]
    incoming_ids = {str(row.get("id") or "") for row in incoming_rows}
    preview_live = [
        deepcopy(row) for row in current_rows
        if _group_name(row.get("group")) != group or str(row.get("id") or "") in incoming_ids
    ]
    summary = _apply_reference_rows({"references": preview_live}, incoming_rows, mode="merge")
    deleted = sum(1 for row in current_group if str(row.get("id") or "") not in incoming_ids)
    return {**summary, "kind": "reference", "category": "", "group": group, "label": f"References · {group}", "incoming": len(incoming_rows), "current": len(current_group), "deleted": deleted}


def _reference_rows_for_scope(incoming: dict, scope: str, cast_rows: list[dict] | None = None) -> list[dict]:
    """Return reusable Reference records that logically travel with this scope.

    Full/reference imports carry their own Reference rows. Cast exports also
    embed the stable Reference records named by ``reference_ids`` so canonical
    identity links remain portable; importing that Cast must therefore bring
    those linked records along instead of leaving dead stable IDs behind.
    Category-only imports intentionally carry no References.
    """
    refs = deepcopy(incoming.get("references") or [])
    if scope == "pack" or scope == "references":
        return refs
    if scope == "reference_item":
        return refs[:1]
    if scope in {"cast", "cast_item"}:
        linked = {
            str(ref_id).strip()
            for row in (cast_rows or [])
            if isinstance(row, dict)
            for ref_id in (row.get("reference_ids") or [])
            if str(ref_id).strip()
        }
        return [row for row in refs if str(row.get("id") or "").strip() in linked]
    return []
def _preview_import(current: dict, incoming: dict, scope: str, category_id: str = "", subcategory: str = "") -> dict:
    cast_rows, prompt_sets = _scope_content(incoming, scope, category_id, subcategory)
    reference_rows = _reference_rows_for_scope(incoming, scope, cast_rows)
    groups: list[dict] = []
    if cast_rows:
        for group in sorted({_group_name(row.get("group")) for row in cast_rows}):
            groups.append(_preview_group_cast(current.get("cast") or [], cast_rows, group))
    for cid, cat, rows in prompt_sets:
        category_name = str(cat.get("name") or cid or "Category")
        for group in sorted({_group_name(row.get("subcategory")) for row in rows}):
            groups.append(_preview_group_prompt(current, cid, category_name, rows, group))
    summary = {"new": 0, "updated": 0, "collisions": 0, "name_collisions": 0, "moved": 0, "deleted": 0}
    if reference_rows:
        for group in sorted({_group_name(row.get("group")) for row in reference_rows}):
            groups.append(_preview_group_reference(current.get("references") or [], reference_rows, group))
    for group in groups:
        for key in summary:
            if key == "deleted":
                continue
            summary[key] += int(group.get(key) or 0)
    content_types = []
    if cast_rows: content_types.append("Cast")
    if reference_rows: content_types.append("References")
    content_types.extend([str(cat.get("name") or cid) for cid, cat, rows in prompt_sets if rows])
    return {"summary": summary, "groups": groups, "content_types": content_types}


def inspect_bytes(raw: bytes, scope="pack", category_id="", subcategory="") -> dict:
    """Validate and classify an import without mutating live Library state."""
    incoming, thumbs = _read_uploaded_pack(raw)
    incoming, source = _annotate_import_provenance(incoming)
    current = load()
    preview = _preview_import(current, incoming, scope, category_id, subcategory)
    summary = preview["summary"]
    warnings: list[str] = []
    if source.get("legacy"):
        warnings.append("Older pack format: Creator Palette assigned a deterministic pack identity from its name/author so future merges and pack deletion remain stable.")
    if summary.get("collisions"):
        warnings.append(f"{summary['collisions']} hard collision(s) use a different stable ID with an existing handle. They will never silently overwrite the existing record.")
    if summary.get("name_collisions"):
        warnings.append(f"{summary['name_collisions']} same-name/title collision(s) use different stable IDs. Names alone never trigger overwrite.")
    return {
        "name": incoming.get("name") or "Imported pack",
        "source_pack": source,
        "scope": scope,
        "category": category_id,
        "subcategory": subcategory,
        "incoming": _pack_counts(incoming),
        "current": _pack_counts(current),
        "thumbnail_files": len(thumbs),
        "warnings": warnings,
        "current_fingerprint": _pack_fingerprint(current),
        "impact": preview,
    }

def _backup_dir() -> Path:
    path = _user_root() / "import_backups"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _create_import_backup(pack: dict | None = None) -> Path:
    pack = pack or load()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    path = _backup_dir() / f"before-import-{stamp}-{uuid.uuid4().hex[:6]}.zip"
    path.write_bytes(_zip_bytes(pack, "pack"))
    backups = sorted(_backup_dir().glob("before-import-*.zip"), key=lambda item: item.stat().st_mtime, reverse=True)
    for old in backups[20:]:
        try:
            old.unlink()
        except OSError:
            pass
    return path


def latest_import_backup() -> Path | None:
    backups = sorted(_backup_dir().glob("before-import-*.zip"), key=lambda item: item.stat().st_mtime, reverse=True)
    return backups[0] if backups else None


def import_backup_status() -> dict:
    path = latest_import_backup()
    return {"available": bool(path), "name": path.name if path else ""}


def _ensure_category_for_import(pack: dict, source_category: dict, category_id: str) -> dict:
    target = _category_or_none(pack, category_id)
    if target is not None:
        return target
    model = _model(pack)
    target = deepcopy(source_category)
    target["id"] = category_id
    target["prompts"] = []
    model.setdefault("categories", []).append(target)
    return target


def _normalize_import_mode(mode) -> str:
    if isinstance(mode, bool):
        if mode:
            raise ValueError("Generic Replace is disabled. Choose Merge or Replace Selected Group.")
        return "append"
    value = str(mode or "append").strip().lower()
    aliases = {"safe": "append", "update": "merge", "replace-selected-group": "replace_group", "replace_selected_group": "replace_group"}
    value = aliases.get(value, value)
    if value in {"replace", "replace_sections", "replace_all", "replace-all"}:
        raise ValueError("Generic Replace is disabled for safety. Choose Merge or Replace Selected Group.")
    if value not in {"append", "merge", "replace_group"}:
        raise ValueError("unknown pack import mode")
    return value


def _apply_cast_rows(out: dict, rows: list[dict], *, mode: str) -> dict:
    live = out.setdefault("cast", [])
    stats = {"new": 0, "updated": 0, "collisions": 0, "name_collisions": 0, "moved": 0}
    for incoming in rows:
        cls = _classify_cast(live, incoming)
        if cls.get("name_collision"):
            stats["name_collisions"] += 1
        if cls["status"] == "collision":
            stats["collisions"] += 1
            continue
        if cls["status"] == "update":
            if mode == "merge":
                idx = int(cls["index"])
                live[idx] = {**live[idx], **deepcopy(incoming)}
                stats["updated"] += 1
                if cls.get("moved"):
                    stats["moved"] += 1
            continue
        live.append(deepcopy(incoming))
        stats["new"] += 1
    return stats


def _apply_prompt_rows(out: dict, category_id: str, source_category: dict, rows: list[dict], *, mode: str) -> dict:
    target = _ensure_category_for_import(out, source_category, category_id)
    live = target.setdefault("prompts", [])
    stats = {"new": 0, "updated": 0, "collisions": 0, "name_collisions": 0, "moved": 0}
    for incoming in rows:
        cls = _classify_prompt(live, incoming)
        if cls.get("name_collision"):
            stats["name_collisions"] += 1
        if cls["status"] == "update":
            if mode == "merge":
                idx = int(cls["index"])
                live[idx] = {**live[idx], **deepcopy(incoming)}
                stats["updated"] += 1
                if cls.get("moved"):
                    stats["moved"] += 1
            continue
        live.append(deepcopy(incoming))
        stats["new"] += 1
    return stats


def _replace_selected_cast_group(out: dict, incoming_rows: list[dict], group: str, *, transaction_id: str) -> tuple[dict, list[dict]]:
    group = _group_name(group)
    selected = [deepcopy(row) for row in incoming_rows if _group_name(row.get("group")) == group]
    if not selected:
        raise ValueError(f"Incoming pack does not contain Cast group “{group}”. Nothing was changed.")
    live = out.setdefault("cast", [])
    incoming_ids = {str(row.get("id") or "") for row in selected}
    removed = [deepcopy(row) for row in live if _group_name(row.get("group")) == group and str(row.get("id") or "") not in incoming_ids]
    removed_ids = {str(row.get("id") or "") for row in removed}
    if removed_ids:
        live[:] = [row for row in live if str(row.get("id") or "") not in removed_ids]
    trash_entries = [_trash_entry("cast", row, reason="replace_selected_group", transaction_id=transaction_id) for row in removed]
    stats = _apply_cast_rows(out, selected, mode="merge")
    stats["deleted"] = len(removed)
    return stats, trash_entries


def _replace_selected_prompt_group(out: dict, category_id: str, source_category: dict, incoming_rows: list[dict], group: str, *, transaction_id: str) -> tuple[dict, list[dict]]:
    group = _group_name(group)
    selected = [deepcopy(row) for row in incoming_rows if _group_name(row.get("subcategory")) == group]
    if not selected:
        raise ValueError(f"Incoming pack does not contain selected group “{group}”. Nothing was changed.")
    target = _ensure_category_for_import(out, source_category, category_id)
    live = target.setdefault("prompts", [])
    incoming_ids = {str(row.get("id") or "") for row in selected}
    removed = [deepcopy(row) for row in live if _group_name(row.get("subcategory")) == group and str(row.get("id") or "") not in incoming_ids]
    removed_ids = {str(row.get("id") or "") for row in removed}
    if removed_ids:
        live[:] = [row for row in live if str(row.get("id") or "") not in removed_ids]
    trash_entries = [_trash_entry("prompt", row, category=category_id, reason="replace_selected_group", transaction_id=transaction_id) for row in removed]
    stats = _apply_prompt_rows(out, category_id, source_category, selected, mode="merge")
    stats["deleted"] = len(removed)
    return stats, trash_entries


def _replace_selected_reference_group(out: dict, incoming_rows: list[dict], group: str, *, transaction_id: str) -> tuple[dict, list[dict]]:
    group = _group_name(group)
    selected = [deepcopy(row) for row in incoming_rows if _group_name(row.get("group")) == group]
    if not selected:
        raise ValueError(f"Incoming pack does not contain Reference group “{group}”. Nothing was changed.")
    live = out.setdefault("references", [])
    incoming_ids = {str(row.get("id") or "") for row in selected}
    removed = [deepcopy(row) for row in live if _group_name(row.get("group")) == group and str(row.get("id") or "") not in incoming_ids]
    removed_ids = {str(row.get("id") or "") for row in removed}
    if removed_ids:
        live[:] = [row for row in live if str(row.get("id") or "") not in removed_ids]
    trash_entries = [_trash_entry("reference", row, reason="replace_selected_group", transaction_id=transaction_id) for row in removed]
    stats = _apply_reference_rows(out, selected, mode="merge")
    stats["deleted"] = len(removed)
    return stats, trash_entries


def _validate_replace_selection(cast_rows: list[dict], prompt_sets: list[tuple[str, dict, list[dict]]], reference_rows: list[dict], *, replace_kind: str, replace_category: str, replace_group: str, category_id: str = "") -> None:
    kind = str(replace_kind or "").strip().lower()
    group = _group_name(replace_group)
    if not str(replace_group or "").strip():
        raise ValueError("Replace Selected Group requires an explicitly selected group. Nothing was changed.")
    if kind == "cast":
        if not any(_group_name(row.get("group")) == group for row in cast_rows):
            raise ValueError(f"Incoming pack does not contain Cast group “{group}”. Nothing was changed.")
        return
    if kind in {"reference", "references"}:
        if not any(_group_name(row.get("group")) == group for row in reference_rows):
            raise ValueError(f"Incoming pack does not contain Reference group “{group}”. Nothing was changed.")
        return
    if kind in {"prompt", "category"}:
        requested_category = str(replace_category or category_id or "").strip()
        selected = next(((cid, rows) for cid, _cat, rows in prompt_sets if str(cid) == requested_category), None)
        if selected is None and len(prompt_sets) == 1:
            selected = (prompt_sets[0][0], prompt_sets[0][2])
        if selected is None:
            raise ValueError("Replace Selected Group requires an explicitly selected category. Nothing was changed.")
        _cid, rows = selected
        if not any(_group_name(row.get("subcategory")) == group for row in rows):
            raise ValueError(f"Incoming pack does not contain selected category group “{group}”. Nothing was changed.")
        return
    raise ValueError("Replace Selected Group requires choosing a Cast, Reference, or category group.")


def import_bytes(raw: bytes, scope="pack", category_id="", subcategory="", mode="append", expected_fingerprint="", replace_kind="", replace_category="", replace_group="") -> dict:
    """Apply a reviewed import using loss-resistant semantics.

    append        -> add only genuinely new stable IDs; existing records win.
    merge         -> update matching stable IDs and add new records; unrelated records survive.
    replace_group -> replace exactly one explicitly selected Cast/Reference/category group.

    Generic section/library replacement is intentionally unsupported.
    """
    mode = _normalize_import_mode(mode)
    incoming, thumbs = _read_uploaded_pack(raw)
    incoming, source_info = _annotate_import_provenance(incoming)
    current = load()
    expected = str(expected_fingerprint or "").strip()
    if expected and _pack_fingerprint(current) != expected:
        raise ValueError("the editable pack changed after import review; no changes were made. Review the import again before applying it")

    # Validate scope and destructive selection before touching thumbnails, making
    # a rollback backup, or mutating any persistent state.
    cast_rows, prompt_sets = _scope_content(incoming, scope, category_id, subcategory)
    reference_rows = _reference_rows_for_scope(incoming, scope, cast_rows)
    if mode == "replace_group":
        _validate_replace_selection(
            cast_rows, prompt_sets, reference_rows, replace_kind=replace_kind,
            replace_category=replace_category, replace_group=replace_group,
            category_id=category_id,
        )

    # Existing thumbnail files are never replaced; imported references receive
    # fresh local filenames only after the operation has passed validation.
    incoming = _install_thumbs(thumbs, incoming)
    cast_rows, prompt_sets = _scope_content(incoming, scope, category_id, subcategory)
    reference_rows = _reference_rows_for_scope(incoming, scope, cast_rows)
    out = deepcopy(current)
    tx, backup = _new_transaction(f"pack.import.{mode}", current)
    trash_entries: list[dict] = []
    total = {"new": 0, "updated": 0, "collisions": 0, "name_collisions": 0, "moved": 0, "deleted": 0}

    def add_stats(stats: dict):
        for key in total:
            total[key] += int(stats.get(key) or 0)

    if mode in {"append", "merge"}:
        if cast_rows:
            add_stats(_apply_cast_rows(out, cast_rows, mode=mode))
        if reference_rows:
            add_stats(_apply_reference_rows(out, reference_rows, mode=mode))
        for cid, source_cat, rows in prompt_sets:
            if rows:
                add_stats(_apply_prompt_rows(out, cid, source_cat, rows, mode=mode))
    else:
        kind = str(replace_kind or "").strip().lower()
        group = _group_name(replace_group)
        if not replace_group:
            raise ValueError("Replace Selected Group requires an explicitly selected group. Nothing was changed.")
        if kind == "cast":
            if not cast_rows:
                raise ValueError("This import scope contains no Cast records for the selected group.")
            stats, entries = _replace_selected_cast_group(out, cast_rows, group, transaction_id=tx)
            add_stats(stats); trash_entries.extend(entries)
        elif kind in {"reference", "references"}:
            if not reference_rows:
                raise ValueError("This import scope contains no Reference records for the selected group.")
            stats, entries = _replace_selected_reference_group(out, reference_rows, group, transaction_id=tx)
            add_stats(stats); trash_entries.extend(entries)
        elif kind in {"prompt", "category"}:
            requested_category = str(replace_category or category_id or "").strip()
            selected_set = next(((cid, cat, rows) for cid, cat, rows in prompt_sets if str(cid) == requested_category), None)
            if selected_set is None and len(prompt_sets) == 1:
                selected_set = prompt_sets[0]
            if selected_set is None:
                raise ValueError("Replace Selected Group requires an explicitly selected category.")
            cid, source_cat, rows = selected_set
            stats, entries = _replace_selected_prompt_group(out, cid, source_cat, rows, group, transaction_id=tx)
            add_stats(stats); trash_entries.extend(entries)
        else:
            raise ValueError("Replace Selected Group requires choosing a Cast, Reference, or category group.")

    saved = save(out)
    trash_ids = _push_trash(trash_entries) if trash_entries else []
    details = {
        "mode": mode,
        "scope": scope,
        "source_pack": source_info,
        "summary": total,
        "replace": {"kind": replace_kind, "category": replace_category, "group": replace_group} if mode == "replace_group" else {},
        "trash_ids": trash_ids,
    }
    _commit_transaction(f"pack.import.{mode}", tx, backup, details, reversible=True)
    return saved


def source_packs() -> list[dict]:
    pack = load()
    sources: dict[str, dict] = {}
    def touch(row: dict, kind: str, category: str = "", group: str = ""):
        sid = str(row.get("source_pack_id") or "").strip()
        if not sid:
            return
        name = str(row.get("source_pack") or sid).strip() or sid
        entry = sources.setdefault(sid, {"id": sid, "name": name, "cast": 0, "prompts": 0, "references": 0, "groups": []})
        if kind == "cast": entry["cast"] += 1
        elif kind == "reference": entry["references"] += 1
        else: entry["prompts"] += 1
        descriptor = {"kind": kind, "category": category, "group": group}
        if descriptor not in entry["groups"]:
            entry["groups"].append(descriptor)
    for row in pack.get("cast") or []:
        touch(row, "cast", group=_group_name(row.get("group")))
    for row in pack.get("references") or []:
        touch(row, "reference", group=_group_name(row.get("group")))
    for cat, row in _prompt_rows(pack):
        touch(row, "prompt", category=str(cat.get("id") or ""), group=_group_name(row.get("subcategory")))
    return sorted(sources.values(), key=lambda row: str(row.get("name") or "").lower())


def delete_source_pack(source_pack_id: str, *, permanent: bool = False) -> dict:
    source_pack_id = str(source_pack_id or "").strip()
    if not source_pack_id:
        raise ValueError("Choose an imported pack first")
    pack = load()
    tx, backup = _new_transaction("pack.delete.permanent" if permanent else "pack.trash", pack)
    removed: list[tuple[str, str, dict]] = []
    cast_kept = []
    for row in pack.get("cast") or []:
        if str(row.get("source_pack_id") or "") == source_pack_id:
            removed.append(("cast", "", deepcopy(row)))
        else:
            cast_kept.append(row)
    pack["cast"] = cast_kept
    ref_kept = []
    for row in pack.get("references") or []:
        if str(row.get("source_pack_id") or "") == source_pack_id:
            removed.append(("reference", "", deepcopy(row)))
        else:
            ref_kept.append(row)
    pack["references"] = ref_kept
    for cat in _model(pack).get("categories") or []:
        cid = str(cat.get("id") or "")
        kept = []
        for row in cat.get("prompts") or []:
            if str(row.get("source_pack_id") or "") == source_pack_id:
                removed.append(("prompt", cid, deepcopy(row)))
            else:
                kept.append(row)
        cat["prompts"] = kept
    if not removed:
        raise ValueError("No live reusable records belong to that imported pack")
    saved = save(pack)
    trash_ids = []
    if permanent:
        for _kind, _cat, record in removed:
            _delete_thumbnail_if_unreferenced(_record_thumbnail(record), saved)
    else:
        entries = [_trash_entry(kind, record, category=cat, reason="pack_delete", transaction_id=tx, source_pack_id=source_pack_id) for kind, cat, record in removed]
        trash_ids = _push_trash(entries)
    summary = {"records": len(removed), "cast": sum(1 for kind, _, _ in removed if kind == "cast"), "references": sum(1 for kind, _, _ in removed if kind == "reference"), "prompts": sum(1 for kind, _, _ in removed if kind == "prompt"), "trash_ids": trash_ids}
    _commit_transaction("pack.delete.permanent" if permanent else "pack.trash", tx, backup, {"source_pack_id": source_pack_id, **summary}, reversible=not permanent)
    return {"pack": saved, **summary, "permanent": bool(permanent)}

def delete_cast_group(group: str, *, permanent: bool = False) -> dict:
    group = _group_name(group)
    pack = load()
    rows = pack.setdefault("cast", [])
    removed = [deepcopy(row) for row in rows if _group_name(row.get("group")) == group]
    if not removed:
        raise ValueError("Cast group was not found")
    tx, backup = _new_transaction("cast.group.delete.permanent" if permanent else "cast.group.trash", pack)
    removed_ids = {str(row.get("id") or "") for row in removed}
    pack["cast"] = [row for row in rows if str(row.get("id") or "") not in removed_ids]
    saved = save(pack)
    trash_ids = []
    if permanent:
        for record in removed:
            _delete_thumbnail_if_unreferenced(_record_thumbnail(record), saved)
    else:
        trash_ids = _push_trash([_trash_entry("cast", record, reason="group_delete", transaction_id=tx) for record in removed])
    details = {"group": group, "records": len(removed), "trash_ids": trash_ids}
    _commit_transaction("cast.group.delete.permanent" if permanent else "cast.group.trash", tx, backup, details, reversible=not permanent)
    return {"pack": saved, **details, "permanent": bool(permanent)}


def _prune_trash_live_duplicates(pack: dict) -> int:
    """Drop Trash copies whose exact stable IDs are live after rollback.

    Automatic rollback ZIPs predate Trash snapshots. Without this cleanup a
    restored Library record could coexist with its later Trash copy and look like
    a ghost duplicate. Different-ID handle/name collisions intentionally stay in
    Trash so the user can resolve them deliberately.
    """
    trash = _load_trash()
    items = trash.get("items") or []
    live_cast_ids = {str(row.get("id") or "") for row in pack.get("cast") or [] if str(row.get("id") or "")}
    live_prompt_ids: dict[str, set[str]] = {}
    for cat in _model(pack).get("categories") or []:
        cid = str(cat.get("id") or "")
        live_prompt_ids[cid] = {str(row.get("id") or "") for row in cat.get("prompts") or [] if str(row.get("id") or "")}
    kept = []
    removed = 0
    for entry in items:
        record = entry.get("record") or {}
        rid = str(record.get("id") or "")
        if entry.get("kind") == "cast" and rid and rid in live_cast_ids:
            removed += 1; continue
        if entry.get("kind") == "prompt":
            cid = str(entry.get("category") or "")
            if rid and rid in live_prompt_ids.get(cid, set()):
                removed += 1; continue
        kept.append(entry)
    if removed:
        _save_trash({"format": "z3_minimax_h3_trash_v1", "items": kept})
    return removed


def restore_latest_import_backup() -> dict:
    path = latest_import_backup()
    if path is None:
        raise ValueError("no automatic import backup is available")
    # Restoring is itself destructive. Snapshot the current state *after*
    # selecting the restore target so the user can reverse an accidental restore.
    target_raw = path.read_bytes()
    _create_import_backup(load())
    incoming, thumbs = _read_uploaded_pack(target_raw)
    incoming = _install_thumbs(thumbs, incoming)
    saved = save(incoming)
    _prune_trash_live_duplicates(saved)
    return saved
