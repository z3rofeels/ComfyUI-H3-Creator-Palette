"""MiniMax H3 Creator Palette by z3rofeels."""
from . import server_routes  # noqa: F401
from . import refine_routes  # noqa: F401
from . import palette_routes  # noqa: F401
from . import pack_routes  # noqa: F401
from .creator_node import comfy_entrypoint  # noqa: F401

WEB_DIRECTORY = "./js"
__version__ = "3.14.1"
__all__ = ["comfy_entrypoint", "WEB_DIRECTORY", "__version__"]
