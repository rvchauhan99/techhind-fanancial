# Module map — router ↔ page ↔ collections ↔ E2E

| Domain | Router | Web routes | Mongo collections | E2E IDs |
|--------|--------|------------|-------------------|---------|
| Auth / RBAC / 2FA / profile | `routers/auth.py` | `/login`, `/profile` | `users` (`must_change_password`), `login_attempts`, `revoked_refresh` | AUTH-01…06, AUTH-2FA-01…02, USR-01…03 |
| Health / ready | `server.py` | — | — | SET-R2-01 |
| Company / masters / uploads / users | `routers/settings.py` | `/settings` (Users tab) | `company`, `masters`, `number_series`, `files`, `users` | SET-01…04, SET-R2-01, USR-01…03 |
| Customers / products / subscriptions | `routers/catalog.py` | `/customers`, `/customers/:id`, `/products`, `/subscriptions`, `/subscriptions/:id/renew` | `customers`, `products`, `subscriptions` | CAT-01…05 |
| Invoices / CN / DN / payments | `routers/billing.py` | `/invoices`, `/invoices/new`, `/invoices/:id`, `/invoices/:id/edit`, `/payments` | `invoices`, `payments` | INV-01…10, INV-DN-01, INV-TDS-01, INV-CONCUR-01, INV-PAY-DEL-01 |
| Vendors / bills / vouchers | `routers/payables.py` | `/vendors`, `/expenses` | `vendors`, `purchase_bills`, `vendor_payments`, `expense_vouchers` | PAY-01…05 |
| Bank ledger | `routers/banks.py`, `bank_ledger.py` | `/banks`, `/banks/:id`, `/banks/:id/statement.csv` | `bank_accounts`, `bank_ledger` | BANK-01…11 |
| Payables | `routers/payables.py` | `/vendors`, `/bills`, `/bills/:id/pdf`, `/vendor-payments`, `/vendor-payments/:id/pdf`, `/vouchers`, `/vouchers/:id/pdf` | `vendors`, `purchase_bills`, `vendor_payments`, `expense_vouchers` | — |
| Reports / GSTR / pack | `routers/reports.py` | `/accountant-pack` (enriched ZIP), `/reports/month-summary`, `/reports/gstr1`, `/reports/gstr3b` | — | OPS-01…06 |
| Dashboard / aging | `routers/dashboard.py` | `/dashboard`, `/aging` | (aggregates) | DASH-01…04 |
| Period close | `routers/periods.py` | `/period-close` | `periods` | OPS-05, OPS-PERIOD-DATE |
| Reports / GSTR / pack | `routers/reports.py` | `/accountant-pack`, `/reports/month-summary`, `/reports/gstr1`, `/reports/gstr3b` | — | OPS-01…06 |
| CSV import | `routers/imports.py` | `/imports` | (targets vary) | OPS-01…02, OPS-IMPORT-PAY-01 |
| Audit / activity | `routers/dashboard.py` (`/audit`, `/activity`); `core.audit` | `/audit`; Activity panel on invoice detail | `audit_logs` | AUTH-AUDIT-01, AUD-01, AUD-ACT-01 |
| Support tickets | `routers/tickets.py` | `/tickets`, `/tickets/:id` | `tickets`, `ticket_messages` | SUP-01…04, SUP-10…17 (ops: assignee/category/SLA/internal notes + Solar bridge files + file-only finance reply). Inbox rows go through `notifications.notify_users`. Reply composer is a dropzone (`ticket-reply-dropzone`); message attachments use authenticated blob fetch with image thumbs + fullscreen lightbox (`TicketAttachmentViewer`). |
| Org RBAC | `routers/rbac.py`, `rbac_seed.py` | `/roles` (nav from `/rbac/me`) | `org_roles`, `menus`, `role_menus` | RBAC-01…, RBAC-FL-01…03 |
| Work (projects / tasks) | `routers/work.py` | `/projects`, `/projects/:id`, `/tasks`, `/tasks/:id`, `/work-report` | `projects`, `tasks`, `work_activity` | WRK-01…, TSK-01… (List/Kanban/Deadline, checklist, files dropzone, observers, reminders, BA owner `ba_id`). List/board/deadline filter by `priority` (low/normal/high/urgent); list shows Priority column. Default list/board hide Done (and Cancelled on list); toggle `include_done` or status=done to show. List/board sort: priority (urgent first), then status (`ready_to_live` → `in_review` → `testing_rejected` → `in_progress` → `todo` → …), then older `created_at` first within the same priority+status. List `GET /work/tasks?page>=1` returns `{items,page,limit,total}` (page=0 legacy bare list); FE list pager + page size. Title search `q` uses escaped regex on title/number/description via `apply_q` (preserves freelancer `$or`). Status path: In Review → Testing Rejected (reason required) or Ready to Live (QA, BA, or work manager) → Done. Writers complete only from Ready to Live. Task Files card: click/drop/paste, cap 10, `POST /work/tasks/{id}/attachments`. Task/project actions fan out to the inbox (assignee, BA, observers, creator, or project owner and members, minus the actor). Checklist edits stay on `work_activity` only. |
| Notifications | `notifications.py`, `routers/notifications.py` | Header bell on every authenticated page | `notifications` (`user_id`, `read`, `source`, `type`, `title`, `body`, `entity_type`, `entity_id`, `href`, `actor_id`, `actor_name`, `ts`; `ticket_id` when source is ticket; `activity_id` + `repeat_until_read` on mentions) | NTF-01…09. Mentions from `@Name` or `mention_ids` in task/project chat (any active user, not only the task audience). Unread mentions bump every 15 minutes for 24 hours until the record or bell item is opened. |
| Email log | `email_service.py` | — | `email_log` | INV-05, CAT-05 |
| Indexes / seed | `indexes.py`, `seed.py` | — | (all) | `make seed-qa` (QA DB suffix only) |
| Prod cutover | `scripts/prod_bootstrap.py`, `scripts/cutover_import.py` | — | (bootstrap + import) | CUTOVER-01…05 |

## Shared helpers

- Numbering / FY / period lock: `core.py`
- GST compute: `gst.py`
- PDF: `pdf.py`
- Storage: `storage.py` (`active_backend()` → `r2` | `local`)
- List filters: `list_query.py` + FE `FilterBar` / `useListFilters` (URL-synced) on all list pages
