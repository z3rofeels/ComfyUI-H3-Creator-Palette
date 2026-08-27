"""HTTP API for editable H3 starter/Cast packs."""
from __future__ import annotations

import io
import json
import re
from urllib.parse import quote

from aiohttp import web
from server import PromptServer

from . import pack_store

routes = PromptServer.instance.routes


def _json_pack(pack, transaction=None):
    payload={"ok": True, "pack": pack, "catalog": pack.get("catalog", {}), "cast": pack.get("cast", [])}
    if transaction: payload["transaction"] = transaction
    return web.json_response(payload)


def _tx_id():
    row=pack_store.latest_transaction()
    return str((row or {}).get("transaction_id") or "")


def _new_tx(before_id: str):
    row=pack_store.latest_transaction()
    return row if row and str(row.get("transaction_id") or "") != str(before_id or "") else None


@routes.get("/z3_minimax_creator/h3_pack")
async def get_pack(request):
    try:
        return _json_pack(pack_store.load())
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.get("/z3_minimax_creator/h3_pack/integrity")
async def get_pack_integrity(request):
    try:
        return web.json_response({"ok": True, "report": pack_store.audit_integrity()})
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.post("/z3_minimax_creator/h3_pack/integrity/repair")
async def repair_pack_integrity(request):
    try:
        result = pack_store.repair_integrity()
        return web.json_response({"ok": True, **result})
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.post("/z3_minimax_creator/h3_pack/reset")
async def reset_pack(request):
    try:
        return _json_pack(pack_store.reset())
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.post("/z3_minimax_creator/h3_pack/prompt")
async def save_prompt(request):
    try:
        body = await request.json(); before=_tx_id()
        item = pack_store.upsert_prompt(body.get("category"), body.get("item") or {})
        return web.json_response({"ok": True, "item": item, "transaction": _new_tx(before)})
    except (ValueError, KeyError) as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.post("/z3_minimax_creator/h3_pack/prompt/delete")
async def delete_prompt(request):
    try:
        body = await request.json(); before=_tx_id()
        result = pack_store.delete_prompt_record(body.get("category"), body.get("id"), permanent=bool(body.get("permanent")))
        return web.json_response({"ok": True, **result, "transaction": _new_tx(before)})
    except (ValueError, KeyError) as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)


@routes.post("/z3_minimax_creator/h3_pack/cast")
async def save_cast(request):
    try:
        body = await request.json(); before=_tx_id()
        item = pack_store.upsert_cast(body.get("item") or {})
        return web.json_response({"ok": True, "item": item, "transaction": _new_tx(before)})
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.post("/z3_minimax_creator/h3_pack/cast/delete")
async def delete_cast(request):
    try:
        body = await request.json(); before=_tx_id()
        result = pack_store.delete_cast_record(body.get("handle") or "", item_id=body.get("id") or "", permanent=bool(body.get("permanent")))
        return web.json_response({"ok": True, **result, "transaction": _new_tx(before)})
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.post("/z3_minimax_creator/h3_pack/reference")
async def save_reference(request):
    try:
        body = await request.json(); before=_tx_id()
        item = pack_store.upsert_reference(body.get("item") or {})
        return web.json_response({"ok": True, "item": item, "transaction": _new_tx(before)})
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.post("/z3_minimax_creator/h3_pack/reference/delete")
async def delete_reference(request):
    try:
        body = await request.json(); before=_tx_id()
        result = pack_store.delete_reference_record(body.get("id") or "", permanent=bool(body.get("permanent")))
        return web.json_response({"ok": True, **result, "transaction": _new_tx(before)})
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.get("/z3_minimax_creator/h3_pack/trash")
async def get_pack_trash(request):
    try:
        return web.json_response({"ok": True, **pack_store.trash_status()})
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.post("/z3_minimax_creator/h3_pack/trash/restore")
async def restore_pack_trash(request):
    try:
        body = await request.json(); before=_tx_id()
        result = pack_store.restore_trash_item(body.get("trash_id") or "")
        return web.json_response({"ok": True, "pack": result["pack"], "restored": result["restored"], "transaction": _new_tx(before)})
    except (ValueError, KeyError) as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.post("/z3_minimax_creator/h3_pack/trash/empty")
