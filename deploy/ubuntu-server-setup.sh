#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-shopeeAI}"
APP_DIR="${APP_DIR:-/opt/shopeeAI}"
REPO_URL="${REPO_URL:-https://github.com/huynhlongdai/shopeeAI.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-8787}"
HOST="${HOST:-0.0.0.0}"
NODE_MAJOR="${NODE_MAJOR:-20}"
API_TOKEN="${API_TOKEN:-}"
FACEBOOK_PUBLISH_MODE="${FACEBOOK_PUBLISH_MODE:-draft}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root."
  exit 1
fi

if [ -z "${API_TOKEN}" ]; then
  if command -v openssl >/dev/null 2>&1; then
    API_TOKEN="$(openssl rand -hex 32)"
  else
    API_TOKEN="$(date +%s)-change-this-token"
  fi
fi

echo "Installing system packages..."
apt-get update
apt-get install -y ca-certificates curl git ufw

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -Eq "^v${NODE_MAJOR}\\."; then
  echo "Installing Node.js ${NODE_MAJOR}..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

echo "Installing app into ${APP_DIR}..."
if [ -d "${APP_DIR}/.git" ]; then
  git -C "${APP_DIR}" fetch origin "${BRANCH}"
  git -C "${APP_DIR}" checkout "${BRANCH}"
  git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"
else
  mkdir -p "$(dirname "${APP_DIR}")"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
fi

cd "${APP_DIR}"
npm ci --omit=dev

cat > "${APP_DIR}/.env" <<ENV
PORT=${PORT}
HOST=${HOST}
API_TOKEN=${API_TOKEN}
SHOPEE_BROWSER_HEADLESS=true
SHOPEE_BROWSER_CHANNEL=chrome
SHOPEE_USER_DATA_DIR=.shopee-browser
SHOPEE_CUSTOM_LINK_URL=https://affiliate.shopee.vn/offer/custom_link
SHOPEE_HOME_URL=https://shopee.vn/
EXTENSION_JOB_TIMEOUT_MS=600000
SHOPEEAI_DATA_DIR=.shopeeai-data
PRODUCT_CACHE_TTL_MS=10800000
PRODUCT_STATIC_CACHE_TTL_MS=86400000
OFFER_CACHE_TTL_MS=3600000
AFFILIATE_CACHE_TTL_MS=1209600000
PROFILE_COOLDOWN_BASE_MS=30000
FACEBOOK_PUBLISH_MODE=${FACEBOOK_PUBLISH_MODE}
ENV

cat > /etc/systemd/system/shopeeai.service <<SERVICE
[Unit]
Description=shopeeAI API server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable shopeeai
systemctl restart shopeeai

if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null || true
  ufw allow "${PORT}/tcp" >/dev/null || true
fi

sleep 2
echo
echo "Service status:"
systemctl --no-pager --full status shopeeai || true
echo
echo "Local health check:"
curl -fsS "http://127.0.0.1:${PORT}/health"
echo
echo
echo "Done."
echo "Admin UI: http://$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}'):${PORT}/admin/"
echo "API Base for extension: http://<server-ip>:${PORT}"
echo "API Token: ${API_TOKEN}"
