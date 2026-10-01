#!/usr/bin/env python3
"""Critical QA: Production Task Module (TSK-01..10)."""
from __future__ import annotations

import io
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "http://127.0.0.1:8000"
PASS = 0
FAIL = 0


def req(method: str, path: str, body=None, cookie: str | None = None, raw: bytes | None = None, ctype: str | None = None):
    data = raw
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if ctype:
        headers["Content-Type"] = ctype
    if cookie:
        headers["Cookie"] = cookie
        # also bearer from cookie token if present
        for part in cookie.split(";"):
            part = part.strip()
            if part.startswith("access_token="):
                headers["Authorization"] = f"Bearer {part.split('=', 1)[1]}"
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=45) as resp:
            raw_b = resp.read()
            text = raw_b.decode() if raw_b else "{}"
            try:
                payload = json.loads(text) if text.strip() else {}
            except Exception:
                payload = {"_raw": text}
            return resp.status, payload, resp.headers
    except urllib.error.HTTPError as e:
        raw_b = e.read()
        text = raw_b.decode() if raw_b else "{}"
        try:
            payload = json.loads(text) if text.strip() else {}
        except Exception:
            payload = {"detail": text}
        return e.code, payload, e.headers


def login(email: str, password: str) -> str:
    status, data, headers = req("POST", "/api/auth/login", {"email": email, "password": password})
    if status != 200:
        raise RuntimeError(f"login failed {email}: {status} {data}")
    token = data.get("access_token")
    if token:
        return f"access_token={token}"
    set_cookie = headers.get("Set-Cookie") or ""
    if "access_token=" in set_cookie:
        return set_cookie.split(";", 1)[0]
    raise RuntimeError(f"no token for {email}")


def check(cid: str, cond: bool, detail: str = ""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"PASS {cid} {detail}")
    else:
        FAIL += 1
        print(f"FAIL {cid} {detail}")


