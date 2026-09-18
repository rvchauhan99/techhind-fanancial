from typing import Optional, List
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel

from core import (db, require_roles, ADMIN_ROLES, ALL_ROLES, audit, new_id, iso_now, hash_password)
import storage

router = APIRouter(prefix="/api", tags=["settings"])


async def _valid_role_key(role: str) -> bool:
    if not role:
        return False
    row = await db.org_roles.find_one({"key": role, "active": {"$ne": False}})
    return bool(row)

MIME = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp",
        "pdf": "application/pdf", "csv": "text/csv", "zip": "application/zip"}


# ---------- Company profile ----------
@router.get("/settings/company")
async def get_company_profile(user=Depends(require_roles(*ALL_ROLES))):
    company = await db.company.find_one({"id": "company"}, {"_id": 0})
    return company or {}


@router.put("/settings/company")
async def put_company_profile(body: dict, user=Depends(require_roles(*ADMIN_ROLES))):
    body.pop("id", None)
    body.pop("_id", None)
    body["updated_at"] = iso_now()
    await db.company.update_one({"id": "company"}, {"$set": body}, upsert=True)
    await audit(user, "company_updated", "company", "company", "Company profile updated")
    return await db.company.find_one({"id": "company"}, {"_id": 0})


ASSET_KINDS = {
    "logo": "logo_path",
    "stamp": "stamp_path",
    "signature": "signature_path",
}
IMAGE_EXTS = {"jpg", "jpeg", "png", "webp"}


async def _upload_company_asset(kind: str, file: UploadFile, user: dict) -> dict:
    if kind not in ASSET_KINDS:
        raise HTTPException(status_code=404, detail="Unknown asset kind (logo|stamp|signature)")
    field = ASSET_KINDS[kind]
    ext = (file.filename or f"{kind}.png").split(".")[-1].lower()
    if ext not in IMAGE_EXTS:
        raise HTTPException(status_code=400, detail="Only jpg, jpeg, png, webp images are allowed")
    ctype = MIME.get(ext, "application/octet-stream")
    path = f"{storage.APP_NAME}/company/{kind}.{ext}"
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    from core import validate_upload
    validate_upload(data, ctype, file.filename or "")
    storage.put_object(path, data, ctype)
    await db.files.insert_one({"id": new_id(), "storage_path": path, "original_filename": file.filename,
                               "content_type": ctype, "size": len(data), "is_deleted": False,
                               "created_at": iso_now()})
    await db.company.update_one({"id": "company"}, {"$set": {field: path}}, upsert=True)
    await audit(user, f"{kind}_uploaded", "company", "company", f"Company {kind} updated")
    return {field: path}


@router.post("/settings/company/assets/{kind}")
async def upload_company_asset(kind: str, file: UploadFile = File(...),
                               user=Depends(require_roles(*ADMIN_ROLES))):
    return await _upload_company_asset(kind.lower().strip(), file, user)


@router.post("/settings/company/logo")
async def upload_logo(file: UploadFile = File(...), user=Depends(require_roles(*ADMIN_ROLES))):
    """Alias for POST /settings/company/assets/logo (backward compatible)."""
    return await _upload_company_asset("logo", file, user)


# ---------- Masters ----------
MASTER_SECTIONS = ("hsn_codes", "tax_rates", "expense_categories", "banks")


@router.get("/settings/masters")
async def get_masters(user=Depends(require_roles(*ALL_ROLES))):
    doc = await db.masters.find_one({"id": "masters"}, {"_id": 0})
    return doc or {"hsn_codes": [], "tax_rates": [], "expense_categories": [], "banks": []}


@router.put("/settings/masters/{section}")
async def put_master_section(section: str, body: list, user=Depends(require_roles(*ADMIN_ROLES))):
    if section not in MASTER_SECTIONS:
        raise HTTPException(status_code=404, detail="Unknown master section")
    await db.masters.update_one({"id": "masters"}, {"$set": {section: body}}, upsert=True)
    await audit(user, "master_updated", "masters", section, f"Master '{section}' updated ({len(body)} items)")
    return {"ok": True, "count": len(body)}


@router.get("/settings/number-series")
async def get_series(user=Depends(require_roles(*ADMIN_ROLES))):
    return await db.number_series.find({}, {"_id": 0}).to_list(100)


# ---------- Users ----------
class UserIn(BaseModel):
    name: str
    email: str
    password: str
    role: str


@router.get("/users")
async def list_users(
    active_only: bool = False,
    user=Depends(require_roles(*ALL_ROLES)),
):
    """Any authenticated user may list users (assignee pickers). Full fields for all."""
    filt: dict = {}
    if active_only:
        filt["active"] = {"$ne": False}
    return await db.users.find(
        filt,
        {"_id": 0, "password_hash": 0, "totp_secret": 0, "totp_pending_secret": 0},
    ).sort("name", 1).to_list(500)


@router.post("/users")
async def create_user(body: UserIn, user=Depends(require_roles(*ADMIN_ROLES))):
    email = body.email.lower().strip()
    if not await _valid_role_key(body.role):
        raise HTTPException(status_code=400, detail="Invalid role")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already exists")
    doc = {"id": new_id(), "name": body.name, "email": email, "role": body.role,
           "password_hash": hash_password(body.password), "active": True,
           "totp_enabled": False, "created_at": iso_now()}
    await db.users.insert_one(doc)
    await audit(user, "user_created", "user", doc["id"], f"User {email} created with role {body.role}")
    doc.pop("password_hash")
    doc.pop("_id", None)
    return doc


@router.patch("/users/{user_id}")
async def update_user(user_id: str, body: dict, user=Depends(require_roles(*ADMIN_ROLES))):
    allowed = {k: v for k, v in body.items() if k in ("name", "role", "active", "department", "title")}
    if "role" in allowed and not await _valid_role_key(allowed["role"]):
        raise HTTPException(status_code=400, detail="Invalid role")
    if not allowed:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = await db.users.update_one({"id": user_id}, {"$set": allowed})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="User not found")
    await audit(user, "user_updated", "user", user_id, f"User updated: {', '.join(allowed.keys())}", diff=allowed)
    return {"ok": True}


@router.post("/users/{user_id}/reset-password")
async def reset_password(user_id: str, body: dict, user=Depends(require_roles(*ADMIN_ROLES))):
    pw = body.get("password", "")
    if len(pw) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    res = await db.users.update_one({"id": user_id}, {"$set": {"password_hash": hash_password(pw)}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="User not found")
    await audit(user, "password_reset", "user", user_id, "Password reset by admin")
    return {"ok": True}


# ---------- Files ----------
@router.get("/files/{path:path}")
async def serve_file(path: str, user=Depends(require_roles(*ALL_ROLES))):
    record = await db.files.find_one({"storage_path": path, "is_deleted": False})
    got = storage.get_object_or_none(path)
    if not got:
        raise HTTPException(status_code=404, detail="File not found")
    data, ctype = got
    return Response(content=data, media_type=(record or {}).get("content_type", ctype))
