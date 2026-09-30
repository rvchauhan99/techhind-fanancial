from datetime import date, timedelta

from core import db, hash_password, new_id, iso_now, fy_of, SERIES_PREFIX, CYCLE_MONTHS
from gst import compute_document, r2

COMPANY = {
    "id": "company",
    "legal_name": "TechHind Pvt Ltd",
    "trade_name": "TechHind",
    "gstin": "24AAACT2728Q1ZW",
    "pan": "AAACT2728Q",
    "cin": "U72200GJ2015PTC083412",
    "state": "Gujarat",
    "state_code": "24",
    "address": "704, Iscon Elegance, SG Highway, Ahmedabad, Gujarat 380015",
    "email": "finance@techhind.in",
    "phone": "+91 79 4890 2200",
    "website": "https://techhind.in",
    "bank": {"bank_name": "HDFC Bank", "account_name": "TechHind Pvt Ltd",
             "account_no": "50200088765432", "ifsc": "HDFC0001207",
             "branch": "SG Highway, Ahmedabad", "upi": "techhind@hdfcbank"},
    "terms": "Payment due within 15 days of invoice date. Interest @18% p.a. applies on delayed payments. Subject to Ahmedabad jurisdiction.",
    "brand": {"primary": "#0F284E", "accent": "#0066CC"},
    "logo_path": None, "stamp_path": None, "signature_path": None,
}

MASTERS = {
    "id": "masters",
    "hsn_codes": [
        {"code": "998314", "description": "IT software / SaaS subscription", "default_rate": 18},
        {"code": "998313", "description": "IT consulting & support services", "default_rate": 18},
        {"code": "998315", "description": "Software implementation & onboarding", "default_rate": 18},
        {"code": "998311", "description": "Management consulting services", "default_rate": 18},
        {"code": "998439", "description": "Other professional services", "default_rate": 18},
    ],
    "tax_rates": [{"rate": 0, "label": "Exempt / Nil"}, {"rate": 5, "label": "5%"},
                  {"rate": 12, "label": "12%"}, {"rate": 18, "label": "18% (SaaS/Services)"},
                  {"rate": 28, "label": "28%"}],
    "expense_categories": [
        {"name": "Cloud & Hosting"}, {"name": "Salaries (Monthly Summary)"},
        {"name": "Statutory Payments"}, {"name": "Office Rent"},
        {"name": "Marketing & Ads"}, {"name": "Travel"},
        {"name": "Professional Fees"}, {"name": "Software Licenses"},
        {"name": "Office Supplies"},
    ],
    "banks": [
        {"bank_name": "HDFC Bank", "account_name": "TechHind Pvt Ltd", "account_no": "50200088765432",
         "ifsc": "HDFC0001207", "branch": "SG Highway, Ahmedabad", "primary": True},
        {"bank_name": "ICICI Bank", "account_name": "TechHind Pvt Ltd", "account_no": "120405500998",
         "ifsc": "ICIC0001204", "branch": "Prahladnagar, Ahmedabad", "primary": False},
    ],
}

USERS = [
    ("Gayatri Chauhan", "gayatribachauhan99@gmail.com", "TechHind@2026", "admin"),
    ("Rohan Desai", "accountant@techhind.in", "Finance@123", "accountant"),
    ("Priya Nair", "ops@techhind.in", "Ops@12345", "ops"),
    ("Kiran Mehta", "viewer@techhind.in", "View@12345", "viewer"),
    ("Amit Shah", "dev@techhind.in", "Dev@12345", "developer"),
    ("Neha Patel", "pm@techhind.in", "Pm@123456", "project_manager"),
    ("Sonal Joshi", "qa@techhind.in", "Qa@123456", "qa"),
    ("Meera Shah", "ba@techhind.in", "Ba@123456", "business_analyst"),
    ("Ravi Trainer", "trainer@techhind.in", "Train@123", "trainer"),
]

PRODUCTS = [
    ("TH Cloud — Starter", "saas_plan", "998314", 18, 4999, "monthly", "Entry SaaS plan, up to 5 seats"),
    ("TH Cloud — Growth", "saas_plan", "998314", 18, 12999, "monthly", "Growth SaaS plan, up to 25 seats"),
    ("TH Cloud — Enterprise", "saas_plan", "998314", 18, 49999, "monthly", "Enterprise SaaS, unlimited seats + SLA"),
    ("TH Cloud — Growth Annual", "saas_plan", "998314", 18, 129990, "yearly", "Growth plan billed annually (2 months free)"),
    ("Implementation & Onboarding", "one_time", "998315", 18, 75000, "one_time", "One-time setup, data migration & training"),
    ("Consulting Services", "service", "998313", 18, 2500, "one_time", "Solution consulting (per hour)"),
    ("Extra Storage Add-on (100 GB)", "addon", "998314", 18, 999, "monthly", "Additional storage block"),
]

