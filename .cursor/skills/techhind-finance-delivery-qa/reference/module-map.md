# Module map — router ↔ page ↔ collections ↔ E2E

| Domain | Router | Web routes | Mongo collections | E2E IDs |
|--------|--------|------------|-------------------|---------|
| Auth / RBAC / 2FA | `routers/auth.py` | `/login` | `users`, `login_attempts`, `revoked_refresh` | AUTH-01…06, AUTH-2FA-01 |
| Health / ready | `server.py` | — | — | SET-R2-01 |
| Company / masters / uploads | `routers/settings.py` | `/settings` | `company`, `masters`, `number_series`, `files` | SET-01…04, SET-R2-01 |
| Customers / products / subscriptions | `routers/catalog.py` | `/customers`, `/customers/:id`, `/products`, `/subscriptions` | `customers`, `products`, `subscriptions` | CAT-01…05 |
| Invoices / CN / DN / payments | `routers/billing.py` | `/invoices`, `/invoices/new`, `/invoices/:id`, `/invoices/:id/edit`, `/payments` | `invoices`, `payments` | INV-01…10, INV-DN-01, INV-TDS-01, INV-CONCUR-01, INV-PAY-DEL-01 |
| Vendors / bills / vouchers | `routers/payables.py` | `/vendors`, `/expenses` | `vendors`, `purchase_bills`, `vendor_payments`, `expense_vouchers` | PAY-01…05 |
| Dashboard / aging | `routers/dashboard.py` | `/dashboard`, `/aging` | (aggregates) | DASH-01…04 |
| Period close | `routers/periods.py` | `/period-close` | `periods` | OPS-05, OPS-PERIOD-DATE |
| Reports / GSTR / pack | `routers/reports.py` | `/accountant-pack` | — | OPS-01…06 |
| CSV import | `routers/imports.py` | `/imports` | (targets vary) | OPS-01…02, OPS-IMPORT-PAY-01 |
| Audit / activity | `routers/dashboard.py` (`/audit`, `/activity`); `core.audit` | `/audit`; Activity panel on invoice detail | `audit_logs` | AUTH-AUDIT-01, AUD-01, AUD-ACT-01 |
| Support tickets | `routers/tickets.py` | `/tickets`, `/tickets/:id` | `tickets`, `ticket_messages`, `notifications` | SUP-01…04, SUP-10…16 (ops: assignee/category/SLA/internal notes + Solar bridge files) |
| Org RBAC | `routers/rbac.py`, `rbac_seed.py` | `/roles` (nav from `/rbac/me`) | `org_roles`, `menus`, `role_menus` | RBAC-01… |
| Work (projects / tasks) | `routers/work.py` | `/projects`, `/projects/:id`, `/tasks`, `/tasks/:id`, `/work-report` | `projects`, `tasks`, `work_activity` | WRK-01…, TSK-01… (List/Kanban/Deadline, checklist, files, observers, reminders) |
| Email log | `email_service.py` | — | `email_log` | INV-05, CAT-05 |
| Indexes / seed | `indexes.py`, `seed.py` | — | (all) | `make seed-qa` |

## Shared helpers

- Numbering / FY / period lock: `core.py`
- GST compute: `gst.py`
- PDF: `pdf.py`
- Storage: `storage.py` (`active_backend()` → `r2` | `local`)
