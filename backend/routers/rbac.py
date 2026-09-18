"""Org roles, menus, and role→menu access."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import (
    ALL_ROLES,
    audit,
    db,
    iso_now,
    new_id,
    require_capability,
    require_roles,
    user_capabilities,
)

router = APIRouter(prefix="/api/rbac", tags=["rbac"])


def _strip(doc: dict | None) -> dict | None:
    if not doc:
        return None
    doc = dict(doc)
    doc.pop("_id", None)
    return doc


class RoleIn(BaseModel):
    key: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=1, max_length=80)
    description: str = ""
    active: bool = True
    can_finance_write: bool = False
    can_finance_admin: bool = False
    can_finance_audit: bool = False
    can_work_write: bool = False
    can_work_manage: bool = False
    can_rbac_admin: bool = False


class RolePatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    active: Optional[bool] = None
    can_finance_write: Optional[bool] = None
    can_finance_admin: Optional[bool] = None
    can_finance_audit: Optional[bool] = None
    can_work_write: Optional[bool] = None
    can_work_manage: Optional[bool] = None
    can_rbac_admin: Optional[bool] = None


class MenuIn(BaseModel):
    key: str = Field(min_length=2, max_length=40)
    label: str = Field(min_length=1, max_length=80)
    path: str = Field(min_length=1, max_length=120)
    section: str = "Core"
    icon: str = "Circle"
    sort_order: int = 100
    active: bool = True


class MenuPatch(BaseModel):
    label: Optional[str] = None
    path: Optional[str] = None
    section: Optional[str] = None
    icon: Optional[str] = None
    sort_order: Optional[int] = None
    active: Optional[bool] = None


class RoleMenusIn(BaseModel):
    menu_keys: List[str]


@router.get("/me")
async def rbac_me(user=Depends(require_roles(*ALL_ROLES))):
    role_key = user.get("role") or ""
    caps = await user_capabilities(user)
    role_row = await db.org_roles.find_one({"key": role_key}, {"_id": 0})
    menu_keys = [
        m["menu_key"]
        async for m in db.role_menus.find({"role_key": role_key}, {"_id": 0, "menu_key": 1})
    ]
    menus = []
    if menu_keys:
        menus = await db.menus.find(
            {"key": {"$in": menu_keys}, "active": {"$ne": False}},
            {"_id": 0},
        ).sort("sort_order", 1).to_list(200)
    return {
        "role": role_key,
        "role_name": (role_row or {}).get("name") or role_key,
        "capabilities": caps,
        "menus": menus,
        "menu_keys": [m["key"] for m in menus],
    }


@router.get("/role-options")
async def role_options(user=Depends(require_roles(*ALL_ROLES))):
    """Active org roles for user-picker dropdowns (any authenticated)."""
    return await db.org_roles.find(
        {"active": {"$ne": False}},
        {"_id": 0, "key": 1, "name": 1},
    ).sort("key", 1).to_list(100)


@router.get("/roles")
async def list_roles(user=Depends(require_capability("can_rbac_admin"))):
    return await db.org_roles.find({}, {"_id": 0}).sort("key", 1).to_list(100)


@router.post("/roles")
async def create_role(body: RoleIn, user=Depends(require_capability("can_rbac_admin"))):
    key = body.key.strip().lower().replace(" ", "_")
    if await db.org_roles.find_one({"key": key}):
        raise HTTPException(status_code=409, detail="Role key already exists")
    now = iso_now()
    doc = {
        "id": new_id(),
        "key": key,
        "name": body.name.strip(),
        "description": body.description or "",
        "is_system": False,
        "active": body.active,
        "can_finance_write": body.can_finance_write,
        "can_finance_admin": body.can_finance_admin,
        "can_finance_audit": body.can_finance_audit,
        "can_work_write": body.can_work_write,
        "can_work_manage": body.can_work_manage,
        "can_rbac_admin": body.can_rbac_admin,
        "created_at": now,
        "updated_at": now,
    }
    await db.org_roles.insert_one(doc)
    await audit(user, "role_created", "org_role", key, f"Role {key} created")
    return _strip(doc)


@router.patch("/roles/{key}")
async def patch_role(key: str, body: RolePatch, user=Depends(require_capability("can_rbac_admin"))):
    existing = await db.org_roles.find_one({"key": key}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Role not found")
    patch = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if existing.get("is_system") and "active" in patch and patch["active"] is False:
        raise HTTPException(status_code=400, detail="Cannot deactivate system role")
    patch["updated_at"] = iso_now()
    await db.org_roles.update_one({"key": key}, {"$set": patch})
    await audit(user, "role_updated", "org_role", key, f"Role {key} updated", diff=patch)
    return await db.org_roles.find_one({"key": key}, {"_id": 0})


@router.get("/menus")
async def list_menus(user=Depends(require_capability("can_rbac_admin"))):
    return await db.menus.find({}, {"_id": 0}).sort("sort_order", 1).to_list(200)


@router.post("/menus")
async def create_menu(body: MenuIn, user=Depends(require_capability("can_rbac_admin"))):
    key = body.key.strip().lower().replace(" ", "_")
    if await db.menus.find_one({"key": key}):
        raise HTTPException(status_code=409, detail="Menu key already exists")
    now = iso_now()
    doc = {
        "id": new_id(),
        "key": key,
        "label": body.label.strip(),
        "path": body.path.strip(),
        "section": body.section or "Core",
        "icon": body.icon or "Circle",
        "sort_order": body.sort_order,
        "active": body.active,
        "created_at": now,
        "updated_at": now,
    }
    await db.menus.insert_one(doc)
    await audit(user, "menu_created", "menu", key, f"Menu {key} created")
    return _strip(doc)


@router.patch("/menus/{key}")
async def patch_menu(key: str, body: MenuPatch, user=Depends(require_capability("can_rbac_admin"))):
    existing = await db.menus.find_one({"key": key}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Menu not found")
    patch = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to update")
    patch["updated_at"] = iso_now()
    await db.menus.update_one({"key": key}, {"$set": patch})
    await audit(user, "menu_updated", "menu", key, f"Menu {key} updated", diff=patch)
    return await db.menus.find_one({"key": key}, {"_id": 0})


@router.get("/roles/{key}/menus")
async def get_role_menus(key: str, user=Depends(require_capability("can_rbac_admin"))):
    if not await db.org_roles.find_one({"key": key}):
        raise HTTPException(status_code=404, detail="Role not found")
    rows = await db.role_menus.find({"role_key": key}, {"_id": 0}).to_list(200)
    return {"role_key": key, "menu_keys": sorted(r["menu_key"] for r in rows)}


@router.put("/roles/{key}/menus")
async def put_role_menus(key: str, body: RoleMenusIn, user=Depends(require_capability("can_rbac_admin"))):
    if not await db.org_roles.find_one({"key": key}):
        raise HTTPException(status_code=404, detail="Role not found")
    valid = {
        m["key"]
        async for m in db.menus.find({"active": {"$ne": False}}, {"_id": 0, "key": 1})
    }
    keys = sorted({k for k in body.menu_keys if k in valid})
    await db.role_menus.delete_many({"role_key": key})
    now = iso_now()
    if keys:
        await db.role_menus.insert_many(
            [
                {
                    "id": new_id(),
                    "role_key": key,
                    "menu_key": mk,
                    "created_at": now,
                    "updated_at": now,
                }
                for mk in keys
            ]
        )
    await audit(
        user,
        "role_menus_updated",
        "org_role",
        key,
        f"Role {key} menus set ({len(keys)})",
        diff={"menu_keys": keys},
    )
    return {"role_key": key, "menu_keys": keys}
