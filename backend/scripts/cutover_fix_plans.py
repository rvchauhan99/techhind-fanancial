#!/usr/bin/env python3
"""Idempotent cutover fix: real Annual/Monthly products, client prices (GST-incl),
rewrite historical invoices with 18% CGST+SGST (or IGST if states differ), link subs.

  python -m scripts.cutover_fix_plans --dry-run
  python -m scripts.cutover_fix_plans --commit
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

ANNUAL = "TechHind Solar CRM — Annual"
MONTHLY = "TechHind Solar CRM — Monthly"
QUARTERLY = "TechHind Solar CRM — Quarterly"
HALF_YEAR = "TechHind Solar CRM — Half-Year"

PROD_PRODUCTS = [
    {
        "name": ANNUAL, "type": "saas_plan", "hsn_sac": "998314", "tax_rate": 18,
        "price": 184066.0, "billing_cycle": "yearly", "unit": "Nos",
        "description": "Annual Solar CRM subscription (price incl. 18% GST)",
        "active": True, "price_includes_gst": True,
    },
    {
        "name": MONTHLY, "type": "saas_plan", "hsn_sac": "998314", "tax_rate": 18,
        "price": 14999.0, "billing_cycle": "monthly", "unit": "Nos",
        "description": "Monthly Solar CRM subscription (₹14,999 excl. + 18% GST)",
        "active": True, "price_includes_gst": False,
    },
    {
        "name": QUARTERLY, "type": "saas_plan", "hsn_sac": "998314", "tax_rate": 18,
        "price": 43497.0, "billing_cycle": "quarterly", "unit": "Nos",
        "description": "Quarterly Solar CRM subscription (₹14,499/mo × 3 = ₹43,497 excl. + 18% GST)",
        "active": True, "price_includes_gst": False,
    },
    {
        "name": HALF_YEAR, "type": "saas_plan", "hsn_sac": "998314", "tax_rate": 18,
        "price": 83994.0, "billing_cycle": "half_yearly", "unit": "Nos",
        "description": "Half-year Solar CRM subscription (₹13,999/mo × 6 = ₹83,994 excl. + 18% GST)",
        "active": True, "price_includes_gst": False,
    },
]

# Inclusive consideration = bank cash + TDS (where recorded)
# forext: renewal price is monthly excl 14999 (2-month hist invoice handled separately)
CLIENT_PLAN = {
    "se": {"inclusive": 187186.0, "cycle": "yearly", "product": ANNUAL, "price_includes_gst": True},
    "hs": {"inclusive": 176396.0, "cycle": "yearly", "product": ANNUAL, "price_includes_gst": True},
    "sclean": {"inclusive": 184066.0, "cycle": "yearly", "product": ANNUAL, "price_includes_gst": True},
    "forext": {"inclusive": 14999.0, "cycle": "monthly", "product": MONTHLY, "price_includes_gst": False},
    "griwa": {"inclusive": 14999.0, "cycle": "monthly", "product": MONTHLY, "price_includes_gst": False, "cancelled": True},
}

# Invoice rewrite: match by bank cash amount on paid cutover invoices → full consideration
# (cash, cash+tds) keyed by customer cutover_code
INVOICE_CONSIDERATION = {
    "se": {184066.0: 187186.0},
    "hs": {176396.0: 176396.0},
    "sclean": {58866.0: 59881.0, 180946.0: 184066.0},
    "forext": {35399.0: 35399.0},
    "griwa": {35398.0: 35398.0},
}

TDS_BY_CASH = {
    184066.0: 3120.0,
    58866.0: 1015.0,
    180946.0: 3120.0,
}


class Stats:
    def __init__(self):
        self.counts: dict[str, int] = {}
        self.notes: list[str] = []

    def add(self, k: str, n: int = 1):
        self.counts[k] = self.counts.get(k, 0) + n

    def note(self, msg: str):
        self.notes.append(msg)


async def ensure_products(commit: bool, stats: Stats) -> dict:
    from core import db, new_id, iso_now

    by_name = {}
    for spec in PROD_PRODUCTS:
        existing = await db.products.find_one({"name": spec["name"]}, {"_id": 0})
        if existing:
            if commit:
                await db.products.update_one({"id": existing["id"]}, {"$set": {**spec}})
            by_name[spec["name"]] = {**existing, **spec}
            stats.add("product_updated")
        else:
            doc = {**spec, "id": new_id(), "created_at": iso_now()}
            if commit:
                await db.products.insert_one(doc)
            by_name[spec["name"]] = doc
            stats.add("product_created")

    demo = await db.products.find(
        {"name": {"$nin": [p["name"] for p in PROD_PRODUCTS]}, "active": {"$ne": False}},
        {"_id": 0, "id": 1, "name": 1},
    ).to_list(100)
    for d in demo:
        if commit:
            await db.products.update_one({"id": d["id"]}, {"$set": {"active": False}})
        stats.add("product_deactivated")
        stats.note(f"deactivated demo product {d['name']}")
    return by_name


async def ensure_company_state(commit: bool, stats: Stats):
    from core import db
    from seed import COMPANY

    company = await db.company.find_one({"id": "company"}, {"_id": 0}) or {}
    patch = {}
    if not company.get("state"):
        patch["state"] = COMPANY["state"]
    if not company.get("state_code"):
        patch["state_code"] = COMPANY["state_code"]
    if patch and commit:
        await db.company.update_one({"id": "company"}, {"$set": patch}, upsert=True)
    if patch:
        stats.add("company_state_fixed")
        stats.note(f"company state → {patch or company}")
    return await db.company.find_one({"id": "company"}, {"_id": 0}) or COMPANY


async def fix_subscriptions(commit: bool, stats: Stats, products: dict):
    from core import db, new_id, iso_now, CYCLE_MONTHS
    from scripts.cutover_import import PARTY_MAP, load_ved_rows, _cutover_id

    ved = load_ved_rows()
    customers = {}
    async for c in db.customers.find({"cutover_code": {"$exists": True}}, {"_id": 0}):
        customers[c["cutover_code"]] = c
    # also by crm key
    for code in PARTY_MAP:
        if code in customers:
            continue
        c = await db.customers.find_one({"crm_tenant_key": f"CUTOVER-{code}"}, {"_id": 0})
        if c:
            if commit and not c.get("cutover_code"):
                await db.customers.update_one({"id": c["id"]}, {"$set": {"cutover_code": code}})
            customers[code] = c

    for code, cust in customers.items():
        patch = {}
        if cust.get("state_code") != "24" or cust.get("state") != "Gujarat":
            patch = {"state": "Gujarat", "state_code": "24"}
            if commit:
                await db.customers.update_one({"id": cust["id"]}, {"$set": patch})
            stats.add("customer_state_fixed")

    for row in ved:
        code = row["code"]
        if row.get("skip_sub") or PARTY_MAP.get(code, {}).get("skip_sub"):
            stats.add("sub_skipped")
            continue
        plan = CLIENT_PLAN.get(code)
        cust = customers.get(code)
        if not plan or not cust:
            stats.note(f"skip sub {code}: missing plan or customer")
            continue
        product = products[plan["product"]]
        months = CYCLE_MONTHS.get(plan["cycle"], 12) or 12
        price = plan["inclusive"]
        incl = plan.get("price_includes_gst", True)
        cancelled = bool(plan.get("cancelled"))
        start = row["start"]
        end = row.get("end")
        next_renewal = end or start
        cut_key = _cutover_id("sub", code, start, row["type"])
        existing = await db.subscriptions.find_one(
            {"$or": [
                {"cutover_key": cut_key},
                {"customer_id": cust["id"]},
            ]},
            {"_id": 0},
        )
        doc = {
            "customer_id": cust["id"],
            "product_id": product["id"],
            "product_name": product["name"],
            "plan_name": product["name"],
            "billing_cycle": plan["cycle"],
            "price": price,
            "price_includes_gst": incl,
            "tax_rate": 18,
            "status": "cancelled" if cancelled else "active",
            "start_on": start,
            "start_date": start,
            "end_date": end,
            "next_renewal_on": next_renewal,
            "seats": 1,
            "auto_renew": False if cancelled else True,
            "mrr": 0.0 if cancelled else round(price / months, 2),
            "notes": (
                f"Cutover from ved.xlsx; referred_by={row.get('referred_by')}"
                + (" | Customer gone — master only, no renewals" if cancelled else "")
            ),
            "cutover_key": cut_key,
        }
        if existing:
            if commit:
                await db.subscriptions.update_one({"id": existing["id"]}, {"$set": doc})
            stats.add("sub_updated")
            customers[code]["_sub_id"] = existing["id"]
        else:
            doc.update({"id": new_id(), "created_at": iso_now()})
            if commit:
                await db.subscriptions.insert_one(doc)
            stats.add("sub_created")
            customers[code]["_sub_id"] = doc["id"]
    return customers


async def rewrite_invoices(commit: bool, stats: Stats, company: dict, products: dict, customers: dict):
    from core import db
    from gst import compute_document, exclusive_from_inclusive, r2
    from decimal import Decimal, ROUND_HALF_UP

    for code, cust in customers.items():
        if code not in INVOICE_CONSIDERATION:
            continue
        plan = CLIENT_PLAN.get(code)
        product = products[plan["product"]] if plan else None
        sub_id = cust.get("_sub_id")
        if not sub_id:
            sub = await db.subscriptions.find_one({"customer_id": cust["id"]}, {"_id": 0})
            sub_id = (sub or {}).get("id")

        invoices = await db.invoices.find(
            {"customer_id": cust["id"], "created_by": "cutover"},
            {"_id": 0},
        ).to_list(50)
        for inv in invoices:
            # Detect original cash from lines rate / grand_total / amount_paid
            cash_candidates = [
                float(inv.get("amount_paid") or 0),
                float(inv.get("grand_total") or 0),
            ]
            if inv.get("lines"):
                cash_candidates.append(float(inv["lines"][0].get("rate") or 0))
                if inv["lines"][0].get("rate_inclusive") is not None:
                    cash_candidates.append(float(inv["lines"][0]["rate_inclusive"]))

            consideration = None
            cash_key = None
            mapping = INVOICE_CONSIDERATION[code]
            for cand in cash_candidates:
                for cash, incl in mapping.items():
                    if abs(cand - cash) < 0.02 or abs(cand - incl) < 0.02:
                        consideration = incl
                        cash_key = cash
                        break
                if consideration is not None:
                    break
            if consideration is None:
                stats.note(f"invoice {inv.get('invoice_no')} {code}: no consideration map")
                stats.add("invoice_skipped")
                continue

            tax_rate = 18.0
            exclusive = exclusive_from_inclusive(consideration, tax_rate)
            desc = f"{product['name']} — {cust['legal_name']}" if product else inv["lines"][0]["description"]
            lines = [{
                "description": desc,
                "product_id": product["id"] if product else None,
                "hsn_sac": "998314",
                "qty": 1,
                "unit": "Nos",
                "rate": exclusive,
                "rate_inclusive": r2(consideration),
                "discount": 0,
                "tax_rate": tax_rate,
            }]
            pos_code = cust.get("state_code") or "24"
            pos_state = cust.get("state") or "Gujarat"
            computed = compute_document(lines, company.get("state_code") or "24", pos_code)
            # Align grand_total to whole-rupee consideration when round-off is within ₹1
            raw = r2(computed["total_taxable"] + computed["total_tax"])
            target_grand = float(Decimal(str(consideration)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            if abs(computed["grand_total"] - target_grand) <= 1.01:
                computed["grand_total"] = target_grand
                computed["round_off"] = r2(target_grand - raw)

            tds = TDS_BY_CASH.get(cash_key, 0.0) if cash_key else 0.0
            bank_cash = r2(consideration - tds)

            patch = {
                **computed,
                "subscription_id": sub_id,
                "place_of_supply": {"state": pos_state, "code": pos_code},
                "tds_amount": tds,
                "amount_paid": computed["grand_total"],
                "balance": 0.0,
                "status": "paid",
                "notes": "Cutover historical (GST-inclusive rewritten)",
            }
            if commit:
                await db.invoices.update_one({"id": inv["id"]}, {"$set": patch})
            stats.add("invoice_rewritten")
            stats.note(
                f"{inv.get('invoice_no')} {code}: grand={computed['grand_total']} "
                f"taxable={computed['total_taxable']} cgst={computed['total_cgst']} "
                f"sgst={computed['total_sgst']} scheme={computed['tax_scheme']}"
            )

            # Sync payment TDS + allocation to new grand
            pay = await db.payments.find_one(
                {"customer_id": cust["id"], "cutover_key": inv.get("cutover_key")},
                {"_id": 0},
            )
            if not pay:
                pay = await db.payments.find_one(
                    {"allocations.invoice_id": inv["id"]},
                    {"_id": 0},
                )
            if pay:
                pay_patch = {
                    "amount": bank_cash,
                    "tds_amount": tds,
                    "allocations": [{
                        "invoice_id": inv["id"],
                        "amount": computed["grand_total"],
                        "invoice_no": inv.get("invoice_no"),
                        "invoice_date": inv.get("invoice_date"),
                    }],
                    "unallocated": 0.0,
                }
                if commit:
                    await db.payments.update_one({"id": pay["id"]}, {"$set": pay_patch})
                stats.add("payment_synced")


async def run(commit: bool):
    from core import db
    import bank_ledger as bl

    stats = Stats()
    mode = "COMMIT" if commit else "DRY-RUN"
    print(f"cutover_fix_plans {mode}")

    company = await ensure_company_state(commit, stats)
    products = await ensure_products(commit, stats)
    customers = await fix_subscriptions(commit, stats, products)
    await rewrite_invoices(commit, stats, company, products, customers)

    hdfc = await bl.get_primary_bank()
    if hdfc:
        live = await bl.live_balance(hdfc["id"])
        stats.note(f"HDFC live_balance={live}")

    print("counts:", stats.counts)
    for n in stats.notes:
        print(" ", n)
    return stats


def main():
    parser = argparse.ArgumentParser(description="Fix cutover plans + GST-inclusive invoices")
    parser.add_argument("--commit", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    commit = bool(args.commit) and not args.dry_run
    if not args.commit and not args.dry_run:
        commit = False
        print("Defaulting to dry-run (pass --commit to write)")
    asyncio.run(run(commit=commit))


if __name__ == "__main__":
    main()