async def empty_pack_trash(request):
    try:
        before=_tx_id(); result=pack_store.empty_trash()
        return web.json_response({"ok": True, **result, "transaction": _new_tx(before)})
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.post("/z3_minimax_creator/h3_pack/trash/delete")
async def permanently_delete_pack_trash_item(request):
    try:
        body = await request.json(); before=_tx_id(); result=pack_store.permanently_delete_trash_item(body.get("trash_id") or "")
        return web.json_response({"ok": True, **result, "transaction": _new_tx(before)})
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.post("/z3_minimax_creator/h3_pack/cast/group/delete")
async def delete_cast_group(request):
    try:
        body = await request.json(); before=_tx_id()
        result = pack_store.delete_cast_group(body.get("group") or "", permanent=bool(body.get("permanent")))
        return web.json_response({"ok": True, **result, "transaction": _new_tx(before)})
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.get("/z3_minimax_creator/h3_pack/sources")
async def get_pack_sources(request):
    try:
        return web.json_response({"ok": True, "sources": pack_store.source_packs()})
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.post("/z3_minimax_creator/h3_pack/source/delete")
async def delete_pack_source(request):
    try:
        body = await request.json(); before=_tx_id()
        result = pack_store.delete_source_pack(body.get("source_pack_id") or "", permanent=bool(body.get("permanent")))
        return web.json_response({"ok": True, **result, "transaction": _new_tx(before)})
    except (ValueError, KeyError) as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.get("/z3_minimax_creator/h3_pack/transactions")
async def get_pack_transactions(request):
    try:
        limit = int(request.query.get("limit", "50"))
        return web.json_response({"ok": True, "transactions": pack_store.mutation_journal(limit)})
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.post("/z3_minimax_creator/h3_pack/history/apply")
async def apply_pack_history(request):
    try:
        body=await request.json(); result=pack_store.apply_history_transaction(body.get("transaction_id") or "", body.get("direction") or "undo")
        return web.json_response({"ok": True, **result})
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


async def _multipart(request):
    reader = await request.multipart()
    fields = {}
    raw = b""
    async for part in reader:
        if part.name == "file":
            raw = await part.read(decode=False)
        else:
            fields[part.name] = (await part.text()).strip()
    return fields, raw


@routes.post("/z3_minimax_creator/h3_pack/thumbnail")
async def set_pack_thumbnail(request):
    try:
        fields, raw = await _multipart(request)
        if not raw:
            raise ValueError("choose a local image first")
        before=_tx_id(); rel = pack_store.set_thumbnail(fields.get("kind") or "prompt", fields.get("category") or "", fields.get("id") or "", raw)
        return web.json_response({"ok": True, "thumbnail": rel, "transaction": _new_tx(before)})
    except (ValueError, KeyError) as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.post("/z3_minimax_creator/h3_pack/thumbnail/delete")
async def delete_pack_thumbnail(request):
    try:
        body = await request.json()
        before=_tx_id(); changed = pack_store.remove_thumbnail(body.get("kind") or "prompt", body.get("category") or "", body.get("id") or "")
        return web.json_response({"ok": True, "deleted": changed, "transaction": _new_tx(before)})
    except (ValueError, KeyError) as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)


@routes.get("/z3_minimax_creator/h3_pack/thumb")
async def get_pack_thumbnail(request):
    path = pack_store.thumbnail_path(request.query.get("file", ""))
    if not path:
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers={"Cache-Control": "private, max-age=3600"})


@routes.get("/z3_minimax_creator/h3_pack/export")
async def export_pack(request):
    try:
        scope = request.query.get("scope", "pack")
        category = request.query.get("category", "")
        subcategory = request.query.get("subcategory", "")
        item_id = request.query.get("id", "")
        raw = pack_store.export_bytes(scope, category, subcategory, item_id)
        name = re.sub(r"[^A-Za-z0-9_.-]+", "-", f"MiniMax-H3-{scope}-{item_id or subcategory or category or 'pack'}").strip("-") + ".zip"
        return web.Response(body=raw, content_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"'})
    except (ValueError, KeyError) as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)


@routes.post("/z3_minimax_creator/h3_pack/import/inspect")
async def inspect_pack_import(request):
    try:
        fields, raw = await _multipart(request)
        if not raw:
            raise ValueError("choose a .zip or .json pack first")
        report = pack_store.inspect_bytes(raw, fields.get("scope") or "pack", fields.get("category") or "", fields.get("subcategory") or "")
        return web.json_response({"ok": True, "report": report})
    except (ValueError, KeyError, json.JSONDecodeError) as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.get("/z3_minimax_creator/h3_pack/import/backup")
async def import_backup_status(request):
    try:
        return web.json_response({"ok": True, **pack_store.import_backup_status()})
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.post("/z3_minimax_creator/h3_pack/import/undo")
async def undo_pack_import(request):
    try:
        return _json_pack(pack_store.restore_latest_import_backup())
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


@routes.post("/z3_minimax_creator/h3_pack/import")
async def import_pack(request):
    try:
        fields, raw = await _multipart(request)
        if not raw:
            raise ValueError("choose a .zip or .json pack first")
        mode = fields.get("mode") or "append"
        before=_tx_id()
        pack = pack_store.import_bytes(
            raw, fields.get("scope") or "pack", fields.get("category") or "", fields.get("subcategory") or "",
            mode=mode, expected_fingerprint=fields.get("expected_fingerprint") or "", replace_kind=fields.get("replace_kind") or "",
            replace_category=fields.get("replace_category") or "", replace_group=fields.get("replace_group") or "",
        )
        return _json_pack(pack, _new_tx(before))
    except (ValueError, KeyError, json.JSONDecodeError) as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)
