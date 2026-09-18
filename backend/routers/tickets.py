"""Support tickets — company CRM inbox + Solar service-key bridge."""
from __future__ import annotations

import hmac
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Union

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

import storage
from core import (
    ALL_ROLES,
    audit,
    db,
    iso_now,
    new_id,
    next_number,
    require_capability,
    require_roles,
    today,
    validate_upload,
)
from email_service import send_email

router = APIRouter(prefix="/api", tags=["tickets"])
logger = logging.getLogger("tickets")

STATUSES = ("open", "pending", "resolved", "closed")
PRIORITIES = ("low", "normal", "high")
CATEGORIES = ("billing", "technical", "onboarding", "account", "other")
VISIBILITIES = ("public", "internal")
MAX_ATTACHMENTS = int(os.environ.get("SUPPORT_TICKETS_MAX_ATTACHMENTS_PER_MESSAGE") or 5)

SLA_FIRST_RESPONSE_HOURS = {"high": 4, "normal": 8, "low": 24}
SLA_RESOLVE_HOURS = {"high": 24, "normal": 48, "low": 120}

require_ticket_write = require_capability("can_ticket_write")


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


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def _sla_due_at(priority: str, base_iso: str | None = None) -> str:
    hours = SLA_RESOLVE_HOURS.get(priority or "normal", 48)
    base = _parse_dt(base_iso) or datetime.now(timezone.utc)
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    return (base + timedelta(hours=hours)).isoformat()


def _compute_sla_breached(ticket: dict) -> bool:
    if ticket.get("status") in ("resolved", "closed"):
        return False
    due = _parse_dt(ticket.get("sla_due_at"))
    if not due:
        return bool(ticket.get("sla_breached"))
    now = datetime.now(timezone.utc)
    if due.tzinfo is None:
        due = due.replace(tzinfo=timezone.utc)
    return now > due


def _enrich_ticket(ticket: dict | None) -> dict | None:
    if not ticket:
        return None
    t = dict(ticket)
    t.pop("_id", None)
    t["sla_breached"] = _compute_sla_breached(t)
    if not t.get("category"):
        t["category"] = "other"
    if t.get("tags") is None:
        t["tags"] = []
    return t


class TicketCreateIn(BaseModel):
    customer_id: str
    subject: str = Field(min_length=1, max_length=240)
    body: str = Field(min_length=1)
    priority: str = "normal"
    category: str = "other"
    assignee_id: Optional[str] = None
    tags: Optional[List[str]] = None
    requester_name: str = ""
    requester_email: str = ""


class TicketPatchIn(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    category: Optional[str] = None
    assignee_id: Optional[str] = None
    tags: Optional[List[str]] = None


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


async def _user_name(user_id: str | None) -> str:
    if not user_id:
        return ""
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "name": 1, "email": 1})
    if not u:
        return ""
    return (u.get("name") or u.get("email") or user_id).strip()


def _as_file_list(files: Union[List[UploadFile], UploadFile, None]) -> List[UploadFile]:
    if not files:
        return []
    if isinstance(files, list):
        return files
    return [files]


async def _save_attachments(files: Union[List[UploadFile], UploadFile, None], ticket_id: str) -> list:
    uploads = []
    for f in _as_file_list(files):
        if not f or isinstance(f, (str, bytes)):
            continue
        if not getattr(f, "filename", None):
            continue
        uploads.append(f)
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


async def _notify(
    *,
    user_id: str | None,
    ticket_id: str,
    ntype: str,
    title: str,
    body: str = "",
) -> None:
    if not user_id:
        return
    await db.notifications.insert_one(
        {
            "id": new_id(),
            "user_id": user_id,
            "ticket_id": ticket_id,
            "type": ntype,
            "title": title,
            "body": body,
            "read": False,
            "ts": iso_now(),
        }
    )


