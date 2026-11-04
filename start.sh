#!/usr/bin/env bash
set -euo pipefail
# Rebuild the frontend first, so the server serves the current source.
"$(dirname "$0")/build.sh"
uvx --with-editable ".[station]" sestudio serve "$@"
