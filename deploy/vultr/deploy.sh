#!/usr/bin/env bash
# Deploy TechHind Finance backend to the AIC Cloud VPS (no Mongo — Atlas only).
# systemd uvicorn on 127.0.0.1:8010. Host Caddy terminates TLS for api.techhind.in.
# Usage: ./deploy/vultr/deploy.sh [user@host]
# Env: SKIP_ENV_SYNC=1  — never overwrite remote .env (used by GitHub Actions)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REMOTE="${1:-${TECHHIND_SSH:-aic-finance}}"
APP_ROOT="/opt/techhind-finance"
BACKEND_REMOTE="${APP_ROOT}/backend"

echo "==> Deploy target: ${REMOTE}"
echo "==> Local repo: ${ROOT}"

ssh "${REMOTE}" "mkdir -p ${BACKEND_REMOTE} ${APP_ROOT}/venv"

echo "==> Rsync backend"
rsync -az --delete \
  --exclude '.venv/' \
  --exclude 'venv/' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  --exclude '.local_storage/' \
  --exclude 'cutover/*.csv' \
  --exclude 'cutover/*.xlsx' \
  --exclude '.env' \
  --exclude '.env.production' \
  "${ROOT}/backend/" "${REMOTE}:${BACKEND_REMOTE}/"

if [[ "${SKIP_ENV_SYNC:-0}" == "1" ]]; then
  echo "==> SKIP_ENV_SYNC=1 — remote .env left unchanged"
elif [[ -f "${ROOT}/backend/.env.production" ]]; then
  echo "==> Sync .env.production → remote .env"
  rsync -az "${ROOT}/backend/.env.production" "${REMOTE}:${BACKEND_REMOTE}/.env"
  ssh "${REMOTE}" "chmod 600 ${BACKEND_REMOTE}/.env; chown www-data:www-data ${BACKEND_REMOTE}/.env || true"
else
  echo "WARN: no backend/.env.production — remote .env left unchanged"
fi

echo "==> Install WeasyPrint system libs if missing (no Mongo)"
ssh "${REMOTE}" bash -s <<'EOF'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip \
  libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 libffi-dev \
  shared-mime-info fonts-dejavu-core >/dev/null
id www-data >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin www-data
EOF

echo "==> venv + requirements"
ssh "${REMOTE}" bash -s <<EOF
set -euo pipefail
cd ${APP_ROOT}
if [[ ! -x venv/bin/python ]]; then
  python3 -m venv venv
fi
venv/bin/pip install -q --upgrade pip
venv/bin/pip install -q -r backend/requirements.txt
chown -R www-data:www-data ${APP_ROOT}
EOF

echo "==> systemd unit"
rsync -az "${ROOT}/deploy/vultr/techhind-finance.service" "${REMOTE}:/tmp/techhind-finance.service"
ssh "${REMOTE}" "cp /tmp/techhind-finance.service /etc/systemd/system/techhind-finance.service && systemctl daemon-reload && systemctl enable techhind-finance.service && systemctl restart techhind-finance.service"

echo "==> Ensure Caddy site for api.techhind.in"
rsync -az "${ROOT}/deploy/vultr/caddy-api.techhind.in.conf" "${REMOTE}:/tmp/caddy-api.techhind.in.conf"
ssh "${REMOTE}" bash -s <<EOF
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
caddyfile = Path("/etc/caddy/Caddyfile")
snippet = Path("/tmp/caddy-api.techhind.in.conf").read_text().strip() + "\n"
text = caddyfile.read_text() if caddyfile.exists() else ""
if "auto_https disable_redirects" not in text:
    text = "{\n\tauto_https disable_redirects\n}\n\n" + text
if "api.techhind.in" not in text:
    if text and not text.endswith("\n"):
        text += "\n"
    text += "\n" + snippet
    print("Appended api.techhind.in")
else:
    print("Caddy already has api.techhind.in")
caddyfile.write_text(text)
PY
systemctl reload caddy
sleep 2
systemctl --no-pager status techhind-finance.service | head -15
curl -sS -o /dev/null -w "local_health=%{http_code}\n" http://127.0.0.1:8010/health || true
curl -sS http://127.0.0.1:8010/ready || true
echo
EOF

echo "==> Done."
echo "    DNS: api.techhind.in A → 178.92.120.191"
echo "    Atlas: allowlist 178.92.120.191/32"
echo "    Vercel: REACT_APP_BACKEND_URL=https://api.techhind.in"
