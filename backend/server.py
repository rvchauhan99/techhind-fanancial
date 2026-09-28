"""TechHind Company Finance — FastAPI entrypoint."""
from __future__ import annotations

import logging
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

# WeasyPrint (cffi) needs Homebrew dylibs discoverable on macOS
_hb = Path("/opt/homebrew/lib")
if _hb.is_dir():
    _cur = os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "")
    if str(_hb) not in _cur.split(":"):
        os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = (
            f"{_hb}:{_cur}" if _cur else str(_hb)
        )

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from core import client, db
import storage

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from indexes import ensure_indexes
    from seed import seed_all

    try:
        await ensure_indexes()
        await seed_all()
    except Exception as e:
        logger.error(
            "Mongo startup failed (check Atlas Network Access for this host IP): %s", e
        )
    try:
        storage.init_storage()
        logger.info("Object storage initialized backend=%s", storage.active_backend())
    except Exception as e:
        logger.error("Storage init failed: %s", e)
    try:
        import email_service
        logger.info(
            "Email provider=%s configured=%s",
            email_service.active_provider(),
            email_service.is_configured(),
        )
    except Exception as e:
        logger.error("Email service init failed: %s", e)
    import asyncio
    from notifications import reminder_sweep_loop

    stop_reminders = asyncio.Event()
    sweep_task = asyncio.create_task(reminder_sweep_loop(stop_reminders))
    try:
        yield
    finally:
        stop_reminders.set()
        sweep_task.cancel()
        try:
            await sweep_task
        except asyncio.CancelledError:
            pass
        client.close()


app = FastAPI(title="TechHind Company Finance", lifespan=lifespan)

from routers import auth as auth_router
from routers import settings as settings_router
from routers import catalog as catalog_router
from routers import billing as billing_router
from routers import payables as payables_router
from routers import dashboard as dashboard_router
from routers import periods as periods_router
from routers import reports as reports_router
from routers import imports as imports_router
from routers import tickets as tickets_router
from routers import rbac as rbac_router
from routers import work as work_router
from routers import banks as banks_router
from routers import notifications as notifications_router

app.include_router(auth_router.router)
app.include_router(notifications_router.router)
app.include_router(settings_router.router)
app.include_router(catalog_router.router)
app.include_router(billing_router.router)
app.include_router(banks_router.router)
app.include_router(payables_router.router)
app.include_router(dashboard_router.router)
app.include_router(periods_router.router)
app.include_router(reports_router.router)
app.include_router(imports_router.router)
app.include_router(tickets_router.router)
app.include_router(rbac_router.router)
app.include_router(work_router.router)

_origins = [o.strip() for o in (os.environ.get("FRONTEND_URL") or "http://localhost:3000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    from core import client_ip_from_request, set_request_client_ip
    rid = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    request.state.request_id = rid
    ip = client_ip_from_request(request)
    request.state.client_ip = ip
    set_request_client_ip(ip)
    response = await call_next(request)
    response.headers["X-Request-Id"] = rid
    return response


@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception):
    rid = getattr(request.state, "request_id", "-")
    logger.exception("Unhandled error request_id=%s", rid)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "request_id": rid},
    )


@app.get("/health")
async def health():
    return {"status": "ok", "service": "techhind-finance"}


@app.get("/ready")
async def ready():
    try:
        await client.admin.command("ping")
        mongo_ok = True
    except Exception as exc:
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "mongo": str(exc)},
        )
    try:
        storage.init_storage()
        backend = storage.active_backend()
    except Exception as exc:
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "mongo": mongo_ok, "storage": str(exc)},
        )
    import email_service
    return {
        "status": "ready",
        "mongo": True,
        "storage": backend,
        "email_provider": email_service.active_provider(),
        "email_configured": email_service.is_configured(),
        "db": os.environ.get("DB_NAME"),
    }
