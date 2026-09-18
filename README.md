# TechHind Company Finance

Standalone GST finance platform for TechHind Pvt Ltd (INR, FY Apr–Mar).

## Stack

- **Backend:** FastAPI + MongoDB (Motor) — `backend/`
- **Frontend:** React (CRA/craco) + Tailwind + shadcn — `frontend/`

## Local development

```bash
# MongoDB on 127.0.0.1:27017

cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # if present; or create .env with MONGO_URL, DB_NAME, JWT_SECRET
uvicorn server:app --reload --host 127.0.0.1 --port 8000

cd frontend
yarn install   # or npm install
# set REACT_APP_BACKEND_URL=http://127.0.0.1:8000 in frontend/.env
yarn start
```

| Service | URL |
|---------|-----|
| API | http://127.0.0.1:8000 |
| Web | http://localhost:3000 |

Storage: Cloudflare R2 when `BUCKET_*` is set; otherwise `backend/.local_storage`.  
Email: Brevo when configured; otherwise mocked in `email_log`.

## Agent / Cursor

See [AGENTS.md](AGENTS.md) and `.cursor/skills/techhind-finance-delivery-qa/`.

## Docs

- [docs/PRD.md](docs/PRD.md)
- [docs/E2E-SIGN-OFF.md](docs/E2E-SIGN-OFF.md)
- [docs/design-guidelines.json](docs/design-guidelines.json)
- Auth playbook: [auth_testing.md](auth_testing.md) (credentials in gitignored `memory/test_credentials.md`)

## Tests

```bash
python tests/e2e_critical_api.py
python tests/e2e_browser_walk.py
```
