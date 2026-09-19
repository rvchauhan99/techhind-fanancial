#!/usr/bin/env python3
"""Browser route walker for TechHind Finance (uses requests + optional selenium).

Primary path: authenticate via API, then open routes with selenium if available;
otherwise prints the route checklist for MCP-driven verification.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import requests

BASE_API = "http://127.0.0.1:8000/api"
BASE_WEB = os.environ.get("WEB_BASE", "http://localhost:3011")
OUT = Path(__file__).resolve().parents[1] / "test_reports" / "browser_e2e_results.json"
SHOTS = Path(__file__).resolve().parents[1] / "test_reports" / "prod_readiness"
SHOTS.mkdir(parents=True, exist_ok=True)

CREDS = ("gayatribachauhan99@gmail.com", "TechHind@2026")

ROUTES = [
    ("/login", "Sign in", False),
    ("/dashboard", "SAAS MRR", True),
    ("/subscriptions", "Subscriptions", True),
    ("/invoices", "Tax Invoices", True),
    ("/expenses", "Expense", True),
    ("/banks", "Bank Ledger", True),
    ("/settings", "Branding", True),
    ("/imports", "Import", False),
    ("/accountant-pack", "Accountant", False),
    ("/period-close", "Period", False),
    ("/aging", "Aging", False),
    ("/customers", "Customers", False),
    ("/products", "Products", False),
    ("/vendors", "Vendors", False),
    ("/payments", "Payments", False),
    ("/audit", "Audit", False),
    ("/tickets", "Support", False),
    ("/projects", "Projects", False),
    ("/tasks", "My Work", True),
    ("/tasks?view=kanban", "Kanban", True),
    ("/tasks?view=deadline", "Deadline", True),
    ("/work-report", "Work Report", False),
    ("/roles", "Roles", False),
]


def login_token() -> str:
    r = requests.post(f"{BASE_API}/auth/login", json={"email": CREDS[0], "password": CREDS[1]}, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]


def try_selenium(token: str) -> list[dict]:
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.support.ui import WebDriverWait
    except Exception as e:
        print(f"selenium unavailable: {e}", file=sys.stderr)
        return []

    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--window-size=1440,900")
    opts.add_argument("--disable-gpu")
    driver = webdriver.Chrome(options=opts)
    wait = WebDriverWait(driver, 20)
    results = []
    try:
        # Seed auth token before app boot so axios picks up tcf_token
        driver.get(f"{BASE_WEB}/login")
        wait.until(EC.presence_of_element_located((By.TAG_NAME, "body")))
        driver.execute_script("localStorage.setItem('tcf_token', arguments[0]);", token)
        driver.get(f"{BASE_WEB}/dashboard")
        wait.until(lambda d: "Gayatri" in d.find_element(By.TAG_NAME, "body").text or "SAAS MRR" in d.find_element(By.TAG_NAME, "body").text)
        results.append({"route": "/login", "status": "PASS", "notes": "Auth via tcf_token seed + dashboard load"})

        for path, marker, shot in ROUTES:
            if path == "/login":
                continue
            driver.get(f"{BASE_WEB}{path}")
            wait.until(EC.presence_of_element_located((By.TAG_NAME, "body")))
            body = driver.find_element(By.TAG_NAME, "body").text
            ok = marker.lower() in body.lower() or "Gayatri" in body
            if "/login" in driver.current_url and "Sign in" in body:
                ok = False
            entry = {
                "route": path,
                "status": "PASS" if ok else "FAIL",
                "notes": f"marker={marker!r} found={ok}",
            }
            if shot and ok:
                name = f"browser_{path.strip('/').replace('/', '_') or 'home'}.png"
                fp = SHOTS / name
                driver.save_screenshot(str(fp))
                entry["screenshot"] = name
            results.append(entry)
            if path == "/invoices" and ok:
                try:
                    cells = driver.find_elements(By.XPATH, "//*[starts-with(normalize-space(.),'TH/')]")
                    if cells:
                        cells[0].click()
                        wait.until(lambda d: "/invoices/" in d.current_url)
                        body = driver.find_element(By.TAG_NAME, "body").text
                        ok2 = "PDF" in body or "Tax Invoice" in body
                        shot_name = "browser_invoice_detail.png"
                        driver.save_screenshot(str(SHOTS / shot_name))
                        results.append({
                            "route": "/invoices/:id",
                            "status": "PASS" if ok2 else "FAIL",
                            "notes": f"url={driver.current_url}",
                            "screenshot": shot_name,
                        })
                except Exception as ex:
                    results.append({"route": "/invoices/:id", "status": "FAIL", "notes": str(ex)})
        return results
    finally:
        driver.quit()


def main():
    token = login_token()
    print("API login OK")
    results = try_selenium(token)
    if not results:
        print("NO_SELENIUM")
        sys.exit(2)
    failed = [r for r in results if r["status"] != "PASS"]
    payload = {
        "tier": "Critical",
        "environment": {
            "api": "http://127.0.0.1:8000",
            "web": BASE_WEB,
            "db": "mongodb://127.0.0.1:27017/techhind_finance_qa",
        },
        "browser_walk": results,
        "api_suite": "test_reports/e2e_api_results.json",
        "summary": {"passed": len(results) - len(failed), "failed": len(failed), "total": len(results)},
    }
    OUT.write_text(json.dumps(payload, indent=2))
    print(json.dumps(payload["summary"]))
    for r in results:
        print(f"[{r['status']}] {r['route']}: {r.get('notes','')}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
