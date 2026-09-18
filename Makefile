# TechHind Company Finance — local QA scripts
.PHONY: help test-api test-browser seed-qa health load-auth load-all

API_DIR=backend
PY=$(API_DIR)/.venv/bin/python

help:
	@echo "Targets: health | seed-qa | test-api | test-browser | load-auth | load-all"

health:
	cd $(API_DIR) && .venv/bin/python scripts/health_probe.py

seed-qa:
	cd $(API_DIR) && .venv/bin/python -m seed --reset-qa

test-api:
	$(PY) tests/e2e_critical_api.py

test-browser:
	$(PY) tests/e2e_browser_walk.py

load-auth:
	k6 run tests/load/auth_login.js

load-all:
	mkdir -p test_reports/load
	k6 run --summary-export=test_reports/load/auth_login.json tests/load/auth_login.js
	k6 run --summary-export=test_reports/load/invoice_list_dashboard.json tests/load/invoice_list_dashboard.js
	k6 run --summary-export=test_reports/load/invoice_pdf.json tests/load/invoice_pdf.js
	k6 run --summary-export=test_reports/load/payment_post.json tests/load/payment_post.js
	k6 run --summary-export=test_reports/load/r2_upload.json tests/load/r2_upload.js