def _email_requester(ticket: dict, subject: str, text: str) -> None:
    to = (ticket.get("requester_email") or "").strip()
    if not to:
        return
    try:
        send_email(to, subject, text=text)
    except Exception as exc:
        logger.warning("Support email failed ticket=%s: %s", ticket.get("id"), exc)


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
    category: str = "other",
    assignee_id: str | None = None,
    tags: list | None = None,
    files: List[UploadFile] | None = None,
) -> dict:
    if priority not in PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid priority")
    cat = (category or "other").strip().lower()
    if cat not in CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category")
    if assignee_id:
        u = await db.users.find_one({"id": assignee_id}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(status_code=400, detail="Assignee not found")
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
        "category": cat,
        "tags": [str(t).strip() for t in (tags or []) if str(t).strip()][:20],
        "assignee_id": assignee_id or None,
        "assignee_name": await _user_name(assignee_id) if assignee_id else "",
        "requester_name": (requester_name or "").strip(),
        "requester_email": (requester_email or "").strip(),
        "solar_user_id": (solar_user_id or "").strip() or None,
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
        "sla_due_at": _sla_due_at(priority, now),
        "sla_breached": False,
        "first_response_at": None,
        "resolved_at": None,
    }
    await db.tickets.insert_one(ticket)
    attachments = await _save_attachments(files, tid)
    msg = {
        "id": new_id(),
        "ticket_id": tid,
        "body": body.strip(),
        "author_type": "customer" if source == "solar" else "support",
        "author_name": requester_name or created_by,
        "visibility": "public",
        "attachments": attachments,
        "created_at": now,
    }
    await db.ticket_messages.insert_one(msg)
    if assignee_id:
        await _notify(
            user_id=assignee_id,
            ticket_id=tid,
            ntype="ticket_assigned",
            title=f"Assigned {number}",
            body=subject.strip(),
        )
    return _enrich_ticket(ticket)


async def _assert_solar_access(ticket: dict, solar_user_id: str, viewer_is_superadmin: bool) -> None:
    if viewer_is_superadmin:
        return
    if not solar_user_id or ticket.get("solar_user_id") != solar_user_id:
        raise HTTPException(status_code=403, detail="Ticket not visible to this user")


async def _public_messages(ticket_id: str) -> list:
    msgs = await db.ticket_messages.find(
        {"ticket_id": ticket_id, "$or": [{"visibility": "public"}, {"visibility": {"$exists": False}}]},
        {"_id": 0},
    ).sort("created_at", 1).to_list(500)
    return msgs


# ---------- Internal Finance CRM ----------


@router.get("/tickets/meta")
async def tickets_meta(user=Depends(require_roles(*ALL_ROLES))):
    agents = await db.users.find(
        {"active": {"$ne": False}, "role": {"$in": ["admin", "accountant", "ops", "support_agent"]}},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1},
    ).to_list(200)
    return {
        "categories": list(CATEGORIES),
        "statuses": list(STATUSES),
        "priorities": list(PRIORITIES),
        "sla_policy": {
            "first_response_hours": SLA_FIRST_RESPONSE_HOURS,
            "resolve_hours": SLA_RESOLVE_HOURS,
        },
        "assignees": agents,
        "max_attachments": MAX_ATTACHMENTS,
    }


@router.get("/tickets/queue")
async def tickets_queue(user=Depends(require_roles(*ALL_ROLES))):
    now_iso = datetime.now(timezone.utc).isoformat()
    open_statuses = ["open", "pending"]
    open_count = await db.tickets.count_documents({"status": {"$in": open_statuses}})
    mine = await db.tickets.count_documents(
        {"status": {"$in": open_statuses}, "assignee_id": user["id"]}
    )
    unassigned = await db.tickets.count_documents(
        {
            "status": {"$in": open_statuses},
            "$or": [{"assignee_id": None}, {"assignee_id": ""}, {"assignee_id": {"$exists": False}}],
        }
    )
    breached = await db.tickets.count_documents(
        {
            "status": {"$in": open_statuses},
            "sla_due_at": {"$lt": now_iso},
        }
    )
    return {
        "open": open_count,
        "mine": mine,
        "unassigned": unassigned,
        "breached": breached,
    }