CUSTOMERS = [
    ("UrbanKart Technologies Pvt Ltd", "UrbanKart", "24AAECU4821F1Z5", "Gujarat", "24",
     "9th Floor, Westgate Business Bay, SG Highway, Ahmedabad, Gujarat 380051",
     "Neha Shah", "neha.shah@urbankart.in", "+91 98980 11223", "CRM-URB-1042"),
    ("FinEdge Payments Pvt Ltd", "FinEdge", "27AAECF3312K1Z8", "Maharashtra", "27",
     "One BKC, G Block, Bandra Kurla Complex, Mumbai, Maharashtra 400051",
     "Arjun Rao", "arjun.rao@finedge.in", "+91 98200 44556", "CRM-FIN-0871"),
    ("CloudKirana Retail Pvt Ltd", "CloudKirana", "29AAHCC8823P1Z2", "Karnataka", "29",
     "Prestige Towers, Residency Road, Bengaluru, Karnataka 560025",
     "Divya Hegde", "divya@cloudkirana.in", "+91 98450 77889", "CRM-CLK-0554"),
    ("MediServe Healthtech Pvt Ltd", "MediServe", "07AAFCM5541R1Z6", "Delhi", "07",
     "Okhla Industrial Estate Phase III, New Delhi 110020",
     "Sanjay Kapoor", "sanjay.k@mediserve.in", "+91 98110 33445", "CRM-MED-0912"),
    ("AgroLink Supply Chain Pvt Ltd", "AgroLink", "33AAICA2210M1Z4", "Tamil Nadu", "33",
     "Tidel Park, Rajiv Gandhi Salai, Chennai, Tamil Nadu 600113",
     "Meera Krishnan", "meera@agrolink.in", "+91 98410 66778", "CRM-AGR-0333"),
    ("BrightHire Staffing LLP", "BrightHire", "24AAHFB9931L1Z9", "Gujarat", "24",
     "Shivalik Plaza, Law Garden Road, Ahmedabad, Gujarat 380006",
     "Jay Patel", "jay@brighthire.in", "+91 97240 55667", "CRM-BRH-0720"),
    ("Zenith Realty Advisors Pvt Ltd", "Zenith", "27AAHCZ6618B1Z3", "Maharashtra", "27",
     "Senapati Bapat Marg, Lower Parel, Mumbai, Maharashtra 400013",
     "Farah Khan", "farah@zenithrealty.in", "+91 98330 88990", "CRM-ZEN-0288"),
    ("QuantumQA Labs Pvt Ltd", "QuantumQA", "29AAHCQ1177D1Z7", "Karnataka", "29",
     "Manyata Tech Park, Hebbal, Bengaluru, Karnataka 560045",
     "Vikram Shetty", "vikram@quantumqa.in", "+91 99010 22334", "CRM-QQA-0466"),
]

VENDORS = [
    ("NimbusCloud Infrastructure Pvt Ltd", "29AAHCN5520E1Z1", "Karnataka", "29",
     "Whitefield, Bengaluru, Karnataka 560066", "Rakesh Iyer", "billing@nimbuscloud.in", "+91 80411 22334"),
    ("MetroOffice Spaces Pvt Ltd", "24AAHCM8810F1Z4", "Gujarat", "24",
     "SG Highway, Ahmedabad, Gujarat 380015", "Bhavna Trivedi", "accounts@metrooffice.in", "+91 79400 55667"),
    ("LexCorp Legal Advisors", "27AAACL3345G1Z9", "Maharashtra", "27",
     "Fort, Mumbai, Maharashtra 400001", "Aditya Verma", "aditya@lexcorp.in", "+91 22220 88990"),
]

_counters = {}


def _num(kind: str, d: date) -> str:
    fy = fy_of(d)
    key = (kind, fy)
    _counters[key] = _counters.get(key, 0) + 1
    return f"{SERIES_PREFIX[kind]}/{fy}/{_counters[key]:04d}"


