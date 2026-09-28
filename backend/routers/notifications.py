"""Inbox read API. Writes go through notifications.notify_users."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from core import ALL_ROLES, db, iso_now, require_roles
from notifications import public_notification

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    unread: int = Query(0),
    limit: int = Query(30, ge=1, le=100),
    user=Depends(require_roles(*ALL_ROLES)),
):
    filt: dict = {"user_id": user["id"]}
    if unread:
        filt["read"] = False
    rows = await db.notifications.find(filt, {"_id": 0}).sort("ts", -1).to_list(limit)
    return [public_notification(r) for r in rows]


@router.get("/unread-count")
async def unread_count(user=Depends(require_roles(*ALL_ROLES))):
    n = await db.notifications.count_documents({"user_id": user["id"], "read": False})
    return {"count": n}


@router.post("/read-all")
async def read_all(user=Depends(require_roles(*ALL_ROLES))):
    now = iso_now()
    res = await db.notifications.update_many(
        {"user_id": user["id"], "read": False},
        {"$set": {"read": True, "read_at": now}},
    )
    return {"updated": res.modified_count}


@router.post("/{nid}/read")
async def mark_read(nid: str, user=Depends(require_roles(*ALL_ROLES))):
    now = iso_now()
    res = await db.notifications.update_one(
        {"id": nid, "user_id": user["id"], "read": False},
        {"$set": {"read": True, "read_at": now}},
    )
    if res.matched_count == 0:
        existing = await db.notifications.find_one(
            {"id": nid, "user_id": user["id"]},
            {"_id": 0},
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Notification not found")
        return public_notification(existing)
    doc = await db.notifications.find_one({"id": nid, "user_id": user["id"]}, {"_id": 0})
    return public_notification(doc or {})
