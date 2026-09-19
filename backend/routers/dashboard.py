from datetime import date, timedelta

from fastapi import APIRouter, Depends

from core import db, require_roles, ALL_ROLES, FINANCE_ROLES, today, fy_of
from gst import r2
import bank_ledger as bl

router = APIRouter(prefix="/api", tags=["dashboard"])

AR_BUCKETS = ["current", "0-30", "31-60", "61-90", "90+"]


def _bucket(days_overdue: int) -> str:
    if days_overdue <= 0:
        return "current"
    if days_overdue <= 30:
        return "0-30"
    if days_overdue <= 60:
        return "31-60"
    if days_overdue <= 90:
        return "61-90"
    return "90+"


def _aging(docs, date_field, as_of: str = "", q: str = "", bucket: str = "", min_balance=None):
    try:
        t = date.fromisoformat(as_of) if (as_of or "").strip() else today()
    except Exception:
        t = today()
    out = {b: {"amount": 0.0, "count": 0} for b in AR_BUCKETS}
    rows = []
    ql = (q or "").strip().lower()
    min_bal = None
    if min_balance is not None and min_balance != "":
        try:
            min_bal = float(min_balance)
        except (TypeError, ValueError):
            min_bal = None
    for d in docs:
        try:
            due = date.fromisoformat(d.get("due_date") or d.get(date_field))
        except Exception:
            due = t
        days = (t - due).days
        b = _bucket(days)
        party = d.get("party") or ""
        if ql and ql not in party.lower() and ql not in (d.get("invoice_no") or d.get("bill_no") or "").lower():
            continue
        if bucket and b != bucket:
            continue
        bal = float(d.get("balance") or 0)
        if min_bal is not None and bal < min_bal:
            continue
        out[b]["amount"] = r2(out[b]["amount"] + bal)
        out[b]["count"] += 1
        rows.append({**d, "days_overdue": days, "bucket": b})
    return {"buckets": out, "rows": rows, "as_of": t.isoformat()}


@router.get("/aging/ar")
async def ar_aging(as_of: str = "", q: str = "", bucket: str = "", min_balance: float = None,
                   user=Depends(require_roles(*ALL_ROLES))):
    invs = await db.invoices.find(
        {"doc_type": "INV", "status": {"$in": ["approved", "partially_paid"]}, "balance": {"$gt": 0}},
        {"_id": 0}).to_list(2000)
    for i in invs:
        i["party"] = (i.get("customer_snapshot") or {}).get("legal_name", "")
    return _aging(invs, "invoice_date", as_of=as_of, q=q, bucket=bucket, min_balance=min_balance)


@router.get("/aging/ap")
async def ap_aging(as_of: str = "", q: str = "", bucket: str = "", min_balance: float = None,
                   user=Depends(require_roles(*ALL_ROLES))):
    bills = await db.purchase_bills.find(
        {"status": {"$in": ["posted", "partially_paid"]}, "balance": {"$gt": 0}},
        {"_id": 0}).to_list(2000)
    for b in bills:
        b["party"] = (b.get("vendor_snapshot") or {}).get("name", "")
    return _aging(bills, "bill_date", as_of=as_of, q=q, bucket=bucket, min_balance=min_balance)


@router.get("/queue")
async def operational_queue(user=Depends(require_roles(*ALL_ROLES))):
    t = today().isoformat()
    draft_invoices = await db.invoices.count_documents({"status": "draft"})
    pending_vouchers = await db.expense_vouchers.count_documents({"status": "pending_approval"})
    draft_bills = await db.purchase_bills.count_documents({"status": "draft"})
    overdue_invoices = await db.invoices.count_documents(
        {"doc_type": "INV", "status": {"$in": ["approved", "partially_paid"]},
         "balance": {"$gt": 0}, "due_date": {"$lt": t}})
    pays = await db.payments.find({"unallocated": {"$gt": 0}}, {"_id": 0, "unallocated": 1}).to_list(1000)
    unallocated = r2(sum(p["unallocated"] for p in pays))
    return {"draft_invoices": draft_invoices, "pending_vouchers": pending_vouchers,
            "draft_bills": draft_bills, "overdue_invoices": overdue_invoices,
            "unallocated_receipts": unallocated}


