#!/usr/bin/env python3
"""Critical QA: Support Module Pro (SUP-01..04 regression + SUP-10..16)."""
from __future__ import annotations

import json
import os
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "http://127.0.0.1:8000"
PASS = 0
FAIL = 0


def _load_dotenv():
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if not os.path.isfile(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip().strip('"').strip("'")
            os.environ.setdefault(k, v)


_load_dotenv()
SVC = os.environ.get("SUPPORT_SERVICE_KEY") or os.environ.get("SUPPORT_TICKETS_SERVICE_KEY") or "local-support-dev-key"


def req(method: str, path: str, body=None, cookie: str | None = None, raw: bytes | None = None, ctype: str | None = None, headers_extra: dict | None = None):
    data = raw
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if ctype:
        headers["Content-Type"] = ctype
    if cookie:
        headers["Cookie"] = cookie
        for part in cookie.split(";"):
            part = part.strip()
            if part.startswith("access_token="):
                headers["Authorization"] = f"Bearer {part.split('=', 1)[1]}"
    if headers_extra:
        headers.update(headers_extra)
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=45) as resp:
            raw_b = resp.read()
            ctype_hdr = (resp.headers.get("Content-Type") or "").lower()
            if "application/json" in ctype_hdr or (raw_b[:1] in (b"{", b"[") and b"\x89PNG" not in raw_b[:8]):
                text = raw_b.decode() if raw_b else "{}"
                try:
                    payload = json.loads(text) if text.strip() else {}
                except Exception:
                    payload = {"_raw": text, "_bytes": raw_b}
            else:
                payload = {"_bytes": raw_b, "_raw": ""}
            return resp.status, payload, resp.headers
    except urllib.error.HTTPError as e:
        raw_b = e.read()
        try:
            text = raw_b.decode() if raw_b else "{}"
            payload = json.loads(text) if text.strip() else {}
        except Exception:
            payload = {"detail": raw_b[:200], "_bytes": raw_b}
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


