#!/usr/bin/env python3
"""Build backend/.env.production from backend/.env with prod overrides. Never commits."""
from __future__ import annotations

import re
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend" / ".env"
OUT = ROOT / "backend" / ".env.production"

OVERRIDES = {
    "ENV": "production",
    "REQUIRE_MONGO_TRANSACTIONS": "true",
    "SECURE_COOKIES": "true",
    "FRONTEND_URL": "https://admin.techhind.in",
}


def main() -> int:
    if not SRC.exists():
        print(f"Missing {SRC}", file=sys.stderr)
        return 1
    lines = SRC.read_text().splitlines()
    keys_seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        raw = line.strip()
        if not raw or raw.startswith("#"):
            out.append(line)
            continue
        if "=" not in raw:
            out.append(line)
            continue
        key, _, val = raw.partition("=")
        key = key.strip()
        keys_seen.add(key)
        if key in OVERRIDES:
            out.append(f"{key}={OVERRIDES[key]}")
        elif key == "JWT_SECRET" and (
            not val.strip() or "change-me" in val.lower() or val.strip() == "tcf-e2e-local-jwt-secret-change-me"
        ):
            out.append(f"JWT_SECRET={secrets.token_urlsafe(48)}")
            print("Generated new JWT_SECRET for production")
        else:
            out.append(line)
    for k, v in OVERRIDES.items():
        if k not in keys_seen:
            out.append(f"{k}={v}")
    # Ensure MONGO aliases for core.py
    text = "\n".join(out) + "\n"
    if "MONGO_URL=" not in text and "MONGO_URI=" in text:
        m = re.search(r"^MONGO_URI=(.*)$", text, re.M)
        if m:
            text += f"MONGO_URL={m.group(1)}\n"
    if "DB_NAME=" not in text and "MONGO_DATABASE=" in text:
        m = re.search(r"^MONGO_DATABASE=(.*)$", text, re.M)
        if m:
            text += f"DB_NAME={m.group(1)}\n"
    OUT.write_text(text)
    OUT.chmod(0o600)
    print(f"Wrote {OUT} (gitignored via *.env / .env.*)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
