# Business flow — TechHind Company Finance

## Product

Standalone single-company finance for TechHind Pvt Ltd. INR only. FY 1 Apr – 31 Mar. Number series `TH/{FY}/{SEQ:4}`. Desktop-first, data-dense.

## Personas (RBAC)

| Role | Can |
|------|-----|
| Admin | Full access: company, users, masters, period reopen |
| Accountant | Approvals, payments, period close, reports / accountant pack |
| Ops | Draft invoices, record payments, renewals |
| Viewer | Read-only (Settings → Security restricted) |
| Freelancer | Assigned tasks + tickets only (no finance menus; cannot create tasks/tickets) |

## Auth extras

- New users (Settings → Users) get a temporary password and `must_change_password`; first login forces a password change before the app opens.
- Profile (`/profile`): change password + authenticator 2FA (QR). Settings → Security links here.

## Core flows

1. **Subscription revenue** — customer → product/plan → subscription → renewals buckets (Overdue / 7 / 15 / 30 days)
2. **GST billing** — draft invoice → approve (locks + assigns `TH/{FY}/{SEQ}`) → PDF → email → payment allocation (+ optional TDS) → AR aging
3. **Adjustments** — credit note / debit note; CN reduces invoice balance
4. **Payables** — vendor → purchase bill (+ ITC) → vendor payment
5. **Expenses** — voucher submit → approve → post (+ attachments); posted vouchers withdraw from bank ledger
6. **Bank ledger** — per-account statement (running balance); auto-post from receipts / vendor payments / posted vouchers; Cash book; manual lines; inter-bank transfer; go-live statement CSV import (Date/Narration/Chq/ValueDt/Withdrawal/Deposit/Closing) with optional link to CRM docs
7. **Period close** — `open` → `in_review` → `gst_filed` → `closed` (mutations locked when closed; Admin can reopen)
8. **Ops** — CSV import (dry-run), Accountant Pack ZIP, GSTR-1 / GSTR-3B JSON export

## Current integrations (local truth)

| Concern | Status |
|---------|--------|
| Storage | Cloudflare R2 when `BUCKET_*` set; else `backend/.local_storage` |
| Email | Brevo SMTP/API when keys set; else mock (`email_log`) |
| e-Invoice IRN/QR | Mock sandbox only — not NIC-registered |

## Backlog (pointers)

- P1: Real NIC e-invoice; GSTR schema validation; TDS Form 26Q-style reports
- P2: Multi-currency; CN auto-apply on payment; backup/retention for packs
