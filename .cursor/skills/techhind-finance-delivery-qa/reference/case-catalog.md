# E2E case catalog

Distilled from `docs/PROD-READINESS-SIGN-OFF.md`, `docs/E2E-SIGN-OFF.md`, and `tests/e2e_critical_api.py`.

## API Critical (53+)

| Group | IDs | Focus |
|-------|-----|-------|
| Auth / RBAC | AUTH-01 … AUTH-06, AUTH-2FA-01, AUTH-AUDIT-01 | Login, lockout, roles, TOTP, audit RBAC |
| Settings | SET-01 … SET-04, SET-R2-01 | Company, masters, branding, `/ready` R2 |
| Catalog / renewals | CAT-01 … CAT-05 | Customers, products, subscriptions, renewal email |
| GST invoices / payments | INV-01 … INV-10 (+06b), INV-DN-01, INV-TDS-01, INV-CONCUR-01, INV-PAY-DEL-01 | GST, PDF, CN/DN, TDS, concurrency, payment reverse |
| Audit / activity | AUD-01, AUD-ACT-01 | Actor+IP+ts on audits; entity activity diffs |
| Payables / vouchers | PAY-01 … PAY-05 | Vendor bill ITC, vendor payment, expense |
| Dashboard / aging | DASH-01 … DASH-04 | KPIs, AR/AP aging |
| Import / reports / period | OPS-01 … OPS-06, OPS-PERIOD-DATE, OPS-IMPORT-PAY-01 | CSV, pack, GSTR, period lock, payment import txn |
| Support tickets | SUP-01 … SUP-04 | Manual create, reply, status; Solar bridge key; attachment limits |
| Org RBAC | RBAC-01 … RBAC-04 | Seed roles/menus; `/rbac/me` menus; developer finance 403; role menu update |
| Work mgmt | WRK-01 … WRK-05 | Project+task CRUD; assignee any user; activity; viewer create 403; dashboard/report |

## Browser routes (16+)

login, dashboard, subscriptions, invoices, invoice detail (+ Activity panel), expenses, settings, imports, accountant-pack, period-close, aging, customers, products, vendors, payments, audit (admin/accountant only), **support tickets** (`/tickets`), **projects / tasks / work-report / roles**.

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
