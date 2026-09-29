"""Projects, tasks, work activity, workload dashboard & report."""
from __future__ import annotations

from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

import storage
from core import (
    ALL_ROLES,
    audit,
    db,
    field_diff,
    iso_now,
    is_own_work_role,
    new_id,
    next_number,
    require_capability,
    require_roles,
    today,
    user_capabilities,
    validate_upload,
)
from rbac_seed import TASK_TYPES

router = APIRouter(prefix="/api/work", tags=["work"])

PROJECT_STATUSES = ("planned", "active", "on_hold", "completed", "cancelled")
TASK_STATUSES = (
    "backlog",
    "todo",
    "in_progress",
    "in_review",
    "blocked",
    "done",
    "cancelled",
)
KANBAN_COLUMNS = ("backlog", "todo", "in_progress", "in_review", "blocked", "done")
PRIORITIES = ("low", "normal", "high", "urgent")
OPEN_STATUSES = ("backlog", "todo", "in_progress", "in_review", "blocked")
PROJECT_FIELDS = [
    "name", "description", "status", "priority", "customer_id", "owner_id",
    "member_ids", "start_date", "due_date", "tags",
]
TASK_FIELDS = [
    "title", "description", "status", "priority", "category", "task_type",
    "project_id", "assignee_id", "observer_ids", "due_date", "start_date",
    "tags", "reminder_at", "checklist", "attachment_ids",
]
LEGACY_TYPE_MAP = {"demo": "customer_demo"}
MAX_TASK_ATTACHMENTS = 10


def _strip(doc: dict | None) -> dict | None:
    if not doc:
        return None
    doc = dict(doc)
    doc.pop("_id", None)
    return doc


def _normalize_task_type(val: str | None) -> str:
    v = (val or "other").strip().lower()
    v = LEGACY_TYPE_MAP.get(v, v)
    if v not in TASK_TYPES:
        return "other"
    return v


def _normalize_status(val: str | None) -> str:
    v = (val or "todo").strip().lower()
    if v not in TASK_STATUSES:
        return "todo"
    return v


async def _work_activity(
    user: dict,
    entity_type: str,
    entity_id: str,
    action: str,
    summary: str,
    diff: dict | None = None,
    comment: str | None = None,
    mention_ids: list | None = None,
):
    row = {
        "id": new_id(),
        "ts": iso_now(),
        "entity_type": entity_type,
        "entity_id": entity_id,
        "action": action,
        "summary": summary,
        "diff": diff or {},
        "comment": comment,
        "mention_ids": mention_ids or [],
        "user_id": user.get("id"),
        "user_name": user.get("name"),
        "role": user.get("role"),
    }
    await db.work_activity.insert_one(row)
    await audit(user, action, entity_type, entity_id, summary, diff=diff)
    return _strip(row)


def _task_audience(*tasks: dict) -> list:
    ids = []
    for task in tasks:
        if not task:
            continue
        ids.append(task.get("assignee_id"))
        ids.append(task.get("created_by"))
        ids.extend(task.get("observer_ids") or [])
    return ids


def _project_audience(*projects: dict) -> list:
    ids = []
    for project in projects:
        if not project:
            continue
        ids.append(project.get("owner_id"))
        ids.append(project.get("created_by"))
        ids.extend(project.get("member_ids") or [])
    return ids


async def _inbox(
    user: dict,
    user_ids: list,
    *,
    source: str,
    ntype: str,
    title: str,
    body: str,
    entity_type: str,
    entity_id: str,
    activity_id: str | None = None,
    repeat_until_read: bool = False,
) -> None:
    from notifications import notify_users

    href = f"/tasks/{entity_id}" if entity_type == "task" else f"/projects/{entity_id}"
    await notify_users(
        user_ids,
        actor_id=user.get("id"),
        actor_name=user.get("name") or "",
        source=source,
        ntype=ntype,
        title=title,
        body=body,
        entity_type=entity_type,
        entity_id=entity_id,
        href=href,
        activity_id=activity_id,
        repeat_until_read=repeat_until_read,
    )


async def _resolve_mentions(text: str) -> list[str]:
    """Match @Name tokens: full name, unique first name, or unique email local-part.

    Longest alias wins. `@` inside an email (letter/@) is ignored.
    """
    rows = await db.users.find(
        {"active": {"$ne": False}},
        {"_id": 0, "id": 1, "name": 1, "email": 1},
    ).to_list(500)
    fulls: list[tuple[str, str]] = []
    first_counts: dict[str, list[str]] = {}
    local_counts: dict[str, list[str]] = {}
    first_orig: dict[str, str] = {}
    for u in rows:
        uid = u.get("id") or ""
        if not uid:
            continue
        name = (u.get("name") or "").strip()
        email = (u.get("email") or "").strip()
        if name:
            fulls.append((name, uid))
            first = name.split()[0]
            key = first.lower()
            first_counts.setdefault(key, []).append(uid)
            first_orig.setdefault(key, first)
        if email and "@" in email:
            local = email.split("@", 1)[0].strip()
            if local:
                local_counts.setdefault(local.lower(), []).append(uid)

    candidates: list[tuple[str, str]] = list(fulls)
    seen_alias = {(n.lower(), uid) for n, uid in fulls}
    for key, uids in first_counts.items():
        uniq = list(dict.fromkeys(uids))
        if len(uniq) != 1:
            continue
        uid = uniq[0]
        alias = first_orig.get(key) or key
        if (alias.lower(), uid) not in seen_alias:
            candidates.append((alias, uid))
            seen_alias.add((alias.lower(), uid))
    for key, uids in local_counts.items():
        uniq = list(dict.fromkeys(uids))
        if len(uniq) != 1:
            continue
        uid = uniq[0]
        if (key, uid) not in seen_alias:
            candidates.append((key, uid))
            seen_alias.add((key, uid))
    candidates.sort(key=lambda pair: len(pair[0]), reverse=True)

    found: list[str] = []
    seen: set[str] = set()
    lower = text.lower()
    i = 0
    while i < len(text):
        at = lower.find("@", i)
        if at < 0:
            break
        if at > 0 and text[at - 1].isalnum():
            i = at + 1
            continue
        rest = text[at + 1:]
        rest_l = rest.lower()
        matched = False
        for alias, uid in candidates:
            nlen = len(alias)
            if not rest_l.startswith(alias.lower()):
                continue
            if nlen < len(rest) and rest[nlen].isalnum():
                continue
            if uid not in seen:
                seen.add(uid)
                found.append(uid)
            i = at + 1 + nlen
            matched = True
            break
        if not matched:
            i = at + 1
    return found


