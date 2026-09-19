from datetime import date
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from core import (db, require_roles, ALL_ROLES, WRITER_ROLES, FINANCE_ROLES, audit, new_id,
                  iso_now, next_number, get_company, assert_period_open)
from gst import compute_document, r2
from fastapi.responses import Response
import storage
import pdf as pdfmod

router = APIRouter(prefix="/api", tags=["payables"])

OPEN_BILL_STATUSES = ("posted", "partially_paid")


class BillLineIn(BaseModel):
    description: str
    hsn_sac: str = ""
    qty: float = 1
    rate: float = 0
    tax_rate: float = 18


class BillIn(BaseModel):
    vendor_id: str
    bill_no: str
    bill_date: str
    due_date: Optional[str] = None
    lines: List[BillLineIn]
    itc_eligible: bool = True
    notes: str = ""


async def _build_bill_doc(body: BillIn, company: dict) -> dict:
    vendor = await db.vendors.find_one({"id": body.vendor_id}, {"_id": 0})
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    computed = compute_document([l.model_dump() for l in body.lines], company["state_code"],
                                vendor.get("state_code", company["state_code"]))
    doc = {"vendor_id": vendor["id"],
           "vendor_snapshot": {"name": vendor.get("name"), "gstin": vendor.get("gstin"),
                               "state": vendor.get("state"), "state_code": vendor.get("state_code")},
           "bill_no": body.bill_no, "bill_date": body.bill_date, "due_date": body.due_date,
           "itc_eligible": body.itc_eligible, "notes": body.notes}
    doc.update(computed)
    return doc


@router.get("/bills")
async def list_bills(status: str = "", vendor_id: str = "", page: int = 0, limit: int = 100,
                     q: str = "", date_from: str = "", date_to: str = "",
                     min_total: float = None, max_total: float = None, itc: str = "",
                     user=Depends(require_roles(*ALL_ROLES))):
    from list_query import apply_q, apply_date_range, apply_amount_range, apply_eq
    flt = {}
    apply_eq(flt, "status", status)
    apply_eq(flt, "vendor_id", vendor_id)
    apply_date_range(flt, "bill_date", date_from, date_to)
    apply_amount_range(flt, "grand_total", min_total, max_total)
    if (itc or "").lower() in ("1", "true", "yes", "eligible"):
        flt["itc_eligible"] = True
    elif (itc or "").lower() in ("0", "false", "no", "blocked"):
        flt["itc_eligible"] = False
    apply_q(flt, q, ["bill_no", "vendor_snapshot.name"])
    limit = max(1, min(limit, 500))
    cur = db.purchase_bills.find(flt, {"_id": 0}).sort("bill_date", -1)
    if page <= 0:
        return await cur.to_list(1000)
    skip = (page - 1) * limit
    total = await db.purchase_bills.count_documents(flt)
    items = await cur.skip(skip).to_list(limit)
    return {"items": items, "page": page, "limit": limit, "total": total}


@router.post("/bills")
async def create_bill(body: BillIn, user=Depends(require_roles(*WRITER_ROLES))):
    company = await get_company()
    await assert_period_open(body.bill_date, user)
    doc = await _build_bill_doc(body, company)
    doc.update({"id": new_id(), "status": "draft", "amount_paid": 0.0, "balance": doc["grand_total"],
                "created_by": user["id"], "created_at": iso_now()})
    await db.purchase_bills.insert_one(doc)
    await audit(user, "bill_created", "purchase_bill", doc["id"],
                f"Purchase bill {body.bill_no} from {doc['vendor_snapshot']['name']} — ₹{doc['grand_total']:,.2f}")
    doc.pop("_id", None)
    return doc


@router.patch("/bills/{bid}")
async def update_bill(bid: str, body: BillIn, user=Depends(require_roles(*WRITER_ROLES))):
    cur = await db.purchase_bills.find_one({"id": bid}, {"_id": 0})
    if not cur:
        raise HTTPException(status_code=404, detail="Bill not found")
    if cur["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only draft bills can be edited")
    await assert_period_open(cur["bill_date"], user)
    await assert_period_open(body.bill_date, user)
    company = await get_company()
    doc = await _build_bill_doc(body, company)
    doc["balance"] = doc["grand_total"]
    await db.purchase_bills.update_one({"id": bid}, {"$set": doc})
    await audit(user, "bill_updated", "purchase_bill", bid, "Draft bill edited",
                diff={"bill_date": body.bill_date, "grand_total": doc.get("grand_total")})
    return await db.purchase_bills.find_one({"id": bid}, {"_id": 0})


