"""HTTP routes for ComfyUI-FileHub.

Registered on import via the standard `PromptServer.instance.routes` decorator pattern
used by ComfyUI-Manager.
"""

from __future__ import annotations

import logging
import mimetypes
import os
import shutil
import time

from aiohttp import web

import folder_paths
from server import PromptServer

from . import pinsets, thumbs

log = logging.getLogger("filehub.routes")
routes = PromptServer.instance.routes

TRASH_DIRNAME = ".filehub_trash"
VALID_TYPES = ("input", "output", "temp")


# -- helpers -----------------------------------------------------------------


def _root_for(type_name: str) -> str | None:
    if type_name not in VALID_TYPES:
        return None
    return folder_paths.get_directory_by_type(type_name)


def _safe_join(root: str, *parts: str) -> str | None:
    """Join under `root`, refusing any path that escapes it."""
    candidate = os.path.abspath(os.path.join(root, *parts))
    root_abs = os.path.abspath(root)
    try:
        if os.path.commonpath((root_abs, candidate)) != root_abs:
            return None
    except ValueError:
        return None
    return candidate


def _kind_of(filename: str) -> str:
    mime, _ = mimetypes.guess_type(filename, strict=False)
    if not mime:
        return "other"
    top = mime.split("/")[0]
    if top in ("image", "video", "audio"):
        return top
    return "other"


def _next_available(path: str) -> str:
    """If path exists, return path with `(1)`, `(2)` ... suffix until free."""
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    i = 1
    while True:
        cand = f"{base} ({i}){ext}"
        if not os.path.exists(cand):
            return cand
        i += 1


def _err(status: int, msg: str) -> web.Response:
    return web.json_response({"error": msg}, status=status)


# -- list --------------------------------------------------------------------


@routes.get("/filehub/list")
async def filehub_list(request: web.Request) -> web.Response:
    q = request.rel_url.query
    type_name = q.get("type", "input")
    subfolder = q.get("subfolder", "") or ""
    exts_param = q.get("exts", "")  # comma-separated; empty = all known media
    kinds_param = q.get("kinds", "image,video,audio")
    sort = q.get("sort", "mtime")
    try:
        limit = max(0, int(q.get("limit", "200")))
    except ValueError:
        limit = 200
    try:
        offset = max(0, int(q.get("offset", "0")))
    except ValueError:
        offset = 0

    root = _root_for(type_name)
    if root is None:
        return _err(400, f"invalid type: {type_name}")
    target = _safe_join(root, subfolder)
    if target is None:
        return _err(400, "invalid subfolder")
    if not os.path.isdir(target):
        return web.json_response({"type": type_name, "subfolder": subfolder, "files": [], "subfolders": []})

    allowed_exts: set[str] | None = None
    if exts_param:
        allowed_exts = {e.strip().lower().lstrip(".") for e in exts_param.split(",") if e.strip()}
    allowed_kinds = {k.strip() for k in kinds_param.split(",") if k.strip()}

    files = []
    subfolders = []
    try:
        with os.scandir(target) as it:
            for entry in it:
                if entry.name.startswith(".") or entry.name == TRASH_DIRNAME:
                    continue
                if entry.is_dir():
                    subfolders.append(entry.name)
                    continue
                if not entry.is_file():
                    continue
                ext = os.path.splitext(entry.name)[1].lower().lstrip(".")
                if allowed_exts is not None and ext not in allowed_exts:
                    continue
                kind = _kind_of(entry.name)
                if allowed_kinds and kind not in allowed_kinds:
                    continue
                try:
                    st = entry.stat()
                except OSError:
                    continue
                files.append({
                    "name": entry.name,
                    "subfolder": subfolder,
                    "type": type_name,
                    "mtime": st.st_mtime,
                    "size": st.st_size,
                    "kind": kind,
                })
    except OSError as e:
        log.warning("[FileHub] list failed for %s: %s", target, e)
        return _err(500, f"listing failed: {e}")

    if sort == "name":
        files.sort(key=lambda x: x["name"].lower())
    else:
        files.sort(key=lambda x: x["mtime"], reverse=True)
    subfolders.sort()

    total = len(files)
    page = files[offset:offset + limit] if limit else files[offset:]

    return web.json_response({
        "type": type_name,
        "subfolder": subfolder,
        "files": page,
        "subfolders": subfolders,
        "total": total,
        "offset": offset,
        "limit": limit,
    })


# -- promote (output|temp -> input) -----------------------------------------


