#!/usr/bin/env python3
"""Idempotent: upsert Solar CRM list-price catalog SKUs and hard-delete demo leftovers.

Does not touch subscriptions or invoices. Safe for prod.

  python -m scripts.cutover_add_list_plans --dry-run
  python -m scripts.cutover_add_list_plans --commit
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

from scripts.cutover_fix_plans import PROD_PRODUCTS  # noqa: E402

KEEP_NAMES = {p["name"] for p in PROD_PRODUCTS}


async def main(commit: bool):
    from core import db, new_id, iso_now

    for spec in PROD_PRODUCTS:
        existing = await db.products.find_one({"name": spec["name"]}, {"_id": 0})
        if existing:
            if commit:
                await db.products.update_one({"id": existing["id"]}, {"$set": {**spec}})
            action = "updated" if commit else "would_update"
        else:
            doc = {**spec, "id": new_id(), "created_at": iso_now()}
            if commit:
                await db.products.insert_one(doc)
            action = "created" if commit else "would_create"
        print(
            f"{action}: {spec['name']} price={spec['price']} "
            f"cycle={spec['billing_cycle']} incl_gst={spec['price_includes_gst']}"
        )

    demos = await db.products.find(
        {"name": {"$nin": list(KEEP_NAMES)}}, {"_id": 0, "id": 1, "name": 1}
    ).to_list(500)
    for d in demos:
        refs = await db.subscriptions.count_documents({"product_id": d["id"]})
        if refs:
            print(f"skip delete (sub refs={refs}): {d['name']}")
            continue
        if commit:
            await db.products.delete_one({"id": d["id"]})
        print(f"{'deleted' if commit else 'would_delete'}: {d['name']}")

    print("done" if commit else "dry-run complete (no writes)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    commit = bool(args.commit) and not args.dry_run
    asyncio.run(main(commit))
