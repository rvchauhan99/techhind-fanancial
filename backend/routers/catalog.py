from datetime import date, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import (db, require_roles, ALL_ROLES, WRITER_ROLES, audit, new_id, iso_now, today, CYCLE_MONTHS)
import email_service

router = APIRouter(prefix="/api", tags=["catalog"])


# ---------- Customers ----------
class ContactIn(BaseModel):
    name: str = ""
    email: str = ""
    phone: str = ""


class CustomerIn(BaseModel):
    legal_name: str
    trade_name: str = ""
    gstin: str = ""
    pan: str = ""
    state: str
    state_code: str
    billing_address: str = ""
    shipping_address: str = ""
    contacts: List[ContactIn] = []
    crm_tenant_key: str = ""
    notes: str = ""


@router.get("/customers")
async def list_customers(q: str = "", user=Depends(require_roles(*ALL_ROLES))):
    flt = {}
    if q:
        flt = {"$or": [{"legal_name": {"$regex": q, "$options": "i"}},
                       {"trade_name": {"$regex": q, "$options": "i"}},
                       {"gstin": {"$regex": q, "$options": "i"}}]}
    return await db.customers.find(flt, {"_id": 0}).sort("legal_name", 1).to_list(500)


@router.post("/customers")
async def create_customer(body: CustomerIn, user=Depends(require_roles(*WRITER_ROLES))):
    doc = body.model_dump()
    doc.update({"id": new_id(), "created_at": iso_now(), "created_by": user["id"]})
    await db.customers.insert_one(doc)
    await audit(user, "customer_created", "customer", doc["id"], f"Customer '{doc['legal_name']}' created")
    doc.pop("_id", None)
    return doc


@router.get("/customers/{cid}")
async def get_customer(cid: str, user=Depends(require_roles(*ALL_ROLES))):
    doc = await db.customers.find_one({"id": cid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Customer not found")
    return doc


@router.patch("/customers/{cid}")
async def update_customer(cid: str, body: dict, user=Depends(require_roles(*WRITER_ROLES))):
    body.pop("id", None)
    body.pop("_id", None)
    res = await db.customers.update_one({"id": cid}, {"$set": body})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Customer not found")
    await audit(user, "customer_updated", "customer", cid, "Customer updated")
    return await db.customers.find_one({"id": cid}, {"_id": 0})


@router.get("/customers/{cid}/overview")
async def customer_overview(cid: str, user=Depends(require_roles(*ALL_ROLES))):
    customer = await db.customers.find_one({"id": cid}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    subs = await db.subscriptions.find({"customer_id": cid}, {"_id": 0}).to_list(100)
    invoices = await db.invoices.find({"customer_id": cid, "status": {"$ne": "draft"}}, {"_id": 0}).sort("invoice_date", -1).to_list(500)
    drafts = await db.invoices.count_documents({"customer_id": cid, "status": "draft"})
    payments = await db.payments.find({"customer_id": cid}, {"_id": 0}).sort("payment_date", -1).to_list(500)
    outstanding = sum(i.get("balance", 0) for i in invoices if i["status"] in ("approved", "partially_paid") and i["doc_type"] == "INV")
    total_billed = sum(i.get("grand_total", 0) for i in invoices if i["doc_type"] == "INV" and i["status"] != "cancelled")
    return {"customer": customer, "subscriptions": subs, "invoices": invoices, "draft_count": drafts,
            "payments": payments, "outstanding": round(outstanding, 2), "total_billed": round(total_billed, 2)}


# ---------- Products ----------
class ProductIn(BaseModel):
    name: str
    type: str = "saas_plan"  # saas_plan | one_time | service | addon
    hsn_sac: str = "998314"
    tax_rate: float = 18
    price: float = 0
    billing_cycle: str = "monthly"  # monthly|quarterly|half_yearly|yearly|one_time
    unit: str = "Nos"
    description: str = ""
    active: bool = True


@router.get("/products")
async def list_products(user=Depends(require_roles(*ALL_ROLES))):
    return await db.products.find({}, {"_id": 0}).sort("name", 1).to_list(500)


@router.post("/products")
async def create_product(body: ProductIn, user=Depends(require_roles(*WRITER_ROLES))):
    doc = body.model_dump()
    doc.update({"id": new_id(), "created_at": iso_now()})
    await db.products.insert_one(doc)
    await audit(user, "product_created", "product", doc["id"], f"Product '{doc['name']}' created")
    doc.pop("_id", None)
    return doc


@router.patch("/products/{pid}")
async def update_product(pid: str, body: dict, user=Depends(require_roles(*WRITER_ROLES))):
    body.pop("id", None)
    body.pop("_id", None)
    res = await db.products.update_one({"id": pid}, {"$set": body})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Product not found")
    await audit(user, "product_updated", "product", pid, "Product updated")
    return await db.products.find_one({"id": pid}, {"_id": 0})


# ---------- Subscriptions ----------
class SubscriptionIn(BaseModel):
    customer_id: str
    product_id: Optional[str] = None
    plan_name: str = ""
    status: str = "active"  # trial|active|grace|overdue|paused|cancelled|expired
    start_on: str
    next_renewal_on: str
    billing_cycle: str = "monthly"
    price: float = 0
    auto_renew: bool = True
    notes: str = ""


def _sub_doc(body: SubscriptionIn, user: dict):
    months = CYCLE_MONTHS.get(body.billing_cycle, 1) or 1
    doc = body.model_dump()
    doc["mrr"] = round(body.price / months, 2)
    return doc


@router.get("/subscriptions")
async def list_subscriptions(status: str = "", customer_id: str = "", user=Depends(require_roles(*ALL_ROLES))):
    flt = {}
    if status:
        flt["status"] = status
    if customer_id:
        flt["customer_id"] = customer_id
    subs = await db.subscriptions.find(flt, {"_id": 0}).sort("next_renewal_on", 1).to_list(500)
    cust_ids = list({s["customer_id"] for s in subs})
    custs = await db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0, "id": 1, "legal_name": 1}).to_list(500)
    cmap = {c["id"]: c["legal_name"] for c in custs}
    for s in subs:
        s["customer_name"] = cmap.get(s["customer_id"], "")
    return subs


@router.post("/subscriptions")
async def create_subscription(body: SubscriptionIn, user=Depends(require_roles(*WRITER_ROLES))):
    doc = _sub_doc(body, user)
    doc.update({"id": new_id(), "created_at": iso_now(), "created_by": user["id"]})
    await db.subscriptions.insert_one(doc)
    await audit(user, "subscription_created", "subscription", doc["id"],
                f"Subscription '{doc['plan_name']}' created")
    doc.pop("_id", None)
    return doc


@router.get("/subscriptions/renewals")
async def renewal_buckets(user=Depends(require_roles(*ALL_ROLES))):
    t = today()
    subs = await db.subscriptions.find(
        {"status": {"$in": ["trial", "active", "grace", "overdue"]}}, {"_id": 0}).to_list(1000)
    cust_ids = list({s["customer_id"] for s in subs})
    custs = await db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0, "id": 1, "legal_name": 1}).to_list(1000)
    cmap = {c["id"]: c["legal_name"] for c in custs}
    buckets = {"overdue": [], "in_7_days": [], "in_15_days": [], "in_30_days": []}
    for s in subs:
        try:
            nxt = date.fromisoformat(s["next_renewal_on"])
        except Exception:
            continue
        days = (nxt - t).days
        s["days_to_renewal"] = days
        s["customer_name"] = cmap.get(s["customer_id"], "")
        if days < 0:
            buckets["overdue"].append(s)
        elif days <= 7:
            buckets["in_7_days"].append(s)
        elif days <= 15:
            buckets["in_15_days"].append(s)
        elif days <= 30:
            buckets["in_30_days"].append(s)
    return {"buckets": buckets,
            "counts": {k: len(v) for k, v in buckets.items()}}


