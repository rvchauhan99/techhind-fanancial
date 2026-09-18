# DB index review — TechHind Company Finance

**Date:** 2026-09-18  
**DB:** `techhind_finance_qa` (local Mongo `127.0.0.1:27017`)  
**Bootstrap:** `backend/indexes.py` → `ensure_indexes()` on FastAPI lifespan

## Indexes (startup)

| Collection | Index | Notes |
|------------|-------|--------|
| users | `email` unique | Login |
| login_attempts | `identifier` | Lockout |
| invoices | `(status, doc_type)` | List filters |
| invoices | `customer_id` | Customer 360 |
| invoices | `invoice_date` | Month/FY reports |
| invoices | `invoice_no` unique **partial** (`$type: string`) | Drafts use `null` — sparse unique would collide |
| payments | `customer_id`, `payment_date` | AR / receipts |
| payments | `receipt_no` unique partial | Same null-safe pattern |
| number_series | `(kind, fy)` unique | TH/{FY}/{SEQ} |
| periods | `month` unique | Period close |
| subscriptions | `(customer_id, status)`, `next_renewal_on` | Renewals strip |
| purchase_bills | `(vendor_id, status)`, `bill_date` | AP |
| expense_vouchers | `status`, `voucher_date` | Ops queue |
| email_log | `ts` | Send history |
| vendors | `gstin` | Lookup |
| audit_logs | `ts` | Trail |
| revoked_refresh | `jti` unique, `exp` TTL | Refresh rotation |

## Query fixes

- Reports/dashboard month filters use `month_date_range(month)` → `{ $gte, $lt }` on ISO date strings (not `$regex: ^{month}`).
- Dashboard summary KPIs use aggregation for billed/collected/outstanding/MRR/ITC; trend/top customers remain FY-scoped finds on indexed dates.
- Invoice + payment list endpoints support `page`/`limit` pagination (`page=0` preserves legacy bare-array clients).

## Explain notes (hot paths)

Sampled after QA seed (~dozens of docs). With demo volume, all plans are `IXSCAN` / `COLLSCAN` on tiny collections; indexes matter at production scale.

| Query | Prefer | Evidence |
|-------|--------|----------|
| Invoices by month | `{invoice_date: {$gte,$lt}}` + `invoice_date` index | Avoids regex prefix scan |
| Payments by customer | `customer_id` | IXSCAN |
| Open AR | `(status, doc_type)` + balance filter | Compound helps status filter |
| Subscriptions renewals | `next_renewal_on` | Strip buckets |
| Period lock | `periods.month` unique | O(1) lookup |
| Refresh revoke | `revoked_refresh.jti` | Logout/rotate |

### How to re-check

```bash
mongosh techhind_finance_qa --eval 'db.invoices.find({invoice_date:{$gte:"2026-09-01",$lt:"2026-10-01"}}).explain("executionStats")'
```

Expect `winningPlan.inputStage.indexName` containing `invoice_date` when cardinality grows.

## Replica set

Multi-doc transactions (`run_in_transaction`) require a replica set. Local helper: `docker-compose.mongo-rs.yml`. Without RS, helper falls back to non-transactional sequential writes (logged) **only when** `REQUIRE_MONGO_TRANSACTIONS` is unset/false and `ENV` is not production. With the flag (or prod), transactions **fail closed** (HTTP 503) — no silent fallback.
