# AGENTS.md — techhind-fanancial

**TechHind Company Finance (TCF)** — standalone single-company GST finance app (INR, FY Apr–Mar, series `TH/{FY}/{SEQ}`).

**Last synced:** 2026-10-01 — Tasks default hide Done; list/board sort by priority then status; `include_done` toggle. Prior: Tasks list/board/deadline accept `priority` filter; list shows Priority column. Prior: Task workflow adds Testing Rejected and Ready to Live, plus a Business Analyst role and `ba_id`. QA, BA, or a work manager signs off; writers complete only from Ready to Live. Prior: task and ticket attachments accept `.md`.

## Not Solar CRM

FastAPI + Mongo + CRA. Ports **8000** / **3000** (web often **3011** locally). No Nest modules, no tenant migrations, no `5142`.

## Mandatory skills

1. `.cursor/skills/techhind-finance-delivery-qa/SKILL.md` before marking work complete
2. `.cursor/skills/techhind-finance-context-sync/SKILL.md` after route/collection/GST/UI changes
3. `.cursor/skills/techhind-finance-testing/SKILL.md` when choosing verification tier

## Local

| Service | URL |
|---------|-----|
| API | `http://127.0.0.1:8000` |
| Web | `http://localhost:3000` (or `:3011`) |
| Mongo | `mongodb://127.0.0.1:27017` |
| QA DB | `techhind_finance_qa` |

Credentials: gitignored `memory/test_credentials.md` only.

## Read-next (do not full-scan the repo)

| Task | Open |
|------|------|
| Billing / GST / payments | `reference/gst-invariants.md` + `business-flow.md` |
| New route / collection | `reference/module-map.md` + `technical-flow.md` |
| UI | `reference/design.md` |
| Finish / QA | `reference/testing.md` + `case-catalog.md` |
| How to run | `reference/runbook.md` |
| Prod readiness | `docs/PROD-READINESS-SIGN-OFF.md` |

Annexes live under `.cursor/skills/techhind-finance-delivery-qa/reference/`.

## Stale if

- New router/page/collection not listed in `module-map.md`
- GST/period/RBAC behaviour changed without annex patch
- User asks for full context resync

## Hard stops

- NIC e-invoice is mock — do not claim live IRN
- Never commit `.env`, `memory/test_credentials.md`, or passwords in docs
- No Emergent preview hosts or `.emergent/` platform metadata

## Canonical product docs

- `docs/PRD.md`
- `docs/design-guidelines.json`
- `docs/PROD-READINESS-SIGN-OFF.md`
- `docs/DB-INDEX-REVIEW.md`
- `docs/LOAD-RESULTS.md`
- `docs/E2E-SIGN-OFF.md` (historical)
