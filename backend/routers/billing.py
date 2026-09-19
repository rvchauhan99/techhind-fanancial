from datetime import date
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from core import (db, require_roles, ALL_ROLES, WRITER_ROLES, FINANCE_ROLES, audit, new_id,
                  iso_now, today, next_number, get_company, add_months, CYCLE_MONTHS,
                  assert_period_open, field_diff, run_in_transaction)
from gst import compute_document, r2
import hashlib
import secrets
import pdf as pdfmod
import email_service

router = APIRouter(prefix="/api", tags=["billing"])

OPEN_INV_STATUSES = ("approved", "partially_paid")


class LineIn(BaseModel):
    description: str
    product_id: Optional[str] = None
    hsn_sac: str = ""
    qty: float = 1
    unit: str = "Nos"
    rate: float = 0
    discount: float = 0
    tax_rate: float = 18


class InvoiceIn(BaseModel):
    doc_type: str = "INV"  # INV | CN | DN
    customer_id: str
    invoice_date: str
    due_date: Optional[str] = None
    lines: List[LineIn]
    subscription_id: Optional[str] = None
    is_export_sez: bool = False
    lut_flag: bool = False
    reverse_charge: bool = False
    pos_state_code: Optional[str] = None
    pos_state: Optional[str] = None
    pos_override_reason: str = ""
    reference_invoice_id: Optional[str] = None
    reason: str = ""
    notes: str = ""