def _mk_invoice(cust, lines, inv_date: date, status, company, products, sub_id=None,
                due_days=15, paid_amount=0.0, doc_type="INV", ref_inv=None, reason=""):
    pos_code = cust["state_code"]
    computed = compute_document(lines, company["state_code"], pos_code)
    inv = {
        "id": new_id(), "doc_type": doc_type, "status": status,
        "invoice_no": None, "invoice_date": inv_date.isoformat(),
        "due_date": (inv_date + timedelta(days=due_days)).isoformat(),
        "customer_id": cust["id"],
        "customer_snapshot": {"legal_name": cust["legal_name"], "trade_name": cust.get("trade_name", ""),
                              "gstin": cust.get("gstin", ""), "billing_address": cust.get("billing_address", ""),
                              "state": cust["state"], "state_code": cust["state_code"],
                              "contact_email": cust.get("contact_email", "")},
        "place_of_supply": {"state": cust["state"], "code": cust["state_code"]},
        "pos_override_reason": "", "is_export_sez": False, "lut_flag": False, "reverse_charge": False,
        "subscription_id": sub_id, "reference_invoice_id": (ref_inv or {}).get("id"),
        "reference_invoice_no": (ref_inv or {}).get("invoice_no"), "reason": reason,
        "notes": "", "irn": None, "irn_qr": None, "tds_amount": 0,
        "created_by": "seed", "created_at": iso_now(),
    }
    inv.update(computed)
    if status != "draft":
        inv["invoice_no"] = _num(doc_type, inv_date)
        inv["branding_snapshot"] = company
        inv["approved_by"] = "seed"
        inv["approved_at"] = iso_now()
    inv["amount_paid"] = r2(paid_amount)
    inv["balance"] = r2(max(inv["grand_total"] - paid_amount, 0))
    if paid_amount > 0 and inv["balance"] <= 0.005:
        inv["status"] = "paid"
    elif paid_amount > 0:
        inv["status"] = "partially_paid"
    inv["sent_on"] = iso_now() if status in ("approved", "paid", "partially_paid") else None
    inv["send_status"] = "mocked" if inv["sent_on"] else None
    return inv


def _mk_payment(cust, pay_date: date, amount, inv_allocs, method="upi", ref="", bank_id=""):
    receipt_no = _num("RCP", pay_date)
    allocs = [{"invoice_id": inv["id"], "amount": r2(amt), "invoice_no": inv.get("invoice_no"),
               "invoice_date": inv.get("invoice_date")} for inv, amt in inv_allocs]
    return {"id": new_id(), "receipt_no": receipt_no, "customer_id": cust["id"],
            "customer_name": cust["legal_name"], "payment_date": pay_date.isoformat(),
            "amount": r2(amount), "method": method, "reference_no": ref,
            "bank_id": bank_id, "tds_amount": 0.0,
            "allocations": allocs, "unallocated": r2(amount - sum(a["amount"] for a in allocs)),
            "notes": "", "created_by": "seed", "created_at": iso_now()}


QA_DB_SUFFIXES = ("_qa", "_e2e", "_test")

COLLECTIONS = (
    "users", "company", "masters", "products", "customers", "subscriptions",
    "invoices", "payments", "vendors", "purchase_bills", "vendor_payments",
    "expense_vouchers", "number_series", "audit_logs", "periods", "email_log",
    "files", "login_attempts", "tickets", "ticket_messages",
    "org_roles", "menus", "role_menus", "projects", "tasks", "work_activity",
    "bank_accounts", "bank_ledger",
)


def _assert_qa_db():
    import os
    name = (os.environ.get("DB_NAME") or os.environ.get("MONGO_DATABASE") or "").strip()
    if not any(name.endswith(s) for s in QA_DB_SUFFIXES):
        raise RuntimeError(
            f"Refusing destructive seed: DB_NAME={name!r} must end with "
            f"{QA_DB_SUFFIXES} (e.g. techhind_finance_qa)"
        )


async def reset_qa_and_seed():
    """Drop QA collections and re-seed. Safety: DB_NAME must be *_qa|*_e2e|*_test."""
    _assert_qa_db()
    for name in COLLECTIONS:
        await db[name].drop()
    await seed_all(force=True)


