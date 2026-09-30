# Design — dense finance UI

Source of truth (full tokens): `docs/design-guidelines.json`.

## Layout

- Desktop (`md` and up): left-nav workspace; maximize data density; minimize padding
- Phone (below `md`, 768px): installable PWA. Menu button + bottom tabs (Home, Tickets, Invoices, Tasks, More). Full menu in a solid `#0B192C` drawer. Safe-area insets. Header actions sit in `mobile-action-bar` above the tabs
- Lists use `table.pwa-table`: desktop table, phone cards labeled from the header (`data-label`). The roles permission matrix stays a horizontal-scroll table
- FilterBar: on a phone, search stays inline and other fields open in a Filters sheet (`filter-more-btn`). URL query params stay the source of truth
- Service worker (production build only) precaches the app shell. `/api` is network-only. Offline banner `offline-banner`; update prompt `pwa-update-banner`
- Persistent renewals strip: Overdue / 7 / 15 / 30 day buckets (horizontal scroll on a phone)
- Operational queue counters where implemented
- Solid backgrounds on dialogs/drawers — no transparent floating sheets

## Typography & currency

- Headings: Outfit / Cabinet Grotesk (not Inter)
- Body: IBM Plex Sans
- Mono for GSTIN, invoice numbers, HSN/SAC, INR amounts (JetBrains Mono / IBM Plex Mono)
- INR with Indian grouping: `₹12,45,500.00`

## GST visual tags

- Intra-state CGST+SGST — emerald
- Inter-state IGST — indigo
- Zero-rated / SEZ — sky

## Status badges

Draft, Pending Approval, Approved/Locked, Partially Paid, Paid, Overdue, Cancelled — structured pills.

## data-testid

All primary buttons, tabs, inputs, filters, KPIs must have kebab-case `data-testid` (see `frontend/src/constants/testIds/`).

Header notification bell: `notification-bell`, `notification-badge`, `notification-item`, `notification-mark-all`.

Task/project chat mentions: `work-activity-panel`, `work-comment-input`, `work-mention-button`, `work-mention-list`, `work-mention-option`, `work-comment-submit`.

Phone shell: `mobile-menu-btn`, `mobile-tabbar`, `tab-home`, `tab-tickets`, `tab-invoices`, `tab-tasks`, `tab-more`, `mobile-drawer`, `mobile-nav`, `mobile-action-bar`, `filter-more-btn`, `offline-banner`, `pwa-update-banner`, `pwa-update-reload`.

File dropzone (tasks Files card + ticket reply): `task-file-dropzone`, `task-file-input`, `ticket-reply-dropzone`, `ticket-reply-files`, `file-chip-list`, `file-chip-remove-{n}`. Native click/drop/paste; png/jpeg/webp/pdf/csv/xls/xlsx/md/markdown; 5 MB each. `.md` is stored as `text/markdown` even when the browser sends `text/plain` or `application/octet-stream`. Tasks cap 10 (immediate upload). Tickets cap 5 per message (queued chips, then send). File-only ticket reply stores body `(attachment)`. Company logo/stamp/signature stay image-only. Expense voucher attachments stay unrestricted.

Task sign-off: board columns include Testing Rejected and Ready to Live (`kanban-testing_rejected`, `kanban-ready_to_live`). Detail actions `task-reject-reason`, `task-reject-btn`, `task-ready-btn`, BA field `task-ba-edit` / create `task-ba-select`. QA, Business Analyst, or a work manager rejects with a reason or marks ready to live. Writers complete only from Ready to Live.

## List filters (FilterBar)

- Shared: `frontend/src/components/filters/FilterBar.jsx` + `useListFilters` (`hooks/useListFilters.js`)
- Field types: text, number, number_range, date, date_range, select, multi_select, toggle
- Persistence: **URL query params only** (shareable / back-button); no localStorage
- Dense: h-8 controls, 11px labels, tabs/view chips **above** FilterBar
- Backend: `backend/list_query.py` helpers (`apply_q`, `apply_date_range`, `apply_amount_range`, …)
- Convention: `date_from`/`date_to` on primary date; prefixed keys for secondary ranges (`renewal_from`, `due_from`)
- Filter controls use `data-testid="filter-{key}"`; clear = `filter-clear-btn`

## List sort conventions

| Kind | Default order | Examples |
|------|---------------|----------|
| Operational transactions | Newest first (date / `updated_at` desc) | Invoices, payments, bills, vouchers, tickets, tasks, bank ledger statement |
| Masters / directories | A–Z by name | Customers, products, vendors, users, bank accounts |
| Urgency queues | Soonest / overdue first | Subscription renewals, open-invoice due, task deadline view |
| Threads / statutory packs | Chronological ascending | Ticket messages, GSTR / accountant-pack month docs |

Bank ledger: compute running balance oldest→newest, then **reverse** for API/UI/CSV so newest row is first and its `running_balance` equals live balance.

## PDF branding

Official TechHind tax invoice layout: company header + GSTIN, billed/shipped to, HSN lines, tax summary, amount in words, bank details, signatory. Spec in `docs/design-guidelines.json` → `branded_pdf_spec`.
