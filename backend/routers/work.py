"""Projects, tasks, work activity, workload dashboard & report."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core import (
    ALL_ROLES,
    audit,
    db,
    field_diff,
    iso_now,
    new_id,
    next_number,
    require_capability,
    require_roles,
    today,
    user_capabilities,
)
from rbac_seed import WORK_CATEGORIES

router = APIRouter(prefix="/api/work", tags=["work"])

PROJECT_STATUSES = ("planned", "active", "on_hold", "completed", "cancelled")
TASK_STATUSES = ("todo", "in_progress", "blocked", "done", "cancelled")
PRIORITIES = ("low", "normal", "high", "urgent")
PROJECT_FIELDS = [
    "name", "description", "status", "priority", "customer_id", "owner_id",
    "member_ids", "start_date", "due_date", "tags",
]
TASK_FIELDS = [
    "title", "description", "status", "priority", "category", "project_id",
    "assignee_id", "due_date", "start_date", "tags",
]


def _strip(doc: dict | None) -> dict | None:
    if not doc:
        return None
    doc = dict(doc)
    doc.pop("_id", None)
    return doc


async def _work_activity(
    user: dict,
    entity_type: str,
    entity_id: str,
    action: str,
    summary: str,
    diff: dict | None = None,
    comment: str | None = None,
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
        "user_id": user.get("id"),
        "user_name": user.get("name"),
        "role": user.get("role"),
    }
    await db.work_activity.insert_one(row)
    await audit(user, action, entity_type, entity_id, summary, diff=diff)
    return _strip(row)


async def _user_map(ids: list) -> dict:
    ids = [i for i in ids if i]
    if not ids:
        return {}
    rows = await db.users.find(
        {"id": {"$in": ids}},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1},
    ).to_list(500)
    return {r["id"]: r for r in rows}


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


async def _enrich_task(t: dict) -> dict:
    t = _strip(t) or {}
    umap = await _user_map([t.get("assignee_id"), t.get("created_by")])
    t["assignee"] = umap.get(t.get("assignee_id"))
    t["creator"] = umap.get(t.get("created_by"))
    if t.get("project_id"):
        pr = await db.projects.find_one(
            {"id": t["project_id"]},
            {"_id": 0, "id": 1, "number": 1, "name": 1, "status": 1},
        )
        t["project"] = pr
    return t


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
    category: str = "other"
    project_id: Optional[str] = None
    assignee_id: Optional[str] = None
    due_date: Optional[str] = None
    start_date: Optional[str] = None
    tags: List[str] = []


class TaskPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    category: Optional[str] = None
    project_id: Optional[str] = None
    assignee_id: Optional[str] = None
    due_date: Optional[str] = None
    start_date: Optional[str] = None
    tags: Optional[List[str]] = None


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


def _validate_status(val: str, allowed: tuple, label: str):
    if val not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid {label}: {val}")


def _validate_priority(val: str):
    if val not in PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority: {val}")


def _validate_category(val: str):
    if val not in WORK_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category: {val}")


# ---------- Meta ----------
@router.get("/categories")
async def list_categories(user=Depends(require_roles(*ALL_ROLES))):
    masters = await db.masters.find_one({"id": "masters"}, {"_id": 0, "work_task_categories": 1})
    cats = (masters or {}).get("work_task_categories") or [{"name": c} for c in WORK_CATEGORIES]
    return cats


# ---------- Projects ----------
@router.get("/projects")
async def list_projects(
    status: Optional[str] = None,
    customer_id: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    user=Depends(require_roles(*ALL_ROLES)),
):
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
    rows = await db.projects.find(filt, {"_id": 0}).sort("updated_at", -1).to_list(limit)
    out = []
    for r in rows:
        out.append(await _enrich_project(r))
    return out


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
            # allow self-owned edits; reassignment needs manage
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
        user,
        "project",
        project_id,
        "project_updated",
        f"Updated {existing.get('number')}",
        diff=diff,
    )
    return await _enrich_project(await db.projects.find_one({"id": project_id}, {"_id": 0}))


# ---------- Tasks ----------
@router.get("/tasks")
async def list_tasks(
    status: Optional[str] = None,
    project_id: Optional[str] = None,
    assignee_id: Optional[str] = None,
    category: Optional[str] = None,
    mine: bool = False,
    overdue: bool = False,
    q: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    user=Depends(require_roles(*ALL_ROLES)),
):
    filt: dict = {}
    if status:
        filt["status"] = status
    if project_id:
        filt["project_id"] = project_id
    if category:
        filt["category"] = category
    if mine:
        filt["assignee_id"] = user["id"]
    elif assignee_id:
        filt["assignee_id"] = assignee_id
    if overdue:
        filt["due_date"] = {"$lt": today().isoformat()}
        filt["status"] = {"$nin": ["done", "cancelled"]}
    if q and q.strip():
        filt["$or"] = [
            {"title": {"$regex": q.strip(), "$options": "i"}},
            {"number": {"$regex": q.strip(), "$options": "i"}},
        ]
    rows = await db.tasks.find(filt, {"_id": 0}).sort("updated_at", -1).to_list(limit)
    return [await _enrich_task(r) for r in rows]


@router.post("/tasks")
async def create_task(body: TaskIn, user=Depends(require_capability("can_work_write"))):
    _validate_status(body.status, TASK_STATUSES, "status")
    _validate_priority(body.priority)
    _validate_category(body.category)
    if body.project_id and not await db.projects.find_one({"id": body.project_id}):
        raise HTTPException(status_code=404, detail="Project not found")
    if body.assignee_id and not await db.users.find_one(
        {"id": body.assignee_id, "active": {"$ne": False}}
    ):
        raise HTTPException(status_code=400, detail="Invalid assignee")
    now = iso_now()
    number = await next_number("TSK", today())
    doc = {
        "id": new_id(),
        "number": number,
        "title": body.title.strip(),
        "description": body.description or "",
        "status": body.status,
        "priority": body.priority,
        "category": body.category,
        "project_id": body.project_id,
        "assignee_id": body.assignee_id,
        "due_date": body.due_date,
        "start_date": body.start_date,
        "tags": body.tags or [],
        "created_by": user["id"],
        "created_at": now,
        "updated_at": now,
    }
    await db.tasks.insert_one(doc)
    await _work_activity(user, "task", doc["id"], "task_created", f"Created {number}")
    if body.assignee_id:
        await _work_activity(
            user,
            "task",
            doc["id"],
            "task_assigned",
            f"Assigned {number}",
            diff={"assignee_id": {"old": None, "new": body.assignee_id}},
        )
    return await _enrich_task(doc)


@router.get("/tasks/{task_id}")
async def get_task(task_id: str, user=Depends(require_roles(*ALL_ROLES))):
    t = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
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
    caps = await user_capabilities(user)
    patch = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if "status" in patch:
        _validate_status(patch["status"], TASK_STATUSES, "status")
    if "priority" in patch:
        _validate_priority(patch["priority"])
    if "category" in patch:
        _validate_category(patch["category"])
    if "assignee_id" in patch:
        new_a = patch["assignee_id"]
        old_a = existing.get("assignee_id")
        if new_a != old_a and not caps.get("can_work_manage"):
            # writers can assign if currently unassigned or self is assignee/creator
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
    await _work_activity(
        user,
        "task",
        task_id,
        "task_updated",
        f"Updated {existing.get('number')}",
        diff=diff,
    )
    return await _enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


# ---------- Comments / activity ----------
@router.post("/projects/{project_id}/comments")
async def project_comment(
    project_id: str,
    body: CommentIn,
    user=Depends(require_capability("can_work_write")),
):
    if not await db.projects.find_one({"id": project_id}):
        raise HTTPException(status_code=404, detail="Project not found")
    return await _work_activity(
        user,
        "project",
        project_id,
        "comment",
        "Comment added",
        comment=body.body.strip(),
    )


@router.post("/tasks/{task_id}/comments")
async def task_comment(
    task_id: str,
    body: CommentIn,
    user=Depends(require_capability("can_work_write")),
):
    if not await db.tasks.find_one({"id": task_id}):
        raise HTTPException(status_code=404, detail="Task not found")
    return await _work_activity(
        user,
        "task",
        task_id,
        "comment",
        "Comment added",
        comment=body.body.strip(),
    )


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
    return rows


# ---------- Dashboard / report ----------
@router.get("/dashboard")
async def work_dashboard(user=Depends(require_roles(*ALL_ROLES))):
    today_s = today().isoformat()
    open_task_q = {"status": {"$nin": ["done", "cancelled"]}}
    my_open = await db.tasks.count_documents({**open_task_q, "assignee_id": user["id"]})
    overdue = await db.tasks.count_documents(
        {**open_task_q, "due_date": {"$lt": today_s}, "assignee_id": user["id"]}
    )
    all_overdue = await db.tasks.count_documents({**open_task_q, "due_date": {"$lt": today_s}})
    active_projects = await db.projects.count_documents({"status": {"$in": ["planned", "active"]}})
    by_status = {}
    for s in TASK_STATUSES:
        by_status[s] = await db.tasks.count_documents({"status": s})

    # workload by assignee (open tasks)
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
        by_category[t.get("category") or "other"] = by_category.get(t.get("category") or "other", 0) + 1
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
            "open_tasks": sum(1 for t in tasks if t.get("status") not in ("done", "cancelled")),
            "done_tasks": sum(1 for t in tasks if t.get("status") == "done"),
        },
        "by_category": [{"category": k, "count": v} for k, v in sorted(by_category.items())],
        "by_status": [{"status": k, "count": v} for k, v in sorted(by_status.items())],
        "by_assignee": assignee_rows,
        "projects_by_status": {
            s: sum(1 for p in projects if p.get("status") == s) for s in PROJECT_STATUSES
        },
    }
