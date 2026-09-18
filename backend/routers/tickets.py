"""Support tickets — company CRM inbox + Solar service-key bridge."""
from __future__ import annotations

import hmac
import os
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

import storage
from core import (
    ALL_ROLES,
    WRITER_ROLES,
    audit,
    db,
    iso_now,
    new_id,
    next_number,
    require_roles,
    today,
    validate_upload,
)

router = APIRouter(prefix="/api", tags=["tickets"])

STATUSES = ("open", "pending", "resolved", "closed")
PRIORITIES = ("low", "normal", "high")
MAX_ATTACHMENTS = int(os.environ.get("SUPPORT_TICKETS_MAX_ATTACHMENTS_PER_MESSAGE") or 5)


def _as_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    return str(v or "").strip().lower() in ("1", "true", "yes", "on")


def _service_key() -> str:
    return (os.environ.get("SUPPORT_SERVICE_KEY") or os.environ.get("SUPPORT_TICKETS_SERVICE_KEY") or "").strip()


async def require_support_service(request: Request) -> None:
    expected = _service_key()
    provided = (request.headers.get("X-Support-Service-Key") or "").strip()
    if not expected or not provided or not hmac.compare_digest(expected, provided):
        raise HTTPException(status_code=401, detail="Invalid support service key")


class TicketCreateIn(BaseModel):
    customer_id: str
    subject: str = Field(min_length=1, max_length=240)
    body: str = Field(min_length=1)
    priority: str = "normal"
    requester_name: str = ""
    requester_email: str = ""


class TicketStatusIn(BaseModel):
    status: str
    priority: Optional[str] = None


class MessageIn(BaseModel):
    body: str = Field(min_length=1)


def _strip_id(doc: dict | None) -> dict | None:
    if not doc:
        return None
    doc = dict(doc)
    doc.pop("_id", None)
    return doc


async def _customer_or_404(customer_id: str) -> dict:
    cust = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    return cust


async def _customer_by_tenant_key(crm_tenant_key: str) -> dict:
    key = (crm_tenant_key or "").strip()
    if not key:
        raise HTTPException(status_code=422, detail="crm_tenant_key is required")
    cust = await db.customers.find_one({"crm_tenant_key": key}, {"_id": 0})
    if not cust:
        raise HTTPException(
            status_code=422,
            detail=f"No Finance customer linked to tenant key '{key}' — set crm_tenant_key manually",
        )
    return cust


async def _save_attachments(files: List[UploadFile] | None, ticket_id: str) -> list:
    if not files:
        return []
    uploads = [f for f in files if f and getattr(f, "filename", None)]
    if len(uploads) > MAX_ATTACHMENTS:
        raise HTTPException(status_code=400, detail=f"Max {MAX_ATTACHMENTS} attachments per message")
    out = []
    for f in uploads:
        data = await f.read()
        if not data:
            continue
        ctype = validate_upload(data, f.content_type, f.filename or "")
        fid = new_id()
        ext = (f.filename or "bin").rsplit(".", 1)[-1].lower() if "." in (f.filename or "") else "bin"
        path = f"{storage.APP_NAME}/tickets/{ticket_id}/{fid}.{ext}"
        storage.put_object(path, data, ctype)
        await db.files.insert_one(
            {
                "id": fid,
                "storage_path": path,
                "original_filename": f.filename,
                "content_type": ctype,
                "size": len(data),
                "is_deleted": False,
                "created_at": iso_now(),
            }
        )
        out.append(
            {
                "file_id": fid,
                "name": f.filename,
                "mime": ctype,
                "size": len(data),
                "storage_path": path,
            }
        )
    return out


async def _insert_ticket(
    *,
    customer: dict,
    subject: str,
    body: str,
    priority: str,
    source: str,
    requester_name: str,
    requester_email: str,
    solar_user_id: str,
    created_by: str,
    files: List[UploadFile] | None = None,
) -> dict:
    if priority not in PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid priority")
    number = await next_number("SUP", today())
    tid = new_id()
    now = iso_now()
    ticket = {
        "id": tid,
        "number": number,
        "customer_id": customer["id"],
        "customer_name": customer.get("legal_name") or customer.get("trade_name") or "",
        "crm_tenant_key": (customer.get("crm_tenant_key") or "").strip() or None,
        "source": source,
        "subject": subject.strip(),
        "status": "open",
        "priority": priority,
        "requester_name": (requester_name or "").strip(),
        "requester_email": (requester_email or "").strip(),
        "solar_user_id": (solar_user_id or "").strip() or None,
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }
    await db.tickets.insert_one(ticket)
    attachments = await _save_attachments(files, tid)
    msg = {
        "id": new_id(),
        "ticket_id": tid,
        "body": body.strip(),
        "author_type": "customer" if source == "solar" else "support",
        "author_name": requester_name or created_by,
        "attachments": attachments,
        "created_at": now,
    }
    await db.ticket_messages.insert_one(msg)
    return _strip_id(ticket)


