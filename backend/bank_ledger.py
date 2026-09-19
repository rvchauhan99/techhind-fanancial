"""Bank ledger engine — statement-style postings with computed running balance."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from fastapi import HTTPException

from core import db, new_id, iso_now
from gst import r2

SOURCE_TYPES = (
    "payment",
    "vendor_payment",
    "expense_voucher",
    "transfer",
    "manual",
    "import",
    "opening",
)


async def get_account(bank_id: str, session=None, *, allow_inactive: bool = False) -> dict:
    opts = {"session": session} if session is not None else {}
    acct = await db.bank_accounts.find_one({"id": bank_id}, {"_id": 0}, **opts)
    if not acct:
        raise HTTPException(status_code=404, detail="Bank account not found")
    if not allow_inactive and acct.get("is_active") is False:
        raise HTTPException(status_code=400, detail="Bank account is inactive")
    return acct


async def get_primary_bank(session=None) -> Optional[dict]:
    opts = {"session": session} if session is not None else {}
    acct = await db.bank_accounts.find_one(
        {"account_type": "bank", "primary": True, "is_active": {"$ne": False}},
        {"_id": 0},
        **opts,
    )
    if acct:
        return acct
    return await db.bank_accounts.find_one(
        {"account_type": "bank", "is_active": {"$ne": False}},
        {"_id": 0},
        **opts,
    )


async def get_cash_account(session=None) -> dict:
    opts = {"session": session} if session is not None else {}
    acct = await db.bank_accounts.find_one(
        {"account_type": "cash", "is_active": {"$ne": False}},
        {"_id": 0},
        **opts,
    )
    if not acct:
        raise HTTPException(status_code=400, detail="Cash account not configured")
    return acct


async def resolve_bank_for_method(bank_id: str | None, method: str, session=None) -> dict:
    """Cash method always posts to Cash; otherwise use bank_id or primary bank."""
    if (method or "").lower() == "cash":
        return await get_cash_account(session=session)
    if bank_id:
        return await get_account(bank_id, session=session)
    primary = await get_primary_bank(session=session)
    if not primary:
        raise HTTPException(status_code=400, detail="No bank account configured — create one under Bank Ledger")
    return primary


async def live_balance(bank_id: str, as_of: str | None = None, session=None) -> float:
    """opening + sum(credit) - sum(debit) up to as_of (inclusive)."""
    opts = {"session": session} if session is not None else {}
    acct = await db.bank_accounts.find_one({"id": bank_id}, {"_id": 0}, **opts)
    if not acct:
        raise HTTPException(status_code=404, detail="Bank account not found")
    opening = float(acct.get("opening_balance") or 0)
    flt: dict = {"bank_id": bank_id}
    if as_of:
        flt["txn_date"] = {"$lte": as_of}
    pipe = [
        {"$match": flt},
        {"$group": {
            "_id": None,
            "credit": {"$sum": "$credit"},
            "debit": {"$sum": "$debit"},
        }},
    ]
    rows = await db.bank_ledger.aggregate(pipe, **opts).to_list(1)
    if not rows:
        return r2(opening)
    return r2(opening + float(rows[0].get("credit") or 0) - float(rows[0].get("debit") or 0))


async def total_cash_position(session=None) -> float:
    opts = {"session": session} if session is not None else {}
    accounts = await db.bank_accounts.find(
        {"is_active": {"$ne": False}}, {"_id": 0, "id": 1}, **opts
    ).to_list(200)
    total = 0.0
    for a in accounts:
        total += await live_balance(a["id"], session=session)
    return r2(total)


async def post_entry(
    *,
    bank_id: str,
    txn_date: str,
    debit: float = 0.0,
    credit: float = 0.0,
    narration: str = "",
    reference_no: str = "",
    source_type: str,
    source_id: str | None = None,
    value_date: str | None = None,
    bank_closing: float | None = None,
    linked_kind: str | None = None,
    linked_id: str | None = None,
    linked_no: str | None = None,
    linked_path: str | None = None,
    transfer_group_id: str | None = None,
    created_by: str = "",
    session=None,
) -> dict:
    if source_type not in SOURCE_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid source_type: {source_type}")
    debit = r2(max(float(debit or 0), 0))
    credit = r2(max(float(credit or 0), 0))
    if debit <= 0 and credit <= 0:
        raise HTTPException(status_code=400, detail="Entry requires debit or credit amount")
    if debit > 0 and credit > 0:
        raise HTTPException(status_code=400, detail="Entry cannot have both debit and credit")

    await get_account(bank_id, session=session)
    opts = {"session": session} if session is not None else {}

    if source_id:
        existing = await db.bank_ledger.find_one(
            {"source_type": source_type, "source_id": source_id},
            {"_id": 0},
            **opts,
        )
        if existing:
            return existing

    doc = {
        "id": new_id(),
        "bank_id": bank_id,
        "txn_date": txn_date,
        "value_date": value_date or txn_date,
        "narration": narration or "",
        "reference_no": reference_no or "",
        "debit": debit,
        "credit": credit,
        "bank_closing": bank_closing,
        "source_type": source_type,
        "source_id": source_id,
        "linked_kind": linked_kind,
        "linked_id": linked_id,
        "linked_no": linked_no,
        "linked_path": linked_path,
        "transfer_group_id": transfer_group_id,
        "created_by": created_by,
        "created_at": iso_now(),
    }
    await db.bank_ledger.insert_one(doc, **opts)
    doc.pop("_id", None)
    return doc


async def reverse_by_source(source_type: str, source_id: str, session=None) -> int:
    opts = {"session": session} if session is not None else {}
    res = await db.bank_ledger.delete_many(
        {"source_type": source_type, "source_id": source_id},
        **opts,
    )
    return res.deleted_count


async def statement(
    bank_id: str,
    date_from: str = "",
    date_to: str = "",
    source_type: str = "",
    unlinked_only: bool = False,
) -> dict:
    acct = await get_account(bank_id, allow_inactive=True)
    opening = float(acct.get("opening_balance") or 0)
    opening_date = acct.get("opening_date") or ""

    flt: dict = {"bank_id": bank_id}
    if date_from:
        flt.setdefault("txn_date", {})["$gte"] = date_from
    if date_to:
        flt.setdefault("txn_date", {})["$lte"] = date_to
    if source_type:
        flt["source_type"] = source_type
    if unlinked_only:
        flt["$or"] = [
            {"linked_id": None},
            {"linked_id": ""},
            {"linked_id": {"$exists": False}},
        ]
        # Imported / manual without a CRM link
        flt["source_type"] = {"$in": ["import", "manual"]}

    # Balance before date_from (or opening if no from)
    if date_from:
        opening_bal = await live_balance(bank_id, as_of=_day_before(date_from))
        # If opening_date is after or equal to date_from edge case: use sum before date_from
        before_flt = {"bank_id": bank_id, "txn_date": {"$lt": date_from}}
        pipe = [
            {"$match": before_flt},
            {"$group": {"_id": None, "c": {"$sum": "$credit"}, "d": {"$sum": "$debit"}}},
        ]
        rows = await db.bank_ledger.aggregate(pipe).to_list(1)
        opening_bal = r2(opening + (float(rows[0]["c"]) - float(rows[0]["d"]) if rows else 0))
    else:
        opening_bal = r2(opening)

    items = await db.bank_ledger.find(flt, {"_id": 0}).sort(
        [("txn_date", 1), ("created_at", 1)]
    ).to_list(10000)

    running = opening_bal
    enriched = []
    for row in items:
        running = r2(running + float(row.get("credit") or 0) - float(row.get("debit") or 0))
        bank_close = row.get("bank_closing")
        recon_diff = None
        if bank_close is not None:
            recon_diff = r2(running - float(bank_close))
        enriched.append({
            **row,
            "running_balance": running,
            "recon_diff": recon_diff,
            "recon_mismatch": recon_diff is not None and abs(recon_diff) > 0.01,
        })

    # Newest first for UI/export; balances were computed chronological ascending.
    enriched.reverse()

    live = await live_balance(bank_id)
    return {
        "account": acct,
        "opening_balance": opening_bal,
        "opening_date": opening_date,
        "live_balance": live,
        "items": enriched,
        "count": len(enriched),
    }


def _day_before(iso_date: str) -> str:
    try:
        d = date.fromisoformat(iso_date)
        return (d - timedelta(days=1)).isoformat()
    except ValueError:
        return iso_date


async def post_payment_receipt(pay: dict, session=None, *, skip_bank_post: bool = False) -> dict | None:
    """Deposit cash amount (not TDS) for a customer receipt."""
    if skip_bank_post or pay.get("skip_bank_post"):
        return None
    method = pay.get("method") or "upi"
    acct = await resolve_bank_for_method(pay.get("bank_id"), method, session=session)
    allocs = pay.get("allocations") or []
    inv_nos = ", ".join(a.get("invoice_no") or "" for a in allocs if a.get("invoice_no"))
    first_inv = allocs[0] if allocs else None
    linked_kind = "invoice" if first_inv else "payment"
    linked_id = (first_inv or {}).get("invoice_id") or pay.get("id")
    linked_no = (first_inv or {}).get("invoice_no") or pay.get("receipt_no")
    linked_path = f"/invoices/{linked_id}" if first_inv else "/payments"
    narration = f"Receipt {pay.get('receipt_no')} — {pay.get('customer_name') or ''}"
    if inv_nos:
        narration += f" ({inv_nos})"
    return await post_entry(
        bank_id=acct["id"],
        txn_date=pay["payment_date"],
        credit=r2(pay.get("amount") or 0),
        narration=narration.strip(),
        reference_no=pay.get("reference_no") or "",
        source_type="payment",
        source_id=pay["id"],
        linked_kind=linked_kind,
        linked_id=linked_id,
        linked_no=linked_no,
        linked_path=linked_path,
        created_by=pay.get("created_by") or "",
        session=session,
    )


async def post_vendor_payment(vp: dict, session=None, *, skip_bank_post: bool = False) -> dict | None:
    if skip_bank_post or vp.get("skip_bank_post"):
        return None
    method = vp.get("method") or "neft"
    acct = await resolve_bank_for_method(vp.get("bank_id"), method, session=session)
    allocs = vp.get("allocations") or []
    bill_nos = ", ".join(a.get("bill_no") or "" for a in allocs if a.get("bill_no"))
    first = allocs[0] if allocs else None
    narration = f"Vendor pay {vp.get('payment_ref')} — {vp.get('vendor_name') or ''}"
    if bill_nos:
        narration += f" ({bill_nos})"
    return await post_entry(
        bank_id=acct["id"],
        txn_date=vp["payment_date"],
        debit=r2(vp.get("amount") or 0),
        narration=narration.strip(),
        reference_no=vp.get("reference_no") or "",
        source_type="vendor_payment",
        source_id=vp["id"],
        linked_kind="vendor_payment",
        linked_id=vp["id"],
        linked_no=vp.get("payment_ref"),
        linked_path="/vendors",
        created_by=vp.get("created_by") or "",
        session=session,
    )


async def post_expense_voucher(voucher: dict, session=None, *, skip_bank_post: bool = False) -> dict | None:
    if skip_bank_post or voucher.get("skip_bank_post"):
        return None
    bank_id = voucher.get("bank_id")
    if not bank_id and voucher.get("paid_via"):
        # Resolve by bank_name for legacy paid_via string
        acct = await db.bank_accounts.find_one(
            {"bank_name": voucher["paid_via"], "is_active": {"$ne": False}},
            {"_id": 0},
            **({"session": session} if session else {}),
        )
        if acct:
            bank_id = acct["id"]
    acct = await resolve_bank_for_method(bank_id, "neft", session=session)
    return await post_entry(
        bank_id=acct["id"],
        txn_date=voucher["voucher_date"],
        debit=r2(voucher.get("total") or voucher.get("amount") or 0),
        narration=f"Expense {voucher.get('voucher_no') or ''} — {voucher.get('category')}: {voucher.get('narration') or ''}".strip(),
        reference_no=voucher.get("voucher_no") or "",
        source_type="expense_voucher",
        source_id=voucher["id"],
        linked_kind="expense_voucher",
        linked_id=voucher["id"],
        linked_no=voucher.get("voucher_no"),
        linked_path="/expenses",
        created_by=voucher.get("approved_by") or voucher.get("created_by") or "",
        session=session,
    )


async def link_entry(
    entry_id: str,
    *,
    linked_kind: str,
    linked_id: str,
    linked_no: str | None = None,
    linked_path: str | None = None,
    session=None,
) -> None:
    opts = {"session": session} if session is not None else {}
    await db.bank_ledger.update_one(
        {"id": entry_id},
        {"$set": {
            "linked_kind": linked_kind,
            "linked_id": linked_id,
            "linked_no": linked_no,
            "linked_path": linked_path,
        }},
        **opts,
    )


def parse_bank_date(raw: str) -> str:
    """Accept DD/MM/YYYY, DD/MM/YY, YYYY-MM-DD → ISO YYYY-MM-DD."""
    v = (raw or "").strip()
    if not v:
        raise ValueError("date is required")
    if len(v) == 10 and v[4] == "-" and v[7] == "-":
        date.fromisoformat(v)
        return v
    parts = v.replace("-", "/").split("/")
    if len(parts) != 3:
        raise ValueError(f"invalid date '{raw}'")
    d, m, y = parts
    yi = int(y)
    if yi < 100:
        yi += 2000
    return date(yi, int(m), int(d)).isoformat()


def parse_amount(raw: str) -> float:
    v = (raw or "").strip().replace(",", "").replace("₹", "").replace(" ", "")
    if not v or v == "-":
        return 0.0
    return r2(float(v))
