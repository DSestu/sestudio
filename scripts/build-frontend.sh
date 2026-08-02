#!/usr/bin/env bash
# Rebuild the frontend and stage the result.
#
# frontend/dist is committed (so git-installs and `uv build` work without npm)
# but generated, so it goes stale the moment frontend sources change. This runs
# from a pre-commit hook whenever those sources are touched.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm is not on PATH, so frontend/dist cannot be rebuilt." >&2
  echo "       Build it yourself and stage the result:" >&2
  echo "         npm --prefix frontend run build && git add frontend/dist" >&2
  echo "       Or skip this hook with: SKIP=frontend-build git commit ..." >&2
  exit 1
fi

npm --prefix frontend run build
git add frontend/dist