async def _build_invoice_doc(body: InvoiceIn, company: dict) -> dict:
    customer = await db.customers.find_one({"id": body.customer_id}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    if body.doc_type in ("CN", "DN"):
        if not body.reference_invoice_id:
            raise HTTPException(status_code=400, detail="CN/DN requires a reference invoice")
        ref = await db.invoices.find_one({"id": body.reference_invoice_id}, {"_id": 0})
        if not ref or ref.get("status") == "draft":
            raise HTTPException(status_code=400, detail="Reference invoice must be approved")
    pos_code = body.pos_state_code or customer.get("state_code", "")
    pos_state = body.pos_state or customer.get("state", "")
    if body.pos_state_code and body.pos_state_code != customer.get("state_code") and not body.pos_override_reason:
        raise HTTPException(status_code=400, detail="Place-of-supply override requires a reason")
    computed = compute_document([l.model_dump() for l in body.lines], company["state_code"],
                                pos_code, body.is_export_sez, body.lut_flag, body.reverse_charge)
    primary_contact = (customer.get("contacts") or [{}])[0]
    doc = {
        "doc_type": body.doc_type,
        "customer_id": customer["id"],
        "customer_snapshot": {
            "legal_name": customer.get("legal_name"), "trade_name": customer.get("trade_name"),
            "gstin": customer.get("gstin"), "billing_address": customer.get("billing_address"),
            "state": customer.get("state"), "state_code": customer.get("state_code"),
            "contact_email": primary_contact.get("email", ""),
        },
        "invoice_date": body.invoice_date,
        "due_date": body.due_date,
        "place_of_supply": {"state": pos_state, "code": pos_code},
        "pos_override_reason": body.pos_override_reason,
        "is_export_sez": body.is_export_sez, "lut_flag": body.lut_flag,
        "reverse_charge": body.reverse_charge,
        "subscription_id": body.subscription_id,
        "reference_invoice_id": body.reference_invoice_id,
        "reason": body.reason, "notes": body.notes,
        "irn": None, "irn_qr": None, "tds_amount": 0,
    }
    doc.update(computed)
    return doc


@router.get("/invoices")
async def list_invoices(status: str = "", doc_type: str = "", customer_id: str = "", q: str = "",
                        page: int = 0, limit: int = 100,
                        user=Depends(require_roles(*ALL_ROLES))):
    flt = {}
    if status:
        flt["status"] = status
    if doc_type:
        flt["doc_type"] = doc_type
    if customer_id:
        flt["customer_id"] = customer_id
    if q:
        flt["$or"] = [{"invoice_no": {"$regex": q, "$options": "i"}},
                      {"customer_snapshot.legal_name": {"$regex": q, "$options": "i"}}]
    limit = max(1, min(limit, 500))
    cur = db.invoices.find(flt, {"_id": 0}).sort([("invoice_date", -1), ("created_at", -1)])
    if page <= 0:
        return await cur.to_list(1000)
    skip = (page - 1) * limit
    total = await db.invoices.count_documents(flt)
    items = await cur.skip(skip).to_list(limit)
    return {"items": items, "page": page, "limit": limit, "total": total}


@router.post("/invoices")
async def create_invoice(body: InvoiceIn, user=Depends(require_roles(*WRITER_ROLES))):
    company = await get_company()
    await assert_period_open(body.invoice_date, user)
    doc = await _build_invoice_doc(body, company)
    ref_no = None
    if body.reference_invoice_id:
        ref = await db.invoices.find_one({"id": body.reference_invoice_id}, {"_id": 0, "invoice_no": 1})
        ref_no = (ref or {}).get("invoice_no")
    doc.update({"id": new_id(), "status": "draft", "invoice_no": None,
                "reference_invoice_no": ref_no,
                "amount_paid": 0.0, "balance": doc["grand_total"],
                "branding_snapshot": None, "sent_on": None, "send_status": None,
                "created_by": user["id"], "created_at": iso_now()})
    await db.invoices.insert_one(doc)
    label = {"INV": "Invoice", "CN": "Credit note", "DN": "Debit note"}[doc["doc_type"]]
    await audit(user, "invoice_created", "invoice", doc["id"],
                f"{label} draft created for {doc['customer_snapshot']['legal_name']} — ₹{doc['grand_total']:,.2f}")
    doc.pop("_id", None)
    return doc


@router.get("/invoices/{iid}")
async def get_invoice(iid: str, user=Depends(require_roles(*ALL_ROLES))):
    doc = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.patch("/invoices/{iid}")
async def update_invoice(iid: str, body: InvoiceIn, user=Depends(require_roles(*WRITER_ROLES))):
    cur = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not cur:
        raise HTTPException(status_code=404, detail="Document not found")
    if cur["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only draft documents can be edited (immutability rule)")
    await assert_period_open(cur["invoice_date"], user)
    await assert_period_open(body.invoice_date, user)
    company = await get_company()
    doc = await _build_invoice_doc(body, company)
    doc["balance"] = doc["grand_total"]
    await db.invoices.update_one({"id": iid}, {"$set": doc})
    diff = field_diff(
        cur, doc,
        ["invoice_date", "due_date", "customer_id", "grand_total", "total_taxable", "total_tax",
         "doc_type", "notes", "reason", "reference_invoice_id"],
    )
    await audit(user, "invoice_updated", "invoice", iid, "Draft document edited", diff=diff)
    return await db.invoices.find_one({"id": iid}, {"_id": 0})


@router.delete("/invoices/{iid}")
async def delete_invoice(iid: str, user=Depends(require_roles(*WRITER_ROLES))):
    cur = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not cur:
        raise HTTPException(status_code=404, detail="Document not found")
    if cur["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only draft documents can be deleted (immutability rule)")
    await assert_period_open(cur["invoice_date"], user)
    await db.invoices.delete_one({"id": iid})
    await audit(user, "invoice_deleted", "invoice", iid, "Draft document deleted")
    return {"ok": True}


@router.post("/invoices/{iid}/approve")
async def approve_invoice(iid: str, user=Depends(require_roles(*FINANCE_ROLES))):
    cur = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not cur:
        raise HTTPException(status_code=404, detail="Document not found")
    if cur["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only drafts can be approved")
    await assert_period_open(cur["invoice_date"], user)
    company = await get_company()
    inv_date = date.fromisoformat(cur["invoice_date"])

    async def _do(session):
        opts = {"session": session} if session else {}
        # Claim draft first so a losing race does not burn a number series slot
        res = await db.invoices.update_one(
            {"id": iid, "status": "draft"},
            {"$set": {
                "status": "approved", "branding_snapshot": company,
                "approved_by": user["id"], "approved_at": iso_now(),
            }},
            **opts,
        )
        if res.matched_count == 0:
            raise HTTPException(status_code=409, detail="Invoice already approved or changed")
        number = await next_number(cur["doc_type"], inv_date, session=session)
        await db.invoices.update_one({"id": iid}, {"$set": {"invoice_no": number}}, **opts)
        if cur["doc_type"] == "CN" and cur.get("reference_invoice_id"):
            ref = await db.invoices.find_one({"id": cur["reference_invoice_id"]}, {"_id": 0}, **opts)
            if ref:
                new_balance = r2(max(0.0, ref.get("balance", 0) - cur["grand_total"]))
                new_status = ref["status"]
                if new_balance <= 0.005 and ref["status"] in OPEN_INV_STATUSES:
                    new_status = "paid"
                elif new_balance < ref.get("grand_total", 0):
                    new_status = "partially_paid" if ref["status"] in OPEN_INV_STATUSES else ref["status"]
                await db.invoices.update_one(
                    {"id": ref["id"]},
                    {"$set": {"balance": new_balance, "status": new_status},
                     "$push": {"applied_notes": {"id": iid, "invoice_no": number,
                                                 "doc_type": "CN",
                                                 "amount": cur["grand_total"]}}},
                    **opts,
                )
        if cur["doc_type"] == "DN" and cur.get("reference_invoice_id"):
            ref = await db.invoices.find_one({"id": cur["reference_invoice_id"]}, {"_id": 0}, **opts)
            if ref:
                new_balance = r2(ref.get("balance", 0) + cur["grand_total"])
                new_paid = ref.get("amount_paid", 0)
                new_status = "partially_paid" if new_paid > 0 else "approved"
                await db.invoices.update_one(
                    {"id": ref["id"]},
                    {"$set": {"balance": new_balance, "grand_total": r2(ref.get("grand_total", 0) + cur["grand_total"]),
                              "status": new_status},
                     "$push": {"applied_notes": {"id": iid, "invoice_no": number,
                                                 "doc_type": "DN",
                                                 "amount": cur["grand_total"]}}},
                    **opts,
                )
        return number

    number = await run_in_transaction(_do)
    await audit(
        user, "invoice_approved", "invoice", iid,
        f"{cur['doc_type']} {number} approved & locked — ₹{cur['grand_total']:,.2f}",
        diff={"status": {"old": "draft", "new": "approved"}, "invoice_no": {"old": None, "new": number}},
    )
    return await db.invoices.find_one({"id": iid}, {"_id": 0})


@router.post("/invoices/{iid}/cancel")
async def cancel_invoice(iid: str, user=Depends(require_roles(*FINANCE_ROLES))):
    cur = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not cur:
        raise HTTPException(status_code=404, detail="Document not found")
    if cur["status"] not in OPEN_INV_STATUSES:
        raise HTTPException(status_code=400, detail="Only approved documents can be cancelled")
    if cur.get("amount_paid", 0) > 0:
        raise HTTPException(status_code=400, detail="Cannot cancel: payments recorded. Issue a Credit Note instead.")
    await assert_period_open(cur["invoice_date"], user)
    await db.invoices.update_one({"id": iid}, {"$set": {"status": "cancelled", "balance": 0,
                                                        "cancelled_by": user["id"], "cancelled_at": iso_now()}})
    await audit(
        user, "invoice_cancelled", "invoice", iid,
        f"{cur['invoice_no']} cancelled (number retired, not reused)",
        diff={"status": {"old": cur["status"], "new": "cancelled"}},
    )
    return await db.invoices.find_one({"id": iid}, {"_id": 0})


class SendIn(BaseModel):
    to: str
    subject: str = ""
    message: str = ""


@router.post("/invoices/{iid}/send")
async def send_invoice(iid: str, body: SendIn, user=Depends(require_roles(*WRITER_ROLES))):
    cur = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not cur:
        raise HTTPException(status_code=404, detail="Document not found")
    if cur["status"] == "draft":
        raise HTTPException(status_code=400, detail="Approve the document before sending")

    subject = body.subject or f"{cur.get('invoice_no')} from TechHind Pvt Ltd"
    message = body.message or (
        f"Please find attached tax invoice {cur.get('invoice_no')}.\n\n"
        f"Amount due: INR {cur.get('grand_total', cur.get('total', 0))}\n"
        f"Due date: {cur.get('due_date') or '—'}\n\n"
        "Regards,\nTechHind Pvt Ltd"
    )
    html = (
        f"<p>{message.replace(chr(10), '<br/>')}</p>"
        f"<p style='color:#666;font-size:12px'>This email was sent from TechHind Finance.</p>"
    )

    attachments = []
    try:
        company = await get_company()
        pdf_html = pdfmod.render_invoice_html(cur, company)
        pdf_bytes = await pdfmod.build_pdf(pdf_html)
        fname = f"{(cur.get('invoice_no') or 'invoice').replace('/', '-')}.pdf"
        attachments.append({"filename": fname, "content": pdf_bytes, "content_type": "application/pdf"})
    except Exception as e:
        # Still send the email body if PDF rendering fails
        import logging
        logging.getLogger("billing").warning("Invoice PDF attach skipped: %s", e)

    try:
        result = email_service.send_email(
            body.to, subject, text=message, html=html, attachments=attachments or None
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Email delivery failed: {e}")

    status = result.get("status") or ("mocked" if result.get("mocked") else "sent")
    log = {
        "id": new_id(),
        "doc_id": iid,
        "doc_type": cur["doc_type"],
        "doc_no": cur.get("invoice_no"),
        "to": ", ".join(result.get("to") or [body.to]),
        "subject": subject,
        "sent_on": iso_now(),
        "status": status,
        "provider": result.get("provider"),
        "message_id": result.get("message_id") or "",
        "sent_by": user["id"],
    }
    await db.email_log.insert_one(log)
    await db.invoices.update_one(
        {"id": iid}, {"$set": {"sent_on": log["sent_on"], "send_status": status}}
    )
    mode = "MOCKED" if result.get("mocked") else "sent"
    await audit(
        user,
        "invoice_emailed",
        "invoice",
        iid,
        f"{cur.get('invoice_no')} emailed to {log['to']} ({mode})",
    )
    log.pop("_id", None)
    return {"ok": True, "mocked": bool(result.get("mocked")), "log": log}


@router.get("/invoices/{iid}/emails")
async def invoice_emails(iid: str, user=Depends(require_roles(*ALL_ROLES))):
    return await db.email_log.find({"doc_id": iid}, {"_id": 0}).sort("sent_on", -1).to_list(100)


@router.get("/invoices/{iid}/pdf")
async def invoice_pdf(iid: str, user=Depends(require_roles(*ALL_ROLES))):
    doc = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    company = await get_company()
    html = pdfmod.render_invoice_html(doc, company)
    data = await pdfmod.build_pdf(html)
    name = (doc.get("invoice_no") or "draft").replace("/", "-")
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{name}.pdf"'})


# ---------- Payments / Receipts ----------
class AllocationIn(BaseModel):
    invoice_id: str
    amount: float


class PaymentIn(BaseModel):
    customer_id: str
    payment_date: str
    amount: float
    tds_amount: float = 0
    method: str = "upi"  # upi|neft|rtgs|cheque|cash|card
    reference_no: str = ""
    bank_id: str = ""
    allocations: List[AllocationIn] = []
    notes: str = ""


async def _apply_payment_to_invoice(invoice_id: str, amount: float, session=None):
    opts = {"session": session} if session is not None else {}
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0}, **opts)
    if not inv:
        raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found")
    if inv["status"] not in OPEN_INV_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invoice {inv.get('invoice_no')} is not open for payment")
    if amount > inv.get("balance", 0) + 0.005:
        raise HTTPException(status_code=400, detail=f"Allocation exceeds balance on {inv.get('invoice_no')}")
    new_paid = r2(inv.get("amount_paid", 0) + amount)
    new_balance = r2(inv["grand_total"] - new_paid)
    new_status = "paid" if new_balance <= 0.005 else "partially_paid"
    await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {"amount_paid": new_paid, "balance": max(new_balance, 0.0), "status": new_status}},
        **opts,
    )
    if new_status == "paid" and inv.get("subscription_id"):
        sub = await db.subscriptions.find_one({"id": inv["subscription_id"]}, {"_id": 0}, **opts)
        if sub:
            months = CYCLE_MONTHS.get(sub.get("billing_cycle", "monthly"), 1) or 1
            nxt = add_months(date.fromisoformat(sub["next_renewal_on"]), months)
            upd = {"next_renewal_on": nxt.isoformat()}
            if sub.get("status") in ("trial", "grace", "overdue"):
                upd["status"] = "active"
            await db.subscriptions.update_one({"id": sub["id"]}, {"$set": upd}, **opts)
    return inv


