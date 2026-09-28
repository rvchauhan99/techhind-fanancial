# Design — dense finance UI

Source of truth (full tokens): `docs/design-guidelines.json`.

## Layout

- Desktop-first left-nav workspace; maximize data density; minimize padding
- Persistent renewals strip: Overdue / 7 / 15 / 30 day buckets
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
