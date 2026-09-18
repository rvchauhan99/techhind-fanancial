import csv
import io
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import PlainTextResponse

from core import (db, require_roles, FINANCE_ROLES, audit, new_id, iso_now, next_number,
                  get_company, assert_period_open, CYCLE_MONTHS)
from gst import compute_document, r2

router = APIRouter(prefix="/api/import", tags=["import"])

ENTITIES = ["customers", "vendors", "products", "subscriptions", "expenses",
            "invoices", "payments", "opening_balances"]

TEMPLATES = {
    "customers": "legal_name,trade_name,gstin,state,state_code,billing_address,contact_name,contact_email,contact_phone,crm_tenant_key\nAcme Traders Pvt Ltd,Acme,24AACCA1234F1Z5,Gujarat,24,\"Ring Road, Surat\",Ravi Shah,ravi@acme.in,+91 98000 11111,CRM-ACM-001",
    "vendors": "name,gstin,state,state_code,address,contact_name,contact_email,contact_phone\nPrintZone,24AAACP5544K1Z2,Gujarat,24,\"Ashram Road, Ahmedabad\",Kunal,kunal@printzone.in,+91 97000 22222",
    "products": "name,type,hsn_sac,tax_rate,price,billing_cycle,unit,description\nSupport Retainer,service,998313,18,15000,monthly,Nos,Monthly support retainer",
    "subscriptions": "customer_name,plan_name,price,billing_cycle,start_on,next_renewal_on,status\nAcme Traders Pvt Ltd,TH Cloud — Growth,12999,monthly,2026-04-01,2026-10-01,active",
    "expenses": "voucher_date,category,narration,amount,tax_rate,vendor_name\n2026-08-15,Travel,Client visit Mumbai,12450,0,",
    "invoices": "customer_name,invoice_date,due_date,description,hsn_sac,qty,rate,discount,tax_rate,legacy_no\nAcme Traders Pvt Ltd,2026-08-05,2026-08-20,TH Cloud — Growth (Aug 2026),998314,1,12999,0,18,",
    "payments": "customer_name,payment_date,amount,method,reference_no,invoice_no,tds_amount\nAcme Traders Pvt Ltd,2026-08-10,13838.82,upi,UPI-12345,TH/2026-27/0010,0",
    "opening_balances": "customer_name,amount,as_on_date\nAcme Traders Pvt Ltd,25000,2026-04-01",
}


@router.get("/templates/{entity}")
async def template(entity: str, user=Depends(require_roles(*FINANCE_ROLES))):
    if entity not in TEMPLATES:
        raise HTTPException(status_code=404, detail="Unknown entity")
    return PlainTextResponse(TEMPLATES[entity],
                             headers={"Content-Disposition": f'attachment; filename="{entity}-template.csv"'})


def _parse(data: bytes):
    text = data.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for r in reader:
        row = {k.strip(): (v or "").strip() for k, v in r.items() if k}
        if any(row.values()):
            rows.append(row)
    return rows


def _f(row, key, default=0.0):
    try:
        return float(row.get(key) or default)
    except ValueError:
        raise ValueError(f"'{key}' must be a number, got '{row.get(key)}'")


def _d(row, key):
    v = row.get(key, "")
    try:
        return date.fromisoformat(v).isoformat()
    except ValueError:
        raise ValueError(f"'{key}' must be YYYY-MM-DD, got '{v}'")


