import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import uuid
import logging
import contextvars
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta, date
from fastapi import HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_ALGORITHM = "HS256"
ROLES = ["admin", "accountant", "ops", "viewer"]  # legacy finance roles; org_roles is source of truth
ALL_ROLES = ("admin", "accountant", "ops", "viewer")
WRITER_ROLES = ("admin", "accountant", "ops")
FINANCE_ROLES = ("admin", "accountant")
ADMIN_ROLES = ("admin",)

# Legacy capability fallback when org_roles row missing
_LEGACY_CAPS = {
    "admin": dict(
        can_finance_write=True, can_finance_admin=True, can_finance_audit=True,
        can_work_write=True, can_work_manage=True, can_rbac_admin=True,
        can_ticket_write=True,
    ),
    "accountant": dict(
        can_finance_write=True, can_finance_admin=False, can_finance_audit=True,
        can_work_write=False, can_work_manage=False, can_rbac_admin=False,
        can_ticket_write=True,
    ),
    "ops": dict(
        can_finance_write=True, can_finance_admin=False, can_finance_audit=False,
        can_work_write=True, can_work_manage=False, can_rbac_admin=False,
        can_ticket_write=True,
    ),
    "viewer": dict(
        can_finance_write=False, can_finance_admin=False, can_finance_audit=False,
        can_work_write=False, can_work_manage=False, can_rbac_admin=False,
        can_ticket_write=False,
    ),
    "support_agent": dict(
        can_finance_write=False, can_finance_admin=False, can_finance_audit=False,
        can_work_write=False, can_work_manage=False, can_rbac_admin=False,
        can_ticket_write=True,
    ),
}

_logger = logging.getLogger("core")
_client_ip: contextvars.ContextVar[str] = contextvars.ContextVar("client_ip", default="")


def jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user: dict) -> str:
    payload = {"sub": user["id"], "email": user["email"], "role": user["role"], "type": "access",
               "exp": datetime.now(timezone.utc) + timedelta(minutes=15)}
    return jwt.encode(payload, jwt_secret(), algorithm=JWT_ALGORITHM)


def _secure_cookies() -> bool:
    flag = (os.environ.get("SECURE_COOKIES") or "true").strip().lower()
    return flag not in ("0", "false", "no", "off")


def set_auth_cookies(response, user: dict):
    access = create_access_token(user)
    refresh, jti, exp = create_refresh_token(user["id"])
    secure = _secure_cookies()
    response.set_cookie(key="access_token", value=access, httponly=True, secure=secure,
                        samesite="lax" if not secure else "none", max_age=900, path="/")
    response.set_cookie(key="refresh_token", value=refresh, httponly=True, secure=secure,
                        samesite="lax" if not secure else "none", max_age=604800, path="/")
    return access


def create_refresh_token(user_id: str) -> tuple:
    jti = str(uuid.uuid4())
    exp = datetime.now(timezone.utc) + timedelta(days=7)
    payload = {"sub": user_id, "type": "refresh", "jti": jti, "exp": exp}
    token = jwt.encode(payload, jwt_secret(), algorithm=JWT_ALGORITHM)
    return token, jti, exp


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utcnow().isoformat()


def today() -> date:
    return utcnow().date()


def decode_access_token(token: str) -> dict:
    payload = jwt.decode(token, jwt_secret(), algorithms=[JWT_ALGORITHM])
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    return payload


def client_ip_from_request(request: Request) -> str:
    xff = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    if xff:
        return xff
    if request.client and request.client.host:
        return request.client.host
    return ""


def set_request_client_ip(ip: str) -> None:
    _client_ip.set(ip or "")


def get_request_client_ip() -> str:
    return _client_ip.get() or ""


async def revoke_refresh_jti(jti: str, exp: datetime):
    if not jti:
        return
    await db.revoked_refresh.update_one(
        {"jti": jti},
        {"$set": {"jti": jti, "exp": exp}},
        upsert=True,
    )


async def is_refresh_revoked(jti: str) -> bool:
    if not jti:
        return True
    return bool(await db.revoked_refresh.find_one({"jti": jti}))


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    # Query-string auth removed — tokens must not appear in URLs/logs
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0, "totp_secret": 0, "totp_pending_secret": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="User disabled")
    return user


def month_date_range(month: str) -> dict:
    """Index-friendly ISO date range for YYYY-MM (no regex)."""
    y, m = int(month[:4]), int(month[5:7])
    start = f"{y}-{m:02d}-01"
    if m == 12:
        end = f"{y + 1}-01-01"
    else:
        end = f"{y}-{m + 1:02d}-01"
    return {"$gte": start, "$lt": end}


MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES") or 5 * 1024 * 1024)
ALLOWED_UPLOAD_MIME = {
    "image/png", "image/jpeg", "image/webp", "application/pdf",
    "text/csv", "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def validate_upload(content: bytes, content_type: str | None, filename: str = ""):
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_UPLOAD_BYTES} bytes)")
    ctype = (content_type or "application/octet-stream").split(";")[0].strip().lower()
    if ctype and ctype not in ALLOWED_UPLOAD_MIME:
        raise HTTPException(status_code=400, detail=f"MIME type not allowed: {ctype}")
    return ctype


def _require_mongo_transactions() -> bool:
    flag = (os.environ.get("REQUIRE_MONGO_TRANSACTIONS") or "").strip().lower()
    if flag in ("1", "true", "yes", "on"):
        return True
    env = (os.environ.get("ENV") or os.environ.get("APP_ENV") or "").strip().lower()
    return env in ("production", "prod")


