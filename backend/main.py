import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import SessionLocal, init_db
from app.routes import router
from app.seed import seed_demo_workspace


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    with SessionLocal() as database:
        seed_demo_workspace(database)
    yield


app = FastAPI(title="Mojing Local API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=False)
