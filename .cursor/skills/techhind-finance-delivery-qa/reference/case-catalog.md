# E2E case catalog

Distilled from `docs/PROD-READINESS-SIGN-OFF.md`, `docs/E2E-SIGN-OFF.md`, and `tests/e2e_critical_api.py`.

## API Critical (53+)

| Group | IDs | Focus |
|-------|-----|-------|
| Auth / RBAC | AUTH-01 … AUTH-06, AUTH-2FA-01, AUTH-2FA-02, AUTH-AUDIT-01, USR-01 … USR-03 | Login, lockout, roles, TOTP+QR, first-login password, audit RBAC |
| Settings | SET-01 … SET-04, SET-R2-01 | Company, masters, branding, `/ready` R2 |
| Catalog / renewals | CAT-01 … CAT-05 | Customers, products, subscriptions, renewal email |
| GST invoices / payments | INV-01 … INV-10 (+06b), INV-DN-01, INV-TDS-01, INV-CONCUR-01, INV-PAY-DEL-01 | GST, PDF, CN/DN, TDS, concurrency, payment reverse |
| Audit / activity | AUD-01, AUD-ACT-01 | Actor+IP+ts on audits; entity activity diffs |
| Payables / vouchers | PAY-01 … PAY-05 | Vendor bill ITC, vendor payment, expense |
| Bank ledger | BANK-01 … BANK-11 | Accounts+balance; receipt post/reverse; vendor pay; voucher approve; period lock; statement CSV; transfer; cash book; link; viewer 403 |
| Prod cutover | CUTOVER-01 … CUTOVER-05 | Bootstrap 1 admin; bank CSV 28 lines → live ₹209174.04; parties/subs; expenses/TDS; no UrbanKart / no double bank post |
| Dashboard / aging | DASH-01 … DASH-04 | KPIs, AR/AP aging |
| Import / reports / period | OPS-01 … OPS-06, OPS-PERIOD-DATE, OPS-IMPORT-PAY-01 | CSV, pack, GSTR, period lock, payment import txn |
| Support tickets | SUP-01 … SUP-04, SUP-10 … SUP-16 | Manual create/reply/status; bridge key; internal notes stripped; support_agent write; assignee/mine/SLA; email mock; Solar status filter + file download |
| Org RBAC | RBAC-01 … RBAC-04, RBAC-FL-01 … RBAC-FL-03 | Seed roles/menus; `/rbac/me` menus; developer finance 403; freelancer tasks+tickets only |
| Work mgmt | WRK-01 … WRK-05 | Project+task CRUD; assignee any user; activity; viewer create 403; dashboard/report |
| Task module Pro | TSK-01 … TSK-10 | Types/observers; start/complete; board/deadline; checklist; attachments; reminders; quick testing; viewer 403; reassign manage |

## Browser routes (16+)

login, dashboard, subscriptions, invoices, invoice detail (+ Activity panel), expenses, **bank ledger** (`/banks`), settings (Users + Security→profile), **profile** (`/profile`), imports, accountant-pack, period-close, aging, customers, products, vendors, payments, audit (admin/accountant only), **support tickets** (`/tickets`), **projects / tasks (list|kanban|deadline) / task detail / work-report / roles**.

Default web for local QA when `:3000` is busy: `WEB_BASE=http://localhost:3011`.

## Load (k6)

`tests/load/{auth_login,invoice_list_dashboard,invoice_pdf,payment_post,r2_upload}.js` — see `docs/LOAD-RESULTS.md`.

## RBAC negatives (always Critical when touching roles)

- Viewer POST invoice → 403
- Ops approve invoice → 403
- Viewer: New Invoice CTA hidden; Audit Trail nav hidden; GET `/audit` → 403
- Viewer accountant pack GET → 200 (read allowed)
- Developer POST `/invoices` approve path → 403 (`can_finance_write` false)
- Viewer POST `/work/projects` → 403 (`can_work_write` false)
