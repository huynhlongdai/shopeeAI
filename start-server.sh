#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

PORT="${PORT:-8787}"

echo "shopeeAI API"
echo "Workspace: $(pwd)"
echo "Port: ${PORT}"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed or not available in PATH."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "node_modules not found. Installing dependencies..."
  npm install
fi

PIDS="$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)"
if [ -n "${PIDS}" ]; then
  echo "Port ${PORT} is already used by process id(s): ${PIDS}"
  printf "Stop old server and restart? [y/N] "
  read -r ANSWER
  case "${ANSWER}" in
    y|Y|yes|YES)
      echo "${PIDS}" | xargs kill
      sleep 1
      ;;
    *)
      echo "Cancelled. Open http://127.0.0.1:${PORT}/health to check the existing server."
      exit 0
      ;;
  esac
fi

echo "Starting API at http://127.0.0.1:${PORT}"
echo "Health check: http://127.0.0.1:${PORT}/health"
echo
npm start