async def _active_user_ids(ids: list | None) -> list[str]:
    wanted: list[str] = []
    seen: set[str] = set()
    for raw in ids or []:
        uid = raw.strip() if isinstance(raw, str) else ""
        if not uid or uid in seen:
            continue
        seen.add(uid)
        wanted.append(uid)
    if not wanted:
        return []
    rows = await db.users.find(
        {"id": {"$in": wanted}, "active": {"$ne": False}},
        {"_id": 0, "id": 1},
    ).to_list(500)
    valid = {u["id"] for u in rows if u.get("id")}
    return [uid for uid in wanted if uid in valid]


async def _collect_mentions(text: str, extra_ids: list | None) -> list[str]:
    parsed = await _resolve_mentions(text)
    extra = await _active_user_ids(extra_ids)
    found: list[str] = []
    seen: set[str] = set()
    for uid in extra + parsed:
        if uid in seen:
            continue
        seen.add(uid)
        found.append(uid)
    return found


async def _fanout_comment(
    user: dict,
    *,
    audience: list,
    number: str,
    text: str,
    entity_type: str,
    entity_id: str,
    activity_id: str,
    mention_ids: list,
) -> None:
    mentioned = set(mention_ids)
    others = [uid for uid in audience if uid not in mentioned]
    await _inbox(
        user, others,
        source=entity_type, ntype="comment",
        title=f"Comment on {number}",
        body=text,
        entity_type=entity_type, entity_id=entity_id,
    )
    await _inbox(
        user, mention_ids,
        source=entity_type, ntype="mention",
        title=f"Mentioned on {number}",
        body=text,
        entity_type=entity_type, entity_id=entity_id,
        activity_id=activity_id,
        repeat_until_read=True,
    )


async def _with_mention_state(rows: list) -> list:
    mention_ids: list[str] = []
    activity_ids: list[str] = []
    for row in rows:
        if row.get("action") != "comment":
            row.setdefault("mentions", [])
            row.setdefault("seen_by", [])
            continue
        mention_ids.extend(row.get("mention_ids") or [])
        if row.get("id"):
            activity_ids.append(row["id"])
    umap = await _user_map(mention_ids)
    notes = []
    if activity_ids:
        notes = await db.notifications.find(
            {"activity_id": {"$in": activity_ids}, "type": "mention"},
            {"_id": 0, "activity_id": 1, "user_id": 1, "read": 1, "read_at": 1},
        ).to_list(1000)
    by_activity: dict[str, list] = {}
    for note in notes:
        by_activity.setdefault(note.get("activity_id") or "", []).append(note)
    for row in rows:
        if row.get("action") != "comment":
            continue
        ids = row.get("mention_ids") or []
        row["mentions"] = [
            {"id": uid, "name": (umap.get(uid) or {}).get("name") or ""}
            for uid in ids
        ]
        seen = []
        for note in by_activity.get(row.get("id") or "", []):
            if not note.get("read"):
                continue
            uid = note.get("user_id")
            seen.append({
                "id": uid,
                "name": (umap.get(uid) or {}).get("name") or "",
                "read_at": note.get("read_at"),
            })
        row["seen_by"] = seen
    return rows


def _task_notice(diff: dict, number: str) -> tuple[str, str] | None:
    if "status" in diff:
        change = diff["status"]
        return "status_changed", f"Status {change.get('old')} → {change.get('new')} on {number}"
    if "assignee_id" in diff:
        return "assignee_changed", f"Reassigned {number}"
    if "observer_ids" in diff:
        old = set(diff["observer_ids"].get("old") or [])
        new = set(diff["observer_ids"].get("new") or [])
        kind = "observer_added" if new - old else "observer_removed"
        return kind, f"Observers updated on {number}"
    if "due_date" in diff:
        return "due_date_changed", f"Due date changed on {number}"
    if "priority" in diff:
        return "priority_changed", f"Priority changed on {number}"
    if "reminder_at" in diff:
        return "reminder_set", f"Reminder updated on {number}"
    return None


def _project_notice(diff: dict, number: str) -> tuple[str, str] | None:
    if "status" in diff:
        change = diff["status"]
        return "status_changed", f"Status {change.get('old')} → {change.get('new')} on {number}"
    if "owner_id" in diff:
        return "owner_changed", f"Owner changed on {number}"
    if "member_ids" in diff:
        old = set(diff["member_ids"].get("old") or [])
        new = set(diff["member_ids"].get("new") or [])
        kind = "member_added" if new - old else "member_removed"
        return kind, f"Members updated on {number}"
    return None


async def _user_map(ids: list) -> dict:
    ids = [i for i in ids if i]
    if not ids:
        return {}
    rows = await db.users.find(
        {"id": {"$in": list(set(ids))}},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1},
    ).to_list(500)
    return {r["id"]: r for r in rows}


def _migrate_task_doc(t: dict) -> dict:
    """Normalize legacy fields on read."""
    if not t.get("task_type"):
        t["task_type"] = _normalize_task_type(t.get("category"))
    else:
        t["task_type"] = _normalize_task_type(t.get("task_type"))
    t["category"] = t["task_type"]  # alias for older UI
    t["status"] = _normalize_status(t.get("status"))
    t.setdefault("observer_ids", [])
    t.setdefault("checklist", [])
    t.setdefault("attachment_ids", [])
    t.setdefault("tags", [])
    t.setdefault("reminder_sent", False)
    return t


