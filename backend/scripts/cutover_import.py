#!/usr/bin/env python3
"""Production cutover import — bank ledger + parties + CRM docs (no double cash).

Phases (idempotent):
  1. Bank CSV → bank_ledger (source_type=import)
  2. Parties + subscriptions from ved.xlsx + party map
  3. Historical invoices + payments for customer deposits (skip_bank_post)
  4. Salary / expense / statutory vouchers (skip_bank_post) + link ledger
  5. TDS annotations on payments / customer notes

Usage:
  python -m scripts.cutover_import --dry-run
  python -m scripts.cutover_import --commit
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import io
import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

CUTOVER = ROOT / "cutover"
BANK_CSV = CUTOVER / "Account Internal(bank txn).csv"
EXPENSE_CSV = CUTOVER / "Account Internal(expance).csv"
TDS_CSV = CUTOVER / "Account Internal(TDS).csv"
VED_XLSX = CUTOVER / "ved.xlsx"

EXPECTED_BANK_LINES = 28
EXPECTED_CLOSING = 209174.04

# Locked party map (plan)
PARTY_MAP = {
    "se": {
        "legal_name": "SOLAR EARTH RENEWABLES PRIVATE LIMITED",
        "trade_name": "Solar Earth",
        "match": ("SOLAR EARTH",),
    },
    "hs": {
        "legal_name": "H AND S ENGINEERING",
        "trade_name": "H AND S",
        "match": ("H AND S ENGINEERING", "SOFTWARE CHARGES-H AND S"),
    },
    "sclean": {
        "legal_name": "SOLAR CLEAN ENERGY",
        "trade_name": "Solar Clean",
        "match": ("SOLAR CLEAN ENERGY",),
    },
    "forext": {
        "legal_name": "FOREXT GREEN ENERGY PVT LTD",
        "trade_name": "Forext",
        "match": ("FOREXT GREEN ENERGY",),
    },
    "griwa": {
        "legal_name": "GREENPEAK ENERGY PRIVATE LIMITED",
        "trade_name": "Greenpeak",
        "match": ("GREENPEAK ENERGY",),
    },
    "nx": {
        "legal_name": "NX (stub — yet to call)",
        "trade_name": "NX",
        "match": (),
        "skip_sub": True,
    },
}

PLAN_PRODUCT = {
    "annual": "TH Cloud — Growth Annual",
    "monthly": "TH Cloud — Growth",
}


def _cutover_id(*parts) -> str:
    raw = "|".join(str(p) for p in parts)
    return "cutover:" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:24]


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").upper()).strip()


def classify_bank_row(narration: str, credit: float, debit: float) -> dict:
    n = _norm(narration)
    # Capital / shareholding
    if credit > 0 and (
        "SHARE HOLDING" in n
        or "TECHHIND PRIVATE LIMITED" in n and credit in (50000, 45000, 5000)
        or "RAVATRAJSINH" in n and credit == 45000
        or "YASHKUMAR" in n and credit == 5000
    ):
        # First three deposits are capital; also catch by position later
        if any(x in n for x in ("TECHHIND PRIVATE LIMITED", "RAVATRAJSINH", "YASHKUMAR", "SHARE")):
            if "SOLAR" not in n and "SOFTWARE" not in n and "FOREXT" not in n and "GREENPEAK" not in n:
                if credit in (50000.0, 45000.0, 5000.0) and "SALARY" not in n:
                    return {"kind": "capital", "party": None}

    # Customer receipts
    for code, meta in PARTY_MAP.items():
        for token in meta["match"]:
            if token in n and credit > 0:
                return {"kind": "customer_receipt", "party": code}

    # Salary
    if debit > 0 and (
        "SALARY" in n
        or (abs(debit - 50000) < 0.01 and ("RAVAT" in n or "VEDANT" in n) and "SOLAR" not in n)
    ):
        who = "Ravat" if "RAVAT" in n else ("Vedant" if "VEDANT" in n else "Staff")
        return {"kind": "salary", "party": who}

    # TDS withdrawal (Solar Earth)
    if debit > 0 and "SOLAR EARTH" in n and abs(debit - 3120) < 0.01:
        return {"kind": "tds_withdrawal", "party": "se"}

    # GST
    if debit > 0 and (n.startswith("GST/") or ("GST" in n and "BANK REFERENCE" in n)):
        return {"kind": "statutory_gst", "party": None}

    # Known ops expenses on bank
    if debit > 0 and "HOSTINGER" in n:
        return {"kind": "ops_expense", "party": None, "label": "Hostinger"}
    if debit > 0 and ("PAYUAMAZON" in n or "AMAZON" in n):
        return {"kind": "ops_expense", "party": None, "label": "Amazon PayU"}
    if debit > 0 and "SEJAL GRAPHICS" in n:
        return {"kind": "ops_expense", "party": None, "label": "Sejal Graphics"}

    # Amazon refund / Cashfree noise
    if credit > 0 and ("PAYUAMA" in n or "CASHFREE" in n or "REF-PAYU" in n):
        return {"kind": "misc_credit", "party": None}

    if credit > 0:
        return {"kind": "other_credit", "party": None}
    return {"kind": "other_debit", "party": None}


def parse_expense_date(raw: str, default_year: int = 2026) -> str:
    """Parse expense CSV dates: '2nd may', '16-May', 'Monday, May 11, 2026', 'april'."""
    v = (raw or "").strip().strip('"')
    if not v:
        raise ValueError("empty date")
    # Full weekday form
    for fmt in ("%A, %B %d, %Y", "%B %d, %Y", "%d-%b-%Y", "%d-%B-%Y"):
        try:
            return datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            pass
    # Month-only e.g. april → first of month
    months = {
        "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
        "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
        "aug": 8, "august": 8, "sep": 9, "september": 9, "oct": 10, "october": 10,
        "nov": 11, "november": 11, "dec": 12, "december": 12,
    }
    low = v.lower().strip()
    if low in months:
        return date(default_year, months[low], 1).isoformat()
    # 2nd may / 16-May / 7th may
    m = re.match(r"^(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]+)(?:[\s\-/]+(\d{2,4}))?$", v, re.I)
    if m:
        day = int(m.group(1))
        mon = months.get(m.group(2).lower()[:3]) or months.get(m.group(2).lower())
        if not mon:
            raise ValueError(f"bad month in '{raw}'")
        yr = int(m.group(3)) if m.group(3) else default_year
        if yr < 100:
            yr += 2000
        return date(yr, mon, day).isoformat()
    # Fallback bank-style
    import bank_ledger as bl
    return bl.parse_bank_date(v)


def load_bank_rows() -> list[dict]:
    raise RuntimeError("use load_bank_rows_async")


async def load_bank_rows_async() -> list[dict]:
    from routers.banks import _parse_statement_rows
    return await _parse_statement_rows(BANK_CSV.read_bytes())


def load_expense_rows() -> list[dict]:
    text = EXPENSE_CSV.read_text(encoding="utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for idx, raw in enumerate(reader, 1):
        visit = (raw.get("visit") or "").strip()
        date_raw = (raw.get("Date") or "").strip()
        amount_raw = (raw.get("Amount") or "").strip().replace(",", "")
        purpose = (raw.get("purpose") or "").strip()
        pay_by = (raw.get("pay by") or "").strip()
        if not date_raw and not amount_raw:
            continue
        amount = float(amount_raw or 0)
        txn_date = parse_expense_date(date_raw)
        if purpose.lower() == "visit":
            category = "Travel"
        elif "server" in purpose.lower():
            category = "Cloud & Hosting"
        else:
            category = "Office Supplies"
        rows.append({
            "row": idx,
            "visit": visit,
            "txn_date": txn_date,
            "amount": amount,
            "purpose": purpose,
            "pay_by": pay_by,
            "category": category,
            "narration": f"{visit} ({purpose})" if visit else purpose,
        })
    return rows


def load_tds_rows() -> list[dict]:
    text = TDS_CSV.read_text(encoding="utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    import bank_ledger as bl
    for idx, raw in enumerate(reader, 1):
        company = (raw.get("Company") or "").strip()
        tds_raw = (raw.get("Tds") or "").strip()
        date_raw = (raw.get("Date") or "").strip()
        if not company or not tds_raw:
            continue
        rows.append({
            "row": idx,
            "txn_date": bl.parse_bank_date(date_raw),
            "company": company,
            "tds_amount": float(tds_raw.replace(",", "")),
            "party": _party_from_company(company),
        })
    return rows


def _party_from_company(company: str) -> str | None:
    n = _norm(company)
    for code, meta in PARTY_MAP.items():
        for token in meta["match"]:
            if token in n or _norm(meta["legal_name"]) in n:
                return code
    return None


def load_ved_rows() -> list[dict]:
    import openpyxl
    wb = openpyxl.load_workbook(VED_XLSX, data_only=True)
    ws = wb.active
    rows = []
    for i, row in enumerate(ws.iter_rows(values_only=True), 1):
        if i == 1:
            continue
        code = (row[0] or "").strip().lower() if row[0] else ""
        if not code:
            continue
        start, end, typ, referred = row[1], row[2], row[3], row[4]
        if isinstance(start, str) and "yet to call" in start.lower():
            rows.append({"code": code, "skip_sub": True, "note": start})
            continue
        if not isinstance(start, datetime) or not typ:
            rows.append({"code": code, "skip_sub": True, "note": str(start)})
            continue

        def _d(v):
            if isinstance(v, datetime):
                return v.date().isoformat()
            if isinstance(v, date):
                return v.isoformat()
            return None

        rows.append({
            "code": code,
            "skip_sub": bool(PARTY_MAP.get(code, {}).get("skip_sub")),
            "start": _d(start),
            "end": _d(end),
            "type": str(typ).strip().lower(),
            "referred_by": str(referred or "").strip(),
        })
    return rows


class Stats:
    def __init__(self):
        self.counts = {}
        self.notes = []

    def add(self, key: str, n: int = 1):
        self.counts[key] = self.counts.get(key, 0) + n

    def note(self, msg: str):
        self.notes.append(msg)

    def report(self) -> str:
        lines = [f"  {k}: {v}" for k, v in sorted(self.counts.items())]
        if self.notes:
            lines.append("notes:")
            lines.extend(f"  - {n}" for n in self.notes[:40])
        return "\n".join(lines)


async def phase_bank(commit: bool, stats: Stats, hdfc_id: str) -> list[dict]:
    import bank_ledger as bl

    parsed = await load_bank_rows_async()
    valid = [r for r in parsed if r.get("ok") and not r.get("skipped")]
    invalid = [r for r in parsed if not r.get("ok")]
    stats.add("bank_parsed", len(parsed))
    stats.add("bank_valid", len(valid))
    stats.add("bank_invalid", len(invalid))
    for bad in invalid:
        stats.note(f"bank row {bad.get('row')}: {bad.get('error')}")

    entries = []
    for r in valid:
        cls = classify_bank_row(r["narration"], r["credit"], r["debit"])
        # Fix capital classification for first shareholding lines
        n = _norm(r["narration"])
        if r["credit"] in (50000.0, 45000.0, 5000.0) and r["txn_date"].startswith("2026-02"):
            cls = {"kind": "capital", "party": None}
        source_id = _cutover_id("bank", r["txn_date"], r["debit"], r["credit"], r["narration"][:80], r.get("reference_no"))
        item = {**r, "classify": cls, "source_id": source_id}
        entries.append(item)
        if not commit:
            stats.add(f"bank_kind_{cls['kind']}")
            continue
        existing = await bl.db.bank_ledger.find_one({"source_type": "import", "source_id": source_id}, {"_id": 0})
        if existing:
            stats.add("bank_skipped_existing")
            item["entry_id"] = existing["id"]
            continue
        # Use bank_ledger.db? No - use core.db via post_entry
        from core import db
        entry = await bl.post_entry(
            bank_id=hdfc_id,
            txn_date=r["txn_date"],
            value_date=r["value_date"],
            debit=r["debit"],
            credit=r["credit"],
            narration=r["narration"],
            reference_no=r["reference_no"],
            bank_closing=r.get("bank_closing"),
            source_type="import",
            source_id=source_id,
            created_by="cutover",
            linked_kind="capital" if cls["kind"] == "capital" else None,
            linked_id="share_capital" if cls["kind"] == "capital" else None,
            linked_no="Share capital" if cls["kind"] == "capital" else None,
        )
        item["entry_id"] = entry["id"]
        stats.add("bank_committed")
        stats.add(f"bank_kind_{cls['kind']}")

    if commit:
        live = await bl.live_balance(hdfc_id)
        stats.note(f"HDFC live_balance={live}")
        if abs(live - EXPECTED_CLOSING) > 0.01:
            stats.note(f"WARNING live_balance != {EXPECTED_CLOSING}")
        else:
            stats.note(f"ASSERT ok live_balance == {EXPECTED_CLOSING}")
    return entries


async def phase_parties(commit: bool, stats: Stats) -> dict:
    from core import db, new_id, iso_now, CYCLE_MONTHS

    ved = load_ved_rows()
    products = {p["name"]: p for p in await db.products.find({}, {"_id": 0}).to_list(100)}

    customers_by_code = {}
    for code, meta in PARTY_MAP.items():
        crm_key = f"CUTOVER-{code}"
        existing = await db.customers.find_one({"crm_tenant_key": crm_key}, {"_id": 0})
        if existing:
            customers_by_code[code] = existing
            stats.add("customer_existing")
            continue
        doc = {
            "id": new_id(),
            "legal_name": meta["legal_name"],
            "trade_name": meta["trade_name"],
            "gstin": "",
            "pan": "",
            "state": "Gujarat",
            "state_code": "24",
            "billing_address": "",
            "shipping_address": "",
            "contacts": [],
            "contact_email": "",
            "crm_tenant_key": crm_key,
            "notes": "Cutover historical party",
            "created_at": iso_now(),
            "cutover_code": code,
        }
        if commit:
            await db.customers.insert_one(doc)
            stats.add("customer_created")
        else:
            stats.add("customer_would_create")
        customers_by_code[code] = doc

    for row in ved:
        code = row["code"]
        if row.get("skip_sub") or PARTY_MAP.get(code, {}).get("skip_sub"):
            stats.add("sub_skipped")
            stats.note(f"skip sub {code}: {row.get('note') or 'stub'}")
            continue
        cust = customers_by_code.get(code)
        if not cust:
            stats.note(f"ved code {code} missing party map")
            continue
        pname = PLAN_PRODUCT.get(row["type"])
        product = products.get(pname)
        if not product:
            stats.note(f"product missing for {row['type']}: {pname}")
            continue
        cut_key = _cutover_id("sub", code, row["start"], row["type"])
        existing = await db.subscriptions.find_one({"cutover_key": cut_key}, {"_id": 0})
        if existing:
            stats.add("sub_existing")
            continue
        start_d = date.fromisoformat(row["start"])
        months = CYCLE_MONTHS.get("yearly" if row["type"] == "annual" else "monthly", 1)
        end = row.get("end")
        if end:
            next_renewal = end
        else:
            ny = start_d.year + (start_d.month + months - 1) // 12
            nm = (start_d.month + months - 1) % 12 + 1
            next_renewal = date(ny, nm, min(start_d.day, 28)).isoformat()
        sub = {
            "id": new_id(),
            "customer_id": cust["id"],
            "product_id": product["id"],
            "product_name": product["name"],
            "plan_name": product["name"],
            "billing_cycle": product.get("billing_cycle") or ("yearly" if row["type"] == "annual" else "monthly"),
            "price": product.get("price") or 0,
            "tax_rate": product.get("tax_rate") or 18,
            "status": "active",
            "start_date": row["start"],
            "end_date": end,
            "next_renewal_on": next_renewal,
            "seats": 1,
            "notes": f"Cutover from ved.xlsx; referred_by={row.get('referred_by')}",
            "cutover_key": cut_key,
            "created_at": iso_now(),
        }
        if commit:
            await db.subscriptions.insert_one(sub)
            stats.add("sub_created")
        else:
            stats.add("sub_would_create")

    return customers_by_code


async def phase_receipts(commit: bool, stats: Stats, entries: list, customers: dict, hdfc_id: str, company: dict):
    from core import db, new_id, iso_now, next_number
    from gst import compute_document, r2
    import bank_ledger as bl

    for item in entries:
        cls = item["classify"]
        if cls["kind"] != "customer_receipt":
            continue
        code = cls["party"]
        cust = customers.get(code)
        if not cust:
            stats.note(f"receipt no customer for {code}")
            continue
        amount = r2(item["credit"])
        cut_key = _cutover_id("rcp", code, item["txn_date"], amount, item["narration"][:60])
        existing_pay = await db.payments.find_one({"cutover_key": cut_key}, {"_id": 0})
        if existing_pay:
            stats.add("receipt_existing")
            if commit and item.get("entry_id"):
                await bl.link_entry(
                    item["entry_id"],
                    linked_kind="payment",
                    linked_id=existing_pay["id"],
                    linked_no=existing_pay.get("receipt_no"),
                    linked_path="/payments",
                )
            continue

        # Historical invoice: tax_rate 0 so grand_total == cash received (inclusive)
        lines = [{
            "description": f"Historical cutover receipt — {cust['legal_name']}",
            "product_id": None,
            "hsn_sac": "998314",
            "qty": 1,
            "unit": "Nos",
            "rate": amount,
            "discount": 0,
            "tax_rate": 0,
        }]
        computed = compute_document(lines, company["state_code"], cust.get("state_code") or "24")
        # Force grand_total to match bank cash (gst may round to rupee)
        if abs(computed["grand_total"] - amount) > 0.5:
            computed["grand_total"] = amount
            computed["round_off"] = 0
            computed["total_taxable"] = amount
            computed["sub_total"] = amount

        inv_date = date.fromisoformat(item["txn_date"])
        inv_id = new_id()
        pay_id = new_id()
        inv_no = None
        rcp_no = None
        if commit:
            inv_no = await next_number("INV", inv_date)
            rcp_no = await next_number("RCP", inv_date)

        inv = {
            "id": inv_id, "doc_type": "INV", "status": "paid",
            "invoice_no": inv_no, "invoice_date": item["txn_date"],
            "due_date": item["txn_date"],
            "customer_id": cust["id"],
            "customer_snapshot": {
                "legal_name": cust["legal_name"], "trade_name": cust.get("trade_name", ""),
                "gstin": cust.get("gstin", ""), "billing_address": cust.get("billing_address", ""),
                "state": cust.get("state", ""), "state_code": cust.get("state_code", "24"),
                "contact_email": cust.get("contact_email", ""),
            },
            "place_of_supply": {"state": cust.get("state", "Gujarat"), "code": cust.get("state_code", "24")},
            "pos_override_reason": "", "is_export_sez": False, "lut_flag": False, "reverse_charge": False,
            "subscription_id": None, "reference_invoice_id": None, "reference_invoice_no": None, "reason": "",
            "notes": "Cutover historical", "irn": None, "irn_qr": None, "tds_amount": 0,
            "created_by": "cutover", "created_at": iso_now(),
            "branding_snapshot": company, "approved_by": "cutover", "approved_at": iso_now(),
            "amount_paid": amount, "balance": 0.0,
            "sent_on": None, "send_status": None,
            "cutover_key": cut_key,
        }
        inv.update(computed)
        inv["grand_total"] = amount
        inv["amount_paid"] = amount
        inv["balance"] = 0.0
        inv["status"] = "paid"

        pay = {
            "id": pay_id, "receipt_no": rcp_no, "customer_id": cust["id"],
            "customer_name": cust["legal_name"], "payment_date": item["txn_date"],
            "amount": amount, "method": "neft",
            "reference_no": item.get("reference_no") or "",
            "bank_id": hdfc_id, "tds_amount": 0.0,
            "allocations": [{"invoice_id": inv_id, "amount": amount,
                             "invoice_no": inv_no, "invoice_date": item["txn_date"]}],
            "unallocated": 0.0,
            "notes": "Cutover historical — bank statement linked; skip_bank_post",
            "created_by": "cutover", "created_at": iso_now(),
            "cutover_key": cut_key, "skip_bank_post": True,
        }

        if commit:
            await db.invoices.insert_one(inv)
            await db.payments.insert_one(pay)
            if item.get("entry_id"):
                await bl.link_entry(
                    item["entry_id"],
                    linked_kind="payment",
                    linked_id=pay_id,
                    linked_no=rcp_no,
                    linked_path="/payments",
                )
            stats.add("receipt_created")
        else:
            stats.add("receipt_would_create")


async def phase_vouchers(commit: bool, stats: Stats, entries: list, hdfc_id: str):
    from core import db, new_id, iso_now, next_number
    from gst import r2
    import bank_ledger as bl

    # Salary + statutory + ops from bank
    for item in entries:
        cls = item["classify"]
        kind = cls["kind"]
        if kind not in ("salary", "statutory_gst", "tds_withdrawal", "ops_expense"):
            continue
        amount = r2(item["debit"])
        if amount <= 0:
            continue
        if kind == "salary":
            category = "Salaries (Monthly Summary)"
            vtype = "salary_summary"
            narration = f"Salary — {cls.get('party')}"
        elif kind == "statutory_gst":
            category = "Statutory Payments"
            vtype = "expense"
            narration = "GST payment (cutover)"
        elif kind == "tds_withdrawal":
            category = "Statutory Payments"
            vtype = "expense"
            narration = "TDS remittance — Solar Earth (cutover)"
        else:
            category = "Cloud & Hosting" if cls.get("label") == "Hostinger" else (
                "Office Supplies" if cls.get("label") == "Sejal Graphics" else "Software Licenses"
            )
            vtype = "expense"
            narration = f"{cls.get('label') or 'Ops'} (cutover bank)"

        cut_key = _cutover_id("ev-bank", kind, item["txn_date"], amount, item["narration"][:60])
        existing = await db.expense_vouchers.find_one({"cutover_key": cut_key}, {"_id": 0})
        if existing:
            stats.add("voucher_existing")
            if commit and item.get("entry_id"):
                await bl.link_entry(
                    item["entry_id"],
                    linked_kind="expense_voucher",
                    linked_id=existing["id"],
                    linked_no=existing.get("voucher_no"),
                    linked_path="/expenses",
                )
            continue

        vdate = date.fromisoformat(item["txn_date"])
        vid = new_id()
        vno = await next_number("EV", vdate) if commit else None
        doc = {
            "id": vid, "voucher_no": vno, "voucher_date": item["txn_date"],
            "category": category, "narration": narration,
            "amount": amount, "tax_rate": 0, "tax_amount": 0, "total": amount,
            "vendor_name": "", "paid_via": "HDFC Bank", "bank_id": hdfc_id,
            "type": vtype, "status": "posted", "attachments": [],
            "created_by": "cutover", "created_at": iso_now(),
            "approved_by": "cutover", "approved_at": iso_now(),
            "cutover_key": cut_key, "skip_bank_post": True,
            "notes": "Cutover historical — linked to bank import; skip_bank_post",
        }
        if commit:
            await db.expense_vouchers.insert_one(doc)
            if item.get("entry_id"):
                await bl.link_entry(
                    item["entry_id"],
                    linked_kind="expense_voucher",
                    linked_id=vid,
                    linked_no=vno,
                    linked_path="/expenses",
                )
            stats.add("voucher_created")
        else:
            stats.add("voucher_would_create")

    # Expense CSV — always skip_bank_post (preserve statement as cash truth)
    for row in load_expense_rows():
        cut_key = _cutover_id("ev-csv", row["txn_date"], row["amount"], row["narration"][:80], row["pay_by"])
        existing = await db.expense_vouchers.find_one({"cutover_key": cut_key}, {"_id": 0})
        if existing:
            stats.add("expense_csv_existing")
            continue
        amount = r2(row["amount"])
        vdate = date.fromisoformat(row["txn_date"])
        vid = new_id()
        vno = await next_number("EV", vdate) if commit else None
        # Try link to matching bank debit (Hostinger/Amazon)
        link_entry_id = None
        for item in entries:
            if item["debit"] <= 0:
                continue
            if abs(r2(item["debit"]) - amount) < 0.05 and item["txn_date"] == row["txn_date"]:
                link_entry_id = item.get("entry_id")
                break
            # Hostinger amount match only
            if abs(r2(item["debit"]) - amount) < 0.05 and "HOSTINGER" in _norm(item["narration"]):
                link_entry_id = item.get("entry_id")
                break

        doc = {
            "id": vid, "voucher_no": vno, "voucher_date": row["txn_date"],
            "category": row["category"], "narration": row["narration"],
            "amount": amount, "tax_rate": 0, "tax_amount": 0, "total": amount,
            "vendor_name": row["pay_by"], "paid_via": "HDFC Bank", "bank_id": hdfc_id,
            "type": "expense", "status": "posted", "attachments": [],
            "created_by": "cutover", "created_at": iso_now(),
            "approved_by": "cutover", "approved_at": iso_now(),
            "cutover_key": cut_key, "skip_bank_post": True,
            "notes": f"Cutover expense CSV; pay_by={row['pay_by']}",
        }
        if commit:
            await db.expense_vouchers.insert_one(doc)
            if link_entry_id:
                await bl.link_entry(
                    link_entry_id,
                    linked_kind="expense_voucher",
                    linked_id=vid,
                    linked_no=vno,
                    linked_path="/expenses",
                )
                stats.add("expense_csv_linked")
            stats.add("expense_csv_created")
        else:
            stats.add("expense_csv_would_create")


async def phase_tds(commit: bool, stats: Stats, customers: dict):
    from core import db, iso_now
    from gst import r2

    for row in load_tds_rows():
        code = row["party"]
        cust = customers.get(code) if code else None
        note = f"TDS ₹{row['tds_amount']:,.2f} on {row['txn_date']} ({row['company']})"
        if cust and commit:
            existing_notes = cust.get("notes") or ""
            if note not in existing_notes:
                await db.customers.update_one(
                    {"id": cust["id"]},
                    {"$set": {"notes": (existing_notes + "\n" + note).strip(), "updated_at": iso_now()}},
                )
                cust["notes"] = (existing_notes + "\n" + note).strip()
            stats.add("tds_customer_note")
        elif cust:
            stats.add("tds_customer_note_would")

        # Patch matching payment tds_amount (Solar Earth 3120 / Clean receipts)
        if not cust:
            stats.note(f"TDS no party for {row['company']}")
            continue
        pays = await db.payments.find(
            {"customer_id": cust["id"]}, {"_id": 0}
        ).sort("payment_date", 1).to_list(50)
        target = None
        # Prefer payment on/near TDS date, else first payment
        for p in pays:
            if p.get("payment_date") <= row["txn_date"]:
                target = p
        if not target and pays:
            target = pays[0]
        if not target:
            stats.note(f"TDS no payment for {code}")
            continue
        if commit:
            await db.payments.update_one(
                {"id": target["id"]},
                {"$set": {
                    "tds_amount": r2(row["tds_amount"]),
                    "notes": ((target.get("notes") or "") + f"\n{note}").strip(),
                }},
            )
            stats.add("tds_payment_patched")
        else:
            stats.add("tds_payment_would_patch")


async def run(*, commit: bool) -> None:
    for path in (BANK_CSV, EXPENSE_CSV, TDS_CSV, VED_XLSX):
        if not path.exists():
            raise SystemExit(f"Missing cutover file: {path}")

    from core import db, get_company
    import bank_ledger as bl

    hdfc = await db.bank_accounts.find_one(
        {"bank_name": "HDFC Bank", "primary": True}, {"_id": 0}
    )
    if not hdfc:
        hdfc = await bl.get_primary_bank()
    if not hdfc:
        raise SystemExit("No HDFC/primary bank — run prod_bootstrap first")

    company = await get_company()
    stats = Stats()
    mode = "COMMIT" if commit else "DRY-RUN"
    print(f"=== cutover_import {mode} ===")

    entries = await phase_bank(commit, stats, hdfc["id"])
    if stats.counts.get("bank_valid", 0) != EXPECTED_BANK_LINES:
        stats.note(f"WARNING expected {EXPECTED_BANK_LINES} bank lines, got {stats.counts.get('bank_valid')}")

    customers = await phase_parties(commit, stats)
    await phase_receipts(commit, stats, entries, customers, hdfc["id"], company)
    await phase_vouchers(commit, stats, entries, hdfc["id"])
    await phase_tds(commit, stats, customers)

    if commit:
        live = await bl.live_balance(hdfc["id"])
        print(f"HDFC live_balance={live} expected={EXPECTED_CLOSING}")
        if abs(live - EXPECTED_CLOSING) > 0.01:
            raise SystemExit(f"FAIL: live balance {live} != {EXPECTED_CLOSING}")

    print(stats.report())
    print("done")


def main() -> None:
    parser = argparse.ArgumentParser(description="TechHind Finance cutover import")
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--commit", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(commit=args.commit))


if __name__ == "__main__":
    main()
