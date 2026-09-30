"""Per-user notification inbox.

Activity logs stay in work_activity / audit_logs. This module writes one
inbox row per recipient and never includes the actor.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from typing import Iterable

from core import db, iso_now, new_id, utcnow

logger = logging.getLogger("notifications")

OPEN_TASK_STATUSES = (
    "backlog", "todo", "in_progress", "in_review",
    "testing_rejected", "ready_to_live", "blocked",
)
MENTION_NUDGE = timedelta(minutes=15)
MENTION_MAX_AGE = timedelta(hours=24)


def public_notification(doc: dict) -> dict:
    """Shape stored rows, including legacy ticket docs that only have ticket_id."""
    ticket_id = doc.get("ticket_id") or ""
    href = doc.get("href") or (f"/tickets/{ticket_id}" if ticket_id else "")
    entity_id = doc.get("entity_id") or ticket_id or ""
    entity_type = doc.get("entity_type") or ("ticket" if ticket_id else "")
    source = doc.get("source") or ("ticket" if ticket_id else "")
    return {
        "id": doc.get("id"),
        "user_id": doc.get("user_id"),
        "source": source,
        "type": doc.get("type") or "",
        "title": doc.get("title") or "",
        "body": doc.get("body") or "",
        "entity_type": entity_type,
        "entity_id": entity_id,
        "href": href,
        "actor_id": doc.get("actor_id") or "",
        "actor_name": doc.get("actor_name") or "",
        "ticket_id": ticket_id or None,
        "read": bool(doc.get("read")),
        "read_at": doc.get("read_at"),
        "ts": doc.get("ts"),
        "activity_id": doc.get("activity_id") or "",
        "bump_count": int(doc.get("bump_count") or 0),
        "repeat_until_read": bool(doc.get("repeat_until_read")),
    }


async def notify_users(
    user_ids: Iterable[str | None],
    *,
    actor_id: str | None = None,
    actor_name: str = "",
    source: str,
    ntype: str,
    title: str,
    body: str = "",
    entity_type: str,
    entity_id: str,
    href: str,
    ticket_id: str | None = None,
    activity_id: str | None = None,
    repeat_until_read: bool = False,
) -> int:
    """Insert one unread row per recipient. Drops blanks, duplicates, and the actor.

    Insert failures are logged and swallowed so the originating write still succeeds.
    """
    actor = (actor_id or "").strip()
    seen: set[str] = set()
    recipients: list[str] = []
    for raw in user_ids:
        uid = raw.strip() if isinstance(raw, str) else ""
        if not uid or uid == actor or uid in seen:
            continue
        seen.add(uid)
        recipients.append(uid)
    if not recipients:
        return 0
    now = iso_now()
    docs = []
    for uid in recipients:
        doc = {
            "id": new_id(),
            "user_id": uid,
            "source": source,
            "type": ntype,
            "title": title,
            "body": (body or "")[:500],
            "entity_type": entity_type,
            "entity_id": entity_id,
            "href": href,
            "actor_id": actor or None,
            "actor_name": actor_name or "",
            "read": False,
            "read_at": None,
            "ts": now,
            "created_at": now,
            "bump_count": 0,
            "repeat_until_read": bool(repeat_until_read),
        }
        if ticket_id:
            doc["ticket_id"] = ticket_id
        if activity_id:
            doc["activity_id"] = activity_id
        docs.append(doc)
    try:
        await db.notifications.insert_many(docs)
    except Exception:
        logger.exception("notification insert failed source=%s entity=%s", source, entity_id)
        return 0
    return len(docs)


async def sweep_due_reminders(limit: int = 50) -> int:
    """Claim open tasks whose reminder is due and write one inbox row each.

    find_one_and_update is the claim, so overlapping API processes do not double-send.
    """
    sent = 0
    now = iso_now()
    for _ in range(limit):
        try:
            task = await db.tasks.find_one_and_update(
                {
                    "reminder_at": {"$lte": now, "$type": "string"},
                    "reminder_sent": {"$ne": True},
                    "status": {"$in": list(OPEN_TASK_STATUSES)},
                },
                {"$set": {"reminder_sent": True}},
                projection={
                    "_id": 0,
                    "id": 1,
                    "number": 1,
                    "title": 1,
                    "assignee_id": 1,
                    "created_by": 1,
                },
            )
        except Exception:
            logger.exception("reminder claim failed")
            break
        if not task or not task.get("id"):
            break
        recipient = task.get("assignee_id") or task.get("created_by")
        number = task.get("number") or "task"
        await notify_users(
            [recipient],
            actor_id=None,
            source="task",
            ntype="reminder_due",
            title=f"Reminder {number}",
            body=task.get("title") or "",
            entity_type="task",
            entity_id=task["id"],
            href=f"/tasks/{task['id']}",
        )
        sent += 1
    return sent


async def bump_unseen_mentions() -> int:
    """Move still-unread mentions back to the top every 15 minutes, for up to 24 hours."""
    now = utcnow()
    cutoff = (now - MENTION_NUDGE).isoformat()
    oldest = (now - MENTION_MAX_AGE).isoformat()
    try:
        res = await db.notifications.update_many(
            {
                "type": "mention",
                "read": False,
                "repeat_until_read": True,
                "ts": {"$lte": cutoff},
                "created_at": {"$gte": oldest},
            },
            {"$set": {"ts": iso_now()}, "$inc": {"bump_count": 1}},
        )
    except Exception:
        logger.exception("mention bump failed")
        return 0
    return int(res.modified_count or 0)


async def reminder_sweep_loop(stop: asyncio.Event, interval: float = 60.0) -> None:
    while not stop.is_set():
        try:
            n = await sweep_due_reminders()
            if n:
                logger.info("reminder sweep sent=%s", n)
            bumped = await bump_unseen_mentions()
            if bumped:
                logger.info("mention bump count=%s", bumped)
        except Exception:
            logger.exception("reminder sweep failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue
