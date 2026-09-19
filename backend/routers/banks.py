"""Bank accounts + statement ledger API."""
from __future__ import annotations

import csv
import io
import re
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field

from core import (
    ALL_ROLES,
    FINANCE_ROLES,
    WRITER_ROLES,
    ADMIN_ROLES,
    assert_period_open,
    audit,
    db,
    iso_now,
    new_id,
    require_roles,
    run_in_transaction,
)
from gst import r2
import bank_ledger as bl

router = APIRouter(prefix="/api", tags=["banks"])

STATEMENT_TEMPLATE = (
    "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal,Deposit,Closing\n"
    "01/04/2026,NEFT-CR-ACME-UTR123,,,50000,150000\n"
    "02/04/2026,NEFT-DR-VENDOR-UTR456,,12000,0,138000\n"
)


class BankAccountIn(BaseModel):
    account_type: str = "bank"  # bank | cash
    bank_name: str
    account_name: str = ""
    account_no: str = ""
    ifsc: str = ""
    branch: str = ""
    upi: str = ""
    opening_balance: float = 0
    opening_date: str = ""
    primary: bool = False
    is_active: bool = True


class BankAccountPatch(BaseModel):
    bank_name: Optional[str] = None
    account_name: Optional[str] = None
    account_no: Optional[str] = None
    ifsc: Optional[str] = None
    branch: Optional[str] = None
    upi: Optional[str] = None
    opening_balance: Optional[float] = None
    opening_date: Optional[str] = None
    primary: Optional[bool] = None
    is_active: Optional[bool] = None


class ManualEntryIn(BaseModel):
    txn_date: str
    narration: str
    reference_no: str = ""
    debit: float = 0
    credit: float = 0
    value_date: str = ""


class TransferIn(BaseModel):
    from_bank_id: str
    to_bank_id: str
    amount: float
    txn_date: str
    narration: str = ""
    reference_no: str = ""


class LinkEntryIn(BaseModel):
    linked_kind: str  # payment | invoice | expense_voucher | vendor_payment
    linked_id: str
    linked_no: str = ""
    linked_path: str = ""


def _label(acct: dict) -> str:
    if acct.get("account_type") == "cash":
        return "Cash"
    name = acct.get("bank_name") or "Bank"
    no = acct.get("account_no") or ""
    return f"{name} ···{no[-4:]}" if no else name


@router.get("/banks")
async def list_banks(active_only: bool = True, account_type: str = "", q: str = "",
                     user=Depends(require_roles(*ALL_ROLES))):
    from list_query import apply_q, apply_eq
    flt = {"is_active": {"$ne": False}} if active_only else {}
    apply_eq(flt, "account_type", account_type)
    apply_q(flt, q, ["bank_name", "account_name", "account_no", "ifsc"])
    rows = await db.bank_accounts.find(flt, {"_id": 0}).sort(
        [("account_type", 1), ("primary", -1), ("bank_name", 1)]
    ).to_list(200)
    out = []
    for a in rows:
        bal = await bl.live_balance(a["id"])
        out.append({**a, "live_balance": bal, "label": _label(a)})
    return out


@router.get("/banks/cash-position")
async def cash_position(user=Depends(require_roles(*ALL_ROLES))):
    return {"total": await bl.total_cash_position()}


@router.post("/banks")
async def create_bank(body: BankAccountIn, user=Depends(require_roles(*FINANCE_ROLES))):
    if body.account_type not in ("bank", "cash"):
        raise HTTPException(status_code=400, detail="account_type must be bank or cash")
    if body.account_type == "cash":
        existing = await db.bank_accounts.find_one({"account_type": "cash"}, {"_id": 0})
        if existing:
            raise HTTPException(status_code=400, detail="Cash account already exists")
    if body.opening_date:
        await assert_period_open(body.opening_date, user)
    doc = body.model_dump()
    doc.update({"id": new_id(), "created_by": user["id"], "created_at": iso_now()})
    if doc["primary"] and doc["account_type"] == "bank":
        await db.bank_accounts.update_many(
            {"account_type": "bank"}, {"$set": {"primary": False}}
        )
        await _sync_company_bank(doc)
    await db.bank_accounts.insert_one(doc)
    await audit(user, "bank_account_created", "bank_account", doc["id"],
                f"Bank account {_label(doc)} created")
    doc.pop("_id", None)
    doc["live_balance"] = await bl.live_balance(doc["id"])
    doc["label"] = _label(doc)
    return doc


@router.post("/banks/transfer")
async def transfer(body: TransferIn, user=Depends(require_roles(*FINANCE_ROLES))):
    if body.from_bank_id == body.to_bank_id:
        raise HTTPException(status_code=400, detail="Cannot transfer to the same account")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    await assert_period_open(body.txn_date, user)
    from_acct = await bl.get_account(body.from_bank_id)
    to_acct = await bl.get_account(body.to_bank_id)
    group = new_id()
    narr = body.narration or f"Transfer {_label(from_acct)} → {_label(to_acct)}"

    async def _do(session):
        out_leg = await bl.post_entry(
            bank_id=body.from_bank_id,
            txn_date=body.txn_date,
            debit=body.amount,
            narration=narr,
            reference_no=body.reference_no,
            source_type="transfer",
            source_id=f"{group}:out",
            linked_kind="transfer",
            linked_id=body.to_bank_id,
            linked_no=_label(to_acct),
            linked_path=f"/banks/{body.to_bank_id}",
            transfer_group_id=group,
            created_by=user["id"],
            session=session,
        )
        in_leg = await bl.post_entry(
            bank_id=body.to_bank_id,
            txn_date=body.txn_date,
            credit=body.amount,
            narration=narr,
            reference_no=body.reference_no,
            source_type="transfer",
            source_id=f"{group}:in",
            linked_kind="transfer",
            linked_id=body.from_bank_id,
            linked_no=_label(from_acct),
            linked_path=f"/banks/{body.from_bank_id}",
            transfer_group_id=group,
            created_by=user["id"],
            session=session,
        )
        return {"transfer_group_id": group, "out": out_leg, "in": in_leg}

    result = await run_in_transaction(_do)
    await audit(user, "bank_transfer", "bank_ledger", group,
                f"Transfer ₹{r2(body.amount):,.2f} {_label(from_acct)} → {_label(to_acct)}")
    return result


@router.get("/banks/import/template")
async def import_template(user=Depends(require_roles(*FINANCE_ROLES))):
    return PlainTextResponse(
        STATEMENT_TEMPLATE,
        headers={"Content-Disposition": 'attachment; filename="bank-statement-template.csv"'},
    )


@router.get("/banks/match-suggestions")
async def match_suggestions(reference_no: str = "", user=Depends(require_roles(*ALL_ROLES))):
    """Suggest CRM docs matching a UTR / cheque / ref for linking."""
    ref = (reference_no or "").strip()
    if not ref:
        return {"payments": [], "vendor_payments": [], "vouchers": []}
    rx = {"$regex": re.escape(ref), "$options": "i"}
    pays = await db.payments.find(
        {"reference_no": rx},
        {"_id": 0, "id": 1, "receipt_no": 1, "amount": 1, "payment_date": 1, "customer_name": 1, "reference_no": 1},
    ).to_list(20)
    vpays = await db.vendor_payments.find(
        {"reference_no": rx},
        {"_id": 0, "id": 1, "payment_ref": 1, "amount": 1, "payment_date": 1, "vendor_name": 1, "reference_no": 1},
    ).to_list(20)
    vouchers = await db.expense_vouchers.find(
        {"$or": [{"voucher_no": rx}, {"narration": rx}]},
        {"_id": 0, "id": 1, "voucher_no": 1, "total": 1, "voucher_date": 1, "narration": 1, "category": 1},
    ).to_list(20)
    return {"payments": pays, "vendor_payments": vpays, "vouchers": vouchers}


@router.post("/banks/ledger/{entry_id}/link")
async def link_entry(entry_id: str, body: LinkEntryIn, user=Depends(require_roles(*FINANCE_ROLES))):
    entry = await db.bank_ledger.find_one({"id": entry_id}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=404, detail="Ledger entry not found")
    path = body.linked_path
    if not path:
        path = {
            "payment": "/payments",
            "invoice": f"/invoices/{body.linked_id}",
            "expense_voucher": "/expenses",
            "vendor_payment": "/vendors",
        }.get(body.linked_kind, "")
    await db.bank_ledger.update_one(
        {"id": entry_id},
        {"$set": {
            "linked_kind": body.linked_kind,
            "linked_id": body.linked_id,
            "linked_no": body.linked_no,
            "linked_path": path,
            "updated_at": iso_now(),
        }},
    )
    await audit(user, "bank_ledger_linked", "bank_ledger", entry_id,
                f"Linked to {body.linked_kind} {body.linked_no or body.linked_id}")
    return await db.bank_ledger.find_one({"id": entry_id}, {"_id": 0})


@router.get("/banks/{bank_id}")
async def get_bank(bank_id: str, user=Depends(require_roles(*ALL_ROLES))):
    acct = await bl.get_account(bank_id, allow_inactive=True)
    acct["live_balance"] = await bl.live_balance(bank_id)
    acct["label"] = _label(acct)
    return acct


@router.patch("/banks/{bank_id}")
async def patch_bank(bank_id: str, body: BankAccountPatch, user=Depends(require_roles(*FINANCE_ROLES))):
    cur = await bl.get_account(bank_id, allow_inactive=True)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "opening_date" in updates and updates["opening_date"]:
        await assert_period_open(updates["opening_date"], user)
    if updates.get("primary") and cur.get("account_type") == "bank":
        await db.bank_accounts.update_many(
            {"account_type": "bank", "id": {"$ne": bank_id}}, {"$set": {"primary": False}}
        )
    if updates:
        updates["updated_at"] = iso_now()
        await db.bank_accounts.update_one({"id": bank_id}, {"$set": updates})
    acct = await bl.get_account(bank_id, allow_inactive=True)
    if acct.get("primary") and acct.get("account_type") == "bank":
        await _sync_company_bank(acct)
    await audit(user, "bank_account_updated", "bank_account", bank_id,
                f"Bank account {_label(acct)} updated")
    acct["live_balance"] = await bl.live_balance(bank_id)
    acct["label"] = _label(acct)
    return acct


async def _sync_company_bank(acct: dict):
    """Keep company.bank (invoice PDF) in sync with primary bank account."""
    bank = {
        "bank_name": acct.get("bank_name") or "",
        "account_name": acct.get("account_name") or "",
        "account_no": acct.get("account_no") or "",
        "ifsc": acct.get("ifsc") or "",
        "branch": acct.get("branch") or "",
        "upi": acct.get("upi") or "",
    }
    await db.company.update_one({"id": "company"}, {"$set": {"bank": bank}})


def _filter_statement_items(items, q="", min_amount=None, max_amount=None, side=""):
    ql = (q or "").strip().lower()
    out = items
    if ql:
        out = [r for r in out if ql in (r.get("narration") or "").lower()
               or ql in (str(r.get("reference_no") or "")).lower()]
    if side == "debit":
        out = [r for r in out if float(r.get("debit") or 0) > 0]
    elif side == "credit":
        out = [r for r in out if float(r.get("credit") or 0) > 0]
    if min_amount is not None:
        out = [r for r in out if max(float(r.get("debit") or 0), float(r.get("credit") or 0)) >= float(min_amount)]
    if max_amount is not None:
        out = [r for r in out if max(float(r.get("debit") or 0), float(r.get("credit") or 0)) <= float(max_amount)]
    return out