@routes.post("/filehub/promote")
async def filehub_promote(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return _err(400, "invalid json body")

    from_type = body.get("from_type")
    from_subfolder = body.get("from_subfolder", "") or ""
    from_filename = body.get("from_filename")
    to_subfolder = body.get("to_subfolder", "") or ""
    new_name = body.get("new_name") or from_filename
    overwrite = bool(body.get("overwrite", False))

    if from_type not in ("output", "temp", "input"):
        return _err(400, f"invalid from_type: {from_type}")
    if not isinstance(from_filename, str) or not from_filename:
        return _err(400, "from_filename required")

    src_root = _root_for(from_type)
    dst_root = _root_for("input")
    if src_root is None or dst_root is None:
        return _err(500, "directory resolution failed")

    src = _safe_join(src_root, from_subfolder, from_filename)
    if src is None or not os.path.isfile(src):
        return _err(404, "source file not found")

    if not isinstance(new_name, str) or not new_name or "/" in new_name or "\\" in new_name:
        return _err(400, "invalid new_name")

    dst_dir = _safe_join(dst_root, to_subfolder)
    if dst_dir is None:
        return _err(400, "invalid to_subfolder")
    os.makedirs(dst_dir, exist_ok=True)
    dst = _safe_join(dst_dir, new_name)
    if dst is None:
        return _err(400, "invalid destination")

    if os.path.exists(dst) and not overwrite:
        dst = _next_available(dst)

    try:
        shutil.copy2(src, dst)
    except OSError as e:
        return _err(500, f"copy failed: {e}")

    return web.json_response({
        "type": "input",
        "subfolder": to_subfolder,
        "filename": os.path.basename(dst),
    })


# -- move (rename / relocate within one source) ------------------------------


@routes.post("/filehub/move")
async def filehub_move(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return _err(400, "invalid json body")

    type_name = body.get("type")
    from_subfolder = body.get("from_subfolder", "") or ""
    from_filename = body.get("from_filename")
    to_subfolder = body.get("to_subfolder", from_subfolder) or ""
    new_name = body.get("new_name") or from_filename
    overwrite = bool(body.get("overwrite", False))

    root = _root_for(type_name)
    if root is None:
        return _err(400, f"invalid type: {type_name}")
    if not isinstance(from_filename, str) or not from_filename:
        return _err(400, "from_filename required")
    if not isinstance(new_name, str) or not new_name or "/" in new_name or "\\" in new_name:
        return _err(400, "invalid new_name")

    src = _safe_join(root, from_subfolder, from_filename)
    if src is None or not os.path.isfile(src):
        return _err(404, "source file not found")

    dst_dir = _safe_join(root, to_subfolder)
    if dst_dir is None:
        return _err(400, "invalid to_subfolder")
    os.makedirs(dst_dir, exist_ok=True)
    dst = _safe_join(dst_dir, new_name)
    if dst is None:
        return _err(400, "invalid destination")

    if os.path.exists(dst) and not overwrite and os.path.abspath(src) != os.path.abspath(dst):
        dst = _next_available(dst)

    try:
        os.replace(src, dst)
    except OSError as e:
        return _err(500, f"move failed: {e}")

    return web.json_response({
        "type": type_name,
        "subfolder": to_subfolder,
        "filename": os.path.basename(dst),
    })


# -- delete (soft, into <source>/.filehub_trash/) ----------------------------


@routes.post("/filehub/delete")
async def filehub_delete(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return _err(400, "invalid json body")

    type_name = body.get("type")
    subfolder = body.get("subfolder", "") or ""
    filename = body.get("filename")

    root = _root_for(type_name)
    if root is None:
        return _err(400, f"invalid type: {type_name}")
    if not isinstance(filename, str) or not filename:
        return _err(400, "filename required")

    src = _safe_join(root, subfolder, filename)
    if src is None or not os.path.isfile(src):
        return _err(404, "source file not found")

    trash_dir = _safe_join(root, TRASH_DIRNAME, subfolder)
    if trash_dir is None:
        return _err(500, "trash path resolution failed")
    os.makedirs(trash_dir, exist_ok=True)

    base = f"{int(time.time())}_{filename}"
    dst = _next_available(os.path.join(trash_dir, base))

    try:
        os.replace(src, dst)
    except OSError as e:
        return _err(500, f"delete failed: {e}")

    return web.json_response({"trashed": dst})


# -- poster (video first-frame) ----------------------------------------------


@routes.get("/filehub/poster")
async def filehub_poster(request: web.Request) -> web.Response:
    q = request.rel_url.query
    type_name = q.get("type", "output")
    subfolder = q.get("subfolder", "") or ""
    filename = q.get("filename", "")

    if not filename:
        return _err(400, "filename required")
    root = _root_for(type_name)
    if root is None:
        return _err(400, f"invalid type: {type_name}")

    src = _safe_join(root, subfolder, filename)
    if src is None or not os.path.isfile(src):
        return _err(404, "source file not found")

    poster = thumbs.poster_for(src)
    if poster is None:
        return _err(204, "no poster available")
    return web.FileResponse(poster, headers={"Cache-Control": "public, max-age=3600"})


# -- pinsets -----------------------------------------------------------------


@routes.get("/filehub/pinsets")
async def filehub_pinsets_list(_request: web.Request) -> web.Response:
    return web.json_response({"names": pinsets.list_names()})


@routes.get(r"/filehub/pinsets/{name}")
async def filehub_pinset_get(request: web.Request) -> web.Response:
    name = request.match_info["name"]
    if not pinsets.valid_name(name):
        return _err(400, "invalid name")
    entry = pinsets.get(name)
    if entry is None:
        return _err(404, "not found")
    return web.json_response({"name": name, **entry})


@routes.put(r"/filehub/pinsets/{name}")
async def filehub_pinset_put(request: web.Request) -> web.Response:
    name = request.match_info["name"]
    if not pinsets.valid_name(name):
        return _err(400, "invalid name")
    try:
        body = await request.json()
    except Exception:
        return _err(400, "invalid json body")
    slots = body.get("slots", [])
    try:
        entry = pinsets.put(name, slots)
    except ValueError as e:
        return _err(400, str(e))
    return web.json_response({"name": name, **entry})


@routes.delete(r"/filehub/pinsets/{name}")
async def filehub_pinset_delete(request: web.Request) -> web.Response:
    name = request.match_info["name"]
    if not pinsets.valid_name(name):
        return _err(400, "invalid name")
    ok = pinsets.delete(name)
    if not ok:
        return _err(404, "not found")
    return web.json_response({"deleted": name})
