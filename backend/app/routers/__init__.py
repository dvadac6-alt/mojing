"""API routers, combined under the /api prefix by the app.routes shim.

Split by domain (was a single ~2100-line routes.py): system / novels /
chapters / entities / maps / ai / rag. helpers.py holds shared converters."""
from fastapi import APIRouter

from .ai import router as ai_router
from .chapters import router as chapters_router
from .entities import router as entities_router
from .maps import router as maps_router
from .novels import router as novels_router
from .rag import router as rag_router
from .system import router as system_router

api_router = APIRouter(prefix="/api")
api_router.include_router(system_router)
api_router.include_router(novels_router)
api_router.include_router(chapters_router)
api_router.include_router(entities_router)
api_router.include_router(maps_router)
api_router.include_router(ai_router)
api_router.include_router(rag_router)