@router.get("/banks/{bank_id}/statement")
async def get_statement(
    bank_id: str,
    date_from: str = "",
    date_to: str = "",
    source_type: str = "",
    unlinked_only: bool = False,
    q: str = "",
    min_amount: float = None,
    max_amount: float = None,
    side: str = "",
    user=Depends(require_roles(*ALL_ROLES)),
):
    stmt = await bl.statement(
        bank_id,
        date_from=date_from,
        date_to=date_to,
        source_type=source_type,
        unlinked_only=unlinked_only,
    )
    items = _filter_statement_items(stmt.get("items") or [], q, min_amount, max_amount, side)
    stmt["items"] = items
    stmt["count"] = len(items)
    return stmt


@router.get("/banks/{bank_id}/statement.csv")
async def get_statement_csv(
    bank_id: str,
    date_from: str = "",
    date_to: str = "",
    source_type: str = "",
    unlinked_only: bool = False,
    q: str = "",
    min_amount: float = None,
    max_amount: float = None,
    side: str = "",
    user=Depends(require_roles(*ALL_ROLES)),
):
    stmt = await get_statement(
        bank_id, date_from=date_from, date_to=date_to, source_type=source_type,
        unlinked_only=unlinked_only, q=q, min_amount=min_amount, max_amount=max_amount,
        side=side, user=user,
    )
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Date", "Value Date", "Narration", "Reference", "Source", "Debit", "Credit", "Balance", "Linked"])
    for row in stmt.get("items") or []:
        w.writerow([
            row.get("txn_date", ""),
            row.get("value_date", ""),
            row.get("narration", ""),
            row.get("reference_no", ""),
            row.get("source_type", ""),
            f'{row.get("debit", 0):.2f}',
            f'{row.get("credit", 0):.2f}',
            f'{row.get("running_balance", row.get("balance", 0)):.2f}',
            row.get("linked_no") or row.get("linked_id") or "",
        ])
    acct = stmt.get("account") or {}
    name = (acct.get("bank_name") or bank_id).replace(" ", "-")
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="bank-{name}-statement.csv"'},
    )


@router.post("/banks/{bank_id}/manual")
async def manual_entry(bank_id: str, body: ManualEntryIn, user=Depends(require_roles(*FINANCE_ROLES))):
    await assert_period_open(body.txn_date, user)
    if body.debit <= 0 and body.credit <= 0:
        raise HTTPException(status_code=400, detail="Provide debit or credit")
    if body.debit > 0 and body.credit > 0:
        raise HTTPException(status_code=400, detail="Provide only one of debit or credit")

    async def _do(session):
        return await bl.post_entry(
            bank_id=bank_id,
            txn_date=body.txn_date,
            value_date=body.value_date or body.txn_date,
            debit=body.debit,
            credit=body.credit,
            narration=body.narration,
            reference_no=body.reference_no,
            source_type="manual",
            source_id=new_id(),
            created_by=user["id"],
            session=session,
        )

    doc = await run_in_transaction(_do)
    await audit(user, "bank_manual_entry", "bank_ledger", doc["id"],
                f"Manual {('withdrawal' if body.debit else 'deposit')} ₹{r2(body.debit or body.credit):,.2f}")
    return doc


def _normalize_header(h: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (h or "").lower())


HEADER_MAP = {
    "date": "date",
    "narration": "narration",
    "chqrefno": "ref",
    "chqref": "ref",
    "refno": "ref",
    "reference": "ref",
    "valuedt": "value_date",
    "valuedate": "value_date",
    "d": "value_date",
    "withdrawal": "withdrawal",
    "withdrawals": "withdrawal",
    "debit": "withdrawal",
    "deposit": "deposit",
    "deposits": "deposit",
    "credit": "deposit",
    "closing": "closing",
    "closingbalance": "closing",
    "balance": "closing",
}


def _map_row(raw: dict) -> dict:
    mapped = {}
    for k, v in raw.items():
        key = HEADER_MAP.get(_normalize_header(k))
        if key:
            mapped[key] = (v or "").strip()
    return mapped


def _is_skip_row(mapped: dict, withdrawal: float, deposit: float) -> bool:
    narr = (mapped.get("narration") or "").upper()
    if "OPENING BALANCE" in narr or narr in ("OPENING", "B/F", "BROUGHT FORWARD"):
        return True
    if withdrawal <= 0 and deposit <= 0:
        return True
    return False