async def run_in_transaction(fn):
    """Run async fn(session). Falls back to no-session only when not fail-closed."""
    try:
        async with await client.start_session() as session:
            async with session.start_transaction():
                return await fn(session)
    except HTTPException:
        raise
    except Exception as exc:
        msg = str(exc).lower()
        is_txn = "transaction" in msg or "replica" in msg or "illegal" in msg
        if is_txn and not _require_mongo_transactions():
            _logger.warning("Mongo transaction unavailable — falling back to non-atomic writes: %s", exc)
            return await fn(None)
        if is_txn and _require_mongo_transactions():
            _logger.error("Mongo transactions required but unavailable: %s", exc)
            raise HTTPException(
                status_code=503,
                detail="Database transactions unavailable — replica set required",
            ) from exc
        raise


def require_roles(*roles):
    """Legacy role guard with org-capability compatibility.

    - ALL_ROLES → any authenticated user (org employee roles included)
    - WRITER_ROLES → role in set OR can_finance_write
    - FINANCE_ROLES → role in set OR can_finance_audit / can_finance_write
    - ADMIN_ROLES → role in set OR can_finance_admin
    """
    role_set = set(roles)

    async def dep(request: Request):
        user = await get_current_user(request)
        role = user.get("role") or ""
        if role in role_set:
            return user
        if role_set == set(ALL_ROLES):
            return user
        caps = await user_capabilities(user)
        if role_set == set(WRITER_ROLES) and caps.get("can_finance_write"):
            return user
        if role_set == set(FINANCE_ROLES) and (
            caps.get("can_finance_write") or caps.get("can_finance_audit")
        ):
            return user
        if role_set == set(ADMIN_ROLES) and caps.get("can_finance_admin"):
            return user
        raise HTTPException(
            status_code=403,
            detail="Insufficient permissions for role: " + role,
        )

    return dep


async def get_org_role(role_key: str) -> dict | None:
    if not role_key:
        return None
    return await db.org_roles.find_one({"key": role_key, "active": {"$ne": False}}, {"_id": 0})


async def user_capabilities(user: dict) -> dict:
    role_key = user.get("role") or ""
    row = await get_org_role(role_key)
    if row:
        return {
            "can_finance_write": bool(row.get("can_finance_write")),
            "can_finance_admin": bool(row.get("can_finance_admin")),
            "can_finance_audit": bool(row.get("can_finance_audit")),
            "can_work_write": bool(row.get("can_work_write")),
            "can_work_manage": bool(row.get("can_work_manage")),
            "can_rbac_admin": bool(row.get("can_rbac_admin")),
            "can_ticket_write": bool(row.get("can_ticket_write")),
        }
    return dict(_LEGACY_CAPS.get(role_key, _LEGACY_CAPS["viewer"]))


def require_capability(cap: str):
    async def dep(request: Request):
        user = await get_current_user(request)
        caps = await user_capabilities(user)
        if not caps.get(cap):
            raise HTTPException(status_code=403, detail=f"Missing capability: {cap}")
        return user

    return dep


def field_diff(before: dict, after: dict, keys: list) -> dict:
    """Field-level {field: {old, new}} for activity history."""
    out = {}
    for k in keys:
        b, a = before.get(k), after.get(k)
        if b != a:
            out[k] = {"old": b, "new": a}
    return out


async def audit(user: dict, action: str, entity_type: str, entity_id: str, summary: str,
                diff: dict = None, ip: str = None):
    resolved_ip = ip if ip is not None else get_request_client_ip()
    await db.audit_logs.insert_one({
        "id": new_id(), "ts": iso_now(),
        "user_id": user.get("id"), "user_name": user.get("name"), "role": user.get("role"),
        "ip": resolved_ip or "",
        "action": action, "entity_type": entity_type, "entity_id": entity_id,
        "summary": summary, "diff": diff or {},
    })


def fy_of(d: date) -> str:
    y = d.year if d.month >= 4 else d.year - 1
    return f"{y}-{str(y + 1)[2:]}"


SERIES_PREFIX = {"INV": "TH", "CN": "TH/CN", "DN": "TH/DN", "RCP": "TH/RCP", "EV": "TH/EV", "VP": "TH/VP", "SUP": "SUP", "PRJ": "PRJ", "TSK": "TSK"}


async def next_number(kind: str, on: date, session=None) -> str:
    fy = fy_of(on)
    opts = {"session": session} if session is not None else {}
    doc = await db.number_series.find_one_and_update(
        {"kind": kind, "fy": fy}, {"$inc": {"next_seq": 1}}, upsert=True,
        return_document=True, **opts)
    return f"{SERIES_PREFIX[kind]}/{fy}/{(doc.get('next_seq') or 1):04d}"


async def get_company() -> dict:
    company = await db.company.find_one({"id": "company"}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=400, detail="Company profile not configured")
    return company


async def assert_period_open(date_str: str, user: dict):
    month = (date_str or "")[:7]
    if not month:
        return
    p = await db.periods.find_one({"month": month}, {"_id": 0})
    state = (p or {}).get("state", "open")
    if state in ("gst_filed", "closed"):
        raise HTTPException(status_code=403,
                            detail=f"Period {month} is {state.replace('_', ' ')} — postings locked")
    if state == "in_review" and user.get("role") != "admin":
        raise HTTPException(status_code=403,
                            detail=f"Period {month} is in review — only Admin can post")


def add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    days_in = [31, 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28,
               31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return date(y, m, min(d.day, days_in))


CYCLE_MONTHS = {"monthly": 1, "quarterly": 3, "half_yearly": 6, "yearly": 12, "one_time": 0}