@router.get("/dashboard/summary")
async def dashboard_summary(user=Depends(require_roles(*ALL_ROLES))):
    t = today()
    month_start = t.replace(day=1).isoformat()
    fy_start_month = 4
    fy_start = date(t.year if t.month >= fy_start_month else t.year - 1, fy_start_month, 1).isoformat()

    inv_pipe = [
        {"$match": {"status": {"$nin": ["draft", "cancelled"]}, "invoice_date": {"$gte": fy_start}}},
        {"$group": {
            "_id": {"doc_type": "$doc_type", "month_bucket": {
                "$cond": [{"$gte": ["$invoice_date", month_start]}, "month", "fy"]
            }},
            "grand": {"$sum": "$grand_total"},
            "tax": {"$sum": "$total_tax"},
        }},
    ]
    inv_agg = await db.invoices.aggregate(inv_pipe).to_list(50)

    def _inv_sum(doc_type: str, bucket: str) -> float:
        return r2(sum(
            r["grand"] for r in inv_agg
            if r["_id"].get("doc_type") == doc_type and r["_id"].get("month_bucket") == bucket
        ))

    def _inv_tax(doc_type: str, bucket: str) -> float:
        return r2(sum(
            r["tax"] for r in inv_agg
            if r["_id"].get("doc_type") == doc_type and r["_id"].get("month_bucket") == bucket
        ))

    billed_month = r2(_inv_sum("INV", "month") - _inv_sum("CN", "month"))
    output_tax_month = r2(_inv_tax("INV", "month") - _inv_tax("CN", "month"))

    pay_agg = await db.payments.aggregate([
        {"$match": {"payment_date": {"$gte": month_start}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
    ]).to_list(1)
    collected_month = r2((pay_agg[0]["total"] if pay_agg else 0) or 0)

    out_agg = await db.invoices.aggregate([
        {"$match": {
            "doc_type": "INV",
            "status": {"$in": ["approved", "partially_paid"]},
            "balance": {"$gt": 0},
        }},
        {"$group": {"_id": None, "total": {"$sum": "$balance"}}},
    ]).to_list(1)
    outstanding = r2((out_agg[0]["total"] if out_agg else 0) or 0)

    mrr_agg = await db.subscriptions.aggregate([
        {"$match": {"status": "active"}},
        {"$group": {"_id": None, "mrr": {"$sum": "$mrr"}, "count": {"$sum": 1}}},
    ]).to_list(1)
    mrr = r2((mrr_agg[0]["mrr"] if mrr_agg else 0) or 0)
    active_count = int((mrr_agg[0]["count"] if mrr_agg else 0) or 0)

    itc_agg = await db.purchase_bills.aggregate([
        {"$match": {
            "status": {"$ne": "draft"},
            "itc_eligible": True,
            "bill_date": {"$gte": month_start},
        }},
        {"$group": {"_id": None, "tax": {"$sum": "$total_tax"}}},
    ]).to_list(1)
    itc_month = r2((itc_agg[0]["tax"] if itc_agg else 0) or 0)
    gst_liability = r2(output_tax_month - itc_month)

    # Documents for trend / top customers (FY-scoped, indexed date)
    invs = await db.invoices.find(
        {"status": {"$ne": "draft"}, "invoice_date": {"$gte": fy_start}},
        {"_id": 0, "doc_type": 1, "status": 1, "invoice_date": 1, "grand_total": 1,
         "balance": 1, "due_date": 1, "customer_snapshot.legal_name": 1, "total_tax": 1},
    ).to_list(5000)
    pays = await db.payments.find(
        {"payment_date": {"$gte": fy_start}},
        {"_id": 0, "payment_date": 1, "amount": 1},
    ).to_list(5000)
    vouchers = await db.expense_vouchers.find(
        {"status": "posted", "voucher_date": {"$gte": fy_start}},
        {"_id": 0, "category": 1, "total": 1, "voucher_date": 1},
    ).to_list(5000)
    subs = await db.subscriptions.find({}, {"_id": 0, "status": 1, "mrr": 1}).to_list(1000)

    live_inv = [i for i in invs if i["status"] != "cancelled" and i["doc_type"] == "INV"]

    trend = []
    y, m = t.year, t.month
    months = []
    for _ in range(6):
        months.append((y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    months.reverse()
    for (yy, mm) in months:
        start = date(yy, mm, 1).isoformat()
        end = date(yy + (mm == 12), (mm % 12) + 1, 1).isoformat()
        billed = r2(sum(i["grand_total"] for i in live_inv if start <= i["invoice_date"] < end))
        collected = r2(sum(p["amount"] for p in pays if start <= p["payment_date"] < end))
        trend.append({"month": date(yy, mm, 1).strftime("%b %y"), "billed": billed, "collected": collected})

    by_cust = {}
    for i in live_inv:
        name = (i.get("customer_snapshot") or {}).get("legal_name", "Unknown")
        by_cust[name] = by_cust.get(name, 0) + i["grand_total"]
    top_customers = [{"name": k, "billed": r2(v)} for k, v in
                     sorted(by_cust.items(), key=lambda x: -x[1])[:5]]

    by_cat = {}
    for v in vouchers:
        by_cat[v["category"]] = by_cat.get(v["category"], 0) + v.get("total", 0)
    expense_by_category = [{"category": k, "total": r2(v)} for k, v in
                           sorted(by_cat.items(), key=lambda x: -x[1])]

    open_inv = [i for i in live_inv if i["status"] in ("approved", "partially_paid") and i.get("balance", 0) > 0]
    ar = {b: 0.0 for b in AR_BUCKETS}
    for i in open_inv:
        try:
            due = date.fromisoformat(i.get("due_date") or i["invoice_date"])
        except Exception:
            due = t
        ar[_bucket((t - due).days)] = r2(ar[_bucket((t - due).days)] + i["balance"])

    sub_health = {}
    for s in subs:
        sub_health[s["status"]] = sub_health.get(s["status"], 0) + 1

    return {
        "kpis": {
            "mrr": mrr, "arr": r2(mrr * 12),
            "billed_month": billed_month, "collected_month": collected_month,
            "outstanding": outstanding, "gst_liability": gst_liability,
            "output_tax_month": output_tax_month, "itc_month": itc_month,
            "active_subscriptions": active_count,
            "cash_bank_position": await bl.total_cash_position(),
        },
        "trend": trend, "top_customers": top_customers,
        "expense_by_category": expense_by_category,
        "ar_aging": [{"bucket": b, "amount": ar[b]} for b in AR_BUCKETS],
        "subscription_health": [{"status": k, "count": v} for k, v in sub_health.items()],
        "fy": fy_of(t),
    }


@router.get("/audit")
async def audit_logs(entity_type: str = "", action: str = "", q: str = "",
                     date_from: str = "", date_to: str = "",
                     limit: int = 200, user=Depends(require_roles(*FINANCE_ROLES))):
    from list_query import apply_q, apply_date_range, apply_eq
    flt = {}
    apply_eq(flt, "entity_type", entity_type)
    apply_eq(flt, "action", action)
    apply_date_range(flt, "ts", date_from, date_to)
    apply_q(flt, q, ["summary", "user_email", "user_name", "entity_id"])
    return await db.audit_logs.find(flt, {"_id": 0}).sort("ts", -1).to_list(min(limit, 500))


@router.get("/activity")
async def entity_activity(entity_type: str, entity_id: str, limit: int = 100,
                          user=Depends(require_roles(*FINANCE_ROLES))):
    if not entity_type or not entity_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="entity_type and entity_id are required")
    limit = max(1, min(limit, 500))
    return await db.audit_logs.find(
        {"entity_type": entity_type, "entity_id": entity_id},
        {"_id": 0},
    ).sort("ts", -1).to_list(limit)
