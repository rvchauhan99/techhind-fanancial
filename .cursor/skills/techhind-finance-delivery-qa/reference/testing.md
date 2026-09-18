# Testing — TechHind Company Finance

## Tiers

| Tier | When | Minimum |
|------|------|---------|
| Smoke | Copy, labels, filters | Page loads; one happy path; no console/API errors |
| Standard | CRUD, new fields | API + UI form/list |
| Critical | Money, GST, period, RBAC, storage | `tests/e2e_critical_api.py` (affected IDs) + browser route |
| Regression | Shared gst/core/numbering | Full **47** API + 16 browser walk |

## Runners

| Suite | Command | Artifacts |
|-------|---------|-----------|
| Health | `make health` | stdout mongo/storage/email |
| QA reseed | `make seed-qa` | requires `DB_NAME` ending `_qa`/`_e2e`/`_test` |
| API Critical | `make test-api` | `test_reports/e2e_api_results.json` |
| Browser walk | `WEB_BASE=http://localhost:3011 make test-browser` | `test_reports/browser_e2e_results.json` |
| Load k6 | `make load-all` | `test_reports/load/*.json` |

Case IDs: [case-catalog.md](case-catalog.md). Prod sign-off: `docs/PROD-READINESS-SIGN-OFF.md`.

## Browser MCP

- Prefer `http://localhost:3011` if `:3000` is Solar or otherwise busy
- Credentials: `memory/test_credentials.md` (gitignored)
- Start API (`:8000`) and web before claiming UI verified

## Completion message

```
Test tier: <Smoke|Standard|Critical|Regression>
Cases run: <IDs>
Skipped: <IDs + reason>
Evidence: <routes, API responses, screenshot notes>
```

## Deferred forever until NIC

Real NIC e-invoice (IRN/QR) — mock only.