def multipart_file(field: str, filename: str, content: bytes, content_type: str = "text/plain"):
    boundary = "----TaskQABoundary7MA4YWxkTrZu0gW"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def main():
    admin = login("gayatribachauhan99@gmail.com", "TechHind@2026")
    st, users, _ = req("GET", "/api/users?active_only=true", cookie=admin)
    check("pre-users", st == 200 and len(users or []) >= 2, f"n={len(users or [])}")
    observer = next((u for u in users if u.get("role") == "developer"), users[0])
    assignee = next((u for u in users if u.get("role") == "qa"), users[-1])

    # TSK-01 create with type + observers
    st, task, _ = req(
        "POST",
        "/api/work/tasks",
        {
            "title": "TSK module QA task",
            "task_type": "development",
            "status": "todo",
            "priority": "normal",
            "assignee_id": assignee["id"],
            "observer_ids": [observer["id"]],
            "due_date": (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat(),
        },
        cookie=admin,
    )
    check("TSK-01", st == 200 and task.get("task_type") == "development" and observer["id"] in (task.get("observer_ids") or []), f"st={st}")
    tid = task.get("id")

    # TSK-02 start / complete
    st, started, _ = req("POST", f"/api/work/tasks/{tid}/start", cookie=admin)
    check("TSK-02a", st == 200 and started.get("status") == "in_progress" and started.get("started_at"), f"st={st}")
    st, done, _ = req("POST", f"/api/work/tasks/{tid}/complete", cookie=admin)
    check("TSK-02b", st == 200 and done.get("status") == "done" and done.get("completed_at"), f"st={st}")

    # reopen for further tests
    st, _, _ = req("PATCH", f"/api/work/tasks/{tid}", {"status": "todo"}, cookie=admin)

    # TSK-03 board
    st, board, _ = req("GET", "/api/work/tasks/board", cookie=admin)
    cols = {c["status"] for c in (board.get("columns") or [])}
    check("TSK-03", st == 200 and "todo" in cols and "in_progress" in cols, f"cols={cols}")

    # TSK-04 deadline
    st, dl, _ = req("GET", "/api/work/tasks/deadline", cookie=admin)
    keys = [b["key"] for b in (dl.get("buckets") or [])]
    check("TSK-04", st == 200 and "overdue" in keys and "today" in keys, f"keys={keys}")

    # TSK-05 checklist
    st, cl, _ = req(
        "PUT",
        f"/api/work/tasks/{tid}/checklist",
        {"items": [{"text": "Step 1", "done": False}, {"text": "Step 2", "done": True}]},
        cookie=admin,
    )
    check("TSK-05", st == 200 and len(cl.get("checklist") or []) == 2, f"st={st} n={len(cl.get('checklist') or [])}")

    # TSK-06 attachment (png allowed by validate_upload)
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    body, ctype = multipart_file("file", "qa-note.png", png, "image/png")
    st, att, _ = req("POST", f"/api/work/tasks/{tid}/attachments", cookie=admin, raw=body, ctype=ctype)
    check("TSK-06a", st == 200 and len(att.get("attachment_ids") or []) >= 1, f"st={st} {att}")
    fid = (att.get("attachment_ids") or [None])[0]
    st, att2, _ = req("DELETE", f"/api/work/tasks/{tid}/attachments/{fid}", cookie=admin)
    check("TSK-06b", st == 200 and fid not in (att2.get("attachment_ids") or []), f"st={st}")

    # TSK-06c markdown: browsers often send text/plain for .md
    body, ctype = multipart_file("file", "notes.md", b"# QA note\n", "text/plain")
    st, md_att, _ = req("POST", f"/api/work/tasks/{tid}/attachments", cookie=admin, raw=body, ctype=ctype)
    md_rows = [a for a in (md_att.get("attachments") or []) if str(a.get("original_filename") or "").endswith(".md")]
    md_row = md_rows[0] if md_rows else {}
    check(
        "TSK-06c",
        st == 200 and md_row.get("content_type") == "text/markdown",
        f"st={st} ctype={md_row.get('content_type')}",
    )
    md_fid = md_row.get("id")
    if md_fid:
        st, md_del, _ = req("DELETE", f"/api/work/tasks/{tid}/attachments/{md_fid}", cookie=admin)
        check("TSK-06d", st == 200 and md_fid not in (md_del.get("attachment_ids") or []), f"st={st}")
    else:
        check("TSK-06d", False, "no markdown attachment id")

    body, ctype = multipart_file("file", "notes.md", b"# not a logo\n", "text/plain")
    st, logo, _ = req("POST", "/api/settings/company/assets/logo", cookie=admin, raw=body, ctype=ctype)
    detail = str((logo or {}).get("detail") or "") if isinstance(logo, dict) else ""
    check("SET-MD", st == 400 and "webp" in detail.lower(), f"st={st} {detail}")

    # TSK-07 reminder
    rem = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat().replace("+00:00", "Z")
    st, rset, _ = req("POST", f"/api/work/tasks/{tid}/reminders", {"reminder_at": rem}, cookie=admin)
    check("TSK-07a", st == 200 and rset.get("reminder_at"), f"st={st}")
    st, due, _ = req("GET", "/api/work/tasks/reminders/due", cookie=admin)
    check("TSK-07b", st == 200 and any(t.get("id") == tid for t in (due or [])), f"st={st} n={len(due or [])}")

    # TSK-08 quick testing
    st, qt, _ = req(
        "POST",
        "/api/work/tasks",
        {"title": "Quick UAT case", "quick_testing": True},
        cookie=admin,
    )
    check("TSK-08", st == 200 and qt.get("task_type") == "testing" and qt.get("priority") == "high", f"st={st} type={qt.get('task_type')} pri={qt.get('priority')}")

    # TSK-08b priority list filter
    st, pri_rows, _ = req("GET", "/api/work/tasks?priority=high", cookie=admin)
    check(
        "TSK-08b",
        st == 200 and isinstance(pri_rows, list) and all(t.get("priority") == "high" for t in (pri_rows or [])),
        f"st={st} n={len(pri_rows or [])}",
    )
    st, bad_pri, _ = req("GET", "/api/work/tasks?priority=critical", cookie=admin)
    check("TSK-08c", st == 400, f"st={st} body={bad_pri}")

    # TSK-09 viewer
    viewer = login("viewer@techhind.in", "View@12345")
    st, _, _ = req("POST", "/api/work/tasks", {"title": "nope"}, cookie=viewer)
    check("TSK-09a", st == 403, f"st={st}")
    st, lst, _ = req("GET", "/api/work/tasks", cookie=viewer)
    check("TSK-09b", st == 200, f"st={st} n={len(lst or [])}")

    # TSK-10 reassign needs manage — create as ops, try reassign as developer of other's task
    ops = login("ops@techhind.in", "Ops@12345")
    st, t2, _ = req(
        "POST",
        "/api/work/tasks",
        {"title": "Ops owned", "assignee_id": assignee["id"], "task_type": "uat"},
        cookie=ops,
    )
    check("TSK-10pre", st == 200, f"st={st}")
    try:
        dev = login("dev@techhind.in", "Dev@12345")
        st, _, _ = req(
            "PATCH",
            f"/api/work/tasks/{t2['id']}",
            {"assignee_id": observer["id"]},
            cookie=dev,
        )
        # developer is not assignee/creator — should 403 unless manage
        check("TSK-10", st == 403, f"st={st}")
    except RuntimeError as e:
        check("TSK-10", False, str(e))

    # TSK-11..13 BA / QA sign-off gates
    st, gate, _ = req("POST", "/api/work/tasks", {"title": "Sign-off gate", "status": "in_review"}, cookie=admin)
    gid = (gate or {}).get("id")
    check("TSK-11pre", st == 200 and gid, f"st={st}")
    st, rejected, _ = req("PATCH", f"/api/work/tasks/{gid}", {"status": "testing_rejected"}, cookie=admin)
    check("TSK-11a", st == 400, f"st={st} {rejected}")
    st, blank, _ = req("POST", f"/api/work/tasks/{gid}/reject-testing", {"reason": " "}, cookie=admin)
    check("TSK-11b", st == 400, f"st={st} {blank}")
    st, rej, _ = req(
        "POST", f"/api/work/tasks/{gid}/reject-testing",
        {"reason": "Steps fail on staging"}, cookie=admin,
    )
    check(
        "TSK-11c",
        st == 200 and rej.get("status") == "testing_rejected" and rej.get("rejection_reason") == "Steps fail on staging",
        f"st={st} status={rej.get('status')}",
    )
    try:
        dev = login("dev@techhind.in", "Dev@12345")
        st, denied, _ = req("POST", f"/api/work/tasks/{gid}/ready-to-live", cookie=dev)
        check("TSK-12a", st == 403, f"st={st} {denied}")
        st, early, _ = req("POST", f"/api/work/tasks/{gid}/complete", cookie=dev)
        check("TSK-13a", st == 400, f"st={st} {early}")
    except RuntimeError as e:
        check("TSK-12a", False, str(e))
        check("TSK-13a", False, str(e))
    qa = login("qa@techhind.in", "Qa@123456")
    st, live, _ = req("POST", f"/api/work/tasks/{gid}/ready-to-live", cookie=qa)
    check("TSK-12b", st == 200 and live.get("status") == "ready_to_live", f"st={st} status={live.get('status')}")
    dev = login("dev@techhind.in", "Dev@12345")
    st, done, _ = req("POST", f"/api/work/tasks/{gid}/complete", cookie=dev)
    check("TSK-13b", st == 200 and done.get("status") == "done", f"st={st} status={done.get('status')}")

    print(f"\nResult: {PASS} passed, {FAIL} failed")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
