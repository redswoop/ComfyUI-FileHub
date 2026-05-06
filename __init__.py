from .nodes import FileHubLoader, FileHubSaver
from . import routes  # noqa: F401  (registers HTTP routes on import)

# Raise PIL's PNG tEXt-chunk memory cap. ComfyUI-saved images store the entire
# prompt+workflow JSON in tEXt chunks; large workflows can easily exceed the
# default 64 MB and make /view 500 with "Too much memory used in text chunks".
# This is a per-process global; setting it once at custom-node import time is fine.
try:
    import PIL.PngImagePlugin
    PIL.PngImagePlugin.MAX_TEXT_MEMORY = 512 * 1024 * 1024  # 512 MB
except Exception:
    pass

NODE_CLASS_MAPPINGS = {
    "FileHubLoader": FileHubLoader,
    "FileHubSaver": FileHubSaver,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FileHubLoader": "File Hub Loader",
    "FileHubSaver": "File Hub Saver",
}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
