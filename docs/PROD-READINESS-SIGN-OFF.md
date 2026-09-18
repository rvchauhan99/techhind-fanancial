# Production readiness sign-off — TechHind Company Finance

**Date:** 2026-09-18  
**Program:** Finance Prod Readiness (Stages 0–8) + Critical Hardening (C1–C9)

## Environment matrix

| Component | Value | Status |
|-----------|-------|--------|
| API | `http://127.0.0.1:8000` | Pass |
| Web | `http://localhost:3011` (3000 occupied by Solar) | Pass |
| Mongo | `127.0.0.1:27017` / `DB_NAME=techhind_finance_qa` | Pass |
| Storage | Cloudflare R2 (`storage=r2` via `/ready`) | Pass |
| Email | Brevo SMTP (`provider=brevo-smtp`, live sends in Critical INV-05) | Pass |
| Cookies | `SECURE_COOKIES=false` for local HTTP | Pass |

Harness: `Makefile` (`health`, `seed-qa`, `test-api`, `test-browser`, `load-all`), `backend/.env.example`, `memory/test_credentials.md`, `backend/scripts/health_probe.py`.

## Stage checklist

| Stage | Result | Evidence |
|-------|--------|----------|
| 0 Foundation | **Pass** | health probe; `/health` + `/ready`; QA DB |
| 1 QA seed | **Pass** | `make seed-qa` — periods, DN, TDS, renewals |
| 2 Critical API | **Pass** | **53/53** `test_reports/e2e_api_results.json` |
| 3 Browser | **Pass** | Selenium 16/16; MCP persona matrix + screenshots under `test_reports/prod_readiness/` |
| 4 Indexes / queries | **Pass** | `backend/indexes.py`; `docs/DB-INDEX-REVIEW.md` |
| 5 Arch P0 | **Pass** | Transactions helper + conditional approve; refresh revoke; period lock on patch dates; upload MIME/size; HTML escape in PDF; no `?auth=` query JWT |
| 6 Load (k6) | **Pass*** | `docs/LOAD-RESULTS.md` — *list p95 OK; PDF/R2 slower than aspirational plan targets on laptop |
| 7 P1/P2 | **Pass / tracked** | `/health` `/ready`, pagination, dashboard agg, lifespan, CORS+SECURE_COOKIES; P2 backlog below |
| 8 Sign-off | **This document** | Annex sync |
| Hardening C1–C9 | **Pass** | Fail-closed txn, money paths, number series, concur, audit RBAC+IP, activity history, PDF semaphore |

## Case IDs run

### Critical API (53)

AUTH-01…06, AUTH-2FA-01, AUTH-AUDIT-01, SET-01…04, SET-R2-01, CAT-01…05, INV-01…10 (+06b), INV-DN-01, INV-TDS-01, INV-CONCUR-01, INV-PAY-DEL-01, AUD-01, AUD-ACT-01, PAY-01…05, DASH-01…04, OPS-01…06, OPS-PERIOD-DATE, OPS-IMPORT-PAY-01.

### Browser

- Selenium routes: 16 (see `test_reports/browser_e2e_results.json`)
- MCP: admin dashboard/invoices/settings/period-close; viewer invoices (no New Invoice CTA); invoice detail Activity panel

### Load

`auth_login`, `invoice_list_dashboard`, `invoice_pdf`, `payment_post`, `r2_upload` → `test_reports/load/`  
Post-hardening PDF re-run: `test_reports/load/invoice_pdf_post_harden.json` (p95 within 8s, 0% errors, `PDF_MAX_CONCURRENCY=2`).

## Production gate checklist (before money traffic)

1. Mongo **replica set** ON (`docker-compose.mongo-rs.yml` or managed RS)
2. `REQUIRE_MONGO_TRANSACTIONS=true` (or `ENV=production`) — **no silent txn fallback**
3. `SECURE_COOKIES=true` + HTTPS
4. WeasyPrint system libs installed (`pango`/`glib`; macOS `DYLD_FALLBACK_LIBRARY_PATH`)
5. `/ready` shows `storage=r2` (and email provider configured)
6. Critical suite green including AUTH-AUDIT-01, INV-CONCUR-01, INV-PAY-DEL-01, AUD-01, AUD-ACT-01, OPS-IMPORT-PAY-01
7. Confirm `audit_logs` rows include **user_id / user_name / role**, **ip**, and **ts** on money mutations

## Known deferred (do not claim done)

| Item | Status |
|------|--------|
| Live NIC e-invoice IRN | Mock only — blocked on credentials |
| GSTR JSON schema validation | Export exists; schema not formally validated |
| TDS Form 26Q reports | Not built |
| Immutable WORM / object-lock for audit | Future compliance |
| Full pagination for every catalog list | Later Standard pass |

## Index + load snapshot

- Indexes: see `docs/DB-INDEX-REVIEW.md` (partial unique `invoice_no` / `receipt_no`).
- Load: list/dashboard p95 **~172ms** @ 50 VU; PDF p95 **~5.7–7.5s** @ 10 VU (semaphore capped); R2 upload p95 **~6.7s** @ 5 VU; 0% HTTP errors.

## Verdict

**Local QA production-readiness: PASS** for money/GST/period/RBAC/audit Critical paths with R2 + Brevo, subject to deferred NIC/GSTR/26Q backlog. **Production money traffic requires the Production gate checklist above** (replica set + fail-closed transactions).
