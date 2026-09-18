#!/usr/bin/env python3
"""Standard QA: Org RBAC + Work (RBAC-01..04, WRK-01..05)."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
PASS = 0
FAIL = 0


def req(method: str, path: str, body=None, cookie: str | None = None):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode() or "{}"
            return resp.status, json.loads(raw) if raw.strip() else {}, resp.headers
    except urllib.error.HTTPError as e:
        raw = e.read().decode() or "{}"
        try:
            payload = json.loads(raw) if raw.strip() else {}
        except Exception:
            payload = {"detail": raw}
        return e.code, payload, e.headers


def login(email: str, password: str) -> str:
    status, data, headers = req("POST", "/api/auth/login", {"email": email, "password": password})
    if status != 200:
        raise RuntimeError(f"login failed {email}: {status} {data}")
    # Prefer Set-Cookie access_token
    set_cookie = headers.get("Set-Cookie") or ""
    if "access_token=" in set_cookie:
        # may be multiple; collect from get_all if available
        cookies = []
        if hasattr(headers, "get_all"):
            for c in headers.get_all("Set-Cookie") or []:
                cookies.append(c.split(";", 1)[0])
        else:
            cookies.append(set_cookie.split(";", 1)[0])
        return "; ".join(cookies)
    token = data.get("access_token")
    if token:
        return f"access_token={token}"
    raise RuntimeError(f"no cookie/token for {email}")


def check(cid: str, cond: bool, detail: str = ""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"PASS {cid} {detail}")
    else:
        FAIL += 1
        print(f"FAIL {cid} {detail}")


def main():
    admin = login("gayatribachauhan99@gmail.com", "TechHind@2026")
    st, me, _ = req("GET", "/api/rbac/me", cookie=admin)
    check("RBAC-01", st == 200 and len(me.get("menus") or []) >= 10, f"menus={len(me.get('menus') or [])}")
    check("RBAC-01b", me.get("capabilities", {}).get("can_rbac_admin") is True, "admin caps")

    st, roles, _ = req("GET", "/api/rbac/roles", cookie=admin)
    keys = {r["key"] for r in (roles or [])}
    check("RBAC-01c", st == 200 and "developer" in keys and "project_manager" in keys, f"roles={len(keys)}")

    # Developer menus + finance deny
    try:
        dev = login("dev@techhind.in", "Dev@12345")
    except RuntimeError as e:
        check("RBAC-02", False, str(e))
        dev = None
    if dev:
        st, dme, _ = req("GET", "/api/rbac/me", cookie=dev)
        mkeys = set(dme.get("menu_keys") or [])
        check("RBAC-02", st == 200 and mkeys <= {"dashboard", "projects", "tasks"} and "invoices" not in mkeys, f"keys={mkeys}")
        st, _, _ = req("POST", "/api/work/projects", {"name": "Dev Probe"}, cookie=dev)
        # may succeed (can_work_write) — finance deny:
        st, _, _ = req("POST", "/api/invoices", {"customer_id": "x", "doc_type": "INV", "lines": []}, cookie=dev)
        check("RBAC-03", st in (403, 400, 422), f"dev invoice status={st}")

    # Accountant still has finance menus
    acc = login("accountant@techhind.in", "Finance@123")
    st, ame, _ = req("GET", "/api/rbac/me", cookie=acc)
    check("RBAC-04", st == 200 and "invoices" in (ame.get("menu_keys") or []), "accountant invoices menu")

    # Work create as admin
    st, custs, _ = req("GET", "/api/customers", cookie=admin)
    cust_id = (custs or [{}])[0].get("id")
    st, users, _ = req("GET", "/api/users?active_only=true", cookie=admin)
    check("WRK-01a", st == 200 and len(users or []) >= 4, f"users={len(users or [])}")
    assignee = next((u for u in users if u.get("role") == "developer"), users[0])

    st, proj, _ = req(
        "POST",
        "/api/work/projects",
        {"name": "RBAC QA Project", "status": "active", "customer_id": cust_id, "priority": "high"},
        cookie=admin,
    )
    check("WRK-01", st == 200 and proj.get("number", "").startswith("PRJ/"), f"status={st} no={proj.get('number')}")
    pid = proj.get("id")

    st, task, _ = req(
        "POST",
        "/api/work/tasks",
        {
            "title": "Implement login UAT",
            "category": "uat",
            "project_id": pid,
            "assignee_id": assignee["id"],
            "status": "todo",
            "priority": "normal",
        },
        cookie=admin,
    )
    check("WRK-02", st == 200 and task.get("assignee_id") == assignee["id"], f"status={st}")
    tid = task.get("id")

    st, act, _ = req("POST", f"/api/work/tasks/{tid}/comments", {"body": "Starting UAT"}, cookie=admin)
    check("WRK-03", st == 200 and act.get("action") == "comment", f"status={st}")
    st, acts, _ = req("GET", f"/api/work/activity?entity_type=task&entity_id={tid}", cookie=admin)
    check("WRK-03b", st == 200 and len(acts or []) >= 1, f"n={len(acts or [])}")

    viewer = login("viewer@techhind.in", "View@12345")
    st, _, _ = req("POST", "/api/work/projects", {"name": "Should Fail"}, cookie=viewer)
    check("WRK-04", st == 403, f"viewer create={st}")
    st, plist, _ = req("GET", "/api/work/projects", cookie=viewer)
    check("WRK-04b", st == 200, f"viewer list={st}")

    st, dash, _ = req("GET", "/api/work/dashboard", cookie=admin)
    check("WRK-05", st == 200 and "my_open" in dash and "workload" in dash, f"keys={list(dash)[:5]}")
    st, rep, _ = req("GET", "/api/work/report", cookie=admin)
    check("WRK-05b", st == 200 and "totals" in rep, f"totals={rep.get('totals')}")

    print(f"\nResult: {PASS} passed, {FAIL} failed")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