@router.post("/subscriptions/{sid}/reminder")
async def send_reminder(sid: str, user=Depends(require_roles(*WRITER_ROLES))):
    sub = await db.subscriptions.find_one({"id": sid}, {"_id": 0})
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    cust = await db.customers.find_one({"id": sub["customer_id"]}, {"_id": 0})
    to = (((cust or {}).get("contacts") or [{}])[0]).get("email") or ""
    if not email_service.normalize_recipients(to):
        raise HTTPException(status_code=400, detail="Customer has no valid contact email on file")

    subject = f"Renewal reminder: {sub['plan_name']} renews on {sub['next_renewal_on']}"
    text = (
        f"Hello,\n\nThis is a renewal reminder for {sub['plan_name']}.\n"
        f"Next renewal date: {sub['next_renewal_on']}\n\n"
        "Please contact TechHind Finance if you have any questions.\n\n"
        "Regards,\nTechHind Pvt Ltd"
    )
    html = f"<p>{text.replace(chr(10), '<br/>')}</p>"

    try:
        result = email_service.send_email(to, subject, text=text, html=html)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Email delivery failed: {e}")

    status = result.get("status") or ("mocked" if result.get("mocked") else "sent")
    log = {
        "id": new_id(),
        "doc_id": sid,
        "doc_type": "SUB",
        "doc_no": sub["plan_name"],
        "kind": "renewal_reminder",
        "to": ", ".join(result.get("to") or [to]),
        "subject": subject,
        "sent_on": iso_now(),
        "status": status,
        "provider": result.get("provider"),
        "message_id": result.get("message_id") or "",
        "sent_by": user["id"],
    }
    await db.email_log.insert_one(log)
    await db.subscriptions.update_one({"id": sid}, {"$set": {"reminder_sent_on": log["sent_on"]}})
    mode = "MOCKED" if result.get("mocked") else "sent"
    await audit(
        user,
        "reminder_sent",
        "subscription",
        sid,
        f"Renewal reminder for '{sub['plan_name']}' → {log['to']} ({mode})",
    )
    log.pop("_id", None)
    return {"ok": True, "mocked": bool(result.get("mocked")), "log": log}


