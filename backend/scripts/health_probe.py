#!/usr/bin/env python3
"""QA health probe — Mongo ping, storage backend, email provider. No secrets printed."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")


async def main() -> int:
    from core import client, db
    import storage
    import email_service

    ok = True
    try:
        await client.admin.command("ping")
        print(f"mongo: ok db={os.environ.get('DB_NAME')}")
    except Exception as exc:
        print(f"mongo: FAIL {exc}")
        ok = False

    try:
        storage.init_storage()
        backend = storage.active_backend()
        print(f"storage: {backend}")
        if backend not in ("r2", "local"):
            print("storage: FAIL unexpected backend")
            ok = False
    except Exception as exc:
        print(f"storage: FAIL {exc}")
        ok = False

    print(
        f"email: provider={email_service.active_provider()} "
        f"configured={email_service.is_configured()}"
    )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
