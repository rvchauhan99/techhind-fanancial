# TechHind Company Finance (TCF) — PRD

## Problem statement

Standalone, single-company internal finance platform for TechHind Pvt Ltd (Gujarat, India). Manages SaaS subscription revenue, one-time sales, services, add-ons; GST invoicing (Tax Invoice / CN / DN / Receipts); expenses & vouchers; payments & AR/AP; financial dashboards; CSV import; accountant pack; period close; audit trail. Desktop-first, data-dense. RBAC: Admin / Accountant / Ops / Viewer. INR only. FY 1 Apr – 31 Mar. Number series `TH/{FY}/{SEQ:4}`.

## Architecture

- Backend: FastAPI + Pydantic + Motor (MongoDB), JWT auth (httpOnly cookies + Bearer), bcrypt, TOTP 2FA (pyotp), WeasyPrint branded PDFs, qrcode for mock IRN QR
- Storage: Cloudflare R2 when `BUCKET_*` set; else local filesystem (`backend/.local_storage`)
- Email: Brevo SMTP/API when configured; else mocked in `email_log`
- Frontend: React (CRA/craco) + Tailwind + shadcn/ui + recharts, axios client with token refresh
- DB: MongoDB (env `DB_NAME`). Collections: users, company, masters, number_series, customers, products, subscriptions, invoices (INV/CN/DN), payments, vendors, purchase_bills, vendor_payments, expense_vouchers, email_log, audit_logs, files, periods, login_attempts
- Backend layout: `core.py`, `gst.py`, `pdf.py`, `storage.py`, `seed.py`, `routers/{auth,settings,catalog,billing,payables,dashboard,periods,reports,imports}.py`

## User personas

- Admin — full access incl. company setup, users, masters, period reopen
- Accountant — approvals, payments, period close, reports/pack
- Ops — create drafts, record payments, manage renewals
- Viewer — read-only everything except Settings→Security

## Implemented (2026-09-09)

- **Phase 1**: JWT auth + brute-force lockout + TOTP 2FA, company profile + logo upload, masters, number series, audit trail
- **Phase 2**: Customers 360, product catalog, subscriptions + renewals buckets, GST invoice engine, branded PDF
- **Phase 3**: Payments + TDS, AR/AP aging, CN/DN, vendors, purchase bills + ITC, expense vouchers
- **Phase 4**: Invoice send + renewal reminders (email_log), dashboard KPIs, operational queue strip
- **Phase 5**: CSV import dry-run, Accountant Pack ZIP, Period Close state machine, GSTR-1/GSTR-3B JSON
- Mock IRN + QR on approved invoices

## Mocked / deferred (backlog — not production blockers for other stages)

- e-Invoice IRN/QR: **mock sandbox** — not NIC-registered (do not claim live IRN)
- GSTR JSON schema validation (exports exist; formal schema check deferred)
- TDS Form 26Q reports
- Audit admin-only ACL + retention policy
- Mongo replica set required for true multi-doc transactions (local fallback documented)

## Prod readiness (2026-09-18)

See `docs/PROD-READINESS-SIGN-OFF.md` — Critical API 47/47, browser walk, R2/Brevo, indexes, k6 load, P0 money-safety.

## Agent context

Cursor: see `AGENTS.md` and `.cursor/skills/techhind-finance-delivery-qa/`.
