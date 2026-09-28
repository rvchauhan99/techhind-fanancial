# Technical flow — TechHind Company Finance

## Stack

| Layer | Tech |
|-------|------|
| API | FastAPI + Pydantic + Motor (MongoDB), JWT (httpOnly cookies + Bearer), bcrypt, TOTP (pyotp) |
| PDF | WeasyPrint + qrcode (mock IRN) |
| Storage | Cloudflare R2 (`BUCKET_*`) or local FS (`LOCAL_STORAGE_DIR`, default `backend/.local_storage`) |
| Email | Brevo SMTP (`BREVO_USER` + `BREVO_MASTER_KEY`) or API (`BREVO_API_KEY`); mock when unset |
| Web | React 19 + CRA/craco + Tailwind + shadcn/Radix + recharts + axios + TanStack Query |

## Backend layout (flat — not Nest modules)

| File | Role |
|------|------|
| `backend/server.py` | FastAPI app, CORS, router mount |
| `backend/core.py` | DB, JWT, RBAC, numbering, period lock, audit (+ IP contextvar), `run_in_transaction` fail-closed |
| `backend/gst.py` | GST engine + INR words |
| `backend/pdf.py` | Branded PDF |
| `backend/storage.py` | R2 → local FS |
| `backend/email_service.py` | Brevo or mock |
| `backend/notifications.py` | Per-user inbox fan-out and due-reminder claim |
| `backend/seed.py` | Demo / seed data |
| `backend/routers/*.py` | auth, settings, catalog, billing, payables, banks, dashboard, periods, reports, imports, tickets, rbac, work, notifications |
| `backend/bank_ledger.py` | Bank statement engine (post/reverse/running balance) |

## Frontend layout

| Path | Role |
|------|------|
| `frontend/src/App.js` | Routes |
| `frontend/src/lib/api.js` | Axios client |
| `frontend/src/context/AuthContext.jsx` | Auth state |
| `frontend/src/components/Layout.jsx` | Dense left nav, renewals strip, notification bell |
| `frontend/src/pages/*` | Feature pages |

## Local ports

| Service | URL |
|---------|-----|
| API | `http://127.0.0.1:8000` (`/api/...`) |
| Web | `http://localhost:3000` |
| Mongo | `mongodb://127.0.0.1:27017` — DB from `DB_NAME` |

## Not this repo

Do **not** copy TechHind Solar patterns: NestJS modules, tenant migrations, port `5142`, multi-tenant keys.