async def _enrich_project(p: dict) -> dict:
    p = _strip(p) or {}
    umap = await _user_map([p.get("owner_id"), *(p.get("member_ids") or [])])
    p["owner"] = umap.get(p.get("owner_id"))
    p["members"] = [umap[i] for i in (p.get("member_ids") or []) if i in umap]
    if p.get("customer_id"):
        cust = await db.customers.find_one(
            {"id": p["customer_id"]},
            {"_id": 0, "id": 1, "legal_name": 1, "trade_name": 1},
        )
        p["customer"] = cust
    return p


async def _file_map(ids: list) -> list:
    ids = [i for i in ids if i]
    if not ids:
        return []
    rows = await db.files.find(
        {"id": {"$in": ids}, "is_deleted": {"$ne": True}},
        {"_id": 0},
    ).to_list(100)
    by_id = {r["id"]: r for r in rows}
    return [by_id[i] for i in ids if i in by_id]


async def _enrich_task(t: dict) -> dict:
    t = _migrate_task_doc(_strip(t) or {})
    umap = await _user_map(
        [t.get("assignee_id"), t.get("created_by"), *(t.get("observer_ids") or [])]
    )
    t["assignee"] = umap.get(t.get("assignee_id"))
    t["creator"] = umap.get(t.get("created_by"))
    t["observers"] = [umap[i] for i in (t.get("observer_ids") or []) if i in umap]
    if t.get("project_id"):
        pr = await db.projects.find_one(
            {"id": t["project_id"]},
            {"_id": 0, "id": 1, "number": 1, "name": 1, "status": 1},
        )
        t["project"] = pr
    t["attachments"] = await _file_map(t.get("attachment_ids") or [])
    return t


async def _valid_user_ids(ids: list) -> list:
    clean = list(dict.fromkeys([i for i in (ids or []) if i]))
    if not clean:
        return []
    found = await db.users.find(
        {"id": {"$in": clean}, "active": {"$ne": False}},
        {"_id": 0, "id": 1},
    ).to_list(len(clean))
    return [r["id"] for r in found]


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    status: str = "planned"
    priority: str = "normal"
    customer_id: Optional[str] = None
    owner_id: Optional[str] = None
    member_ids: List[str] = []
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    tags: List[str] = []


class ProjectPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    customer_id: Optional[str] = None
    owner_id: Optional[str] = None
    member_ids: Optional[List[str]] = None
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    tags: Optional[List[str]] = None


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    description: str = ""
    status: str = "todo"
    priority: str = "normal"
    category: Optional[str] = None
    task_type: Optional[str] = None
    project_id: Optional[str] = None
    assignee_id: Optional[str] = None
    observer_ids: List[str] = []
    due_date: Optional[str] = None
    start_date: Optional[str] = None
    reminder_at: Optional[str] = None
    tags: List[str] = []
    quick_testing: bool = False


class TaskPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    category: Optional[str] = None
    task_type: Optional[str] = None
    project_id: Optional[str] = None
    assignee_id: Optional[str] = None
    observer_ids: Optional[List[str]] = None
    due_date: Optional[str] = None
    start_date: Optional[str] = None
    reminder_at: Optional[str] = None
    tags: Optional[List[str]] = None


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    mention_ids: Optional[List[str]] = None


class ObserversIn(BaseModel):
    observer_ids: List[str] = []


class ChecklistItemIn(BaseModel):
    id: Optional[str] = None
    text: str = Field(min_length=1, max_length=500)
    done: bool = False
    sort_order: int = 0


class ChecklistIn(BaseModel):
    items: List[ChecklistItemIn] = []


class ReminderIn(BaseModel):
    reminder_at: Optional[str] = None  # null clears


def _validate_status(val: str, allowed: tuple, label: str):
    if val not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid {label}: {val}")


def _validate_priority(val: str):
    if val not in PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority: {val}")


def _validate_task_type(val: str):
    if val not in TASK_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid task_type: {val}")


def _due_bucket_filter(bucket: str, today_s: str) -> dict:
    d0 = date.fromisoformat(today_s)
    if bucket == "overdue":
        return {"due_date": {"$lt": today_s}, "status": {"$in": list(OPEN_STATUSES)}}
    if bucket == "today":
        return {"due_date": today_s, "status": {"$in": list(OPEN_STATUSES)}}
    if bucket == "tomorrow":
        return {
            "due_date": (d0 + timedelta(days=1)).isoformat(),
            "status": {"$in": list(OPEN_STATUSES)},
        }
    if bucket == "week":
        end = (d0 + timedelta(days=7)).isoformat()
        return {
            "due_date": {"$gte": today_s, "$lte": end},
            "status": {"$in": list(OPEN_STATUSES)},
        }
    if bucket == "none":
        return {
            "$or": [{"due_date": None}, {"due_date": ""}, {"due_date": {"$exists": False}}],
            "status": {"$in": list(OPEN_STATUSES)},
        }
    raise HTTPException(status_code=400, detail=f"Invalid due_bucket: {bucket}")


def _classify_due(due: str | None, today_s: str) -> str:
    if not due:
        return "none"
    d0 = date.fromisoformat(today_s)
    try:
        dd = date.fromisoformat(due[:10])
    except ValueError:
        return "none"
    if dd < d0:
        return "overdue"
    if dd == d0:
        return "today"
    if dd == d0 + timedelta(days=1):
        return "tomorrow"
    if dd <= d0 + timedelta(days=7):
        return "week"
    return "later"


