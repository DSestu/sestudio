#!/usr/bin/env bash
# Rebuild frontend/dist, which the running server serves.
set -euo pipefail
cd "$(dirname "$0")/frontend"
# First run, or a pull that changed dependencies: install them.
if [ ! -x node_modules/.bin/vite ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci
fi
npm run build
