"""FileHubLoader / FileHubSaver — load and save with cross-source pin slots.

Frontend (web/) drives both nodes: it writes a JSON blob into a hidden STRING widget
named `selection` (loader) or `target` (saver), and the Python side parses that blob
to figure out what to do.

Selection blob (loader):
    {
        "active": {"type": "input|output|temp", "subfolder": "", "filename": "..."},
        "pins":   [ <slot>, ... ],   # informational; only `active` drives loading
        "active_index": 0
    }

Target blob (saver):
    {
        "destination": "output|input|both",
        "loader_id":   <int|null>,
        "slot":        <int|null>
    }
"""

from __future__ import annotations

import hashlib
import json
import logging
import os

import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence
from PIL.PngImagePlugin import PngInfo

import folder_paths
import node_helpers
from comfy.cli_args import args as comfy_args
import comfy.model_management

log = logging.getLogger("filehub.nodes")


def _empty_image() -> torch.Tensor:
    return torch.zeros((1, 64, 64, 3), dtype=torch.float32)


def _empty_mask() -> torch.Tensor:
    return torch.zeros((1, 64, 64), dtype=torch.float32)


def _resolve_selection(selection_json: str) -> tuple[str, str, str, str] | None:
    """Parse selection blob and resolve `(type, subfolder, filename, abspath)`.

    Returns None if blob is empty / malformed / file missing.
    """
    if not selection_json:
        return None
    try:
        data = json.loads(selection_json)
    except json.JSONDecodeError:
        return None
    active = data.get("active") if isinstance(data, dict) else None
    if not isinstance(active, dict):
        return None
    type_name = active.get("type")
    filename = active.get("filename")
    subfolder = active.get("subfolder", "") or ""
    if type_name not in ("input", "output", "temp") or not isinstance(filename, str) or not filename:
        return None
    root = folder_paths.get_directory_by_type(type_name)
    if root is None:
        return None
    abspath = os.path.abspath(os.path.join(root, subfolder, filename))
    root_abs = os.path.abspath(root)
    try:
        if os.path.commonpath((root_abs, abspath)) != root_abs:
            return None
    except ValueError:
        return None
    if not os.path.isfile(abspath):
        return None
    return type_name, subfolder, filename, abspath


# -- Loader ------------------------------------------------------------------