@router.get("/tickets")
async def list_tickets(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    source: Optional[str] = None,
    customer_id: Optional[str] = None,
    category: Optional[str] = None,
    assignee_id: Optional[str] = None,
    mine: Optional[str] = None,
    unassigned: Optional[str] = None,
    sla: Optional[str] = None,
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
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
    if category:
        filt["category"] = category
    if _as_bool(mine):
        filt["assignee_id"] = user["id"]
    elif assignee_id:
        filt["assignee_id"] = assignee_id
    if _as_bool(unassigned):
        filt["$or"] = [
            {"assignee_id": None},
            {"assignee_id": ""},
            {"assignee_id": {"$exists": False}},
        ]
    if sla == "breached":
        if isinstance(filt.get("status"), str) and filt["status"] in ("resolved", "closed"):
            return []
        if "status" not in filt:
            filt["status"] = {"$nin": ["resolved", "closed"]}
        filt["sla_due_at"] = {"$lt": datetime.now(timezone.utc).isoformat()}
    elif sla == "ok":
        ok_or = [
            {"sla_due_at": {"$gte": datetime.now(timezone.utc).isoformat()}},
            {"status": {"$in": ["resolved", "closed"]}},
        ]
        if "$or" in filt:
            filt = {"$and": [{k: v for k, v in filt.items()}, {"$or": ok_or}]}
        else:
            filt["$or"] = ok_or
    if date_from or date_to:
        created: dict = {}
        if date_from:
            created["$gte"] = date_from
        if date_to:
            created["$lte"] = date_to
        filt["created_at"] = created
    if q:
        q_clause = [
            {"subject": {"$regex": q, "$options": "i"}},
            {"number": {"$regex": q, "$options": "i"}},
            {"customer_name": {"$regex": q, "$options": "i"}},
        ]
        if "$or" in filt and not _as_bool(unassigned):
            filt["$and"] = [{"$or": filt.pop("$or")}, {"$or": q_clause}]
        elif "$or" in filt:
            filt = {"$and": [filt, {"$or": q_clause}]}
        else:
            filt["$or"] = q_clause
    cur = db.tickets.find(filt, {"_id": 0}).sort("updated_at", -1).limit(limit)
    rows = await cur.to_list(limit)
    return [_enrich_ticket(r) for r in rows]


@router.post("/tickets")
async def create_ticket(body: TicketCreateIn, user=Depends(require_ticket_write)):
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
        category=body.category or "other",
        assignee_id=body.assignee_id,
        tags=body.tags,
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
    for m in msgs:
        if not m.get("visibility"):
            m["visibility"] = "public"
    return {"ticket": _enrich_ticket(ticket), "messages": msgs}


@router.patch("/tickets/{tid}")
async def patch_ticket(tid: str, body: TicketPatchIn, user=Depends(require_ticket_write)):
    ticket = await db.tickets.find_one({"id": tid}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    updates: dict = {"updated_at": iso_now()}
    diff: dict = {}

    if body.status is not None:
        if body.status not in STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        updates["status"] = body.status
        diff["status"] = {"old": ticket.get("status"), "new": body.status}
        if body.status in ("resolved", "closed") and not ticket.get("resolved_at"):
            updates["resolved_at"] = iso_now()
        if body.status in ("open", "pending"):
            updates["resolved_at"] = None

    if body.priority is not None:
        if body.priority not in PRIORITIES:
            raise HTTPException(status_code=400, detail="Invalid priority")
        updates["priority"] = body.priority
        updates["sla_due_at"] = _sla_due_at(body.priority, ticket.get("created_at"))
        diff["priority"] = {"old": ticket.get("priority"), "new": body.priority}

    if body.category is not None:
        cat = body.category.strip().lower()
        if cat not in CATEGORIES:
            raise HTTPException(status_code=400, detail="Invalid category")
        updates["category"] = cat
        diff["category"] = {"old": ticket.get("category"), "new": cat}

    if body.assignee_id is not None:
        aid = (body.assignee_id or "").strip() or None
        if aid:
            u = await db.users.find_one({"id": aid}, {"_id": 0, "id": 1})
            if not u:
                raise HTTPException(status_code=400, detail="Assignee not found")
        updates["assignee_id"] = aid
        updates["assignee_name"] = await _user_name(aid) if aid else ""
        diff["assignee_id"] = {"old": ticket.get("assignee_id"), "new": aid}
        if aid and aid != ticket.get("assignee_id"):
            await _notify(
                user_id=aid,
                ticket_id=tid,
                ntype="ticket_assigned",
                title=f"Assigned {ticket.get('number')}",
                body=ticket.get("subject") or "",
            )
            await audit(user, "ticket_assigned", "ticket", tid, f"Assigned to {updates['assignee_name']}")

    if body.tags is not None:
        updates["tags"] = [str(t).strip() for t in body.tags if str(t).strip()][:20]

    if len(updates) == 1:
        raise HTTPException(status_code=400, detail="No changes")

    await db.tickets.update_one({"id": tid}, {"$set": updates})
    if body.status and body.status == "resolved":
        _email_requester(
            ticket,
            f"[{ticket.get('number')}] Ticket resolved",
            f"Your support ticket {ticket.get('number')} ({ticket.get('subject')}) has been marked resolved.",
        )
        if ticket.get("assignee_id"):
            await _notify(
                user_id=ticket["assignee_id"],
                ticket_id=tid,
                ntype="ticket_resolved",
                title=f"Resolved {ticket.get('number')}",
                body=ticket.get("subject") or "",
            )
    if diff and "assignee_id" not in diff:
        await audit(
            user,
            "ticket_updated",
            "ticket",
            tid,
            f"Ticket {ticket.get('number')} updated",
            diff=diff,
        )
    return _enrich_ticket(await db.tickets.find_one({"id": tid}, {"_id": 0}))


@router.post("/tickets/{tid}/messages")
async def post_message(
    tid: str,
    request: Request,
    user=Depends(require_ticket_write),
):
    ticket = await db.tickets.find_one({"id": tid}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    form = await request.form()
    body = str(form.get("body") or "")
    visibility = str(form.get("visibility") or "public")
    if not body.strip():
        raise HTTPException(status_code=400, detail="Message body required")
    vis = visibility.strip().lower()
    if vis not in VISIBILITIES:
        raise HTTPException(status_code=400, detail="Invalid visibility")
    files = form.getlist("files")
    attachments = await _save_attachments(files, tid)
    now = iso_now()
    msg = {
        "id": new_id(),
        "ticket_id": tid,
        "body": body.strip(),
        "author_type": "support",
        "author_name": user.get("name") or user.get("email") or user["id"],
        "visibility": vis,
        "attachments": attachments,
        "created_at": now,
    }
    await db.ticket_messages.insert_one(msg)
    ticket_updates: dict = {"updated_at": now}
    if ticket.get("status") == "resolved" and vis == "public":
        ticket_updates["status"] = "open"
        ticket_updates["resolved_at"] = None
    if vis == "public" and not ticket.get("first_response_at"):
        ticket_updates["first_response_at"] = now
    await db.tickets.update_one({"id": tid}, {"$set": ticket_updates})

    if vis == "internal":
        await audit(user, "ticket_internal_note", "ticket", tid, f"Internal note on {ticket.get('number')}")
    else:
        await audit(user, "ticket_reply", "ticket", tid, f"Support reply on {ticket.get('number')}")
        if ticket.get("assignee_id") and ticket["assignee_id"] != user["id"]:
            await _notify(
                user_id=ticket["assignee_id"],
                ticket_id=tid,
                ntype="ticket_reply",
                title=f"Reply on {ticket.get('number')}",
                body=body.strip()[:200],
            )
        _email_requester(
            ticket,
            f"[{ticket.get('number')}] Support reply",
            f"A support agent replied on ticket {ticket.get('number')}:\n\n{body.strip()[:2000]}",
        )
    return _strip_id(msg)


# ---------- Solar integration (service key) ----------


@router.get("/integrations/support/status")
async def integration_status(_: None = Depends(require_support_service)):
    return {
        "ok": True,
        "service": "techhind-finance-support",
        "max_attachments": MAX_ATTACHMENTS,
        "categories": list(CATEGORIES),
        "priorities": list(PRIORITIES),
        "sla_policy": {
            "first_response_hours": SLA_FIRST_RESPONSE_HOURS,
            "resolve_hours": SLA_RESOLVE_HOURS,
        },
    }


@router.get("/integrations/support/tickets")
async def integration_list_tickets(
    crm_tenant_key: str = Query(...),
    solar_user_id: Optional[str] = None,
    viewer_is_superadmin: str = Query("false"),
    status: Optional[str] = None,
    priority: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    _: None = Depends(require_support_service),
):
    await _customer_by_tenant_key(crm_tenant_key)
    filt: dict = {"crm_tenant_key": crm_tenant_key.strip()}
    if not _as_bool(viewer_is_superadmin):
        if not solar_user_id:
            raise HTTPException(status_code=400, detail="solar_user_id required for non-superadmin")
        filt["solar_user_id"] = solar_user_id
    if status:
        filt["status"] = status
    if priority:
        filt["priority"] = priority
    if q:
        filt["$or"] = [
            {"subject": {"$regex": q, "$options": "i"}},
            {"number": {"$regex": q, "$options": "i"}},
        ]
    cur = db.tickets.find(filt, {"_id": 0}).sort("updated_at", -1).limit(limit)
    rows = await cur.to_list(limit)
    return [_enrich_ticket(r) for r in rows]


@router.post("/integrations/support/tickets")
async def integration_create_ticket(
    request: Request,
    _: None = Depends(require_support_service),
):
    form = await request.form()
    crm_tenant_key = str(form.get("crm_tenant_key") or "")
    subject = str(form.get("subject") or "")
    body = str(form.get("body") or "")
    priority = str(form.get("priority") or "normal")
    category = str(form.get("category") or "other")
    requester_name = str(form.get("requester_name") or "")
    requester_email = str(form.get("requester_email") or "")
    solar_user_id = str(form.get("solar_user_id") or "")
    if not subject.strip() or not body.strip() or not solar_user_id.strip():
        raise HTTPException(status_code=422, detail="subject, body, and solar_user_id are required")
    cust = await _customer_by_tenant_key(crm_tenant_key)
    files = form.getlist("files")
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
        category=category or "other",
        files=files,
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
    msgs = await _public_messages(tid)
    return {"ticket": _enrich_ticket(ticket), "messages": msgs}


@router.post("/integrations/support/tickets/{tid}/messages")
async def integration_post_message(
    tid: str,
    request: Request,
    _: None = Depends(require_support_service),
):
    form = await request.form()
    crm_tenant_key = str(form.get("crm_tenant_key") or "")
    body = str(form.get("body") or "")
    solar_user_id = str(form.get("solar_user_id") or "")
    requester_name = str(form.get("requester_name") or "")
    viewer_is_superadmin = str(form.get("viewer_is_superadmin") or "false")
    await _customer_by_tenant_key(crm_tenant_key)
    ticket = await db.tickets.find_one({"id": tid, "crm_tenant_key": crm_tenant_key.strip()}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    await _assert_solar_access(ticket, solar_user_id, _as_bool(viewer_is_superadmin))
    if not body.strip():
        raise HTTPException(status_code=400, detail="Message body required")
    files = form.getlist("files")
    attachments = await _save_attachments(files, tid)
    now = iso_now()
    msg = {
        "id": new_id(),
        "ticket_id": tid,
        "body": body.strip(),
        "author_type": "customer",
        "author_name": requester_name or solar_user_id,
        "visibility": "public",
        "attachments": attachments,
        "created_at": now,
    }
    await db.ticket_messages.insert_one(msg)
    updates = {"updated_at": now}
    if ticket.get("status") in ("resolved", "closed"):
        updates["status"] = "open"
        updates["resolved_at"] = None
    await db.tickets.update_one({"id": tid}, {"$set": updates})
    if ticket.get("assignee_id"):
        await _notify(
            user_id=ticket["assignee_id"],
            ticket_id=tid,
            ntype="ticket_customer_reply",
            title=f"Customer reply {ticket.get('number')}",
            body=body.strip()[:200],
        )
    await audit(
        {"id": solar_user_id, "name": requester_name or "Solar user", "role": "integration"},
        "ticket_reply",
        "ticket",
        tid,
        f"Customer reply on {ticket.get('number')}",
    )
    return _strip_id(msg)


@router.get("/integrations/support/files/{file_id}")
async def integration_get_file(
    file_id: str,
    crm_tenant_key: str = Query(...),
    solar_user_id: str = Query(""),
    viewer_is_superadmin: str = Query("false"),
    _: None = Depends(require_support_service),
):
    await _customer_by_tenant_key(crm_tenant_key)
    msg = await db.ticket_messages.find_one(
        {
            "attachments.file_id": file_id,
            "$or": [{"visibility": "public"}, {"visibility": {"$exists": False}}],
        },
        {"_id": 0},
    )
    if not msg:
        raise HTTPException(status_code=404, detail="File not found")
    ticket = await db.tickets.find_one(
        {"id": msg["ticket_id"], "crm_tenant_key": crm_tenant_key.strip()},
        {"_id": 0},
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="File not found")
    await _assert_solar_access(ticket, solar_user_id, _as_bool(viewer_is_superadmin))
    att = next((a for a in (msg.get("attachments") or []) if a.get("file_id") == file_id), None)
    if not att:
        raise HTTPException(status_code=404, detail="File not found")
    path = att.get("storage_path")
    record = await db.files.find_one({"id": file_id, "is_deleted": False})
    got = storage.get_object_or_none(path) if path else None
    if not got and record:
        got = storage.get_object_or_none(record.get("storage_path"))
    if not got:
        raise HTTPException(status_code=404, detail="File not found")
    data, ctype = got
    filename = att.get("name") or (record or {}).get("original_filename") or "attachment"
    return Response(
        content=data,
        media_type=(record or {}).get("content_type") or att.get("mime") or ctype,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