# ---------- Meta ----------
@router.get("/categories")
async def list_categories(user=Depends(require_roles(*ALL_ROLES))):
    masters = await db.masters.find_one({"id": "masters"}, {"_id": 0, "work_task_categories": 1, "work_task_types": 1})
    cats = (masters or {}).get("work_task_types") or (masters or {}).get("work_task_categories")
    return cats or [{"name": c} for c in TASK_TYPES]


@router.get("/task-types")
async def list_task_types(user=Depends(require_roles(*ALL_ROLES))):
    return [{"name": t} for t in TASK_TYPES]


@router.get("/task-statuses")
async def list_task_statuses(user=Depends(require_roles(*ALL_ROLES))):
    return [{"name": s} for s in TASK_STATUSES]


# ---------- Projects ----------
@router.get("/projects")
async def list_projects(
    status: Optional[str] = None,
    customer_id: Optional[str] = None,
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    user=Depends(require_roles(*ALL_ROLES)),
):
    from list_query import apply_date_range
    filt: dict = {}
    if status:
        filt["status"] = status
    if customer_id:
        filt["customer_id"] = customer_id
    if q and q.strip():
        filt["$or"] = [
            {"name": {"$regex": q.strip(), "$options": "i"}},
            {"number": {"$regex": q.strip(), "$options": "i"}},
        ]
    apply_date_range(filt, "due_date", date_from or "", date_to or "")
    rows = await db.projects.find(filt, {"_id": 0}).sort("updated_at", -1).to_list(limit)
    return [await _enrich_project(r) for r in rows]


@router.post("/projects")
async def create_project(body: ProjectIn, user=Depends(require_capability("can_work_write"))):
    _validate_status(body.status, PROJECT_STATUSES, "status")
    _validate_priority(body.priority)
    if body.customer_id and not await db.customers.find_one({"id": body.customer_id}):
        raise HTTPException(status_code=404, detail="Customer not found")
    owner_id = body.owner_id or user["id"]
    if not await db.users.find_one({"id": owner_id, "active": {"$ne": False}}):
        raise HTTPException(status_code=400, detail="Invalid owner")
    now = iso_now()
    number = await next_number("PRJ", today())
    doc = {
        "id": new_id(),
        "number": number,
        "name": body.name.strip(),
        "description": body.description or "",
        "status": body.status,
        "priority": body.priority,
        "customer_id": body.customer_id,
        "owner_id": owner_id,
        "member_ids": list(dict.fromkeys(body.member_ids or [])),
        "start_date": body.start_date,
        "due_date": body.due_date,
        "tags": body.tags or [],
        "created_by": user["id"],
        "created_at": now,
        "updated_at": now,
    }
    await db.projects.insert_one(doc)
    await _work_activity(user, "project", doc["id"], "project_created", f"Created {number}")
    await _inbox(
        user, _project_audience(doc),
        source="project", ntype="project_created",
        title=f"Project {number}", body=doc["name"],
        entity_type="project", entity_id=doc["id"],
    )
    return await _enrich_project(doc)


@router.get("/projects/{project_id}")
async def get_project(project_id: str, user=Depends(require_roles(*ALL_ROLES))):
    p = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return await _enrich_project(p)


@router.patch("/projects/{project_id}")
async def patch_project(
    project_id: str,
    body: ProjectPatch,
    user=Depends(require_capability("can_work_write")),
):
    existing = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Project not found")
    caps = await user_capabilities(user)
    patch = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if "status" in patch:
        _validate_status(patch["status"], PROJECT_STATUSES, "status")
        if patch["status"] in ("completed", "cancelled") and not caps.get("can_work_manage"):
            raise HTTPException(status_code=403, detail="can_work_manage required to close projects")
    if "priority" in patch:
        _validate_priority(patch["priority"])
    if "owner_id" in patch and patch["owner_id"]:
        if not caps.get("can_work_manage") and patch["owner_id"] != existing.get("owner_id"):
            if existing.get("owner_id") != user["id"]:
                raise HTTPException(status_code=403, detail="can_work_manage required to reassign owner")
        if not await db.users.find_one({"id": patch["owner_id"], "active": {"$ne": False}}):
            raise HTTPException(status_code=400, detail="Invalid owner")
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to update")
    patch["updated_at"] = iso_now()
    await db.projects.update_one({"id": project_id}, {"$set": patch})
    after = {**existing, **patch}
    diff = field_diff(existing, after, PROJECT_FIELDS)
    await _work_activity(
        user, "project", project_id, "project_updated",
        f"Updated {existing.get('number')}", diff=diff,
    )
    notice = _project_notice(diff, existing.get("number") or "")
    if notice:
        ntype, title = notice
        await _inbox(
            user, _project_audience(existing, after),
            source="project", ntype=ntype, title=title,
            body=after.get("name") or "",
            entity_type="project", entity_id=project_id,
        )
    return await _enrich_project(await db.projects.find_one({"id": project_id}, {"_id": 0}))


# ---------- Task helpers ----------
def _build_task_filter(
    *,
    status: Optional[str],
    project_id: Optional[str],
    assignee_id: Optional[str],
    category: Optional[str],
    task_type: Optional[str],
    mine: bool,
    overdue: bool,
    observer_id: Optional[str],
    due_bucket: Optional[str],
    q: Optional[str],
    user: dict,
) -> dict:
    filt: dict = {}
    if status:
        filt["status"] = status
    if project_id:
        filt["project_id"] = project_id
    tt = task_type or category
    if tt:
        filt["task_type"] = _normalize_task_type(tt)
    if is_own_work_role(user):
        # Freelancer: only assigned or observing
        filt["$or"] = [
            {"assignee_id": user["id"]},
            {"observer_ids": user["id"]},
        ]
    elif mine:
        filt["assignee_id"] = user["id"]
    elif assignee_id:
        filt["assignee_id"] = assignee_id
    if observer_id and not is_own_work_role(user):
        filt["observer_ids"] = observer_id
    today_s = today().isoformat()
    if due_bucket:
        filt.update(_due_bucket_filter(due_bucket, today_s))
    elif overdue:
        filt["due_date"] = {"$lt": today_s}
        filt["status"] = {"$in": list(OPEN_STATUSES)}
    if q and q.strip():
        q_clause = [
            {"title": {"$regex": q.strip(), "$options": "i"}},
            {"number": {"$regex": q.strip(), "$options": "i"}},
        ]
        if "$or" in filt:
            filt = {"$and": [{"$or": filt.pop("$or")}, {"$or": q_clause}]}
        else:
            filt["$or"] = q_clause
    return filt