@router.delete("/bills/{bid}")
async def delete_bill(bid: str, user=Depends(require_roles(*WRITER_ROLES))):
    cur = await db.purchase_bills.find_one({"id": bid}, {"_id": 0})
    if not cur:
        raise HTTPException(status_code=404, detail="Bill not found")
    if cur["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only draft bills can be deleted")
    await db.purchase_bills.delete_one({"id": bid})
    await audit(user, "bill_deleted", "purchase_bill", bid, "Draft bill deleted")
    return {"ok": True}


@router.post("/bills/{bid}/post")
async def post_bill(bid: str, user=Depends(require_roles(*FINANCE_ROLES))):
    cur = await db.purchase_bills.find_one({"id": bid}, {"_id": 0})
    if not cur:
        raise HTTPException(status_code=404, detail="Bill not found")
    if cur["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only drafts can be posted")
    await assert_period_open(cur["bill_date"], user)
    await db.purchase_bills.update_one({"id": bid}, {"$set": {"status": "posted",
                                                              "posted_by": user["id"], "posted_at": iso_now()}})
    await audit(user, "bill_posted", "purchase_bill", bid,
                f"Bill {cur['bill_no']} posted (ITC {'eligible' if cur.get('itc_eligible') else 'blocked'})")
    return await db.purchase_bills.find_one({"id": bid}, {"_id": 0})