class BulkReminderIn(BaseModel):
    ids: List[str]


@router.post("/subscriptions/reminders/bulk")
async def bulk_reminders(body: BulkReminderIn, user=Depends(require_roles(*WRITER_ROLES))):
    sent, failed = 0, []
    mocked_any = False
    for sid in body.ids:
        sub = await db.subscriptions.find_one({"id": sid}, {"_id": 0})
        if not sub:
            failed.append(sid)
            continue
        cust = await db.customers.find_one({"id": sub["customer_id"]}, {"_id": 0})
        to = (((cust or {}).get("contacts") or [{}])[0]).get("email") or ""
        if not email_service.normalize_recipients(to):
            failed.append(sid)
            continue
        subject = f"Renewal reminder: {sub['plan_name']} renews on {sub['next_renewal_on']}"
        text = (
            f"Hello,\n\nThis is a renewal reminder for {sub['plan_name']}.\n"
            f"Next renewal date: {sub['next_renewal_on']}\n\n"
            "Regards,\nTechHind Pvt Ltd"
        )
        try:
            result = email_service.send_email(to, subject, text=text, html=f"<p>{text.replace(chr(10), '<br/>')}</p>")
        except Exception:
            failed.append(sid)
            continue
        mocked_any = mocked_any or bool(result.get("mocked"))
        status = result.get("status") or ("mocked" if result.get("mocked") else "sent")
        await db.email_log.insert_one({
            "id": new_id(),
            "doc_id": sid,
            "doc_type": "SUB",
            "doc_no": sub["plan_name"],
            "kind": "renewal_reminder",
            "to": ", ".join(result.get("to") or [to]),
            "subject": subject,
            "sent_on": iso_now(),
            "status": status,
            "provider": result.get("provider"),
            "message_id": result.get("message_id") or "",
            "sent_by": user["id"],
        })
        await db.subscriptions.update_one({"id": sid}, {"$set": {"reminder_sent_on": iso_now()}})
        sent += 1
    mode = "MOCKED" if mocked_any or not email_service.is_configured() else "sent"
    await audit(
        user,
        "reminders_bulk",
        "subscription",
        ",".join(body.ids),
        f"Bulk renewal reminders: {sent} {mode}, {len(failed)} failed",
    )
    return {
        "ok": True,
        "mocked": mocked_any or (sent > 0 and not email_service.is_configured()),
        "sent": sent,
        "failed": failed,
    }


@router.patch("/subscriptions/{sid}")
async def update_subscription(sid: str, body: dict, user=Depends(require_roles(*WRITER_ROLES))):
    body.pop("id", None)
    body.pop("_id", None)
    if "price" in body or "billing_cycle" in body:
        cur = await db.subscriptions.find_one({"id": sid})
        if cur:
            price = float(body.get("price", cur.get("price", 0)))
            cycle = body.get("billing_cycle", cur.get("billing_cycle", "monthly"))
            body["mrr"] = round(price / (CYCLE_MONTHS.get(cycle, 1) or 1), 2)
    res = await db.subscriptions.update_one({"id": sid}, {"$set": body})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Subscription not found")
    await audit(user, "subscription_updated", "subscription", sid,
                f"Subscription updated: {', '.join(body.keys())}", diff=body)
    return await db.subscriptions.find_one({"id": sid}, {"_id": 0})


# ---------- Vendors ----------
class VendorIn(BaseModel):
    name: str
    gstin: str = ""
    pan: str = ""
    state: str = ""
    state_code: str = ""
    address: str = ""
    contact_name: str = ""
    contact_email: str = ""
    contact_phone: str = ""


@router.get("/vendors")
async def list_vendors(user=Depends(require_roles(*ALL_ROLES))):
    return await db.vendors.find({}, {"_id": 0}).sort("name", 1).to_list(500)


@router.post("/vendors")
async def create_vendor(body: VendorIn, user=Depends(require_roles(*WRITER_ROLES))):
    doc = body.model_dump()
    doc.update({"id": new_id(), "created_at": iso_now()})
    await db.vendors.insert_one(doc)
    await audit(user, "vendor_created", "vendor", doc["id"], f"Vendor '{doc['name']}' created")
    doc.pop("_id", None)
    return doc


@router.patch("/vendors/{vid}")
async def update_vendor(vid: str, body: dict, user=Depends(require_roles(*WRITER_ROLES))):
    body.pop("id", None)
    body.pop("_id", None)
    res = await db.vendors.update_one({"id": vid}, {"$set": body})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Vendor not found")
    await audit(user, "vendor_updated", "vendor", vid, "Vendor updated")
    return await db.vendors.find_one({"id": vid}, {"_id": 0})