async def _customer(name):
    return await db.customers.find_one(
        {"legal_name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}, {"_id": 0})


async def _validate(entity: str, row: dict):
    if entity == "customers":
        if not row.get("legal_name"):
            raise ValueError("legal_name is required")
        if not row.get("state_code"):
            raise ValueError("state_code is required")
        return {"legal_name": row["legal_name"], "trade_name": row.get("trade_name", ""),
                "gstin": row.get("gstin", "").upper(), "pan": row.get("gstin", "")[2:12],
                "state": row.get("state", ""), "state_code": row["state_code"],
                "billing_address": row.get("billing_address", ""),
                "shipping_address": row.get("billing_address", ""),
                "contacts": [{"name": row.get("contact_name", ""), "email": row.get("contact_email", ""),
                              "phone": row.get("contact_phone", "")}],
                "crm_tenant_key": row.get("crm_tenant_key", ""), "notes": ""}
    if entity == "vendors":
        if not row.get("name"):
            raise ValueError("name is required")
        return {"name": row["name"], "gstin": row.get("gstin", "").upper(),
                "pan": row.get("gstin", "")[2:12], "state": row.get("state", ""),
                "state_code": row.get("state_code", ""), "address": row.get("address", ""),
                "contact_name": row.get("contact_name", ""), "contact_email": row.get("contact_email", ""),
                "contact_phone": row.get("contact_phone", "")}
    if entity == "products":
        if not row.get("name"):
            raise ValueError("name is required")
        return {"name": row["name"], "type": row.get("type", "service"),
                "hsn_sac": row.get("hsn_sac", "998314"), "tax_rate": _f(row, "tax_rate", 18),
                "price": _f(row, "price"), "billing_cycle": row.get("billing_cycle", "one_time"),
                "unit": row.get("unit", "Nos"), "description": row.get("description", ""), "active": True}
    if entity == "subscriptions":
        cust = await _customer(row.get("customer_name", ""))
        if not cust:
            raise ValueError(f"customer '{row.get('customer_name')}' not found (import customers first)")
        if not row.get("plan_name"):
            raise ValueError("plan_name is required")
        cycle = row.get("billing_cycle", "monthly")
        if cycle not in CYCLE_MONTHS or cycle == "one_time":
            raise ValueError(f"invalid billing_cycle '{cycle}'")
        price = _f(row, "price")
        return {"customer_id": cust["id"], "plan_name": row["plan_name"], "price": price,
                "billing_cycle": cycle, "mrr": r2(price / (CYCLE_MONTHS[cycle] or 1)),
                "start_on": _d(row, "start_on"), "next_renewal_on": _d(row, "next_renewal_on"),
                "status": row.get("status", "active"), "auto_renew": True, "notes": "Imported"}
    if entity == "expenses":
        if not row.get("category") or not row.get("narration"):
            raise ValueError("category and narration are required")
        amount = _f(row, "amount")
        tax = _f(row, "tax_rate", 0)
        tax_amt = r2(amount * tax / 100)
        return {"voucher_date": _d(row, "voucher_date"), "category": row["category"],
                "narration": row["narration"], "amount": amount, "tax_rate": tax,
                "tax_amount": tax_amt, "total": r2(amount + tax_amt),
                "vendor_name": row.get("vendor_name", ""), "paid_via": row.get("paid_via", ""),
                "type": "expense", "status": "posted", "attachments": []}
    if entity in ("invoices", "opening_balances"):
        cust = await _customer(row.get("customer_name", ""))
        if not cust:
            raise ValueError(f"customer '{row.get('customer_name')}' not found (import customers first)")
        if entity == "opening_balances":
            amount = _f(row, "amount")
            if amount <= 0:
                raise ValueError("amount must be positive")
            return {"_customer": cust, "amount": amount, "as_on": _d(row, "as_on_date")}
        line = {"description": row.get("description") or "Imported sale",
                "hsn_sac": row.get("hsn_sac", "998314"), "qty": _f(row, "qty", 1),
                "unit": "Nos", "rate": _f(row, "rate"), "discount": _f(row, "discount", 0),
                "tax_rate": _f(row, "tax_rate", 18)}
        return {"_customer": cust, "invoice_date": _d(row, "invoice_date"),
                "due_date": _d(row, "due_date") if row.get("due_date") else None,
                "line": line, "legacy_no": row.get("legacy_no", "")}
    if entity == "payments":
        cust = await _customer(row.get("customer_name", ""))
        if not cust:
            raise ValueError(f"customer '{row.get('customer_name')}' not found")
        amount = _f(row, "amount")
        if amount <= 0:
            raise ValueError("amount must be positive")
        inv = None
        if row.get("invoice_no"):
            inv = await db.invoices.find_one({"invoice_no": row["invoice_no"]}, {"_id": 0})
            if not inv:
                raise ValueError(f"invoice '{row['invoice_no']}' not found")
        return {"_customer": cust, "_invoice": inv, "payment_date": _d(row, "payment_date"),
                "amount": amount, "method": row.get("method", "neft"),
                "reference_no": row.get("reference_no", ""), "tds_amount": _f(row, "tds_amount", 0)}
    raise ValueError("unknown entity")


async def _commit(entity: str, doc: dict, user: dict):
    if entity == "customers":
        doc.update({"id": new_id(), "created_at": iso_now(), "created_by": user["id"]})
        await db.customers.insert_one(doc)
    elif entity == "vendors":
        doc.update({"id": new_id(), "created_at": iso_now()})
        await db.vendors.insert_one(doc)
    elif entity == "products":
        doc.update({"id": new_id(), "created_at": iso_now()})
        await db.products.insert_one(doc)
    elif entity == "subscriptions":
        doc.update({"id": new_id(), "created_at": iso_now(), "created_by": user["id"]})
        await db.subscriptions.insert_one(doc)
    elif entity == "expenses":
        number = await next_number("EV", date.fromisoformat(doc["voucher_date"]))
        doc.update({"id": new_id(), "voucher_no": number, "approved_by": user["id"],
                    "approved_at": iso_now(), "created_by": user["id"], "created_at": iso_now()})
        await db.expense_vouchers.insert_one(doc)
    elif entity in ("invoices", "opening_balances"):
        company = await get_company()
        cust = doc.pop("_customer")
        if entity == "opening_balances":
            inv_date = doc["as_on"]
            line = {"description": "Opening balance brought forward", "hsn_sac": "", "qty": 1,
                    "unit": "Nos", "rate": doc["amount"], "discount": 0, "tax_rate": 0}
            due = inv_date
            legacy = ""
        else:
            inv_date = doc["invoice_date"]
            line = doc["line"]
            due = doc["due_date"]
            legacy = doc["legacy_no"]
        await assert_period_open(inv_date, user)
        computed = compute_document([line], company["state_code"], cust["state_code"])
        inv_date_obj = date.fromisoformat(inv_date)
        number = legacy or await next_number("INV", inv_date_obj)
        inv = {"id": new_id(), "doc_type": "INV", "status": "approved", "invoice_no": number,
               "invoice_date": inv_date, "due_date": due, "customer_id": cust["id"],
               "customer_snapshot": {"legal_name": cust.get("legal_name"), "trade_name": cust.get("trade_name", ""),
                                     "gstin": cust.get("gstin", ""), "billing_address": cust.get("billing_address", ""),
                                     "state": cust.get("state"), "state_code": cust.get("state_code"),
                                     "contact_email": (cust.get("contacts") or [{}])[0].get("email", "")},
               "place_of_supply": {"state": cust.get("state"), "code": cust.get("state_code")},
               "pos_override_reason": "", "is_export_sez": False, "lut_flag": False,
               "reverse_charge": False, "subscription_id": None, "reference_invoice_id": None,
               "reference_invoice_no": None, "reason": "", "notes": "Imported via CSV",
               "irn": None, "irn_qr": None, "tds_amount": 0,
               "branding_snapshot": company, "approved_by": user["id"], "approved_at": iso_now(),
               "amount_paid": 0.0, "balance": computed["grand_total"], "applied_notes": [],
               "sent_on": None, "send_status": None, "created_by": user["id"], "created_at": iso_now()}
        inv.update(computed)
        await db.invoices.insert_one(inv)
    elif entity == "payments":
        cust = doc.pop("_customer")
        inv = doc.pop("_invoice")
        from routers.billing import _apply_payment_to_invoice
        from core import run_in_transaction

        await assert_period_open(doc["payment_date"], user)

        async def _do(session):
            opts = {"session": session} if session is not None else {}
            alloc_amount = 0.0
            alloc_docs = []
            if inv:
                alloc_amount = min(doc["amount"] + doc["tds_amount"], inv.get("balance", 0))
                applied = await _apply_payment_to_invoice(inv["id"], r2(alloc_amount), session=session)
                alloc_docs = [{"invoice_id": inv["id"], "amount": r2(alloc_amount),
                               "invoice_no": applied.get("invoice_no"),
                               "invoice_date": applied.get("invoice_date")}]
            receipt_no = await next_number("RCP", date.fromisoformat(doc["payment_date"]), session=session)
            pay = {"id": new_id(), "receipt_no": receipt_no, "customer_id": cust["id"],
                   "customer_name": cust.get("legal_name"), "payment_date": doc["payment_date"],
                   "amount": doc["amount"], "tds_amount": doc["tds_amount"], "method": doc["method"],
                   "reference_no": doc["reference_no"], "allocations": alloc_docs,
                   "unallocated": r2(doc["amount"] + doc["tds_amount"] - alloc_amount),
                   "notes": "Imported via CSV", "created_by": user["id"], "created_at": iso_now()}
            await db.payments.insert_one(pay, **opts)
            return pay

        await run_in_transaction(_do)


async def _run(file: UploadFile, entity: str, commit: bool, user: dict):
    if entity not in ENTITIES:
        raise HTTPException(status_code=404, detail=f"Unknown entity. Allowed: {ENTITIES}")
    data = await file.read()
    try:
        rows = _parse(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSV parse failed: {e}")
    if not rows:
        raise HTTPException(status_code=400, detail="CSV has no data rows")
    results = []
    valid = 0
    for idx, row in enumerate(rows, 1):
        try:
            doc = await _validate(entity, row)
            results.append({"row": idx, "ok": True, "summary": _summarize(entity, row)})
            if commit:
                await _commit(entity, doc, user)
            valid += 1
        except Exception as e:
            results.append({"row": idx, "ok": False, "error": str(e)})
    if commit and valid:
        await audit(user, "csv_import", "import", entity,
                    f"CSV import ({entity}): {valid}/{len(rows)} rows committed")
    return {"entity": entity, "mode": "commit" if commit else "dry-run",
            "total": len(rows), "valid": valid, "invalid": len(rows) - valid, "rows": results}


def _summarize(entity, row):
    keys = {"customers": "legal_name", "vendors": "name", "products": "name",
            "subscriptions": "plan_name", "expenses": "narration", "invoices": "description",
            "payments": "reference_no", "opening_balances": "customer_name"}
    return row.get(keys.get(entity, ""), "")[:60]


@router.post("/{entity}/dry-run")
async def dry_run(entity: str, file: UploadFile = File(...), user=Depends(require_roles(*FINANCE_ROLES))):
    return await _run(file, entity, commit=False, user=user)


@router.post("/{entity}/commit")
async def commit(entity: str, file: UploadFile = File(...), user=Depends(require_roles(*FINANCE_ROLES))):
    return await _run(file, entity, commit=True, user=user)