@router.get("/bills/{bid}/pdf")
async def bill_pdf(bid: str, user=Depends(require_roles(*ALL_ROLES))):
    doc = await db.purchase_bills.find_one({"id": bid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Bill not found")
    company = await get_company()
    html = pdfmod.render_bill_html(doc, company)
    data = await pdfmod.build_pdf(html)
    fname = f"bill-{(doc.get('bill_no') or bid).replace('/', '-')}.pdf"
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{fname}"'})


class VAllocIn(BaseModel):
    bill_id: str
    amount: float


class VPaymentIn(BaseModel):
    vendor_id: str
    payment_date: str
    amount: float
    method: str = "neft"
    reference_no: str = ""
    bank_id: str = ""
    allocations: List[VAllocIn] = []
    notes: str = ""


@router.get("/vendor-payments")
async def list_vendor_payments(user=Depends(require_roles(*ALL_ROLES)),
                               q: str = "", date_from: str = "", date_to: str = "",
                               vendor_id: str = "", method: str = "",
                               min_amount: float = None, max_amount: float = None):
    from list_query import apply_q, apply_date_range, apply_amount_range, apply_eq
    flt = {}
    apply_eq(flt, "vendor_id", vendor_id)
    apply_eq(flt, "method", method)
    apply_date_range(flt, "payment_date", date_from, date_to)
    apply_amount_range(flt, "amount", min_amount, max_amount)
    apply_q(flt, q, ["payment_ref", "vendor_name", "reference_no"])
    return await db.vendor_payments.find(flt, {"_id": 0}).sort("payment_date", -1).to_list(1000)


@router.get("/vendor-payments/{pid}/pdf")
async def vendor_payment_pdf(pid: str, user=Depends(require_roles(*ALL_ROLES))):
    doc = await db.vendor_payments.find_one({"id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Vendor payment not found")
    company = await get_company()
    html = pdfmod.render_vendor_payment_html(doc, company)
    data = await pdfmod.build_pdf(html)
    fname = f"vpay-{(doc.get('payment_ref') or pid).replace('/', '-')}.pdf"
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{fname}"'})


@router.post("/vendor-payments")
async def create_vendor_payment(body: VPaymentIn, user=Depends(require_roles(*FINANCE_ROLES))):
    vendor = await db.vendors.find_one({"id": body.vendor_id}, {"_id": 0})
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    await assert_period_open(body.payment_date, user)
    total_alloc = r2(sum(a.amount for a in body.allocations))
    if total_alloc > body.amount + 0.005:
        raise HTTPException(status_code=400, detail="Allocations exceed payment amount")
    ref = await next_number("VP", date.fromisoformat(body.payment_date))

    async def _do(session):
        opts = {"session": session} if session else {}
        alloc_docs = []
        for a in body.allocations:
            bill = await db.purchase_bills.find_one({"id": a.bill_id}, {"_id": 0}, **opts)
            if not bill:
                raise HTTPException(status_code=404, detail="Bill not found")
            if bill["status"] not in OPEN_BILL_STATUSES:
                raise HTTPException(status_code=400, detail=f"Bill {bill['bill_no']} is not open")
            if a.amount > bill.get("balance", 0) + 0.005:
                raise HTTPException(status_code=400, detail=f"Allocation exceeds balance on {bill['bill_no']}")
            new_paid = r2(bill.get("amount_paid", 0) + a.amount)
            new_balance = r2(bill["grand_total"] - new_paid)
            await db.purchase_bills.update_one(
                {"id": bill["id"]},
                {"$set": {
                    "amount_paid": new_paid,
                    "balance": max(new_balance, 0.0),
                    "status": "paid" if new_balance <= 0.005 else "partially_paid",
                }},
                **opts,
            )
            alloc_docs.append({"bill_id": a.bill_id, "amount": r2(a.amount), "bill_no": bill["bill_no"]})
        doc = {
            "id": new_id(), "payment_ref": ref, "vendor_id": body.vendor_id,
            "vendor_name": vendor.get("name"), "payment_date": body.payment_date,
            "amount": r2(body.amount), "method": body.method, "reference_no": body.reference_no,
            "bank_id": body.bank_id or "",
            "allocations": alloc_docs, "unallocated": r2(body.amount - total_alloc),
            "notes": body.notes, "created_by": user["id"], "created_at": iso_now(),
        }
        await db.vendor_payments.insert_one(doc, **opts)
        import bank_ledger as bl
        await bl.post_vendor_payment(doc, session=session)
        return doc

    from core import run_in_transaction
    doc = await run_in_transaction(_do)
    await audit(user, "vendor_payment_recorded", "vendor_payment", doc["id"],
                f"Vendor payment {ref} — ₹{doc['amount']:,.2f} to {vendor.get('name')}")
    doc.pop("_id", None)
    return doc


# ---------- Expense vouchers ----------
class VoucherIn(BaseModel):
    voucher_date: str
    category: str
    narration: str
    amount: float
    tax_rate: float = 0
    vendor_name: str = ""
    paid_via: str = ""
    bank_id: str = ""
    type: str = "expense"  # expense | salary_summary


@router.get("/vouchers")
async def list_vouchers(status: str = "", q: str = "", date_from: str = "", date_to: str = "",
                        category: str = "", type: str = "", bank_id: str = "",
                        min_total: float = None, max_total: float = None,
                        user=Depends(require_roles(*ALL_ROLES))):
    from list_query import apply_q, apply_date_range, apply_amount_range, apply_eq
    flt = {}
    apply_eq(flt, "status", status)
    apply_eq(flt, "category", category)
    apply_eq(flt, "type", type)
    apply_eq(flt, "bank_id", bank_id)
    apply_date_range(flt, "voucher_date", date_from, date_to)
    apply_amount_range(flt, "total", min_total, max_total)
    apply_q(flt, q, ["voucher_no", "narration", "vendor_name", "paid_via"])
    return await db.expense_vouchers.find(flt, {"_id": 0}).sort("voucher_date", -1).to_list(1000)


@router.get("/vouchers/{vid}/pdf")
async def voucher_pdf(vid: str, user=Depends(require_roles(*ALL_ROLES))):
    doc = await db.expense_vouchers.find_one({"id": vid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Voucher not found")
    company = await get_company()
    html = pdfmod.render_voucher_html(doc, company)
    data = await pdfmod.build_pdf(html)
    fname = f"voucher-{(doc.get('voucher_no') or vid).replace('/', '-')}.pdf"
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{fname}"'})


@router.post("/vouchers")
async def create_voucher(body: VoucherIn, user=Depends(require_roles(*WRITER_ROLES))):
    await assert_period_open(body.voucher_date, user)
    tax = r2(body.amount * body.tax_rate / 100)
    doc = body.model_dump()
    # Keep paid_via label in sync for display
    if body.bank_id and not body.paid_via:
        acct = await db.bank_accounts.find_one({"id": body.bank_id}, {"_id": 0, "bank_name": 1})
        if acct:
            doc["paid_via"] = acct.get("bank_name") or ""
    doc.update({"id": new_id(), "voucher_no": None, "tax_amount": tax,
                "total": r2(body.amount + tax), "status": "draft", "attachments": [],
                "created_by": user["id"], "created_at": iso_now()})
    await db.expense_vouchers.insert_one(doc)
    await audit(user, "voucher_created", "expense_voucher", doc["id"],
                f"Expense voucher ({body.category}) ₹{doc['total']:,.2f} created")
    doc.pop("_id", None)
    return doc


@router.post("/vouchers/{vid}/submit")
async def submit_voucher(vid: str, user=Depends(require_roles(*WRITER_ROLES))):
    res = await db.expense_vouchers.update_one({"id": vid, "status": {"$in": ["draft", "rejected"]}},
                                               {"$set": {"status": "pending_approval"}})
    if not res.matched_count:
        raise HTTPException(status_code=400, detail="Voucher not in a submittable state")
    await audit(user, "voucher_submitted", "expense_voucher", vid, "Voucher submitted for approval")
    return await db.expense_vouchers.find_one({"id": vid}, {"_id": 0})


@router.post("/vouchers/{vid}/approve")
async def approve_voucher(vid: str, user=Depends(require_roles(*FINANCE_ROLES))):
    cur = await db.expense_vouchers.find_one({"id": vid}, {"_id": 0})
    if not cur:
        raise HTTPException(status_code=404, detail="Voucher not found")
    if cur["status"] != "pending_approval":
        raise HTTPException(status_code=400, detail="Only pending vouchers can be approved")
    await assert_period_open(cur["voucher_date"], user)
    number = await next_number("EV", date.fromisoformat(cur["voucher_date"]))

    async def _do(session):
        opts = {"session": session} if session else {}
        await db.expense_vouchers.update_one(
            {"id": vid},
            {"$set": {"status": "posted", "voucher_no": number,
                      "approved_by": user["id"], "approved_at": iso_now()}},
            **opts,
        )
        posted = {**cur, "status": "posted", "voucher_no": number,
                  "approved_by": user["id"], "approved_at": iso_now()}
        import bank_ledger as bl
        await bl.post_expense_voucher(posted, session=session)
        return posted

    from core import run_in_transaction
    await run_in_transaction(_do)
    await audit(user, "voucher_approved", "expense_voucher", vid,
                f"Voucher {number} approved & posted — ₹{cur['total']:,.2f} ({cur['category']})")
    return await db.expense_vouchers.find_one({"id": vid}, {"_id": 0})


@router.post("/vouchers/{vid}/reject")
async def reject_voucher(vid: str, body: dict = {}, user=Depends(require_roles(*FINANCE_ROLES))):
    res = await db.expense_vouchers.update_one({"id": vid, "status": "pending_approval"},
                                               {"$set": {"status": "rejected",
                                                         "reject_reason": body.get("reason", "")}})
    if not res.matched_count:
        raise HTTPException(status_code=400, detail="Only pending vouchers can be rejected")
    await audit(user, "voucher_rejected", "expense_voucher", vid,
                f"Voucher rejected: {body.get('reason', '')}")
    return await db.expense_vouchers.find_one({"id": vid}, {"_id": 0})


@router.delete("/vouchers/{vid}")
async def delete_voucher(vid: str, user=Depends(require_roles(*WRITER_ROLES))):
    cur = await db.expense_vouchers.find_one({"id": vid}, {"_id": 0})
    if not cur:
        raise HTTPException(status_code=404, detail="Voucher not found")
    if cur["status"] not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail="Only draft/rejected vouchers can be deleted")
    await db.expense_vouchers.delete_one({"id": vid})
    await audit(user, "voucher_deleted", "expense_voucher", vid, "Voucher deleted")
    return {"ok": True}


@router.post("/vouchers/{vid}/attachments")
async def upload_attachment(vid: str, file: UploadFile = File(...), user=Depends(require_roles(*WRITER_ROLES))):
    cur = await db.expense_vouchers.find_one({"id": vid}, {"_id": 0})
    if not cur:
        raise HTTPException(status_code=404, detail="Voucher not found")
    ext = (file.filename or "file.bin").split(".")[-1].lower()
    path = f"{storage.APP_NAME}/vouchers/{vid}/{new_id()}.{ext}"
    data = await file.read()
    storage.put_object(path, data, file.content_type or "application/octet-stream")
    await db.files.insert_one({"id": new_id(), "storage_path": path, "original_filename": file.filename,
                               "content_type": file.content_type, "size": len(data),
                               "is_deleted": False, "created_at": iso_now()})
    await db.expense_vouchers.update_one({"id": vid},
                                         {"$push": {"attachments": {"path": path, "name": file.filename}}})
    await audit(user, "voucher_attachment", "expense_voucher", vid, f"Attachment '{file.filename}' uploaded")
    return {"path": path, "name": file.filename}
