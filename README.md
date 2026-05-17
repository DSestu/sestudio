# fstream-dl

Download episodes from fstream — via CLI or a local web UI.

## Requirements

- Python 3.11+
- [uv](https://github.com/astral-sh/uv)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) in `PATH`
- Node 18+ (only needed to rebuild the frontend)

## Install

```bash
uv sync
```

## Usage

### CLI — download a season

```bash
# All episodes, VF (default)
uv run fstream-dl download <season-page-url>

# Specific episodes, VOSTFR, custom output folder
uv run fstream-dl download <url> -e 1,3,5-8 --lang vostfr -o ~/Videos

# Dry-run: resolve URLs without downloading
uv run fstream-dl download <url> --dry-run
```

| Option | Default | Description |
|---|---|---|
| `-e`, `--episodes` | all | Episodes to download, e.g. `1,3,5-8` |
| `--lang` | `vf` | Language (`vf` or `vostfr`) |
| `-o`, `--output` | `.` | Output directory |
| `-c`, `--concurrency` | `20` | Parallel downloads |
| `--provider` | `uqload` | Stream provider |
| `--dry-run` | off | Print resolved URLs, don't download |
| `--no-resolve` | off | Skip live-domain auto-resolution |
| `-v`, `--verbose` | off | Debug logging |

### Web UI

```bash
uv run fstream-dl serve
```

Opens at `http://127.0.0.1:8080`. The server keeps running in the terminal — downloads continue in the background even if you close the browser tab. Stop it with Ctrl-C.

| Option | Default | Description |
|---|---|---|
| `--host` | `127.0.0.1` | Bind address |
| `--port` | `8080` | Port |
| `--no-resolve` | off | Skip live-domain auto-resolution |

**Features:**
- Search fstream, browse season cards with posters and language badges
- Expand seasons to episode level; cascading checkboxes (series → season → episode)
- Global language and output folder settings (persisted to `~/.config/fstream-dl/config.json`)
- Per-episode progress bars via SSE; downloads keep running after closing the browser tab

Downloads are organised automatically:

```
<output_root>/<Series Name>/Season 01/S01E01 - Title.mp4
```

## Development

```bash
# Run tests
uv run pytest

# Frontend dev server (proxies /api to localhost:8080)
cd frontend && npm install && npm run dev

# Rebuild frontend
cd frontend && npm run build
```

## Providers

| Provider | Status |
|---|---|
| uqload | supported |
| vidzy | planned |
| netu / voe | out of scope (session-token protected) |
