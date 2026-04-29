#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-trading-bot-pro}"
WEB_ROOT="${WEB_ROOT:-./public}"

echo "Installing dependencies..."
npm install

echo "Running tests..."
npm test

if npm run | grep -q " build"; then
  echo "Running build..."
  npm run build
else
  echo "No build step configured; dashboard is standalone HTML."
fi

echo "Preparing dashboard..."
mkdir -p "${WEB_ROOT}"
test -f public/dashboard.html

if command -v pm2 >/dev/null 2>&1; then
  echo "Starting ${APP_NAME} with pm2..."
  pm2 start server.js --name "${APP_NAME}" --update-env || pm2 restart "${APP_NAME}" --update-env
else
  echo "pm2 is not installed. Starting with node in the foreground."
  echo "Install pm2 later with: npm install -g pm2"
  node server.js
fi
