# TechHind Finance — backend deploy

**Scope:** FastAPI on the AIC Cloud VPS. **No MongoDB on the VPS** — Atlas credentials in `backend/.env` / `.env.production`. Frontend on Vercel (`admin.techhind.in`).

## Hosts

| Host | Role |
|------|------|
| `api.techhind.in` | Host **Caddy** on `178.92.120.191` → `127.0.0.1:8010` |
| `admin.techhind.in` | Vercel (CRA) |

Caddy listens on **443** only. Public port **80** is Jweller. Do not bind the API on `0.0.0.0`.

Default SSH: `aic-finance` → `root@178.92.120.191`.

App path: `/opt/techhind-finance/` (uvicorn `127.0.0.1:8010`).

## Env (local, never commit)

```bash
python3 deploy/vultr/make_prod_env.py
# writes backend/.env.production with:
#   ENV=production
#   REQUIRE_MONGO_TRANSACTIONS=true
#   SECURE_COOKIES=true
#   FRONTEND_URL=https://admin.techhind.in
#   MONGO_* / BUCKET_* / BREVO_* from backend/.env (Atlas)
```

## Deploy (local)

```bash
chmod +x deploy/vultr/deploy.sh
./deploy/vultr/deploy.sh aic-finance
```

CI sets `SKIP_ENV_SYNC=1` so the VPS `.env` is never overwritten from GitHub Actions.

## CI/CD (GitHub Actions → AIC Cloud)

Workflow: [`.github/workflows/deploy-backend.yml`](../../.github/workflows/deploy-backend.yml)

**Triggers:** push to `main` when `backend/**`, `deploy/vultr/**`, or the workflow file changes; also **workflow_dispatch**.

### One-time: SSH deploy key on the VPS

```bash
# On your laptop (or CI secrets store) — generate a dedicated key if you do not already have one:
ssh-keygen -t ed25519 -f techhind-finance-deploy -C "github-actions-techhind-finance" -N ""

# Append the PUBLIC key on the VPS:
ssh aic-finance 'mkdir -p ~/.ssh && chmod 700 ~/.ssh'
ssh aic-finance "echo '$(cat techhind-finance-deploy.pub)' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

### GitHub repo secrets / variables

Repo → **Settings → Secrets and variables → Actions**

| Name | Type | Notes |
|------|------|--------|
| `VULTR_SSH_PRIVATE_KEY` | **Secret** (required) | Public half is on `root@178.92.120.191` (`github-actions-mealhq-vultr`) |
| `VULTR_HOST` | Variable | `178.92.120.191` |
| `VULTR_USER` | Variable (optional) | Defaults to `root` |
| `VULTR_HEALTH_URL` | Variable (optional) | Defaults to `https://api.techhind.in/health` |

Do **not** put Mongo/JWT/Brevo secrets in Actions — they stay in `/opt/techhind-finance/backend/.env` on the server.

Workflow matches mealhq-api: `webfactory/ssh-agent` + `SKIP_ENV_SYNC=1` so remote `.env` is never overwritten.

### Verify after first run

```bash
# Actions → Deploy techhind-finance to Vultr → green
curl -sS https://api.techhind.in/health
curl -sS https://api.techhind.in/ready
```

## DNS

1. `api.techhind.in` **A** → `178.92.120.191`.
2. `admin.techhind.in` → Vercel.

## Atlas Network Access (required)

Mongo is **Atlas only**. Allow the VPS egress address:

1. Atlas → Network Access → **Add IP Address**
2. Enter `178.92.120.191/32`
3. Confirm, wait ~1 minute, then:

```bash
ssh aic-finance 'systemctl restart techhind-finance'
curl -sS http://127.0.0.1:8010/ready
```

Without this step, uvicorn stays stuck or `/ready` fails with SSL / server selection errors.

## Vercel

| Env | Value |
|-----|--------|
| `REACT_APP_BACKEND_URL` | `https://api.techhind.in` |

No trailing slash. Redeploy after setting.

## Smoke

```bash
curl -sS http://127.0.0.1:8010/health   # on server
curl -sS https://api.techhind.in/health
curl -sS https://api.techhind.in/ready
```
