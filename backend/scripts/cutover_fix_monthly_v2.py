#!/usr/bin/env python3
"""v2 cutover fixes: Monthly ₹14,999 excl + 18%; Forext 2-month invoice; Greenpeak no renewal.

  python -m scripts.cutover_fix_monthly_v2 --dry-run
  python -m scripts.cutover_fix_monthly_v2 --commit
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

MONTHLY = "TechHind Solar CRM — Monthly"
ANNUAL = "TechHind Solar CRM — Annual"
MONTHLY_EXCL = 14999.0
FOREXT_CASH = 35399.0
GREENPEAK_NAME = "GREENPEAK ENERGY PRIVATE LIMITED"


class Stats:
    def __init__(self):
        self.counts: dict[str, int] = {}
        self.notes: list[str] = []

    def add(self, k: str, n: int = 1):
        self.counts[k] = self.counts.get(k, 0) + n

    def note(self, msg: str):
        self.notes.append(msg)


async def fix_monthly_product(commit: bool, stats: Stats) -> dict | None:
    from core import db

    spec = {
        "name": MONTHLY,
        "type": "saas_plan",
        "hsn_sac": "998314",
        "tax_rate": 18,
        "price": MONTHLY_EXCL,
        "billing_cycle": "monthly",
        "unit": "Nos",
        "description": "Monthly Solar CRM subscription (₹14,999 excl. + 18% GST)",
        "active": True,
        "price_includes_gst": False,
    }
    existing = await db.products.find_one({"name": MONTHLY}, {"_id": 0})
    if not existing:
        stats.note("Monthly product missing")
        return None
    if commit:
        await db.products.update_one({"id": existing["id"]}, {"$set": spec})
    stats.add("monthly_product_updated")
    stats.note(f"Monthly price={MONTHLY_EXCL} excl GST")
    return {**existing, **spec}


async def cancel_greenpeak_sub(commit: bool, stats: Stats):
    from core import db

    cust = await db.customers.find_one(
        {"$or": [
            {"cutover_code": "griwa"},
            {"legal_name": {"$regex": "GREENPEAK", "$options": "i"}},
            {"crm_tenant_key": "CUTOVER-griwa"},
        ]},
        {"_id": 0},
    )
    if not cust:
        stats.note("Greenpeak customer not found")
        return
    # Ensure name unchanged
    if cust.get("legal_name") != GREENPEAK_NAME and commit:
        # only fix if somehow renamed; plan says keep Greenpeak
        pass
    stats.note(f"Greenpeak customer id={cust['id']} name={cust.get('legal_name')}")

    subs = await db.subscriptions.find({"customer_id": cust["id"]}, {"_id": 0}).to_list(20)
    for s in subs:
        patch = {
            "status": "cancelled",
            "auto_renew": False,
            "notes": ((s.get("notes") or "") + " | Customer gone — master only, no renewals").strip(" |"),
        }
        if commit:
            await db.subscriptions.update_one({"id": s["id"]}, {"$set": patch})
        stats.add("greenpeak_sub_cancelled")
        stats.note(f"cancelled sub {s.get('plan_name')} was status={s.get('status')}")


async def fix_forext(commit: bool, stats: Stats, monthly: dict):
    from core import db
    from gst import compute_document, r2

    cust = await db.customers.find_one(
        {"$or": [
            {"cutover_code": "forext"},
            {"legal_name": {"$regex": "FOREXT", "$options": "i"}},
            {"crm_tenant_key": "CUTOVER-forext"},
        ]},
        {"_id": 0},
    )
    if not cust:
        stats.note("Forext customer not found")
        return

    company = await db.company.find_one({"id": "company"}, {"_id": 0}) or {}
    pos_code = cust.get("state_code") or "24"
    pos_state = cust.get("state") or "Gujarat"

    # Active monthly sub @ 14999 excl
    sub = await db.subscriptions.find_one(
        {"customer_id": cust["id"], "status": {"$in": ["active", "grace", "overdue", "cancelled", "expired"]}},
        {"_id": 0},
    )
    sub_patch = {
        "product_id": monthly["id"],
        "product_name": MONTHLY,
        "plan_name": MONTHLY,
        "billing_cycle": "monthly",
        "price": MONTHLY_EXCL,
        "price_includes_gst": False,
        "tax_rate": 18,
        "status": "active",
        "auto_renew": True,
        "mrr": MONTHLY_EXCL,
    }
    if sub:
        if commit:
            await db.subscriptions.update_one({"id": sub["id"]}, {"$set": sub_patch})
        stats.add("forext_sub_updated")
        sub_id = sub["id"]
    else:
        stats.note("Forext sub missing — skip create")
        sub_id = None

    # Rewrite 2-month invoice
    invs = await db.invoices.find(
        {"customer_id": cust["id"], "doc_type": "INV", "status": {"$ne": "draft"}},
        {"_id": 0},
    ).to_list(20)
    target = None
    for inv in invs:
        gt = float(inv.get("grand_total") or 0)
        paid = float(inv.get("amount_paid") or 0)
        if abs(gt - FOREXT_CASH) < 1.5 or abs(paid - FOREXT_CASH) < 1.5:
            target = inv
            break
    if not target:
        stats.note("Forext 35399 invoice not found")
        return

    lines = [{
        "description": f"{MONTHLY} — 2 months — {cust['legal_name']}",
        "product_id": monthly["id"],
        "hsn_sac": "998314",
        "qty": 2,
        "unit": "Nos",
        "rate": MONTHLY_EXCL,
        "discount": 0,
        "tax_rate": 18,
    }]
    computed = compute_document(lines, company.get("state_code") or "24", pos_code)
    raw = r2(computed["total_taxable"] + computed["total_tax"])
    target_grand = float(Decimal(str(FOREXT_CASH)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    # Prefer bank cash as grand when within ₹2 of computed
    if abs(computed["grand_total"] - target_grand) <= 2.01:
        computed["grand_total"] = target_grand
        computed["round_off"] = r2(target_grand - raw)

    patch = {
        **computed,
        "subscription_id": sub_id,
        "place_of_supply": {"state": pos_state, "code": pos_code},
        "amount_paid": computed["grand_total"],
        "balance": 0.0,
        "status": "paid",
        "notes": "Cutover — 2 months @ ₹14,999 excl + 18% GST",
        "customer_snapshot": {
            **(target.get("customer_snapshot") or {}),
            "legal_name": cust.get("legal_name"),
            "trade_name": cust.get("trade_name", ""),
            "state": pos_state,
            "state_code": pos_code,
        },
    }
    if commit:
        await db.invoices.update_one({"id": target["id"]}, {"$set": patch})
    stats.add("forext_invoice_rewritten")
    stats.note(
        f"{target.get('invoice_no')}: qty=2 rate={MONTHLY_EXCL} taxable={computed['total_taxable']} "
        f"cgst={computed['total_cgst']} sgst={computed['total_sgst']} grand={computed['grand_total']} "
        f"scheme={computed['tax_scheme']}"
    )

    pay = await db.payments.find_one(
        {"$or": [
            {"allocations.invoice_id": target["id"]},
            {"customer_id": cust["id"], "amount": FOREXT_CASH},
        ]},
        {"_id": 0},
    )
    if pay and commit:
        await db.payments.update_one(
            {"id": pay["id"]},
            {"$set": {
                "amount": FOREXT_CASH,
                "tds_amount": 0.0,
                "allocations": [{
                    "invoice_id": target["id"],
                    "amount": computed["grand_total"],
                    "invoice_no": target.get("invoice_no"),
                    "invoice_date": target.get("invoice_date"),
                }],
                "unallocated": 0.0,
            }},
        )
        stats.add("forext_payment_synced")


async def run(commit: bool):
    import bank_ledger as bl

    stats = Stats()
    print(f"cutover_fix_monthly_v2 {'COMMIT' if commit else 'DRY-RUN'}")
    monthly = await fix_monthly_product(commit, stats)
    await cancel_greenpeak_sub(commit, stats)
    if monthly:
        await fix_forext(commit, stats, monthly)

    hdfc = await bl.get_primary_bank()
    if hdfc:
        live = await bl.live_balance(hdfc["id"])
        stats.note(f"HDFC live_balance={live}")

    print("counts:", stats.counts)
    for n in stats.notes:
        print(" ", n)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--commit", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    commit = bool(args.commit) and not args.dry_run
    if not args.commit and not args.dry_run:
        print("Defaulting to dry-run (pass --commit to write)")
    asyncio.run(run(commit=commit))


if __name__ == "__main__":
    main()
