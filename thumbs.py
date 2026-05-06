"""Video first-frame poster extraction. Uses ffmpeg if available; degrades to None otherwise.

Cache layout:
    <pkg>/thumbs_cache/<sha1(src_abspath)>_<mtime_ns>.webp

Lazy cleanup: when a request lands for src X, any stale entries matching the same
sha1 but different mtime are removed.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import subprocess
from threading import RLock

log = logging.getLogger("filehub.thumbs")

_PKG_DIR = os.path.dirname(os.path.abspath(__file__))
_CACHE_DIR = os.path.join(_PKG_DIR, "thumbs_cache")
_LOCK = RLock()
_FFMPEG = shutil.which("ffmpeg")

if _FFMPEG is None:
    log.info("[FileHub] ffmpeg not found on PATH; video posters disabled (icon fallback in UI).")
else:
    log.info("[FileHub] ffmpeg detected at %s; video posters enabled.", _FFMPEG)


def have_ffmpeg() -> bool:
    return _FFMPEG is not None


def _cache_key(src_abspath: str) -> str:
    return hashlib.sha1(src_abspath.encode("utf-8")).hexdigest()[:16]


def _entry_path(key: str, mtime_ns: int) -> str:
    return os.path.join(_CACHE_DIR, f"{key}_{mtime_ns}.webp")


def _cleanup_stale(key: str, keep_mtime_ns: int) -> None:
    if not os.path.isdir(_CACHE_DIR):
        return
    prefix = f"{key}_"
    for name in os.listdir(_CACHE_DIR):
        if not name.startswith(prefix) or not name.endswith(".webp"):
            continue
        if name == f"{key}_{keep_mtime_ns}.webp":
            continue
        try:
            os.unlink(os.path.join(_CACHE_DIR, name))
        except OSError:
            pass


def poster_for(src_abspath: str) -> str | None:
    """Return cached poster path, generating on demand. Returns None if unsupported."""
    if not _FFMPEG or not os.path.isfile(src_abspath):
        return None

    try:
        mtime_ns = os.stat(src_abspath).st_mtime_ns
    except OSError:
        return None

    key = _cache_key(src_abspath)
    out = _entry_path(key, mtime_ns)

    with _LOCK:
        if os.path.isfile(out) and os.path.getsize(out) > 0:
            return out
        os.makedirs(_CACHE_DIR, exist_ok=True)
        # Extract a single frame near the start; -frames:v 1 + scale to 256 wide.
        # -ss before -i seeks fast. -an drops audio. -y overwrites.
        cmd = [
            _FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
            "-ss", "0.5", "-i", src_abspath,
            "-frames:v", "1", "-vf", "scale=256:-2",
            "-q:v", "75", "-an",
            out,
        ]
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=20)
        except (subprocess.SubprocessError, OSError) as e:
            log.warning("[FileHub] ffmpeg invocation failed for %s: %s", src_abspath, e)
            return None
        if r.returncode != 0 or not os.path.isfile(out) or os.path.getsize(out) == 0:
            log.warning(
                "[FileHub] ffmpeg poster failed for %s (rc=%s): %s",
                src_abspath, r.returncode, r.stderr.decode("utf-8", errors="replace")[:300],
            )
            try:
                if os.path.isfile(out):
                    os.unlink(out)
            except OSError:
                pass
            return None

        _cleanup_stale(key, mtime_ns)
        return out