def _freelancer_can_access_task(task: dict, user: dict) -> bool:
    if not is_own_work_role(user):
        return True
    uid = user["id"]
    if task.get("assignee_id") == uid:
        return True
    if uid in (task.get("observer_ids") or []):
        return True
    return False


# ---------- Tasks: board / deadline / reminders (before {id}) ----------
@router.get("/tasks/board")
async def tasks_board(
    project_id: Optional[str] = None,
    assignee_id: Optional[str] = None,
    mine: bool = False,
    task_type: Optional[str] = None,
    q: Optional[str] = None,
    user=Depends(require_roles(*ALL_ROLES)),
):
    filt = _build_task_filter(
        status=None, project_id=project_id, assignee_id=assignee_id,
        category=None, task_type=task_type, mine=mine, overdue=False,
        observer_id=None, due_bucket=None, q=q, user=user,
    )
    filt["status"] = {"$in": list(KANBAN_COLUMNS)}
    rows = await db.tasks.find(filt, {"_id": 0}).sort("updated_at", -1).to_list(500)
    enriched = [await _enrich_task(r) for r in rows]
    columns = []
    for st in KANBAN_COLUMNS:
        columns.append({
            "status": st,
            "tasks": [t for t in enriched if t.get("status") == st],
        })
    return {"columns": columns}


@router.get("/tasks/deadline")
async def tasks_deadline(
    project_id: Optional[str] = None,
    assignee_id: Optional[str] = None,
    mine: bool = False,
    task_type: Optional[str] = None,
    q: Optional[str] = None,
    user=Depends(require_roles(*ALL_ROLES)),
):
    filt = _build_task_filter(
        status=None, project_id=project_id, assignee_id=assignee_id,
        category=None, task_type=task_type, mine=mine, overdue=False,
        observer_id=None, due_bucket=None, q=q, user=user,
    )
    filt["status"] = {"$in": list(OPEN_STATUSES)}
    rows = await db.tasks.find(filt, {"_id": 0}).sort("due_date", 1).to_list(500)
    today_s = today().isoformat()
    buckets = {k: [] for k in ("overdue", "today", "tomorrow", "week", "none", "later")}
    for r in rows:
        t = await _enrich_task(r)
        buckets[_classify_due(t.get("due_date"), today_s)].append(t)
    return {
        "buckets": [
            {"key": k, "tasks": buckets[k]}
            for k in ("overdue", "today", "tomorrow", "week", "later", "none")
        ]
    }


@router.get("/tasks/reminders/due")
async def reminders_due(user=Depends(require_roles(*ALL_ROLES))):
    now = iso_now()
    rows = await db.tasks.find(
        {
            "reminder_at": {"$lte": now, "$type": "string"},
            "reminder_sent": {"$ne": True},
            "status": {"$in": list(OPEN_STATUSES)},
        },
        {"_id": 0},
    ).sort("reminder_at", 1).to_list(100)
    return [await _enrich_task(r) for r in rows]


@router.get("/tasks")
async def list_tasks(
    status: Optional[str] = None,
    project_id: Optional[str] = None,
    assignee_id: Optional[str] = None,
    category: Optional[str] = None,
    task_type: Optional[str] = None,
    mine: bool = False,
    overdue: bool = False,
    observer_id: Optional[str] = None,
    due_bucket: Optional[str] = None,
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    user=Depends(require_roles(*ALL_ROLES)),
):
    from list_query import apply_date_range
    filt = _build_task_filter(
        status=status, project_id=project_id, assignee_id=assignee_id,
        category=category, task_type=task_type, mine=mine, overdue=overdue,
        observer_id=observer_id, due_bucket=due_bucket, q=q, user=user,
    )
    apply_date_range(filt, "due_date", date_from or "", date_to or "")
    rows = await db.tasks.find(filt, {"_id": 0}).sort("updated_at", -1).to_list(limit)
    return [await _enrich_task(r) for r in rows]


@router.post("/tasks")
async def create_task(body: TaskIn, user=Depends(require_capability("can_work_write"))):
    if is_own_work_role(user):
        raise HTTPException(status_code=403, detail="Freelancers cannot create tasks")
    status = body.status
    priority = body.priority
    task_type = _normalize_task_type(body.task_type or body.category)
    assignee_id = body.assignee_id
    if body.quick_testing:
        task_type = "testing"
        priority = "high"
        status = status if status in TASK_STATUSES else "todo"
        if not assignee_id:
            assignee_id = user["id"]
    _validate_status(status, TASK_STATUSES, "status")
    _validate_priority(priority)
    _validate_task_type(task_type)
    if body.project_id and not await db.projects.find_one({"id": body.project_id}):
        raise HTTPException(status_code=404, detail="Project not found")
    if assignee_id and not await db.users.find_one({"id": assignee_id, "active": {"$ne": False}}):
        raise HTTPException(status_code=400, detail="Invalid assignee")
    observers = await _valid_user_ids(body.observer_ids)
    now = iso_now()
    number = await next_number("TSK", today())
    doc = {
        "id": new_id(),
        "number": number,
        "title": body.title.strip(),
        "description": body.description or "",
        "status": status,
        "priority": priority,
        "task_type": task_type,
        "category": task_type,
        "project_id": body.project_id,
        "assignee_id": assignee_id,
        "observer_ids": observers,
        "due_date": body.due_date,
        "start_date": body.start_date,
        "reminder_at": body.reminder_at,
        "reminder_sent": False,
        "checklist": [],
        "attachment_ids": [],
        "tags": body.tags or [],
        "started_at": None,
        "completed_at": None,
        "created_by": user["id"],
        "created_at": now,
        "updated_at": now,
    }
    if status == "in_progress":
        doc["started_at"] = now
    await db.tasks.insert_one(doc)
    await _work_activity(user, "task", doc["id"], "task_created", f"Created {number}")
    if assignee_id:
        await _work_activity(
            user, "task", doc["id"], "task_assigned", f"Assigned {number}",
            diff={"assignee_id": {"old": None, "new": assignee_id}},
        )
    if observers:
        await _work_activity(
            user, "task", doc["id"], "observer_added",
            f"Observers set ({len(observers)})",
            diff={"observer_ids": {"old": [], "new": observers}},
        )
    if body.reminder_at:
        await _work_activity(
            user, "task", doc["id"], "reminder_set",
            f"Reminder {body.reminder_at}",
            diff={"reminder_at": {"old": None, "new": body.reminder_at}},
        )
    if assignee_id or observers:
        ntype = "task_assigned" if assignee_id else "observer_added"
        title = f"Assigned {number}" if assignee_id else f"Watching {number}"
        await _inbox(
            user, _task_audience(doc),
            source="task", ntype=ntype, title=title,
            body=doc["title"],
            entity_type="task", entity_id=doc["id"],
        )
    return await _enrich_task(doc)


