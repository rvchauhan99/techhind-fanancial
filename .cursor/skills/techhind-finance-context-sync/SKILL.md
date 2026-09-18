---
name: techhind-finance-context-sync
description: >-
  Keeps TechHind Finance agent knowledge annexes current after code changes.
  Use after features that change routes, collections, RBAC, GST rules, UI flows,
  or when AGENTS.md is marked stale.
---

# Finance context sync

## Goal

Avoid full-repo re-scans. Patch annexes; bump `AGENTS.md` last-synced.

## When

Before sign-off, if any of these changed:

- API routers / web routes
- Mongo collections or field contracts
- RBAC matrix
- GST / numbering / period lock rules
- Storage / email / PDF behaviour
- Dense UI patterns or required `data-testid`s

## Steps

1. Identify which annex under `.cursor/skills/techhind-finance-delivery-qa/reference/` applies.
2. **Patch** that annex (add/remove rows) — do not rewrite from scratch.
3. If a new module appeared → add a row to `module-map.md`.
4. Update `AGENTS.md` last-synced date + one-line changelog.
5. Full resync (re-read PRD + tree) only when user asks or INDEX is stale.

## Do not

- Put secrets in annexes
- Reintroduce Emergent platform paths (`.emergent/`, preview hosts)
- Copy Solar Nest/tenant patterns into this repo's docs
