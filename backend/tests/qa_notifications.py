#!/usr/bin/env python3
"""Inbox QA: NTF-01..04 — fan-out, isolation, reminder claim."""
from __future__ import annotations

import asyncio
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

BASE = "http://127.0.0.1:8000"
PASS = 0
FAIL = 0


def req(method: str, path: str, body=None, cookie: str | None = None):
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if cookie:
        headers["Cookie"] = cookie
        for part in cookie.split(";"):
            part = part.strip()
            if part.startswith("access_token="):
                headers["Authorization"] = f"Bearer {part.split('=', 1)[1]}"
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=45) as resp:
            raw_b = resp.read()
            text = raw_b.decode() if raw_b else "{}"
            payload = json.loads(text) if text.strip() else {}
            return resp.status, payload
    except urllib.error.HTTPError as e:
        raw_b = e.read()
        text = raw_b.decode() if raw_b else "{}"
        try:
            payload = json.loads(text) if text.strip() else {}
        except Exception:
            payload = {"detail": text}
        return e.code, payload


def login(email: str, password: str) -> str:
    status, data = req("POST", "/api/auth/login", {"email": email, "password": password})
    if status != 200 or not data.get("access_token"):
        raise RuntimeError(f"login failed {email}: {status} {data}")
    return f"access_token={data['access_token']}"


def me(cookie: str) -> dict:
    status, data = req("GET", "/api/auth/me", cookie=cookie)
    if status != 200:
        raise RuntimeError(f"me failed: {status} {data}")
    return data


def check(cid: str, cond: bool, detail: str = ""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"PASS {cid} {detail}")
    else:
        FAIL += 1
        print(f"FAIL {cid} {detail}")


def of_task(rows, task_id: str, ntype: str) -> list:
    return [r for r in (rows or []) if r.get("entity_id") == task_id and r.get("type") == ntype]


def main():
    admin = login("gayatribachauhan99@gmail.com", "TechHind@2026")
    dev = login("dev@techhind.in", "Dev@12345")
    ops = login("ops@techhind.in", "Ops@12345")
    dev_id = me(dev)["id"]
    ops_id = me(ops)["id"]

    st, task, = req(
        "POST",
        "/api/work/tasks",
        {
            "title": "NTF inbox QA",
            "task_type": "development",
            "status": "todo",
            "priority": "normal",
            "assignee_id": dev_id,
            "observer_ids": [ops_id],
        },
        cookie=admin,
    )
    check("NTF-pre", st == 200 and task.get("id"), f"st={st}")
    tid = task.get("id")
    if not tid:
        print(f"\nResult: {PASS} passed, {FAIL} failed")
        return 1

    st, _, = req("POST", f"/api/work/tasks/{tid}/comments", {"body": "Please review the inbox"}, cookie=admin)
    check("NTF-comment", st == 200, f"st={st}")

    st, admin_rows = req("GET", "/api/notifications?limit=100", cookie=admin)
    st_d, dev_rows = req("GET", "/api/notifications?limit=100", cookie=dev)
    st_o, ops_rows = req("GET", "/api/notifications?limit=100", cookie=ops)
    admin_comments = of_task(admin_rows, tid, "comment")
    dev_comments = of_task(dev_rows, tid, "comment")
    ops_comments = of_task(ops_rows, tid, "comment")
    dev_href = dev_comments[0].get("href") if dev_comments else None
    check(
        "NTF-01",
        st == 200 and st_d == 200 and len(admin_comments) == 0 and len(dev_comments) == 1,
        f"admin={len(admin_comments)} dev={len(dev_comments)}",
    )
    check(
        "NTF-02",
        st_o == 200 and len(ops_comments) == 1 and dev_href == f"/tasks/{tid}",
        f"ops={len(ops_comments)} href={dev_href}",
    )

    ops_nid = ops_comments[0]["id"] if ops_comments else ""
    st, denied = req("POST", f"/api/notifications/{ops_nid}/read", cookie=dev)
    check("NTF-03", st == 404, f"st={st} {denied}")

    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    st, reminded = req(
        "POST",
        f"/api/work/tasks/{tid}/reminders",
        {"reminder_at": past},
        cookie=admin,
    )
    check("NTF-04pre", st == 200 and reminded.get("reminder_sent") is False, f"st={st}")

    from notifications import sweep_due_reminders

    async def claim():
        for _ in range(8):
            await sweep_due_reminders(limit=100)
            status, row = req("GET", f"/api/work/tasks/{tid}", cookie=admin)
            if status == 200 and row.get("reminder_sent") is True:
                break
        else:
            return False, 0, 0, 0
        _, dev_after = req("GET", "/api/notifications?limit=100", cookie=dev)
        first = len(of_task(dev_after, tid, "reminder_due"))
        extra = await sweep_due_reminders(limit=100)
        _, dev_final = req("GET", "/api/notifications?limit=100", cookie=dev)
        second = len(of_task(dev_final, tid, "reminder_due"))
        return True, first, second, extra

    try:
        claimed, first, second, extra = asyncio.run(claim())
    except Exception as exc:
        claimed, first, second, extra = False, 0, 0, 0
        print(f"sweep error: {exc}")
    check(
        "NTF-04",
        claimed and first == 1 and second == 1,
        f"claimed={claimed} first={first} second={second} extra_sweep={extra}",
    )

    print(f"\nResult: {PASS} passed, {FAIL} failed")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