@router.get("/tasks/{task_id}")
async def get_task(task_id: str, user=Depends(require_roles(*ALL_ROLES))):
    t = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    if not _freelancer_can_access_task(t, user):
        raise HTTPException(status_code=403, detail="Not allowed to view this task")
    return await _enrich_task(t)


@router.patch("/tasks/{task_id}")
async def patch_task(
    task_id: str,
    body: TaskPatch,
    user=Depends(require_capability("can_work_write")),
):
    existing = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Task not found")
    if not _freelancer_can_access_task(existing, user):
        raise HTTPException(status_code=403, detail="Not allowed to update this task")
    existing = _migrate_task_doc(existing)
    caps = await user_capabilities(user)
    patch = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    # allow clearing reminder_at with null
    raw = body.model_dump(exclude_unset=True)
    if "reminder_at" in raw and raw["reminder_at"] is None:
        patch["reminder_at"] = None
        patch["reminder_sent"] = False

    if is_own_work_role(user) and "assignee_id" in patch:
        raise HTTPException(status_code=403, detail="Freelancers cannot reassign tasks")

    if "task_type" in patch or "category" in patch:
        tt = _normalize_task_type(patch.get("task_type") or patch.get("category"))
        _validate_task_type(tt)
        patch["task_type"] = tt
        patch["category"] = tt
    if "status" in patch and patch["status"] is not None:
        _validate_status(patch["status"], TASK_STATUSES, "status")
        if patch["status"] == "in_progress" and not existing.get("started_at"):
            patch["started_at"] = iso_now()
        if patch["status"] == "done" and not existing.get("completed_at"):
            patch["completed_at"] = iso_now()
    if "priority" in patch and patch["priority"] is not None:
        _validate_priority(patch["priority"])
    if "observer_ids" in patch and patch["observer_ids"] is not None:
        if is_own_work_role(user):
            raise HTTPException(status_code=403, detail="Freelancers cannot change observers")
        patch["observer_ids"] = await _valid_user_ids(patch["observer_ids"])
    if "assignee_id" in patch:
        new_a = patch["assignee_id"]
        old_a = existing.get("assignee_id")
        if new_a != old_a and not caps.get("can_work_manage"):
            allowed = (
                not old_a
                or old_a == user["id"]
                or existing.get("created_by") == user["id"]
            )
            if not allowed:
                raise HTTPException(status_code=403, detail="can_work_manage required to reassign")
        if new_a and not await db.users.find_one({"id": new_a, "active": {"$ne": False}}):
            raise HTTPException(status_code=400, detail="Invalid assignee")
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to update")
    patch["updated_at"] = iso_now()
    await db.tasks.update_one({"id": task_id}, {"$set": patch})
    after = {**existing, **patch}
    diff = field_diff(existing, after, TASK_FIELDS)
    if not diff:
        return await _enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))
    number = existing.get("number") or ""
    action = "task_updated"
    if "status" in diff:
        action = "status_changed"
    elif "assignee_id" in diff:
        action = "assignee_changed"
    notice = _task_notice(diff, number)
    summary = notice[1] if notice else f"Updated {number}"
    await _work_activity(
        user, "task", task_id, action,
        summary, diff=diff,
    )
    if notice:
        ntype, title = notice
        await _inbox(
            user, _task_audience(existing, after),
            source="task", ntype=ntype, title=title,
            body=after.get("title") or "",
            entity_type="task", entity_id=task_id,
        )
    return await _enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@router.post("/tasks/{task_id}/start")
async def start_task(task_id: str, user=Depends(require_capability("can_work_write"))):
    existing = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Task not found")
    if not _freelancer_can_access_task(existing, user):
        raise HTTPException(status_code=403, detail="Not allowed to update this task")
    now = iso_now()
    patch = {
        "status": "in_progress",
        "started_at": existing.get("started_at") or now,
        "updated_at": now,
    }
    await db.tasks.update_one({"id": task_id}, {"$set": patch})
    await _work_activity(
        user, "task", task_id, "task_started", f"Started {existing.get('number')}",
        diff={"status": {"old": existing.get("status"), "new": "in_progress"}},
    )
    await _inbox(
        user, _task_audience(existing),
        source="task", ntype="task_started",
        title=f"Started {existing.get('number')}",
        body=existing.get("title") or "",
        entity_type="task", entity_id=task_id,
    )
    return await _enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@router.post("/tasks/{task_id}/complete")
