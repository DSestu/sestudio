#!/usr/bin/env bash
# Ephemeral live preview of the current worktree.
#   preview.sh            frontend dev server (HMR), /api -> live server
#   preview.sh --backend  also run this worktree's backend on a copy of the live config + DB
#   preview.sh --stop     stop this worktree's preview
# Each worktree gets its own fixed port, so several previews can run side by side.
set -euo pipefail

MAIN=/mnt/d/projets_python_ssd/Sencrop/perso/fstream_downloader
LIVE_CFG=/mnt/c/Users/david/.config/sestudio
ROOT=$(git rev-parse --show-toplevel)
NAME=$(basename "$ROOT")
PORT=$((5200 + $(printf %s "$ROOT" | cksum | cut -d' ' -f1) % 100))
API_PORT=$((PORT + 100))
STATE=/tmp/sestudio-preview/$NAME
mkdir -p "$STATE"

stop() {
  for f in "$STATE"/*.pid; do
    [ -e "$f" ] || continue
    pid=$(cat "$f"); rm -f "$f"
    kill -- -"$pid" 2>/dev/null || continue
    # a busy worker thread can outlive SIGTERM and keep the port
    for _ in 1 2 3 4 5 6; do kill -0 -- -"$pid" 2>/dev/null || continue 2; sleep 0.5; done
    kill -9 -- -"$pid" 2>/dev/null || true
  done
}

if [ "${1:-}" = --stop ]; then stop; rm -rf "$STATE"; echo "stopped $NAME"; exit 0; fi
stop

if [ "$ROOT" = "$MAIN" ]; then
  echo "main checkout: node_modules is Windows-installed, run the preview from a worktree" >&2; exit 1
fi

API=https://localhost:8443
if [ "${1:-}" = --backend ]; then
  # Copy, never share: the live server owns its config and DB (see CLAUDE.md "Live server").
  "$MAIN/.venv/bin/python" - "$LIVE_CFG" "$STATE" <<'PY'
import json, re, shutil, sys
src, dst = sys.argv[1:]
c = json.load(open(f"{src}/config.json", encoding="utf-8"))
c["output_root"] = f"{dst}/downloads"
c["notifications_enabled"] = False  # the live config texts the user's phone
win = lambda p: re.sub(r"^([A-Za-z]):\\", lambda m: f"/mnt/{m[1].lower()}/", p).replace("\\", "/")
for lib in c.get("music_libraries", []):
    if "path" in lib: lib["path"] = win(lib["path"])
json.dump(c, open(f"{dst}/config.json", "w"), indent=2)
for ext in ("", "-wal"):  # sqlite's read-only open fails on drvfs, so copy the files
    try: shutil.copyfile(f"{src}/library.db{ext}", f"{dst}/library.db{ext}")
    except FileNotFoundError: pass
PY
  (cd "$ROOT" && PYTHONPATH=src SESTUDIO_WATCHERS=0 SESTUDIO_CONFIG="$STATE/config.json" \
    SESTUDIO_DB="$STATE/library.db" setsid "$MAIN/.venv/bin/python" -m sestudio serve \
    --http-port "$API_PORT" --no-https --no-resolve >"$STATE/backend.log" 2>&1 & echo $! >"$STATE/backend.pid")
  API=http://localhost:$API_PORT
fi

cd "$ROOT/frontend"
[ -d node_modules ] || npm ci --silent
POLL=; case "$ROOT" in /mnt/*) POLL=1 ;; esac
SESTUDIO_API=$API VITE_POLL=$POLL setsid npx vite --host 0.0.0.0 --port "$PORT" --strictPort \
  >"$STATE/vite.log" 2>&1 & echo $! >"$STATE/vite.pid"

for _ in $(seq 60); do curl -s -o /dev/null "http://localhost:$PORT" && break; sleep 0.5; done
# WSL runs in mirrored networking, so the Windows LAN address is local here too.
LAN=$(ip -4 route get "$(ip -4 route show default | awk 'NR==1{print $3}')" 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="src") print $(i+1)}' || true)
TS=$(tailscale ip -4 2>/dev/null | head -1 || true)
echo "preview $NAME: http://localhost:$PORT${LAN:+  phone: http://$LAN:$PORT}${TS:+  tailscale: http://$TS:$PORT}  api: $API"
echo "logs: $STATE/{vite,backend}.log"
