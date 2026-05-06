"""Global pin-set storage. JSON file at <user_dir>/default/filehub_pinsets.json.

Schema:
    {
        "<set_name>": {
            "slots": [
                {"type": "input|output|temp", "filename": "...", "subfolder": "", "label": null},
                ...
            ],
            "updated_at": "<iso8601>"
        }
    }
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import datetime, timezone
from threading import RLock

import folder_paths

_LOCK = RLock()
_NAME_RE = re.compile(r"^[A-Za-z0-9_\-. ]{1,64}$")


def _store_dir() -> str:
    return os.path.join(folder_paths.get_user_directory(), "default")


def _store_path() -> str:
    return os.path.join(_store_dir(), "filehub_pinsets.json")


def _load_all_unlocked() -> dict:
    path = _store_path()
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_all_unlocked(data: dict) -> None:
    os.makedirs(_store_dir(), exist_ok=True)
    path = _store_path()
    fd, tmp = tempfile.mkstemp(prefix=".filehub_pinsets.", suffix=".json", dir=_store_dir())
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, sort_keys=True)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def valid_name(name: str) -> bool:
    return isinstance(name, str) and bool(_NAME_RE.match(name))


def list_names() -> list[str]:
    with _LOCK:
        return sorted(_load_all_unlocked().keys())


def get(name: str) -> dict | None:
    with _LOCK:
        return _load_all_unlocked().get(name)


def put(name: str, slots: list) -> dict:
    if not valid_name(name):
        raise ValueError(f"invalid pinset name: {name!r}")
    if not isinstance(slots, list):
        raise ValueError("slots must be a list")
    cleaned = []
    for s in slots:
        if not isinstance(s, dict):
            continue
        t = s.get("type")
        fn = s.get("filename")
        if t not in ("input", "output", "temp") or not isinstance(fn, str) or not fn:
            continue
        cleaned.append({
            "type": t,
            "filename": fn,
            "subfolder": s.get("subfolder", "") or "",
            "label": s.get("label"),
        })
    entry = {"slots": cleaned, "updated_at": datetime.now(timezone.utc).isoformat()}
    with _LOCK:
        data = _load_all_unlocked()
        data[name] = entry
        _save_all_unlocked(data)
    return entry


def delete(name: str) -> bool:
    with _LOCK:
        data = _load_all_unlocked()
        if name not in data:
            return False
        del data[name]
        _save_all_unlocked(data)
        return True