async def _assert_solar_access(ticket: dict, solar_user_id: str, viewer_is_superadmin: bool) -> None:
    if viewer_is_superadmin:
        return
    if not solar_user_id or ticket.get("solar_user_id") != solar_user_id:
        raise HTTPException(status_code=403, detail="Ticket not visible to this user")


# ---------- Internal Finance CRM ----------


@router.get("/tickets")
async def list_tickets(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    source: Optional[str] = None,
    customer_id: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    user=Depends(require_roles(*ALL_ROLES)),
):
    filt: dict = {}
    if status:
        filt["status"] = status
    if priority:
        filt["priority"] = priority
    if source:
        filt["source"] = source
    if customer_id:
        filt["customer_id"] = customer_id
    if q:
        filt["$or"] = [
            {"subject": {"$regex": q, "$options": "i"}},
            {"number": {"$regex": q, "$options": "i"}},
            {"customer_name": {"$regex": q, "$options": "i"}},
        ]
    cur = db.tickets.find(filt, {"_id": 0}).sort("updated_at", -1).limit(limit)
    return await cur.to_list(limit)


@router.post("/tickets")
async def create_ticket(body: TicketCreateIn, user=Depends(require_roles(*WRITER_ROLES))):
    cust = await _customer_or_404(body.customer_id)
    ticket = await _insert_ticket(
        customer=cust,
        subject=body.subject,
        body=body.body,
        priority=body.priority or "normal",
        source="manual",
        requester_name=body.requester_name or user.get("name") or user.get("email") or "",
        requester_email=body.requester_email or user.get("email") or "",
        solar_user_id="",
        created_by=user["id"],
    )
    await audit(
        user,
        "ticket_created",
        "ticket",
        ticket["id"],
        f"Support ticket {ticket['number']} created (manual)",
        diff={"status": {"old": None, "new": "open"}, "subject": {"old": None, "new": ticket["subject"]}},
    )
    return ticket


