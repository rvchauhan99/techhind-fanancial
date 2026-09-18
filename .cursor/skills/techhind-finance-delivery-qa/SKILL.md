---
name: techhind-finance-delivery-qa
description: >-
  TechHind Company Finance delivery and QA standards. Enforces
  inspect-plan-implement-verify-document-signoff, verification tiers, and GST
  invariants. Use when completing any feature or bugfix in techhind-fanancial.
---

# TechHind Finance Delivery QA

## When to use

Apply on **every** development task in this repo before marking work complete.

## Lifecycle

1. **Inspect** — Read matching annex under `reference/`; match existing patterns.
2. **Plan** — Scope, files, risks (money, GST, period lock, RBAC).
3. **Implement** — Minimal correct diff; no placeholders.
4. **Verify** — Pick tier in [reference/testing.md](reference/testing.md).
5. **Document** — Cases run, skipped + reason, evidence.
6. **Sign-off** — [sign-off-template.md](sign-off-template.md); block if Critical incomplete.

## Local environment

See [reference/runbook.md](reference/runbook.md). Default: API `http://127.0.0.1:8000`, web `http://localhost:3000`.

## Read by task

| Task | Annex |
|------|-------|
| Billing / payments / GST | [gst-invariants.md](reference/gst-invariants.md), [business-flow.md](reference/business-flow.md) |
| New route / collection | [module-map.md](reference/module-map.md), [technical-flow.md](reference/technical-flow.md) |
| UI / layout | [design.md](reference/design.md) |
| Finish / QA | [testing.md](reference/testing.md), [case-catalog.md](reference/case-catalog.md) |

After code changes that alter flows/routes/collections, run **techhind-finance-context-sync**.

## Completion message

```
Test tier: <Smoke|Standard|Critical|Regression>
Cases run: <IDs>
Skipped: <IDs + reason>
Evidence: <routes, API, screenshot notes>
```
