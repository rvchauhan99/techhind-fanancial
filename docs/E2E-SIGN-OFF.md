# TechHind Company Finance — Hard E2E Sign-off

**Date:** 2026-09-09 (full re-run 15:05–15:11 IST)  
**App:** `techhind-fanancial`  
**Test tier:** Critical  

## Environment

| Item | Value |
|------|-------|
| API | `http://127.0.0.1:8000` |
| Web | `http://localhost:3000` |
| MongoDB | `mongodb://127.0.0.1:27017` / DB `techhind_finance_e2e` |
| Storage | Cloudflare R2 via `BUCKET_*` (`solar-demo`); local FS fallback if bucket unset |
| Email | Brevo SMTP (`BREVO_USER` + `BREVO_MASTER_KEY`); API fallback via `BREVO_API_KEY` |
| PDF | WeasyPrint 70.0 (+ Homebrew pango/gobject) |

## Cases run

### API Critical suite — **42/42 PASS**

Runner: [`tests/e2e_critical_api.py`](../tests/e2e_critical_api.py)  
Results: [`test_reports/e2e_api_results.json`](../test_reports/e2e_api_results.json)

| Group | IDs |
|-------|-----|
| Auth / RBAC | AUTH-01 … AUTH-06 |
| Settings | SET-01 … SET-04 |
| Catalog / renewals | CAT-01 … CAT-05 |
| GST invoices / payments | INV-01 … INV-10 (+ INV-06b receipt PDF) |
| Payables / vouchers | PAY-01 … PAY-05 |
| Dashboard / aging | DASH-01 … DASH-04 |
| Import / reports / period | OPS-01 … OPS-06 |

Highlights verified:

- Intra-state CGST+SGST vs inter-state IGST
- Approve → `TH/{FY}/{SEQ}` numbering; immutability; cancel without reuse
- Branded PDF bytes (`%PDF`); live Brevo send (`INV-05` / `CAT-05` → `provider=brevo-smtp`, `mocked=false`); mock IRN
- Payment allocation → paid + subscription `next_renewal_on` advanced
- CN reduces invoice balance
- Vendor bill ITC + vendor payment; expense voucher submit→approve (ops blocked)
- Period close locks postings; admin reopen
- Accountant pack ZIP + GSTR-1 / GSTR-3B JSON
- **SET-02:** logo + stamp + signature upload to R2; company paths set
- **AUTH-02:** 5 failed logins on unique disposable identity → **429** lockout

### Browser E2E — **16/16 routes PASS**

Runner: [`tests/e2e_browser_walk.py`](../tests/e2e_browser_walk.py) (Selenium headless + `tcf_token` seed)  
Also spot-checked via Browser MCP (login → dashboard / subscriptions / invoices)  
Results: [`test_reports/browser_e2e_results.json`](../test_reports/browser_e2e_results.json)

Routes: login, dashboard, subscriptions, invoices, invoice detail, expenses, settings, imports, accountant-pack, period-close, aging, customers, products, vendors, payments, audit.

Screenshots (under `test_reports/`):

- `browser_dashboard.png`
- `browser_subscriptions.png`
- `browser_invoices.png`
- `browser_invoice_detail.png`
- `browser_expenses.png`
- `browser_settings.png`
- `settings-branding-gap-fix.png`

### RBAC / PDF / Ops artifacts

| Check | Result |
|-------|--------|
| Viewer POST invoice | 403 |
| Ops approve invoice | 403 |
| Viewer accountant pack GET | 200 (read allowed) |
| Sample invoice PDF | `test_reports/sample_invoice.pdf` (PDF 1.7) |
| Sample accountant pack | `test_reports/sample_accountant_pack.zip` |
| Sample GSTR-1 / 3B | `test_reports/sample_gstr1.json`, `sample_gstr3b.json` |

## Skipped / deferred

| Item | Reason |
|------|--------|
| Real NIC e-invoice | Mock IRN/QR only — needs NIC credentials |
| Emergent object store | Removed — storage is R2 or local FS only |

## Gap closure

| Gap | Status |
|-----|--------|
| Stamp / signature upload + PDF | **Closed** |
| AUTH-02 lockout exhaustion | **Closed** |
| Cloudflare R2 object storage | **Closed** |
| Brevo email (invoice + renewals) | **Closed** |

## Evidence summary

- API: **42 PASS, 0 FAIL**
- Browser: **16 PASS, 0 FAIL**
- Integrations live: R2 uploads, Brevo SMTP sends
- Money / GST / renewals / period lock / RBAC: Critical path green  

## Sign-off

**Status: PASS (Critical tier)** — full E2E green with R2 + Brevo configured. Remaining production gap: live NIC e-invoice when credentials are available.