class FileHubLoader:
    """Loads an image (or surfaces a path for video/audio) selected by the frontend.

    The frontend's pin/recents UI updates the hidden `selection` widget; the backend
    just resolves whichever file is currently active.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "selection": ("STRING", {"default": "{}", "multiline": False}),
            },
        }

    CATEGORY = "image"
    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "STRING")
    RETURN_NAMES = ("image", "mask", "path", "kind")
    FUNCTION = "load"

    @classmethod
    def IS_CHANGED(cls, selection):
        resolved = _resolve_selection(selection)
        if resolved is None:
            return float("NaN")  # always re-run to surface the error to the user
        _, _, _, abspath = resolved
        try:
            st = os.stat(abspath)
        except OSError:
            return float("NaN")
        h = hashlib.sha256()
        h.update(abspath.encode("utf-8"))
        h.update(f":{st.st_mtime_ns}:{st.st_size}".encode("utf-8"))
        return h.hexdigest()

    @classmethod
    def VALIDATE_INPUTS(cls, selection):
        # Tolerate empty selection so the node validates while user picks a file.
        if not selection or selection == "{}":
            return True
        if _resolve_selection(selection) is None:
            return "FileHubLoader: selected file not found or invalid."
        return True

    def load(self, selection):
        resolved = _resolve_selection(selection)
        if resolved is None:
            return (_empty_image(), _empty_mask(), "", "")

        type_name, subfolder, filename, abspath = resolved
        ext = os.path.splitext(filename)[1].lower()
        annotated = filename
        if subfolder:
            annotated = f"{subfolder}/{filename}"
        annotated = f"{annotated} [{type_name}]"

        # Image branch: mirror stock LoadImage.
        if ext in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".tif"):
            try:
                img = node_helpers.pillow(Image.open, abspath)
            except Exception as e:
                log.warning("[FileHub] failed to open %s: %s", abspath, e)
                return (_empty_image(), _empty_mask(), abspath, "other")

            output_images, output_masks = [], []
            w = h = None
            dtype = comfy.model_management.intermediate_dtype()

            for i in ImageSequence.Iterator(img):
                i = node_helpers.pillow(ImageOps.exif_transpose, i)
                if i.mode == "I":
                    i = i.point(lambda v: v * (1 / 255))
                rgb = i.convert("RGB")
                if w is None:
                    w, h = rgb.size
                if rgb.size != (w, h):
                    continue
                arr = np.array(rgb).astype(np.float32) / 255.0
                tensor = torch.from_numpy(arr)[None,]
                if "A" in i.getbands():
                    mask = np.array(i.getchannel("A")).astype(np.float32) / 255.0
                    mask_t = 1.0 - torch.from_numpy(mask)
                elif i.mode == "P" and "transparency" in i.info:
                    mask = np.array(i.convert("RGBA").getchannel("A")).astype(np.float32) / 255.0
                    mask_t = 1.0 - torch.from_numpy(mask)
                else:
                    mask_t = torch.zeros((64, 64), dtype=torch.float32, device="cpu")
                output_images.append(tensor.to(dtype=dtype))
                output_masks.append(mask_t.unsqueeze(0).to(dtype=dtype))
                if img.format == "MPO":
                    break

            if not output_images:
                return (_empty_image(), _empty_mask(), abspath, "image")
            if len(output_images) > 1:
                out_img = torch.cat(output_images, dim=0)
                out_msk = torch.cat(output_masks, dim=0)
            else:
                out_img, out_msk = output_images[0], output_masks[0]
            return (out_img, out_msk, abspath, "image")

        # Video / audio branch: just surface the path; downstream nodes (VHS, etc.)
        # consume it. Empty image+mask placeholders keep the output shape stable.
        if ext in (".mp4", ".mov", ".webm", ".mkv", ".avi"):
            return (_empty_image(), _empty_mask(), abspath, "video")
        if ext in (".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"):
            return (_empty_image(), _empty_mask(), abspath, "audio")

        return (_empty_image(), _empty_mask(), abspath, "other")


# -- Saver -------------------------------------------------------------------


class FileHubSaver:
    """Save images to output/, input/, or both. Optionally pin into a target loader slot.

    The `target` widget is JSON: {"destination": ..., "loader_id": int|null, "slot": int|null}.
    """

    def __init__(self):
        self.compress_level = 4

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "Images to save."}),
                "filename_prefix": ("STRING", {
                    "default": "FileHub",
                    "tooltip": (
                        "Filename prefix. Supports subfolders ('myproj/img_'), "
                        "%width% / %height%, %year% / %month% / %day% / %hour% / "
                        "%minute% / %second%, %date:yyyy-MM-dd% custom formats, "
                        "and %NodeName.field% to pull values from other nodes "
                        "(e.g. %Empty Latent Image.width%)."
                    ),
                }),
                "target": ("STRING", {"default": '{"destination":"output"}', "multiline": False}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("path",)
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "image"

    @staticmethod
    def _parse_target(target_json: str) -> dict:
        try:
            data = json.loads(target_json) if target_json else {}
        except json.JSONDecodeError:
            data = {}
        if not isinstance(data, dict):
            data = {}
        dest = data.get("destination")
        if dest not in ("output", "input", "both", "skip"):
            dest = "output"
        loader_id = data.get("loader_id")
        if not isinstance(loader_id, int):
            loader_id = None
        slot = data.get("slot")
        if not isinstance(slot, int) or slot < 0:
            slot = None
        return {"destination": dest, "loader_id": loader_id, "slot": slot}

    def _save_one(self, image_tensor, base_dir: str, filename_prefix: str,
                  metadata: PngInfo | None, batch_num: int) -> tuple[str, str, str]:
        """Save one image, return (full_path, filename, subfolder)."""
        h, w = image_tensor.shape[0], image_tensor.shape[1]
        full_dir, fname, counter, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, base_dir, w, h
        )
        i = 255.0 * image_tensor.cpu().numpy()
        img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
        fname_with_batch = fname.replace("%batch_num%", str(batch_num))
        out_name = f"{fname_with_batch}_{counter:05}_.png"
        full_path = os.path.join(full_dir, out_name)
        img.save(full_path, pnginfo=metadata, compress_level=self.compress_level)
        return full_path, out_name, subfolder

    def save(self, images, filename_prefix="FileHub", target='{"destination":"output"}',
             prompt=None, extra_pnginfo=None):
        cfg = self._parse_target(target)
        dest = cfg["destination"]

        # Skip mode: do nothing, return empty path. Lets users keep the saver
        # in a workflow but no-op specific runs without bypassing the node.
        if dest == "skip":
            return {"ui": {"images": []}, "result": ("",)}

        results = []
        first_for_pin: dict | None = None
        first_full_path: str | None = None

        for batch_idx, image in enumerate(images):
            metadata = None
            if not comfy_args.disable_metadata:
                metadata = PngInfo()
                if prompt is not None:
                    metadata.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo:
                    for k, v in extra_pnginfo.items():
                        metadata.add_text(k, json.dumps(v))

            written_paths: list[tuple[str, str, str, str]] = []  # (type, full, name, sub)

            if dest in ("output", "both"):
                full, name, sub = self._save_one(
                    image, folder_paths.get_output_directory(),
                    filename_prefix, metadata, batch_idx,
                )
                written_paths.append(("output", full, name, sub))
                results.append({"filename": name, "subfolder": sub, "type": "output"})

            if dest in ("input", "both"):
                full, name, sub = self._save_one(
                    image, folder_paths.get_input_directory(),
                    filename_prefix, metadata, batch_idx,
                )
                written_paths.append(("input", full, name, sub))
                # Don't surface input writes in the standard `images` UI list — the
                # frontend's recents row is for outputs.

            if first_for_pin is None and written_paths:
                # Prefer the input-target write for pinning if present (since pins
                # most naturally reference inputs); else fall back to output.
                pick = next((w for w in written_paths if w[0] == "input"), written_paths[0])
                first_for_pin = {"type": pick[0], "filename": pick[2], "subfolder": pick[3]}
                first_full_path = pick[1]

        # Push pin update to the loader if requested.
        if cfg["loader_id"] is not None and cfg["slot"] is not None and first_for_pin is not None:
            try:
                from server import PromptServer
                PromptServer.instance.send_sync(
                    "filehub.pin_update",
                    {
                        "loader_id": cfg["loader_id"],
                        "slot": cfg["slot"],
                        "pin": first_for_pin,
                    },
                )
            except Exception as e:
                log.warning("[FileHub] failed to send pin_update event: %s", e)

        return {"ui": {"images": results}, "result": (first_full_path or "",)}