async def ensure_bank_accounts():
    """Idempotent: create HDFC/ICICI/Cash if bank_accounts is empty."""
    if await db.bank_accounts.count_documents({}) > 0:
        return
    t = date.today()
    opening = (t - timedelta(days=120)).isoformat()
    bank_hdfc = {
        "id": new_id(), "account_type": "bank",
        "bank_name": "HDFC Bank", "account_name": "TechHind Pvt Ltd",
        "account_no": "50200088765432", "ifsc": "HDFC0001207",
        "branch": "SG Highway, Ahmedabad", "upi": "techhind@hdfcbank",
        "opening_balance": 0.0, "opening_date": opening,
        "primary": True, "is_active": True,
        "created_by": "seed", "created_at": iso_now(),
    }
    bank_icici = {
        "id": new_id(), "account_type": "bank",
        "bank_name": "ICICI Bank", "account_name": "TechHind Pvt Ltd",
        "account_no": "120405500998", "ifsc": "ICIC0001204",
        "branch": "Prahladnagar, Ahmedabad", "upi": "",
        "opening_balance": 0.0, "opening_date": opening,
        "primary": False, "is_active": True,
        "created_by": "seed", "created_at": iso_now(),
    }
    bank_cash = {
        "id": new_id(), "account_type": "cash",
        "bank_name": "Cash", "account_name": "TechHind Pvt Ltd",
        "account_no": "", "ifsc": "", "branch": "", "upi": "",
        "opening_balance": 0.0, "opening_date": opening,
        "primary": False, "is_active": True,
        "created_by": "seed", "created_at": iso_now(),
    }
    await db.bank_accounts.insert_many([bank_hdfc, bank_icici, bank_cash])