def multipart(fields: dict, files: list | None = None):
    boundary = "----SupportQABoundary7MA4YWxkTrZu0gW"
    parts = []
    for k, v in fields.items():
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
        )
    for name, filename, content, ctype in files or []:
        parts.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
                f"Content-Type: {ctype}\r\n\r\n"
            ).encode()
            + content
            + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def tiny_png() -> bytes:
    # 1x1 PNG
    return (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        b"\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )


def ensure_support_agent(admin_cookie: str) -> str | None:
    """Return cookie for support_agent user (create/update if needed).

    Admin create/reset leaves must_change_password=True; complete first-login
    change-password so ticket write APIs are usable (SUP-12).
    """
    st, users, _ = req("GET", "/api/users", cookie=admin_cookie)
    if st != 200:
        return None
    agent = next((u for u in users if u.get("role") == "support_agent"), None)
    email = "support.agent@techhind.in"
    temp_password = "Support@123"
    final_password = "Support@QA456!"
    if not agent:
        st, created, _ = req(
            "POST",
            "/api/users",
            {
                "name": "Support Agent QA",
                "email": email,
                "password": temp_password,
                "role": "support_agent",
            },
            cookie=admin_cookie,
        )
        if st not in (200, 201):
            existing = next((u for u in users if u.get("email") == email), None)
            if existing:
                req("PATCH", f"/api/users/{existing['id']}", {"role": "support_agent"}, cookie=admin_cookie)
                agent = existing
            else:
                print(f"WARN create support_agent failed: {st} {created}")
                return None
        else:
            agent = created if isinstance(created, dict) else None
    else:
        email = agent.get("email") or email

    agent_id = (agent or {}).get("id")
    if agent_id:
        try:
            req("POST", f"/api/users/{agent_id}/reset-password", {"password": temp_password}, cookie=admin_cookie)
        except Exception:
            pass
        req("PATCH", f"/api/users/{agent_id}", {"role": "support_agent"}, cookie=admin_cookie)

    try:
        cookie = login(email, temp_password)
    except Exception as e:
        # Reset may have failed; try final password from a prior run
        try:
            cookie = login(email, final_password)
            return cookie
        except Exception:
            print(f"WARN support_agent login failed: {e}")
            return None

    st_me, me, _ = req("GET", "/api/auth/me", cookie=cookie)
    needs_change = (st_me == 200 and me.get("must_change_password")) or st_me == 403
    if not needs_change:
        # Probe ticket write path; password_change_required blocks ticket APIs
        st_probe, probe, _ = req("GET", "/api/tickets?limit=1", cookie=cookie)
        if st_probe == 403 and (probe.get("detail") == "password_change_required" or "password" in str(probe.get("detail") or "").lower()):
            needs_change = True

    if needs_change:
        st_ch, ch, _ = req(
            "POST",
            "/api/auth/change-password",
            {"current_password": temp_password, "new_password": final_password},
            cookie=cookie,
        )
        if st_ch != 200:
            # Cookie may already be on final password
            st_ch2, ch2, _ = req(
                "POST",
                "/api/auth/change-password",
                {"current_password": final_password, "new_password": temp_password},
                cookie=cookie,
            )
            if st_ch2 == 200:
                st_ch3, ch3, _ = req(
                    "POST",
                    "/api/auth/change-password",
                    {"current_password": temp_password, "new_password": final_password},
                    cookie=cookie,
                )
                if st_ch3 != 200:
                    print(f"WARN support_agent change-password failed: {st_ch} {ch} / {st_ch3} {ch3}")
                    return None
            else:
                print(f"WARN support_agent change-password failed: {st_ch} {ch}")
                return None
        try:
            cookie = login(email, final_password)
        except Exception as e:
            print(f"WARN support_agent re-login failed: {e}")
            return None
    return cookie


def main():
    admin = login("gayatribachauhan99@gmail.com", "TechHind@2026")
    accountant = login("accountant@techhind.in", "Finance@123")

    st, caps, _ = req("GET", "/api/rbac/me", cookie=admin)
    check("pre-caps", st == 200 and caps.get("capabilities", {}).get("can_ticket_write") is True, str(caps.get("capabilities")))

    st, customers, _ = req("GET", "/api/customers", cookie=admin)
    check("pre-customers", st == 200 and len(customers or []) >= 1, f"n={len(customers or [])}")
    cust = customers[0]
    key = cust.get("crm_tenant_key") or f"qa-tenant-{cust['id'][:8]}"
    if not cust.get("crm_tenant_key"):
        req("PATCH", f"/api/customers/{cust['id']}", {"crm_tenant_key": key}, cookie=admin)

    st, users, _ = req("GET", "/api/users", cookie=admin)
    assignee = next((u for u in (users or []) if u.get("role") in ("admin", "ops", "accountant")), users[0] if users else None)
    assignee_id = assignee["id"] if assignee else None

    # SUP-10 create with category + assignee + sla_due_at
    st, ticket, _ = req(
        "POST",
        "/api/tickets",
        {
            "customer_id": cust["id"],
            "subject": "SUP-10 category assignee SLA",
            "body": "Initial body for SUP-10",
            "priority": "high",
            "category": "billing",
            "assignee_id": assignee_id,
            "requester_email": "requester@example.com",
        },
        cookie=admin,
    )
    check(
        "SUP-10",
        st == 200
        and ticket.get("category") == "billing"
        and ticket.get("assignee_id") == assignee_id
        and bool(ticket.get("sla_due_at")),
        f"st={st} cat={ticket.get('category')} assignee={ticket.get('assignee_id')} sla={ticket.get('sla_due_at')}",
    )
    tid = ticket.get("id")

    # SUP-01 list / create smoke
    st_list, listed, _ = req("GET", "/api/tickets", cookie=admin)
    check("SUP-01", st == 200 and tid and st_list == 200 and isinstance(listed, list), f"tid={tid} list={st_list}")

    # SUP-11 internal note not on Solar bridge
    raw, ctype = multipart({"body": "Secret internal note", "visibility": "internal"})
    st_note, note, _ = req("POST", f"/api/tickets/{tid}/messages", cookie=admin, raw=raw, ctype=ctype)
    st_pub, pub, _ = req(
        "POST",
        f"/api/tickets/{tid}/messages",
        cookie=admin,
        raw=multipart({"body": "Public support reply", "visibility": "public"})[0],
        ctype=multipart({"body": "Public support reply", "visibility": "public"})[1],
    )
    # simplify - already sent; fetch bridge
    qs = urllib.parse.urlencode(
        {
            "crm_tenant_key": key,
            "solar_user_id": "bridge-user-none",
            "viewer_is_superadmin": "true",
        }
    )
    # Ticket may not be solar-sourced — set crm_tenant_key on ticket by using solar create instead for SUP-11
    # Create solar ticket for bridge visibility test
    solar_fields = {
        "crm_tenant_key": key,
        "subject": "SUP-11 bridge strip",
        "body": "Customer opener",
        "priority": "normal",
        "requester_name": "Solar QA",
        "requester_email": "solarqa@example.com",
        "solar_user_id": "solar-user-sup11",
    }
    sraw, sctype = multipart(solar_fields)
    st_s, solar_t, _ = req(
        "POST",
        "/api/integrations/support/tickets",
        raw=sraw,
        ctype=sctype,
        headers_extra={"X-Support-Service-Key": SVC},
    )
    sid = solar_t.get("id")
    # add internal + public via finance
    req(
        "POST",
        f"/api/tickets/{sid}/messages",
        cookie=admin,
        raw=multipart({"body": "INTERNAL-ONLY-XYZ", "visibility": "internal"})[0],
        ctype=multipart({"body": "INTERNAL-ONLY-XYZ", "visibility": "internal"})[1],
    )
    req(
        "POST",
        f"/api/tickets/{sid}/messages",
        cookie=admin,
        raw=multipart({"body": "Public hello", "visibility": "public"})[0],
        ctype=multipart({"body": "Public hello", "visibility": "public"})[1],
    )
    st_g, got, _ = req(
        "GET",
        f"/api/integrations/support/tickets/{sid}?{urllib.parse.urlencode({'crm_tenant_key': key, 'solar_user_id': 'solar-user-sup11', 'viewer_is_superadmin': 'false'})}",
        headers_extra={"X-Support-Service-Key": SVC},
    )
    msgs = got.get("messages") or []
    bodies = [m.get("body") for m in msgs]
    check(
        "SUP-11",
        st_g == 200 and "INTERNAL-ONLY-XYZ" not in bodies and "Public hello" in bodies,
        f"st={st_g} bodies={bodies}",
    )

    # SUP-12 support_agent reply + status
    agent_cookie = ensure_support_agent(admin)
    if agent_cookie:
        st_r, reply, _ = req(
            "POST",
            f"/api/tickets/{tid}/messages",
            cookie=agent_cookie,
            raw=multipart({"body": "Agent reply SUP-12", "visibility": "public"})[0],
            ctype=multipart({"body": "Agent reply SUP-12", "visibility": "public"})[1],
        )
        st_p, patched, _ = req("PATCH", f"/api/tickets/{tid}", {"status": "pending"}, cookie=agent_cookie)
        check(
            "SUP-12",
            st_r == 200 and st_p == 200,
            f"reply={st_r} patch={st_p}",
        )
    else:
        check("SUP-12", False, "could not login support_agent")

    # SUP-13 assign + mine / unassigned
    st_u, unassigned_t, _ = req(
        "POST",
        "/api/tickets",
        {
            "customer_id": cust["id"],
            "subject": "SUP-13 unassigned",
            "body": "no assignee",
            "priority": "low",
            "category": "account",
        },
        cookie=admin,
    )
    uid = unassigned_t.get("id")
    st_mine, mine_rows, _ = req("GET", f"/api/tickets?mine=true&status=open", cookie=admin)
    st_un, un_rows, _ = req("GET", "/api/tickets?unassigned=true&status=open", cookie=admin)
    mine_ids = [r.get("id") for r in (mine_rows or [])]
    un_ids = [r.get("id") for r in (un_rows or [])]
    # assign to admin
    me_st, me, _ = req("GET", "/api/auth/me", cookie=admin)
    admin_id = me.get("id")
    req("PATCH", f"/api/tickets/{uid}", {"assignee_id": admin_id}, cookie=admin)
    st_mine2, mine2, _ = req("GET", "/api/tickets?mine=true", cookie=admin)
    mine2_ids = [r.get("id") for r in (mine2 or [])]
    check(
        "SUP-13",
        st_u == 200 and uid in un_ids and uid in mine2_ids,
        f"unassigned_has={uid in un_ids} after_assign_mine={uid in mine2_ids}",
    )

    # SUP-14 SLA breached filter
    past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    # force breach via direct mongo? Use priority low then manually can't — use API create then we need DB.
    # Workaround: create high ticket and patch priority which recalcs from created_at; instead insert via create
    # and use list sla=breached after updating sla_due_at through a known path.
    # Use accountant create + raw update via patch priority from high to low doesn't set past.
    # Call internal: create ticket then use integration — simplest: POST and then PATCH won't help.
    # Use mongosh? Prefer urllib to a debug? We'll use tickets collection via python motor in-process — not available.
    # Force: create with normal, then use `requests` to admin endpoint — add temporary? 
    # Actually tickets.py doesn't expose sla_due_at patch. Use subprocess mongosh or pymongo.
    try:
        from pymongo import MongoClient

        client = MongoClient(os.environ.get("MONGO_URL") or "mongodb://127.0.0.1:27017")
        dbname = os.environ.get("DB_NAME") or "techhind_finance_qa"
        client[dbname].tickets.update_one(
            {"id": tid},
            {"$set": {"sla_due_at": past, "status": "open"}},
        )
        st_b, breached, _ = req("GET", "/api/tickets?sla=breached", cookie=admin)
        b_ids = [r.get("id") for r in (breached or [])]
        check("SUP-14", st_b == 200 and tid in b_ids, f"st={st_b} in={tid in b_ids} n={len(b_ids)}")
    except Exception as e:
        check("SUP-14", False, f"pymongo update failed: {e}")

    # SUP-02 status + reply regression
    st_p2, _, _ = req("PATCH", f"/api/tickets/{tid}", {"status": "open"}, cookie=accountant)
    st_r2, _, _ = req(
        "POST",
        f"/api/tickets/{tid}/messages",
        cookie=accountant,
        raw=multipart({"body": "SUP-02 reply", "visibility": "public"})[0],
        ctype=multipart({"body": "SUP-02 reply", "visibility": "public"})[1],
    )
    check("SUP-02", st_p2 == 200 and st_r2 == 200, f"patch={st_p2} reply={st_r2}")

    # SUP-17 file-only finance reply stores placeholder body
    raw17, ctype17 = multipart(
        {"body": "", "visibility": "public"},
        [("files", "qa-ticket.png", tiny_png(), "image/png")],
    )
    st17, msg17, _ = req(
        "POST",
        f"/api/tickets/{tid}/messages",
        cookie=admin,
        raw=raw17,
        ctype=ctype17,
    )
    atts17 = (msg17 or {}).get("attachments") or []
    check(
        "SUP-17a",
        st17 == 200 and msg17.get("body") == "(attachment)" and len(atts17) >= 1,
        f"st={st17} body={msg17.get('body')!r} n={len(atts17)}",
    )
    raw_empty, ctype_empty = multipart({"body": "", "visibility": "public"})
    st_empty, _, _ = req(
        "POST",
        f"/api/tickets/{tid}/messages",
        cookie=admin,
        raw=raw_empty,
        ctype=ctype_empty,
    )
    check("SUP-17b", st_empty == 400, f"st={st_empty}")

    # SUP-18 markdown reply: browsers often send application/octet-stream for .md
    raw_md, ctype_md = multipart(
        {"body": "markdown note", "visibility": "public"},
        [("files", "notes.md", b"# ticket note\n", "application/octet-stream")],
    )
    st_md, msg_md, _ = req(
        "POST",
        f"/api/tickets/{tid}/messages",
        cookie=admin,
        raw=raw_md,
        ctype=ctype_md,
    )
    md_att = next(
        (a for a in ((msg_md or {}).get("attachments") or []) if str(a.get("name") or "").endswith(".md")),
        None,
    )
    check(
        "SUP-18",
        st_md == 200 and (md_att or {}).get("mime") == "text/markdown",
        f"st={st_md} mime={(md_att or {}).get('mime')}",
    )

    # SUP-15 public reply emails requester (mock ok)
    # Ensure requester_email set; reply should not 500
    req("PATCH", f"/api/tickets/{tid}", {"status": "open"}, cookie=admin)
    st_e, emsg, _ = req(
        "POST",
        f"/api/tickets/{tid}/messages",
        cookie=admin,
        raw=multipart({"body": "SUP-15 email path", "visibility": "public"})[0],
        ctype=multipart({"body": "SUP-15 email path", "visibility": "public"})[1],
    )
    check("SUP-15", st_e == 200, f"st={st_e} (email mocked if Brevo unset)")

    # SUP-03 / SUP-04 bridge auth + visibility
    bad = req(
        "GET",
        f"/api/integrations/support/tickets?crm_tenant_key={urllib.parse.quote(key)}&viewer_is_superadmin=true",
        headers_extra={"X-Support-Service-Key": "wrong-key"},
    )
    good = req(
        "POST",
        "/api/integrations/support/tickets",
        raw=multipart(
            {
                "crm_tenant_key": key,
                "subject": "SUP-03 from Solar",
                "body": "Customer message",
                "priority": "high",
                "requester_name": "E2E User",
                "requester_email": "e2e@example.com",
                "solar_user_id": "solar-user-e2e-1",
            }
        )[0],
        ctype=multipart(
            {
                "crm_tenant_key": key,
                "subject": "SUP-03 from Solar",
                "body": "Customer message",
                "priority": "high",
                "requester_name": "E2E User",
                "requester_email": "e2e@example.com",
                "solar_user_id": "solar-user-e2e-1",
            }
        )[1],
        headers_extra={"X-Support-Service-Key": SVC},
    )
    check("SUP-03", bad[0] == 401 and good[0] == 200, f"bad={bad[0]} good={good[0]}")
    solar_tid = (good[1] or {}).get("id")

    own = req(
        "GET",
        f"/api/integrations/support/tickets?{urllib.parse.urlencode({'crm_tenant_key': key, 'solar_user_id': 'solar-user-e2e-1', 'viewer_is_superadmin': 'false'})}",
        headers_extra={"X-Support-Service-Key": SVC},
    )
    other = req(
        "GET",
        f"/api/integrations/support/tickets?{urllib.parse.urlencode({'crm_tenant_key': key, 'solar_user_id': 'other-user', 'viewer_is_superadmin': 'false'})}",
        headers_extra={"X-Support-Service-Key": SVC},
    )
    own_n = len(own[1] or []) if own[0] == 200 else -1
    other_n = len(other[1] or []) if other[0] == 200 else -1
    check("SUP-04", own[0] == 200 and other[0] == 200 and own_n >= 1 and other_n == 0, f"own={own_n} other={other_n}")

    # SUP-16 Solar list status filter + file download
    # attach file on solar ticket
    png = tiny_png()
    fraw, fctype = multipart(
        {
            "crm_tenant_key": key,
            "body": "with attachment",
            "solar_user_id": "solar-user-e2e-1",
            "requester_name": "E2E User",
            "viewer_is_superadmin": "false",
        },
        files=[("files", "qa.png", png, "image/png")],
    )
    st_att, att_msg, _ = req(
        "POST",
        f"/api/integrations/support/tickets/{solar_tid}/messages",
        raw=fraw,
        ctype=fctype,
        headers_extra={"X-Support-Service-Key": SVC},
    )
    file_id = None
    for a in (att_msg.get("attachments") or []):
        file_id = a.get("file_id")
        break
    st_filt, filt_rows, _ = req(
        "GET",
        f"/api/integrations/support/tickets?{urllib.parse.urlencode({'crm_tenant_key': key, 'solar_user_id': 'solar-user-e2e-1', 'viewer_is_superadmin': 'false', 'status': 'open'})}",
        headers_extra={"X-Support-Service-Key": SVC},
    )
    st_dl = 0
    if file_id:
        st_dl, dl_payload, dl_headers = req(
            "GET",
            f"/api/integrations/support/files/{file_id}?{urllib.parse.urlencode({'crm_tenant_key': key, 'solar_user_id': 'solar-user-e2e-1', 'viewer_is_superadmin': 'false'})}",
            headers_extra={"X-Support-Service-Key": SVC},
        )
        # binary response may be in _bytes
        ok_bytes = False
        if isinstance(dl_payload, dict) and dl_payload.get("_bytes"):
            ok_bytes = len(dl_payload["_bytes"]) > 10
        elif st_dl == 200:
            ok_bytes = True
    else:
        ok_bytes = False
    check(
        "SUP-16",
        st_att == 200 and st_filt == 200 and isinstance(filt_rows, list) and st_dl == 200 and ok_bytes,
        f"att={st_att} filt={st_filt} n={len(filt_rows or [])} dl={st_dl} file={file_id}",
    )

    # queue meta smoke
    st_q, queue, _ = req("GET", "/api/tickets/queue", cookie=admin)
    st_m, meta, _ = req("GET", "/api/tickets/meta", cookie=admin)
    check("SUP-meta", st_q == 200 and st_m == 200 and "billing" in (meta.get("categories") or []), f"queue={queue}")

    print(f"\n=== SUMMARY: {PASS} PASS, {FAIL} FAIL ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"FATAL {e}")
        sys.exit(2)
