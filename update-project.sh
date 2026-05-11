#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Updating shopeeAI..."

if [ ! -d ".git" ]; then
  echo "This folder is not a git repository."
  exit 1
fi

git fetch --all --prune
git pull --ff-only

if [ -f "package-lock.json" ]; then
  npm install
else
  npm install
fi

echo
echo "Update complete."
echo "Restart the API with: ./start-server.sh"
echo "Reload the Chrome extension at chrome://extensions if extension files changed."