async def seed_all(force: bool = False):
    """Seed demo data on QA DBs only. Non-QA: RBAC + bank shells, never UrbanKart demo."""
    import os
    from rbac_seed import seed_rbac

    db_name = (os.environ.get("DB_NAME") or os.environ.get("MONGO_DATABASE") or "").strip()
    is_qa = any(db_name.endswith(s) for s in QA_DB_SUFFIXES)
    if not is_qa:
        if force:
            raise RuntimeError(
                f"Refusing seed_all(force) on non-QA database {db_name!r}. "
                "Use scripts.prod_bootstrap for production."
            )
        await seed_rbac()
        await ensure_bank_accounts()
        return

    if not force and await db.users.count_documents({}) > 0:
        await seed_rbac()
        await ensure_bank_accounts()
        # Upsert any missing demo org users (idempotent by email) — QA only
        for name, email, pw, role in USERS:
            existing = await db.users.find_one({"email": email})
            if existing:
                continue
            await db.users.insert_one({
                "id": new_id(), "name": name, "email": email,
                "password_hash": hash_password(pw), "role": role,
                "active": True, "totp_enabled": False, "created_at": iso_now(),
            })
        return

    # Users
    for name, email, pw, role in USERS:
        await db.users.insert_one({"id": new_id(), "name": name, "email": email,
                                   "password_hash": hash_password(pw), "role": role,
                                   "active": True, "totp_enabled": False, "created_at": iso_now()})

    # Company + masters
    await db.company.update_one({"id": "company"}, {"$set": COMPANY}, upsert=True)
    await db.masters.update_one({"id": "masters"}, {"$set": MASTERS}, upsert=True)

    # Products
    products = []
    for name, ptype, hsn, rate, price, cycle, desc in PRODUCTS:
        p = {"id": new_id(), "name": name, "type": ptype, "hsn_sac": hsn, "tax_rate": rate,
             "price": price, "billing_cycle": cycle, "unit": "Hour" if ptype == "service" else "Nos",
             "description": desc, "active": True, "created_at": iso_now()}
        products.append(p)
    await db.products.insert_many([dict(p) for p in products])
    pmap = {p["name"]: p for p in products}

    # Customers
    customers = []
    for ln, tn, gstin, state, code, addr, cname, cemail, cphone, crm in CUSTOMERS:
        c = {"id": new_id(), "legal_name": ln, "trade_name": tn, "gstin": gstin,
             "pan": gstin[2:12], "state": state, "state_code": code,
             "billing_address": addr, "shipping_address": addr,
             "contacts": [{"name": cname, "email": cemail, "phone": cphone}],
             "contact_email": cemail, "crm_tenant_key": crm, "notes": "", "created_at": iso_now()}
        customers.append(c)
    await db.customers.insert_many([dict(c) for c in customers])
    cmap = {c["trade_name"]: c for c in customers}

    t = date.today()

    # Bank accounts — HDFC (primary), ICICI, Cash
    bank_hdfc = {
        "id": new_id(), "account_type": "bank",
        "bank_name": "HDFC Bank", "account_name": "TechHind Pvt Ltd",
        "account_no": "50200088765432", "ifsc": "HDFC0001207",
        "branch": "SG Highway, Ahmedabad", "upi": "techhind@hdfcbank",
        "opening_balance": 250000.0,
        "opening_date": (t - timedelta(days=120)).isoformat(),
        "primary": True, "is_active": True,
        "created_by": "seed", "created_at": iso_now(),
    }
    bank_icici = {
        "id": new_id(), "account_type": "bank",
        "bank_name": "ICICI Bank", "account_name": "TechHind Pvt Ltd",
        "account_no": "120405500998", "ifsc": "ICIC0001204",
        "branch": "Prahladnagar, Ahmedabad", "upi": "",
        "opening_balance": 75000.0,
        "opening_date": (t - timedelta(days=120)).isoformat(),
        "primary": False, "is_active": True,
        "created_by": "seed", "created_at": iso_now(),
    }
    bank_cash = {
        "id": new_id(), "account_type": "cash",
        "bank_name": "Cash", "account_name": "TechHind Pvt Ltd",
        "account_no": "", "ifsc": "", "branch": "", "upi": "",
        "opening_balance": 15000.0,
        "opening_date": (t - timedelta(days=120)).isoformat(),
        "primary": False, "is_active": True,
        "created_by": "seed", "created_at": iso_now(),
    }
    await db.bank_accounts.insert_many([bank_hdfc, bank_icici, bank_cash])
    # Keep masters.banks in sync for expense picker legacy
    await db.masters.update_one({"id": "masters"}, {"$set": {"banks": [
        {"bank_name": b["bank_name"], "account_name": b["account_name"],
         "account_no": b["account_no"], "ifsc": b["ifsc"], "branch": b["branch"],
         "primary": b["primary"], "id": b["id"]}
        for b in (bank_hdfc, bank_icici)
    ]}})

    # Subscriptions
    def sub(cust_key, plan, status, start_off, renew_off, cycle=None, price=None):
        p = pmap[plan]
        cyc = cycle or p["billing_cycle"]
        pr = price if price is not None else p["price"]
        months = CYCLE_MONTHS.get(cyc, 1) or 1
        return {"id": new_id(), "customer_id": cmap[cust_key]["id"], "product_id": p["id"],
                "plan_name": plan, "status": status,
                "start_on": (t + timedelta(days=start_off)).isoformat(),
                "next_renewal_on": (t + timedelta(days=renew_off)).isoformat(),
                "billing_cycle": cyc, "price": pr, "mrr": r2(pr / months),
                "auto_renew": True, "notes": "", "created_at": iso_now()}

    subs = [
        sub("UrbanKart", "TH Cloud — Growth", "active", -310, 5),
        sub("FinEdge", "TH Cloud — Enterprise", "overdue", -220, -6),
        sub("CloudKirana", "TH Cloud — Starter", "active", -180, 12),
        sub("MediServe", "TH Cloud — Growth", "active", -150, 25),
        sub("AgroLink", "TH Cloud — Growth Annual", "active", -330, 40),
        sub("BrightHire", "TH Cloud — Starter", "grace", -95, 2),
        sub("QuantumQA", "TH Cloud — Growth", "trial", -12, 9),
        sub("Zenith", "Extra Storage Add-on (100 GB)", "paused", -200, 60),
    ]
    await db.subscriptions.insert_many([dict(s) for s in subs])

    company = COMPANY

    def L(desc, hsn, qty, rate, tax=18, unit="Nos", disc=0, pid=None):
        return {"description": desc, "product_id": pid, "hsn_sac": hsn, "qty": qty,
                "unit": unit, "rate": rate, "discount": disc, "tax_rate": tax}

    # Invoices
    i1 = _mk_invoice(cmap["UrbanKart"], [L("TH Cloud — Growth (May 2026)", "998314", 1, 12999, pid=pmap["TH Cloud — Growth"]["id"])],
                     t - timedelta(days=45), "approved", company, products, sub_id=subs[0]["id"], paid_amount=0)
    i1_full = i1["grand_total"]
    i1 = _mk_invoice(cmap["UrbanKart"], [L("TH Cloud — Growth (Apr 2026)", "998314", 1, 12999, pid=pmap["TH Cloud — Growth"]["id"])],
                     t - timedelta(days=45), "approved", company, products, sub_id=subs[0]["id"], paid_amount=0)
    # recompute paid flag properly below
    i1["amount_paid"] = i1["grand_total"]; i1["balance"] = 0.0; i1["status"] = "paid"

    i2 = _mk_invoice(cmap["FinEdge"], [L("TH Cloud — Enterprise (May 2026)", "998314", 1, 49999, pid=pmap["TH Cloud — Enterprise"]["id"]),
                                       L("Extra Storage Add-on (100 GB)", "998314", 2, 999, pid=pmap["Extra Storage Add-on (100 GB)"]["id"])],
                     t - timedelta(days=40), "approved", company, products, sub_id=subs[1]["id"])
    i2["amount_paid"] = r2(i2["grand_total"] / 2); i2["balance"] = r2(i2["grand_total"] - i2["amount_paid"]); i2["status"] = "partially_paid"

    i3 = _mk_invoice(cmap["CloudKirana"], [L("TH Cloud — Starter (May 2026)", "998314", 1, 4999, pid=pmap["TH Cloud — Starter"]["id"])],
                     t - timedelta(days=35), "approved", company, products, sub_id=subs[2]["id"])
    i3["amount_paid"] = i3["grand_total"]; i3["balance"] = 0.0; i3["status"] = "paid"

    i4 = _mk_invoice(cmap["MediServe"], [L("TH Cloud — Growth (Mar 2026)", "998314", 1, 12999, pid=pmap["TH Cloud — Growth"]["id"]),
                                         L("Consulting Services — data migration", "998313", 6, 2500, unit="Hour")],
                     t - timedelta(days=70), "approved", company, products)
    i4["amount_paid"] = i4["grand_total"]; i4["balance"] = 0.0; i4["status"] = "paid"

    i5 = _mk_invoice(cmap["BrightHire"], [L("TH Cloud — Starter (Jun 2026)", "998314", 1, 4999, pid=pmap["TH Cloud — Starter"]["id"])],
                     t - timedelta(days=20), "approved", company, products, sub_id=subs[5]["id"], due_days=15)

    i6 = _mk_invoice(cmap["AgroLink"], [L("TH Cloud — Growth Annual (2026-27)", "998314", 1, 129990, pid=pmap["TH Cloud — Growth Annual"]["id"])],
                     t - timedelta(days=32), "approved", company, products, sub_id=subs[4]["id"], due_days=30)
    i6["amount_paid"] = i6["grand_total"]; i6["balance"] = 0.0; i6["status"] = "paid"

    i7 = _mk_invoice(cmap["QuantumQA"], [L("TH Cloud — Growth (Jun 2026 — trial conversion)", "998314", 1, 12999, pid=pmap["TH Cloud — Growth"]["id"])],
                     t - timedelta(days=3), "draft", company, products, sub_id=subs[6]["id"])

    i8 = _mk_invoice(cmap["UrbanKart"], [L("Implementation & Onboarding", "998315", 1, 75000, pid=pmap["Implementation & Onboarding"]["id"]),
                                         L("Consulting Services — workflow setup", "998313", 10, 2500, unit="Hour")],
                     t - timedelta(days=10), "approved", company, products, due_days=15)

    i9 = _mk_invoice(cmap["FinEdge"], [L("TH Cloud — Enterprise (Jun 2026)", "998314", 1, 49999, pid=pmap["TH Cloud — Enterprise"]["id"])],
                     t - timedelta(days=1), "draft", company, products, sub_id=subs[1]["id"])

    cn1 = _mk_invoice(cmap["UrbanKart"], [L("Credit: onboarding discount adjustment", "998315", 1, 5000)],
                      t - timedelta(days=2), "draft", company, products, doc_type="CN",
                      ref_inv=i8, reason="Post-sale goodwill discount on onboarding")

    invoices = [i1, i2, i3, i4, i5, i6, i7, i8, i9, cn1]
    await db.invoices.insert_many([dict(i) for i in invoices])

    # Payments
    hdfc_id = bank_hdfc["id"]
    payments = [
        _mk_payment(cmap["UrbanKart"], t - timedelta(days=38), i1["grand_total"], [(i1, i1["grand_total"])], "neft", "UTR88412209", hdfc_id),
        _mk_payment(cmap["FinEdge"], t - timedelta(days=25), i2["amount_paid"], [(i2, i2["amount_paid"])], "rtgs", "RTGS221045", hdfc_id),
        _mk_payment(cmap["CloudKirana"], t - timedelta(days=30), i3["grand_total"], [(i3, i3["grand_total"])], "upi", "UPI-9931442", hdfc_id),
        _mk_payment(cmap["MediServe"], t - timedelta(days=62), i4["grand_total"], [(i4, i4["grand_total"])], "neft", "UTR77210034", hdfc_id),
        _mk_payment(cmap["AgroLink"], t - timedelta(days=28), i6["grand_total"], [(i6, i6["grand_total"])], "neft", "UTR90012218", hdfc_id),
        _mk_payment(cmap["FinEdge"], t - timedelta(days=4), 10000, [], "upi", "UPI-1188230", hdfc_id),
    ]
    await db.payments.insert_many([dict(p) for p in payments])

    # Vendors + purchase bills
    vendors = []
    for name, gstin, state, code, addr, cname, cemail, cphone in VENDORS:
        v = {"id": new_id(), "name": name, "gstin": gstin, "pan": gstin[2:12], "state": state,
             "state_code": code, "address": addr, "contact_name": cname, "contact_email": cemail,
             "contact_phone": cphone, "created_at": iso_now()}
        vendors.append(v)
    await db.vendors.insert_many([dict(v) for v in vendors])

    def bill(v, bill_no, bill_off, lines, itc=True, status="posted", paid=0.0, due_days=30):
        computed = compute_document(lines, company["state_code"], v["state_code"])
        b = {"id": new_id(), "vendor_id": v["id"],
             "vendor_snapshot": {"name": v["name"], "gstin": v["gstin"], "state": v["state"],
                                 "state_code": v["state_code"]},
             "bill_no": bill_no, "bill_date": (t + timedelta(days=bill_off)).isoformat(),
             "due_date": (t + timedelta(days=bill_off + due_days)).isoformat(),
             "itc_eligible": itc, "notes": "", "status": status,
             "created_by": "seed", "created_at": iso_now()}
        b.update(computed)
        b["amount_paid"] = r2(paid)
        b["balance"] = r2(max(b["grand_total"] - paid, 0))
        if paid > 0 and b["balance"] <= 0.005:
            b["status"] = "paid"
        elif paid > 0:
            b["status"] = "partially_paid"
        return b

    b1 = bill(vendors[0], "NC-2026-1187", -50, [L("AWS-equivalent cloud hosting (Apr 2026)", "998314", 1, 42000)], paid=0)
    b1["amount_paid"] = b1["grand_total"]; b1["balance"] = 0.0; b1["status"] = "paid"
    b2 = bill(vendors[0], "NC-2026-1293", -20, [L("Cloud hosting (May 2026)", "998314", 1, 45500)])
    b3 = bill(vendors[1], "MO-INV-0442", -15, [L("Office rent (Jun 2026)", "997212", 1, 85000)], itc=False)
    b4 = bill(vendors[2], "LC-2026-0091", -45, [L("Contract review — MSA renewals", "998211", 1, 30000)], paid=0)
    b4["amount_paid"] = r2(b4["grand_total"] / 2); b4["balance"] = r2(b4["grand_total"] - b4["amount_paid"]); b4["status"] = "partially_paid"
    b5 = bill(vendors[0], "NC-2026-1401", -2, [L("Cloud hosting (Jun 2026)", "998314", 1, 46200)], status="draft")
    bills = [b1, b2, b3, b4, b5]
    await db.purchase_bills.insert_many([dict(b) for b in bills])

    vpay1 = {"id": new_id(), "payment_ref": _num("VP", t - timedelta(days=42)),
             "vendor_id": vendors[0]["id"], "vendor_name": vendors[0]["name"],
             "payment_date": (t - timedelta(days=42)).isoformat(), "amount": b1["grand_total"],
             "method": "neft", "reference_no": "UTR55129011", "bank_id": hdfc_id,
             "allocations": [{"bill_id": b1["id"], "amount": b1["grand_total"], "bill_no": b1["bill_no"]}],
             "unallocated": 0.0, "notes": "", "created_by": "seed", "created_at": iso_now()}
    vpay2 = {"id": new_id(), "payment_ref": _num("VP", t - timedelta(days=30)),
             "vendor_id": vendors[2]["id"], "vendor_name": vendors[2]["name"],
             "payment_date": (t - timedelta(days=30)).isoformat(), "amount": b4["amount_paid"],
             "method": "neft", "reference_no": "UTR55129877", "bank_id": hdfc_id,
             "allocations": [{"bill_id": b4["id"], "amount": b4["amount_paid"], "bill_no": b4["bill_no"]}],
             "unallocated": 0.0, "notes": "", "created_by": "seed", "created_at": iso_now()}
    await db.vendor_payments.insert_many([vpay1, vpay2])

    # Expense vouchers
    def voucher(vdate_off, category, narration, amount, tax, status, vendor_name="", vtype="expense",
                paid_via="HDFC Bank", bank_id=None):
        d = t + timedelta(days=vdate_off)
        tax_amt = r2(amount * tax / 100)
        v = {"id": new_id(), "voucher_no": None, "voucher_date": d.isoformat(), "category": category,
             "narration": narration, "amount": amount, "tax_rate": tax, "tax_amount": tax_amt,
             "total": r2(amount + tax_amt), "vendor_name": vendor_name, "paid_via": paid_via,
             "bank_id": bank_id or hdfc_id,
             "type": vtype, "status": status, "attachments": [], "created_by": "seed",
             "created_at": iso_now()}
        if status == "posted":
            v["voucher_no"] = _num("EV", d)
            v["approved_by"] = "seed"; v["approved_at"] = iso_now()
        return v

    vouchers = [
        voucher(-35, "Salaries (Monthly Summary)", "Payroll summary — Apr 2026 (14 employees)", 850000, 0, "posted", vtype="salary_summary"),
        voucher(-8, "Salaries (Monthly Summary)", "Payroll summary — May 2026 (14 employees)", 850000, 0, "posted", vtype="salary_summary"),
        voucher(-28, "Statutory Payments", "GST payment for Apr 2026 — GSTR-3B", 142350, 0, "posted"),
        voucher(-18, "Marketing & Ads", "Google Ads + LinkedIn campaign (May)", 60000, 18, "posted", vendor_name="Google India Pvt Ltd"),
        voucher(-5, "Travel", "Client visit — Bengaluru (CloudKirana onboarding)", 18450, 0, "pending_approval"),
        voucher(-2, "Software Licenses", "Figma + JetBrains annual renewals", 96000, 18, "pending_approval", vendor_name="Figma Inc"),
        voucher(-1, "Office Supplies", "Ergonomic chairs × 4", 32000, 18, "draft", vendor_name="Urban Ladder"),
    ]
    await db.expense_vouchers.insert_many([dict(v) for v in vouchers])

    # Persist number-series counters
    for (kind, fy), count in _counters.items():
        await db.number_series.update_one({"kind": kind, "fy": fy},
                                          {"$set": {"next_seq": count + 1}}, upsert=True)

    # Periods — current FY months; one closed sample two months ago
    fy_start_year = t.year if t.month >= 4 else t.year - 1
    closed_month = (t.replace(day=1) - timedelta(days=45)).strftime("%Y-%m")
    periods = []
    for i in range(12):
        m = 4 + i
        y = fy_start_year if m <= 12 else fy_start_year + 1
        mo = m if m <= 12 else m - 12
        month = f"{y}-{mo:02d}"
        state = "closed" if month == closed_month else "open"
        periods.append({
            "month": month, "state": state, "updated_at": iso_now(),
            "history": [{"state": state, "at": iso_now(), "by": "seed"}] if state == "closed" else [],
        })
    if periods:
        await db.periods.insert_many(periods)

    # Debit note draft (inter-state FinEdge) for DN flow testing
    dn1 = _mk_invoice(
        cmap["FinEdge"],
        [L("Debit: late payment interest adjustment", "998314", 1, 2500)],
        t - timedelta(days=1), "draft", company, products, doc_type="DN",
        ref_inv=i2, reason="Interest on overdue balance",
    )
    await db.invoices.insert_one(dict(dn1))

    # TDS payment sample (allocated with tds_amount credit)
    tds_pay = _mk_payment(
        cmap["BrightHire"], t - timedelta(days=10), r2(i5["grand_total"] * 0.9),
        [(i5, r2(i5["grand_total"] * 0.9))], "neft", "UTR-TDS-9011", hdfc_id,
    )
    tds_pay["tds_amount"] = r2(i5["grand_total"] * 0.1)
    tds_pay["unallocated"] = 0.0
    i5["amount_paid"] = i5["grand_total"]
    i5["balance"] = 0.0
    i5["status"] = "paid"
    await db.invoices.update_one({"id": i5["id"]}, {"$set": {
        "amount_paid": i5["amount_paid"], "balance": 0.0, "status": "paid",
    }})
    await db.payments.insert_one(tds_pay)
    payments.append(tds_pay)

    # Bank ledger lines for seeded money movements
    import bank_ledger as bl
    for p in payments:
        await bl.post_payment_receipt(p)
    for vp in (vpay1, vpay2):
        await bl.post_vendor_payment(vp)
    for v in vouchers:
        if v["status"] == "posted":
            await bl.post_expense_voucher(v)

    await db.audit_logs.insert_one({"id": new_id(), "ts": iso_now(), "user_id": "seed",
                                    "user_name": "System", "role": "admin", "action": "seeded",
                                    "entity_type": "system", "entity_id": "seed",
                                    "summary": "Demo dataset seeded (customers, catalog, subscriptions, invoices, payments, bills, vouchers, periods, DN, TDS, bank ledger)",
                                    "diff": {}})
    await seed_rbac()


if __name__ == "__main__":
    import argparse
    import asyncio
    import sys

    parser = argparse.ArgumentParser(description="TechHind Finance seed")
    parser.add_argument("--reset-qa", action="store_true",
                        help="Drop QA DB collections and re-seed (DB_NAME must end _qa/_e2e/_test)")
    args = parser.parse_args()
    if not args.reset_qa:
        print("Usage: python -m seed --reset-qa", file=sys.stderr)
        sys.exit(2)

    async def _run():
        await reset_qa_and_seed()
        print("QA seed complete")

    asyncio.run(_run())
