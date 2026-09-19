#!/usr/bin/env python3
"""Production bootstrap — company, masters, products, 1 admin, RBAC, banks, periods.

No demo customers/invoices. Refuses if users already exist (unless --force).

Requires:
  ALLOW_PROD_BOOTSTRAP=1
  PROD_ADMIN_PASSWORD=<strong password>
  MONGO_URL|MONGO_URI + DB_NAME|MONGO_DATABASE
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

ADMIN_EMAIL = (os.environ.get("PROD_ADMIN_EMAIL") or "ravat@techhind.in").strip().lower()
ADMIN_NAME = (os.environ.get("PROD_ADMIN_NAME") or "Ravatrajsinh Chauhan").strip()
HDFC_OPENING_DATE = "2026-02-18"

# Transactional / demo collections cleared by --purge-demo (not company/masters)
PURGE_COLLECTIONS = (
    "users", "customers", "subscriptions", "invoices", "payments",
    "vendors", "purchase_bills", "vendor_payments", "expense_vouchers",
    "number_series", "audit_logs", "periods", "email_log", "files",
    "login_attempts", "tickets", "ticket_messages", "notifications",
    "projects", "tasks", "work_activity", "bank_accounts", "bank_ledger",
    "products", "revoked_refresh",
)


async def purge_demo() -> None:
    from core import db
    for name in PURGE_COLLECTIONS:
        await db[name].drop()
        print(f"  dropped {name}")


async def bootstrap(*, force: bool = False, purge: bool = False) -> None:
    if (os.environ.get("ALLOW_PROD_BOOTSTRAP") or "").strip() != "1":
        raise SystemExit("Refusing: set ALLOW_PROD_BOOTSTRAP=1")

    password = (os.environ.get("PROD_ADMIN_PASSWORD") or "").strip()
    if len(password) < 10:
        raise SystemExit("Refusing: PROD_ADMIN_PASSWORD must be set (min 10 chars)")

    from core import db, hash_password, new_id, iso_now
    from indexes import ensure_indexes
    from rbac_seed import seed_rbac
    from seed import COMPANY, MASTERS, PRODUCTS

    if purge:
        print("Purging transactional/demo collections…")
        await purge_demo()
        force = True

    user_count = await db.users.count_documents({})
    if user_count > 0 and not force:
        raise SystemExit(
            f"Refusing: {user_count} user(s) already exist. Pass --force to re-run "
            "(or --purge-demo to wipe demo money/CRM and re-bootstrap)."
        )

    await ensure_indexes()

    await db.company.update_one({"id": "company"}, {"$set": COMPANY}, upsert=True)
    await db.masters.update_one({"id": "masters"}, {"$set": MASTERS}, upsert=True)

    for name, ptype, hsn, rate, price, cycle, desc in PRODUCTS:
        existing = await db.products.find_one({"name": name}, {"_id": 0})
        if existing:
            continue
        await db.products.insert_one({
            "id": new_id(), "name": name, "type": ptype, "hsn_sac": hsn, "tax_rate": rate,
            "price": price, "billing_cycle": cycle,
            "unit": "Hour" if ptype == "service" else "Nos",
            "description": desc, "active": True, "created_at": iso_now(),
        })

    if force or purge:
        await db.users.delete_many({"email": {"$ne": ADMIN_EMAIL}})

    admin = await db.users.find_one({"email": ADMIN_EMAIL})
    if admin:
        await db.users.update_one(
            {"email": ADMIN_EMAIL},
            {"$set": {
                "name": ADMIN_NAME, "role": "admin", "active": True,
                "password_hash": hash_password(password),
            }},
        )
        admin_id = admin["id"]
    else:
        admin_id = new_id()
        await db.users.insert_one({
            "id": admin_id, "name": ADMIN_NAME, "email": ADMIN_EMAIL,
            "password_hash": hash_password(password), "role": "admin",
            "active": True, "totp_enabled": False, "created_at": iso_now(),
        })

    await seed_rbac()

    if await db.bank_accounts.count_documents({}) == 0:
        await db.bank_accounts.insert_many([
            {
                "id": new_id(), "account_type": "bank",
                "bank_name": "HDFC Bank", "account_name": "TechHind Pvt Ltd",
                "account_no": "50200088765432", "ifsc": "HDFC0001207",
                "branch": "SG Highway, Ahmedabad", "upi": "techhind@hdfcbank",
                "opening_balance": 0.0, "opening_date": HDFC_OPENING_DATE,
                "primary": True, "is_active": True,
                "created_by": "prod_bootstrap", "created_at": iso_now(),
            },
            {
                "id": new_id(), "account_type": "bank",
                "bank_name": "ICICI Bank", "account_name": "TechHind Pvt Ltd",
                "account_no": "120405500998", "ifsc": "ICIC0001204",
                "branch": "Prahladnagar, Ahmedabad", "upi": "",
                "opening_balance": 0.0, "opening_date": HDFC_OPENING_DATE,
                "primary": False, "is_active": True,
                "created_by": "prod_bootstrap", "created_at": iso_now(),
            },
            {
                "id": new_id(), "account_type": "cash",
                "bank_name": "Cash", "account_name": "TechHind Pvt Ltd",
                "account_no": "", "ifsc": "", "branch": "", "upi": "",
                "opening_balance": 0.0, "opening_date": HDFC_OPENING_DATE,
                "primary": False, "is_active": True,
                "created_by": "prod_bootstrap", "created_at": iso_now(),
            },
        ])
    else:
        await db.bank_accounts.update_one(
            {"bank_name": "HDFC Bank", "primary": True},
            {"$set": {"opening_balance": 0.0, "opening_date": HDFC_OPENING_DATE}},
        )

    months = [
        f"{y}-{m:02d}"
        for y, m in [
            (2026, 2), (2026, 3), (2026, 4), (2026, 5), (2026, 6),
            (2026, 7), (2026, 8), (2026, 9), (2026, 10), (2026, 11),
            (2026, 12), (2027, 1), (2027, 2), (2027, 3),
        ]
    ]
    for month in months:
        existing = await db.periods.find_one({"month": month})
        if existing:
            if existing.get("state") != "open":
                await db.periods.update_one(
                    {"month": month},
                    {"$set": {"state": "open", "updated_at": iso_now()},
                     "$push": {"history": {"state": "open", "at": iso_now(), "by": "prod_bootstrap"}}},
                )
            continue
        await db.periods.insert_one({
            "month": month, "state": "open", "updated_at": iso_now(),
            "history": [{"state": "open", "at": iso_now(), "by": "prod_bootstrap"}],
        })

    await db.audit_logs.insert_one({
        "id": new_id(), "ts": iso_now(), "user_id": admin_id,
        "user_name": ADMIN_NAME, "role": "admin", "action": "prod_bootstrap",
        "entity_type": "system", "entity_id": "bootstrap",
        "summary": "Production bootstrap (company, masters, products, 1 admin, banks, periods)",
        "diff": {"force": force, "purge": purge},
    })

    users = await db.users.count_documents({})
    products = await db.products.count_documents({})
    banks = await db.bank_accounts.count_documents({})
    periods = await db.periods.count_documents({})
    customers = await db.customers.count_documents({})
    print(f"prod_bootstrap ok: users={users} products={products} banks={banks} "
          f"periods={periods} customers={customers}")
    print(f"admin={ADMIN_EMAIL}")


def main() -> None:
    parser = argparse.ArgumentParser(description="TechHind Finance production bootstrap")
    parser.add_argument("--force", action="store_true",
                        help="Allow re-run when users already exist")
    parser.add_argument("--purge-demo", action="store_true",
                        help="Drop transactional/demo collections then bootstrap clean")
    args = parser.parse_args()
    asyncio.run(bootstrap(force=args.force, purge=args.purge_demo))


if __name__ == "__main__":
    main()
