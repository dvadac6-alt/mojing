"""Backwards-compatible aggregate: the API implementation now lives in
app/routers/ (split by domain). This module re-exports the combined router plus
the helper names tests import from the old flat module."""
from .routers import api_router as router  # noqa: F401
from .routers.helpers import (  # noqa: F401
    AUTO_VERSION_THROTTLE_SECONDS,
    MAX_AUTO_VERSIONS_PER_CHAPTER,
    _prune_auto_versions,
    _record_auto_version,
)