@router.get("/tickets/{tid}")
async def get_ticket(tid: str, user=Depends(require_roles(*ALL_ROLES))):
    ticket = await db.tickets.find_one({"id": tid}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    msgs = await db.ticket_messages.find({"ticket_id": tid}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return {"ticket": ticket, "messages": msgs}


@router.patch("/tickets/{tid}")
async def patch_ticket(tid: str, body: TicketStatusIn, user=Depends(require_roles(*WRITER_ROLES))):
    ticket = await db.tickets.find_one({"id": tid}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if body.status not in STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    updates = {"status": body.status, "updated_at": iso_now()}
    if body.priority:
        if body.priority not in PRIORITIES:
            raise HTTPException(status_code=400, detail="Invalid priority")
        updates["priority"] = body.priority
    await db.tickets.update_one({"id": tid}, {"$set": updates})
    await audit(
        user,
        "ticket_updated",
        "ticket",
        tid,
        f"Ticket {ticket.get('number')} → {body.status}",
        diff={"status": {"old": ticket.get("status"), "new": body.status}},
    )
    return await db.tickets.find_one({"id": tid}, {"_id": 0})


@router.post("/tickets/{tid}/messages")
async def post_message(
    tid: str,
    body: str = Form(...),
    files: Optional[List[UploadFile]] = File(None),
    user=Depends(require_roles(*WRITER_ROLES)),
):
    ticket = await db.tickets.find_one({"id": tid}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not (body or "").strip():
        raise HTTPException(status_code=400, detail="Message body required")
    file_list = files or []
    attachments = await _save_attachments(file_list, tid)
    now = iso_now()
    msg = {
        "id": new_id(),
        "ticket_id": tid,
        "body": body.strip(),
        "author_type": "support",
        "author_name": user.get("name") or user.get("email") or user["id"],
        "attachments": attachments,
        "created_at": now,
    }
    await db.ticket_messages.insert_one(msg)
    status_set = {}
    if ticket.get("status") == "resolved":
        status_set["status"] = "open"
    await db.tickets.update_one({"id": tid}, {"$set": {"updated_at": now, **status_set}})
    await audit(user, "ticket_reply", "ticket", tid, f"Support reply on {ticket.get('number')}")
    return _strip_id(msg)


# ---------- Solar integration (service key) ----------


@router.get("/integrations/support/status")
async def integration_status(_: None = Depends(require_support_service)):
    return {"ok": True, "service": "techhind-finance-support"}


@router.get("/integrations/support/tickets")
async def integration_list_tickets(
    crm_tenant_key: str = Query(...),
    solar_user_id: Optional[str] = None,
    viewer_is_superadmin: str = Query("false"),
    limit: int = Query(100, ge=1, le=500),
    _: None = Depends(require_support_service),
):
    await _customer_by_tenant_key(crm_tenant_key)
    filt: dict = {"crm_tenant_key": crm_tenant_key.strip()}
    if not _as_bool(viewer_is_superadmin):
        if not solar_user_id:
            raise HTTPException(status_code=400, detail="solar_user_id required for non-superadmin")
        filt["solar_user_id"] = solar_user_id
    cur = db.tickets.find(filt, {"_id": 0}).sort("updated_at", -1).limit(limit)
    return await cur.to_list(limit)


@router.post("/integrations/support/tickets")
async def integration_create_ticket(
    crm_tenant_key: str = Form(...),
    subject: str = Form(...),
    body: str = Form(...),
    priority: str = Form("normal"),
    requester_name: str = Form(""),
    requester_email: str = Form(""),
    solar_user_id: str = Form(...),
    files: Optional[List[UploadFile]] = File(None),
    _: None = Depends(require_support_service),
):
    cust = await _customer_by_tenant_key(crm_tenant_key)
    file_list = files or []
    ticket = await _insert_ticket(
        customer=cust,
        subject=subject,
        body=body,
        priority=priority or "normal",
        source="solar",
        requester_name=requester_name,
        requester_email=requester_email,
        solar_user_id=solar_user_id,
        created_by="system:solar",
        files=file_list,
    )
    await audit(
        {"id": "system:solar", "name": requester_name or "Solar", "role": "integration"},
        "ticket_created",
        "ticket",
        ticket["id"],
        f"Support ticket {ticket['number']} from Solar ({crm_tenant_key})",
        diff={"source": {"old": None, "new": "solar"}},
    )
    return ticket


@router.get("/integrations/support/tickets/{tid}")
async def integration_get_ticket(
    tid: str,
    crm_tenant_key: str = Query(...),
    solar_user_id: str = Query(""),
    viewer_is_superadmin: str = Query("false"),
    _: None = Depends(require_support_service),
):
    await _customer_by_tenant_key(crm_tenant_key)
    ticket = await db.tickets.find_one({"id": tid, "crm_tenant_key": crm_tenant_key.strip()}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    await _assert_solar_access(ticket, solar_user_id, _as_bool(viewer_is_superadmin))
    msgs = await db.ticket_messages.find({"ticket_id": tid}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return {"ticket": ticket, "messages": msgs}


@router.post("/integrations/support/tickets/{tid}/messages")
async def integration_post_message(
    tid: str,
    crm_tenant_key: str = Form(...),
    body: str = Form(...),
    solar_user_id: str = Form(...),
    requester_name: str = Form(""),
    viewer_is_superadmin: str = Form("false"),
    files: Optional[List[UploadFile]] = File(None),
    _: None = Depends(require_support_service),
):
    await _customer_by_tenant_key(crm_tenant_key)
    ticket = await db.tickets.find_one({"id": tid, "crm_tenant_key": crm_tenant_key.strip()}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    await _assert_solar_access(ticket, solar_user_id, _as_bool(viewer_is_superadmin))
    if not (body or "").strip():
        raise HTTPException(status_code=400, detail="Message body required")
    file_list = files or []
    attachments = await _save_attachments(file_list, tid)
    now = iso_now()
    msg = {
        "id": new_id(),
        "ticket_id": tid,
        "body": body.strip(),
        "author_type": "customer",
        "author_name": requester_name or solar_user_id,
        "attachments": attachments,
        "created_at": now,
    }
    await db.ticket_messages.insert_one(msg)
    updates = {"updated_at": now}
    if ticket.get("status") in ("resolved", "closed"):
        updates["status"] = "open"
    await db.tickets.update_one({"id": tid}, {"$set": updates})
    await audit(
        {"id": solar_user_id, "name": requester_name or "Solar user", "role": "integration"},
        "ticket_reply",
        "ticket",
        tid,
        f"Customer reply on {ticket.get('number')}",
    )
    return _strip_id(msg)
