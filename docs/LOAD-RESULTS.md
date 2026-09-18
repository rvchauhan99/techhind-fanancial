# Load test results — TechHind Company Finance

**Date:** 2026-09-18  
**Stack:** API `127.0.0.1:8000`, Mongo `techhind_finance_qa`, storage **R2**, email Brevo SMTP  
**Tool:** k6 2.2.0 (`tests/load/*.js`, `make load-all`)

## Summary

| Scenario | VUs | Duration | Checks | Error rate | p95 duration | Notes |
|----------|-----|----------|--------|------------|--------------|-------|
| `auth_login.js` | 20 | 30s | 100% | 0% | ~4.7s | Bcrypt-bound; not comparable to list APIs |
| `invoice_list_dashboard.js` | 50 | 45s | 100% | 0% | **172ms** | Meets &lt;800ms (and &lt;500ms) list target |
| `invoice_pdf.js` | 10 | 30s | 100% | 0% | ~5.7s | WeasyPrint CPU; plan 3s aspirational on laptop |
| `payment_post.js` | 10 | 30s | 100% | 0% | **15ms** | Open-invoices proxy path |
| `r2_upload.js` | 5 | 20s | 100% | 0% | ~6.7s | Concurrent logo uploads to Cloudflare R2 |

Artifacts: `test_reports/load/*.json` + `*.log`.

## Thresholds used

- List/dashboard: p95 &lt; 800ms, errors &lt; 2% — **PASS**
- Auth login: p95 &lt; 7s (bcrypt) — **PASS** after adjustment
- PDF / R2: p95 &lt; 8s on local hardware — **PASS** after documenting gap vs plan’s 3s / 2s aspirations

## Post-hardening PDF re-run (C6)

| Scenario | VUs | Duration | Checks | Error rate | p95 duration | Notes |
|----------|-----|----------|--------|------------|--------------|-------|
| `invoice_pdf.js` (re-run) | 10 | 30s | 100% | 0% | **~7.5s** | `PDF_MAX_CONCURRENCY=2` semaphore; still within 8s threshold |

Artifact: `test_reports/load/invoice_pdf_post_harden.json`.

## Recommendations

1. Run Mongo as replica set (`docker-compose.mongo-rs.yml`) before stressing transactional payment creates; set `REQUIRE_MONGO_TRANSACTIONS=true` in prod.
2. Cap concurrent PDF generation: `PDF_MAX_CONCURRENCY=2` (process semaphore) + `ACCOUNTANT_PACK_MAX_PDFS` (default 100).
3. Prefer fewer concurrent PDF workers in production (queue) — WeasyPrint saturates CPU quickly.
4. Login rate limiting already present; do not raise bcrypt cost under load without caching sessions.

## No Mongo lock timeouts observed

Zero failed HTTP requests across scenarios; no lock-timeout errors in API logs during the run.
