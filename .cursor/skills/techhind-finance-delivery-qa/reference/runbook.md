# Local runbook

## Ports

| Service | URL |
|---------|-----|
| API | `http://127.0.0.1:8000` |
| Web | `http://localhost:3000` (fallback `PORT=3011` if busy) |
| MongoDB | `mongodb://127.0.0.1:27017` |
| QA DB name | `techhind_finance_qa` |

## Start

```bash
# Mongo must be running locally
# Money QA / prod: use replica set (required when REQUIRE_MONGO_TRANSACTIONS=true)
docker compose -f docker-compose.mongo-rs.yml up -d

cd backend
source .venv/bin/activate
# macOS WeasyPrint: export DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib
uvicorn server:app --reload --host 127.0.0.1 --port 8000

cd frontend
PORT=3011 REACT_APP_BACKEND_URL=http://127.0.0.1:8000 npm start
```

## Makefile QA

```bash
make health      # mongo + storage backend + email
make seed-qa    # destructive reseed (QA DB suffix required)
make test-api
WEB_BASE=http://localhost:3011 make test-browser
make load-all   # requires k6
```

## Env files (names only — never commit secrets)

See `backend/.env.example`.

- `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `FRONTEND_URL` (comma-separated origins OK)
- `SECURE_COOKIES=false` for local HTTP; `true` + HTTPS in production
- `REQUIRE_MONGO_TRANSACTIONS=true` (or `ENV=production`) — fail-closed; no silent non-atomic fallback
- `PDF_MAX_CONCURRENCY=2` (WeasyPrint process semaphore)
- Storage: `BUCKET_*` → R2; else local FS
- Email: `BREVO_*`; mock if unset

## Production gate (money traffic)

1. Mongo replica set ON
2. `REQUIRE_MONGO_TRANSACTIONS=true`
3. `SECURE_COOKIES=true` + HTTPS
4. WeasyPrint system libs installed
5. `/ready` shows `storage=r2`
6. Critical suite green (incl. AUTH-AUDIT-01, INV-CONCUR-01, INV-PAY-DEL-01, AUD-01, AUD-ACT-01, OPS-IMPORT-PAY-01)
7. Audit rows always include actor + IP + timestamp

## Credentials

Gitignored: `memory/test_credentials.md`.

## Production cutover (go-live)

Do **not** run `make seed-qa` / `seed_all(force=True)` against production (`techhind_finance`). `seed_all` only loads demo data when `DB_NAME`/`MONGO_DATABASE` ends with `_qa`/`_e2e`/`_test`.

```bash
cd backend
export ALLOW_PROD_BOOTSTRAP=1 PROD_ADMIN_PASSWORD='…'
# First time after a demo seed on the same DB:
python -m scripts.prod_bootstrap --purge-demo
# Clean empty DB:
# python -m scripts.prod_bootstrap

# Place files under backend/cutover/ (gitignored except README.md)
python -m scripts.cutover_import --dry-run
python -m scripts.cutover_import --commit
# Assert: HDFC live_balance == 209174.04
```

See `backend/cutover/README.md`.

## PDF / system libs

WeasyPrint needs Homebrew pango/glib. On Apple Silicon, ensure `/opt/homebrew/lib` is on `DYLD_FALLBACK_LIBRARY_PATH` (also set in `server.py`). Cap concurrency with `PDF_MAX_CONCURRENCY`. See `docs/PROD-READINESS-SIGN-OFF.md`.

## Ops endpoints

- `GET /health` — liveness
- `GET /ready` — mongo + storage + email provider flags
- `GET /api/audit` — admin + accountant only
- `GET /api/activity?entity_type=&entity_id=` — entity activity history (same RBAC)
- Support tickets: `/tickets` (Finance inbox). Solar bridge: `SUPPORT_SERVICE_KEY` + `/api/integrations/support/*`
- Solar flag: `SUPPORT_TICKETS_ENABLED=false` until QA — see solar-api `.env.example`