async def complete_task(task_id: str, user=Depends(require_capability("can_work_write"))):
    existing = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Task not found")
    if not _freelancer_can_access_task(existing, user):
        raise HTTPException(status_code=403, detail="Not allowed to update this task")
    now = iso_now()
    patch = {
        "status": "done",
        "completed_at": now,
        "updated_at": now,
    }
    if not existing.get("started_at"):
        patch["started_at"] = now
    await db.tasks.update_one({"id": task_id}, {"$set": patch})
    await _work_activity(
        user, "task", task_id, "task_completed", f"Completed {existing.get('number')}",
        diff={"status": {"old": existing.get("status"), "new": "done"}},
    )
    await _inbox(
        user, _task_audience(existing),
        source="task", ntype="task_completed",
        title=f"Completed {existing.get('number')}",
        body=existing.get("title") or "",
        entity_type="task", entity_id=task_id,
    )
    return await _enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@router.put("/tasks/{task_id}/observers")
async def put_observers(
    task_id: str,
    body: ObserversIn,
    user=Depends(require_capability("can_work_write")),
):
    existing = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Task not found")
    old = existing.get("observer_ids") or []
    new = await _valid_user_ids(body.observer_ids)
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {"observer_ids": new, "updated_at": iso_now()}},
    )
    await _work_activity(
        user, "task", task_id, "observer_added" if len(new) >= len(old) else "observer_removed",
        f"Observers updated ({len(new)})",
        diff={"observer_ids": {"old": old, "new": new}},
    )
    if set(new) != set(old):
        added = set(new) - set(old)
        merged = {**existing, "observer_ids": new}
        await _inbox(
            user, _task_audience(existing, merged),
            source="task",
            ntype="observer_added" if added else "observer_removed",
            title=f"Observers updated on {existing.get('number')}",
            body=existing.get("title") or "",
            entity_type="task", entity_id=task_id,
        )
    return await _enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@router.put("/tasks/{task_id}/checklist")
async def put_checklist(
    task_id: str,
    body: ChecklistIn,
    user=Depends(require_capability("can_work_write")),
):
    existing = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Task not found")
    items = []
    for i, it in enumerate(body.items):
        items.append({
            "id": it.id or new_id(),
            "text": it.text.strip(),
            "done": bool(it.done),
            "sort_order": it.sort_order if it.sort_order else i,
        })
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {"checklist": items, "updated_at": iso_now()}},
    )
    await _work_activity(
        user, "task", task_id, "checklist_updated",
        f"Checklist ({len(items)} items)",
        diff={"checklist_count": {"old": len(existing.get("checklist") or []), "new": len(items)}},
    )
    return await _enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@router.post("/tasks/{task_id}/attachments")
async def upload_task_attachment(
    task_id: str,
    file: UploadFile = File(...),
    user=Depends(require_capability("can_work_write")),
):
    existing = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Task not found")
    ids = list(existing.get("attachment_ids") or [])
    if len(ids) >= MAX_TASK_ATTACHMENTS:
        raise HTTPException(status_code=400, detail=f"Max {MAX_TASK_ATTACHMENTS} attachments")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    ctype = validate_upload(data, file.content_type, file.filename or "")
    fid = new_id()
    ext = (file.filename or "bin").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "bin"
    path = f"{storage.APP_NAME}/tasks/{task_id}/{fid}.{ext}"
    storage.put_object(path, data, ctype)
    await db.files.insert_one({
        "id": fid,
        "storage_path": path,
        "original_filename": file.filename,
        "content_type": ctype,
        "size": len(data),
        "is_deleted": False,
        "created_at": iso_now(),
    })
    ids.append(fid)
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {"attachment_ids": ids, "updated_at": iso_now()}},
    )
    await _work_activity(
        user, "task", task_id, "attachment_added",
        f"Attached {file.filename}",
        diff={"attachment_id": {"old": None, "new": fid}},
    )
    await _inbox(
        user, _task_audience(existing),
        source="task", ntype="attachment_added",
        title=f"File on {existing.get('number')}",
        body=file.filename or "",
        entity_type="task", entity_id=task_id,
    )
    return await _enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@router.delete("/tasks/{task_id}/attachments/{file_id}")
async def delete_task_attachment(
    task_id: str,
    file_id: str,
    user=Depends(require_capability("can_work_write")),
):
    existing = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Task not found")
    ids = [i for i in (existing.get("attachment_ids") or []) if i != file_id]
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {"attachment_ids": ids, "updated_at": iso_now()}},
    )
    await db.files.update_one({"id": file_id}, {"$set": {"is_deleted": True}})
    await _work_activity(
        user, "task", task_id, "attachment_removed",
        "Attachment removed",
        diff={"attachment_id": {"old": file_id, "new": None}},
    )
    await _inbox(
        user, _task_audience(existing),
        source="task", ntype="attachment_removed",
        title=f"File removed on {existing.get('number')}",
        body="",
        entity_type="task", entity_id=task_id,
    )
    return await _enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@router.post("/tasks/{task_id}/reminders")
async def set_reminder(
    task_id: str,
    body: ReminderIn,
    user=Depends(require_capability("can_work_write")),
):
    existing = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Task not found")
    old = existing.get("reminder_at")
    patch = {
        "reminder_at": body.reminder_at,
        "reminder_sent": False,
        "updated_at": iso_now(),
    }
    await db.tasks.update_one({"id": task_id}, {"$set": patch})
    await _work_activity(
        user, "task", task_id, "reminder_set" if body.reminder_at else "reminder_cleared",
        f"Reminder {body.reminder_at or 'cleared'}",
        diff={"reminder_at": {"old": old, "new": body.reminder_at}},
    )
    await _inbox(
        user, _task_audience(existing),
        source="task",
        ntype="reminder_set" if body.reminder_at else "reminder_cleared",
        title=f"Reminder updated on {existing.get('number')}",
        body=existing.get("title") or "",
        entity_type="task", entity_id=task_id,
    )
    return await _enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


