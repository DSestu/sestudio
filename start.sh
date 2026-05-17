#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
uv sync
uv run python -m fstream_dl serve "$@"
