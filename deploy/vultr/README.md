# TechHind Finance — Vultr backend deploy

**Scope:** FastAPI on Vultr only. **No MongoDB on Vultr** — Atlas credentials in `backend/.env` / `.env.production`. Frontend on Vercel (`admin.techhind.in`).

## Hosts

| Host | Role |
|------|------|
| `api.techhind.in` | Shared **Caddy** (calling-crm stack) → host `:8010` |
| `admin.techhind.in` | Vercel (CRA) |

This VPS already binds **443** to Caddy and **80** to another Docker app. Do **not** install host nginx/certbot for this API — TLS terminates at shared Caddy (`caddy-api.techhind.in.conf` appended to `/opt/calling-crm/deploy/Caddyfile`). There is no nginx site template in this repo.

Default SSH: `mealhq-vultr` → `root@139.84.223.174`.

App path: `/opt/techhind-finance/` (uvicorn `0.0.0.0:8010`). UFW must allow `8010/tcp` so Docker Caddy can reach the host API.

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
./deploy/vultr/deploy.sh mealhq-vultr
```

CI sets `SKIP_ENV_SYNC=1` so the VPS `.env` is never overwritten from GitHub Actions.

## CI/CD (GitHub Actions → Vultr)

Workflow: [`.github/workflows/deploy-backend.yml`](../../.github/workflows/deploy-backend.yml)

**Triggers:** push to `main` when `backend/**`, `deploy/vultr/**`, or the workflow file changes; also **workflow_dispatch**.

### One-time: SSH deploy key on the VPS

```bash
# On your laptop (or CI secrets store) — generate a dedicated key if you do not already have one:
ssh-keygen -t ed25519 -f techhind-finance-deploy -C "github-actions-techhind-finance" -N ""

# Append the PUBLIC key on Vultr:
ssh mealhq-vultr 'mkdir -p ~/.ssh && chmod 700 ~/.ssh'
ssh mealhq-vultr "echo '$(cat techhind-finance-deploy.pub)' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

### GitHub repo secrets / variables

Repo → **Settings → Secrets and variables → Actions**

| Name | Type | Notes |
|------|------|--------|
| `VULTR_SSH_PRIVATE_KEY` | **Secret** (required) | Same name as [mealhq-api](https://github.com/rvchauhan99/mealhq-api); private key whose public half is on `root@139.84.223.174` |
| `VULTR_HOST` | Variable (optional) | Defaults to `139.84.223.174` |
| `VULTR_USER` | Variable (optional) | Defaults to `root` |
| `VULTR_HEALTH_URL` | Variable (optional) | Defaults to `https://api.techhind.in/health` |

Do **not** put Mongo/JWT/Brevo secrets in Actions — they stay in `/opt/techhind-finance/backend/.env` on the server.

Workflow matches mealhq-api: `webfactory/ssh-agent` + `SKIP_ENV_SYNC=1` so remote `.env` is never overwritten.

### Verify after first run

```bash
# Actions → Deploy backend to Vultr → green
curl -sS https://api.techhind.in/health
curl -sS https://api.techhind.in/ready
```

## DNS

1. `api.techhind.in` **A** → `139.84.223.174` (or Cloudflare orange-cloud + Full SSL).
2. `admin.techhind.in` → Vercel.

If Cloudflare Full (strict) fails ACME, switch the Caddy block to `tls internal` like `api.mealhq.ca`.

## Atlas Network Access (required)

Mongo is **Atlas only**. From this VPS, Atlas currently rejects connections until the IP is allowlisted:

1. Atlas → Network Access → **Add IP Address**
2. Enter `139.84.223.174/32` (Vultr public IP for `mealhq-vultr`)
3. Confirm, wait ~1 minute, then:

```bash
ssh mealhq-vultr 'systemctl restart techhind-finance'
curl -sS http://127.0.0.1:8010/ready   # on server
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