# ---------- Comments / activity ----------
@router.post("/projects/{project_id}/comments")
async def project_comment(
    project_id: str,
    body: CommentIn,
    user=Depends(require_capability("can_work_write")),
):
    project = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    text = body.body.strip()
    mentions = await _collect_mentions(text, body.mention_ids)
    row = await _work_activity(
        user, "project", project_id, "comment", "Comment added",
        comment=text, mention_ids=mentions,
    )
    await _fanout_comment(
        user,
        audience=_project_audience(project),
        number=project.get("number") or "",
        text=text,
        entity_type="project",
        entity_id=project_id,
        activity_id=row["id"],
        mention_ids=mentions,
    )
    return row


@router.post("/tasks/{task_id}/comments")
async def task_comment(
    task_id: str,
    body: CommentIn,
    user=Depends(require_capability("can_work_write")),
):
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not _freelancer_can_access_task(task, user):
        raise HTTPException(status_code=403, detail="Not allowed to comment on this task")
    text = body.body.strip()
    mentions = await _collect_mentions(text, body.mention_ids)
    row = await _work_activity(
        user, "task", task_id, "comment", "Comment added",
        comment=text, mention_ids=mentions,
    )
    await _fanout_comment(
        user,
        audience=_task_audience(task),
        number=task.get("number") or "",
        text=text,
        entity_type="task",
        entity_id=task_id,
        activity_id=row["id"],
        mention_ids=mentions,
    )
    return row


@router.get("/activity")
async def list_activity(
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    user=Depends(require_roles(*ALL_ROLES)),
):
    filt: dict = {}
    if entity_type:
        filt["entity_type"] = entity_type
    if entity_id:
        filt["entity_id"] = entity_id
    rows = await db.work_activity.find(filt, {"_id": 0}).sort("ts", -1).to_list(limit)
    return await _with_mention_state(rows)


# ---------- Dashboard / report ----------
@router.get("/dashboard")
async def work_dashboard(user=Depends(require_roles(*ALL_ROLES))):
    today_s = today().isoformat()
    open_task_q = {"status": {"$in": list(OPEN_STATUSES)}}
    my_open = await db.tasks.count_documents({**open_task_q, "assignee_id": user["id"]})
    overdue = await db.tasks.count_documents(
        {**open_task_q, "due_date": {"$lt": today_s}, "assignee_id": user["id"]}
    )
    all_overdue = await db.tasks.count_documents({**open_task_q, "due_date": {"$lt": today_s}})
    active_projects = await db.projects.count_documents({"status": {"$in": ["planned", "active"]}})
    now = iso_now()
    reminders_due = await db.tasks.count_documents({
        "reminder_at": {"$lte": now, "$type": "string"},
        "reminder_sent": {"$ne": True},
        "status": {"$in": list(OPEN_STATUSES)},
    })
    by_status = {}
    for s in TASK_STATUSES:
        by_status[s] = await db.tasks.count_documents({"status": s})

    pipeline = [
        {"$match": open_task_q},
        {"$group": {"_id": "$assignee_id", "open": {"$sum": 1}}},
        {"$sort": {"open": -1}},
        {"$limit": 20},
    ]
    agg = await db.tasks.aggregate(pipeline).to_list(20)
    ids = [a["_id"] for a in agg if a["_id"]]
    umap = await _user_map(ids)
    workload = [
        {
            "assignee_id": a["_id"],
            "assignee": umap.get(a["_id"]) or {"name": "Unassigned"},
            "open": a["open"],
        }
        for a in agg
    ]

    recent = await db.tasks.find(open_task_q, {"_id": 0}).sort("updated_at", -1).to_list(8)
    return {
        "my_open": my_open,
        "my_overdue": overdue,
        "all_overdue": all_overdue,
        "reminders_due": reminders_due,
        "active_projects": active_projects,
        "by_status": by_status,
        "workload": workload,
        "recent_open": [await _enrich_task(t) for t in recent],
    }


@router.get("/report")
async def work_report(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user=Depends(require_roles(*ALL_ROLES)),
):
    task_filt: dict = {}
    if from_date or to_date:
        created: dict = {}
        if from_date:
            created["$gte"] = from_date
        if to_date:
            created["$lte"] = to_date + "T23:59:59"
        if created:
            task_filt["created_at"] = created

    tasks = await db.tasks.find(task_filt, {"_id": 0}).to_list(2000)
    projects = await db.projects.find({}, {"_id": 0}).to_list(500)

    by_category: dict = {}
    by_assignee: dict = {}
    by_status: dict = {}
    for t in tasks:
        t = _migrate_task_doc(t)
        key = t.get("task_type") or "other"
        by_category[key] = by_category.get(key, 0) + 1
        aid = t.get("assignee_id") or "unassigned"
        by_assignee[aid] = by_assignee.get(aid, 0) + 1
        by_status[t.get("status") or "todo"] = by_status.get(t.get("status") or "todo", 0) + 1

    umap = await _user_map(list(by_assignee.keys()))
    assignee_rows = [
        {
            "assignee_id": k,
            "name": (umap.get(k) or {}).get("name") or "Unassigned",
            "count": v,
        }
        for k, v in sorted(by_assignee.items(), key=lambda x: -x[1])
    ]

    return {
        "totals": {
            "tasks": len(tasks),
            "projects": len(projects),
            "open_tasks": sum(1 for t in tasks if _normalize_status(t.get("status")) in OPEN_STATUSES),
            "done_tasks": sum(1 for t in tasks if t.get("status") == "done"),
        },
        "by_category": [{"category": k, "count": v} for k, v in sorted(by_category.items())],
        "by_status": [{"status": k, "count": v} for k, v in sorted(by_status.items())],
        "by_assignee": assignee_rows,
        "projects_by_status": {
            s: sum(1 for p in projects if p.get("status") == s) for s in PROJECT_STATUSES
        },
    }