async def _parse_statement_rows(data: bytes) -> list:
    text = data.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for idx, raw in enumerate(reader, 1):
        mapped = _map_row({(k or "").strip(): (v or "").strip() for k, v in raw.items() if k})
        if not any(mapped.values()):
            continue
        try:
            txn_date = bl.parse_bank_date(mapped.get("date") or "")
            value_date = bl.parse_bank_date(mapped["value_date"]) if mapped.get("value_date") else txn_date
            withdrawal = bl.parse_amount(mapped.get("withdrawal") or "")
            deposit = bl.parse_amount(mapped.get("deposit") or "")
            closing_raw = mapped.get("closing") or ""
            closing = bl.parse_amount(closing_raw) if closing_raw.strip() else None
        except Exception as e:
            rows.append({"row": idx, "ok": False, "error": str(e), "raw": mapped})
            continue
        if _is_skip_row(mapped, withdrawal, deposit):
            rows.append({"row": idx, "ok": True, "skipped": True, "summary": "Skipped (opening/empty)"})
            continue
        if withdrawal > 0 and deposit > 0:
            rows.append({"row": idx, "ok": False, "error": "Both withdrawal and deposit present", "raw": mapped})
            continue
        rows.append({
            "row": idx,
            "ok": True,
            "skipped": False,
            "txn_date": txn_date,
            "value_date": value_date,
            "narration": mapped.get("narration") or "",
            "reference_no": mapped.get("ref") or "",
            "debit": withdrawal,
            "credit": deposit,
            "bank_closing": closing,
            "summary": f"{txn_date} {(mapped.get('narration') or '')[:40]} "
                       f"{'W' if withdrawal else 'D'} {withdrawal or deposit}",
        })
    return rows


@router.post("/banks/{bank_id}/import/dry-run")
async def import_dry_run(
    bank_id: str,
    file: UploadFile = File(...),
    user=Depends(require_roles(*FINANCE_ROLES)),
):
    await bl.get_account(bank_id)
    data = await file.read()
    try:
        rows = await _parse_statement_rows(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSV parse failed: {e}")
    valid = sum(1 for r in rows if r.get("ok") and not r.get("skipped"))
    invalid = sum(1 for r in rows if not r.get("ok"))
    return {
        "bank_id": bank_id,
        "mode": "dry-run",
        "total": len(rows),
        "valid": valid,
        "invalid": invalid,
        "skipped": sum(1 for r in rows if r.get("skipped")),
        "rows": rows,
    }


@router.post("/banks/{bank_id}/import/commit")
async def import_commit(
    bank_id: str,
    file: UploadFile = File(...),
    user=Depends(require_roles(*FINANCE_ROLES)),
):
    await bl.get_account(bank_id)
    data = await file.read()
    try:
        rows = await _parse_statement_rows(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSV parse failed: {e}")

    committed = 0
    results = []
    for r in rows:
        if not r.get("ok"):
            results.append(r)
            continue
        if r.get("skipped"):
            results.append(r)
            continue
        try:
            await assert_period_open(r["txn_date"], user)
            entry = await bl.post_entry(
                bank_id=bank_id,
                txn_date=r["txn_date"],
                value_date=r["value_date"],
                debit=r["debit"],
                credit=r["credit"],
                narration=r["narration"],
                reference_no=r["reference_no"],
                bank_closing=r.get("bank_closing"),
                source_type="import",
                source_id=new_id(),
                created_by=user["id"],
            )
            committed += 1
            results.append({**r, "entry_id": entry["id"]})
        except Exception as e:
            results.append({"row": r["row"], "ok": False, "error": str(e)})

    if committed:
        await audit(user, "bank_statement_import", "bank_account", bank_id,
                    f"Imported {committed} statement lines")
    return {
        "bank_id": bank_id,
        "mode": "commit",
        "total": len(rows),
        "valid": committed,
        "invalid": sum(1 for r in results if not r.get("ok")),
        "rows": results,
    }