@router.get("/payments")
async def list_payments(customer_id: str = "", page: int = 0, limit: int = 100,
                        user=Depends(require_roles(*ALL_ROLES))):
    """Legacy: page=0 returns a bare list. page>=1 returns {items,page,limit,total}."""
    flt = {"customer_id": customer_id} if customer_id else {}
    limit = max(1, min(limit, 500))
    if page <= 0:
        return await db.payments.find(flt, {"_id": 0}).sort("payment_date", -1).to_list(1000)
    skip = (page - 1) * limit
    total = await db.payments.count_documents(flt)
    items = await db.payments.find(flt, {"_id": 0}).sort("payment_date", -1).skip(skip).to_list(limit)
    return {"items": items, "page": page, "limit": limit, "total": total}


@router.get("/payments/open-invoices/{customer_id}")
async def open_invoices(customer_id: str, user=Depends(require_roles(*ALL_ROLES))):
    return await db.invoices.find(
        {"customer_id": customer_id, "doc_type": "INV", "status": {"$in": list(OPEN_INV_STATUSES)}},
        {"_id": 0}).sort("due_date", 1).to_list(500)


@router.post("/payments")
async def create_payment(body: PaymentIn, user=Depends(require_roles(*WRITER_ROLES))):
    customer = await db.customers.find_one({"id": body.customer_id}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    await assert_period_open(body.payment_date, user)
    total_credit = r2(body.amount + body.tds_amount)
    total_alloc = r2(sum(a.amount for a in body.allocations))
    if total_alloc > total_credit + 0.005:
        raise HTTPException(status_code=400, detail="Allocations exceed payment amount + TDS")

    async def _do(session):
        opts = {"session": session} if session is not None else {}
        receipt_no = await next_number("RCP", date.fromisoformat(body.payment_date), session=session)
        alloc_docs = []
        for a in body.allocations:
            inv = await _apply_payment_to_invoice(a.invoice_id, r2(a.amount), session=session)
            alloc_docs.append({"invoice_id": a.invoice_id, "amount": r2(a.amount),
                               "invoice_no": inv.get("invoice_no"), "invoice_date": inv.get("invoice_date")})
        doc = {"id": new_id(), "receipt_no": receipt_no, "customer_id": body.customer_id,
               "customer_name": customer.get("legal_name"), "payment_date": body.payment_date,
               "amount": r2(body.amount), "tds_amount": r2(body.tds_amount), "method": body.method,
               "reference_no": body.reference_no, "bank_id": body.bank_id or "",
               "allocations": alloc_docs, "unallocated": r2(total_credit - total_alloc),
               "notes": body.notes, "created_by": user["id"], "created_at": iso_now()}
        await db.payments.insert_one(doc, **opts)
        import bank_ledger as bl
        await bl.post_payment_receipt(doc, session=session)
        return doc

    doc = await run_in_transaction(_do)
    await audit(
        user, "payment_recorded", "payment", doc["id"],
        f"Receipt {doc['receipt_no']} — ₹{doc['amount']:,.2f} from {customer.get('legal_name')} "
        f"({len(doc['allocations'])} allocations, ₹{doc['unallocated']:,.2f} unallocated)",
        diff={"amount": doc["amount"], "tds_amount": doc["tds_amount"], "allocations": doc["allocations"]},
    )
    doc.pop("_id", None)
    return doc


@router.delete("/payments/{pid}")
async def delete_payment(pid: str, user=Depends(require_roles(*FINANCE_ROLES))):
    pay = await db.payments.find_one({"id": pid}, {"_id": 0})
    if not pay:
        raise HTTPException(status_code=404, detail="Payment not found")
    await assert_period_open(pay["payment_date"], user)

    async def _do(session):
        opts = {"session": session} if session is not None else {}
        for a in pay.get("allocations", []):
            inv = await db.invoices.find_one({"id": a["invoice_id"]}, {"_id": 0}, **opts)
            if inv and inv["status"] != "cancelled":
                new_paid = r2(max(0.0, inv.get("amount_paid", 0) - a["amount"]))
                new_balance = r2(inv["grand_total"] - new_paid)
                new_status = "approved" if new_paid <= 0.005 else "partially_paid"
                await db.invoices.update_one(
                    {"id": inv["id"]},
                    {"$set": {"amount_paid": new_paid, "balance": new_balance, "status": new_status}},
                    **opts,
                )
        import bank_ledger as bl
        await bl.reverse_by_source("payment", pid, session=session)
        await db.payments.delete_one({"id": pid}, **opts)

    await run_in_transaction(_do)
    await audit(
        user, "payment_deleted", "payment", pid,
        f"Receipt {pay.get('receipt_no')} reversed & deleted",
        diff={"amount": pay.get("amount"), "allocations": pay.get("allocations", [])},
    )
    return {"ok": True}


@router.post("/invoices/{iid}/generate-irn")
async def generate_irn(iid: str, user=Depends(require_roles(*FINANCE_ROLES))):
    cur = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not cur:
        raise HTTPException(status_code=404, detail="Document not found")
    if cur["status"] == "draft":
        raise HTTPException(status_code=400, detail="Approve the invoice before generating IRN")
    if cur.get("irn"):
        raise HTTPException(status_code=400, detail="IRN already generated")
    company = await get_company()
    irn = hashlib.sha256(f"{cur['invoice_no']}|{company['gstin']}|{cur['invoice_date']}".encode()).hexdigest()
    ack_no = "".join(secrets.choice("0123456789") for _ in range(15))
    await db.invoices.update_one({"id": iid}, {"$set": {
        "irn": irn, "irn_ack_no": ack_no, "irn_ack_date": iso_now()[:10], "irn_mode": "mock-sandbox"}})
    await audit(user, "irn_generated", "invoice", iid,
                f"IRN generated for {cur['invoice_no']} (MOCK sandbox — not a real e-invoice)")
    return await db.invoices.find_one({"id": iid}, {"_id": 0})


@router.get("/payments/{pid}/receipt-pdf")
async def receipt_pdf(pid: str, user=Depends(require_roles(*ALL_ROLES))):
    pay = await db.payments.find_one({"id": pid}, {"_id": 0})
    if not pay:
        raise HTTPException(status_code=404, detail="Payment not found")
    company = await get_company()
    customer = await db.customers.find_one({"id": pay["customer_id"]}, {"_id": 0}) or {}
    html = pdfmod.render_receipt_html(pay, company, customer, pay.get("allocations", []))
    data = await pdfmod.build_pdf(html)
    name = (pay.get("receipt_no") or "receipt").replace("/", "-")
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{name}.pdf"'})
