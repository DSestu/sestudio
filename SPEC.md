# SPEC: sestudio uvx Packaging & Distribution

Status: **Draft — awaiting review**
Supersedes (in this file): the prior "Web UI" and "In-browser Player & Cast" specs, which remain in git history (`git show HEAD:SPEC.md`) and describe already-shipped features. This spec covers only how that product gets packaged and shipped.

## Objective

Make sestudio installable and runnable as a **single self-contained command** via
`uvx sestudio`, with **zero manual system setup** — the user should not have to
separately install ffmpeg, ffprobe, Node, or Caddy. Primary distribution channel is
**PyPI**; `uvx --from git+…` is a best-effort secondary path.

Who it's for: the existing single self-hosted user, now installing on a fresh machine
with only `uv` present.

Success = on a clean machine with no repo checkout and nothing but `uv`:
- `uvx sestudio serve` starts the web UI **with assets loading** and downloads working.
- An HLS episode downloads end-to-end **with no system ffmpeg on PATH**.
- `uvx sestudio serve --https` serves HTTPS with a self-signed cert so casting works
  without Caddy.

---

## Tech Stack (packaging-relevant)

| Concern | Choice |
|---|---|
| Build backend | `hatchling` (existing) + build step that bundles the frontend into the package |
| Frontend assets | Vite `dist/` **relocated into** `src/sestudio/web/static/`, shipped inside the wheel |
| ffmpeg | `imageio-ffmpeg` pip wheel (**truly bundles** a static ffmpeg per-platform, offline-verified; ~77 MB installed), injected via yt-dlp `--ffmpeg-location`. ffprobe not needed for HLS→mp4 (verified). |
| yt-dlp | already a dependency; its console script is on PATH inside the uvx venv (invoked via `shutil.which("yt-dlp")`) |
| HTTPS / TLS | self-signed cert generated at startup via the existing `cryptography` dep; served by uvicorn `ssl_keyfile`/`ssl_certfile` |
| Publish | PyPI (built wheel with pre-built frontend); git-based `uvx --from` secondary |

New runtime dep: `imageio-ffmpeg`. No new dep for TLS (`cryptography` already present).

---

## Commands

Run (end users):
```bash
uvx sestudio serve [--host 0.0.0.0] [--port 8080] [--https] [--https-port 8443]
uvx --from git+https://github.com/DSestu/sestudio sestudio serve   # secondary
```

Build & publish (maintainer):
```bash
npm --prefix frontend ci
npm --prefix frontend run build          # → frontend/dist
# build hook copies frontend/dist → src/sestudio/web/static/ (see build hook below)
uv build                                  # produces sdist + wheel with static assets
uvx --from ./dist/sestudio-*.whl sestudio serve   # smoke test the built wheel
uv publish                                # → PyPI
```

Verify (maintainer):
```bash
uv run pytest tests/ -q
uv run ruff check . && uv run ruff format --check .
python -m zipfile -l dist/sestudio-*.whl | grep web/static/index.html   # assets present
```

---

## Core Changes & Acceptance Criteria

### P1 — Bundle frontend assets into the package
The UI must load when installed, with no repo `frontend/` sibling.
- Relocate built assets to `src/sestudio/web/static/` (via build hook; see below).
- `web/app.py` resolves the dist dir **relative to the module**:
  `Path(__file__).parent / "static"` — not `_REPO_ROOT / "frontend" / "dist"`.
- A hatch build step (`[tool.hatch.build.targets.wheel.force-include]` or a custom build
  hook) ensures `web/static/**` lands in the wheel.
- **AC1**: `python -m zipfile -l` on the built wheel lists `sestudio/web/static/index.html`
  and `sestudio/web/static/assets/*`.
- **AC2**: installing the wheel in a clean venv (no repo checkout) and running `serve`
  returns the SPA at `/` with assets loading (HTTP 200, no 404 on `/assets/*`).

### P2 — Ship ffmpeg, no system install required
- Add `imageio-ffmpeg` to `dependencies`. Its per-platform wheel bundles a static ffmpeg
  (offline-verified: no runtime download). ffprobe is **not** required for the HLS→mp4
  path (empirically verified — yt-dlp's `hlsnative` downloader muxes via ffmpeg alone).
- A resolver (`media.ffmpeg_location()`) returns the directory containing the ffmpeg
  binary; `downloader.download()` adds `--ffmpeg-location <dir>` to the yt-dlp command.
- **Prefer a real system install**: if `ffmpeg` is already on PATH, use it (fuller codec
  set, plus a real ffprobe) and skip the bundled binary.
- **AC3**: with no system ffmpeg on PATH, an HLS episode downloads and muxes to mp4
  successfully using the bundled binary.
- **AC4**: with system ffmpeg present, the bundled binary is **not** used (verifiable:
  `--ffmpeg-location` omitted so yt-dlp uses PATH).

### P3 — Self-contained HTTPS for casting (no Caddy)
- **HTTPS is the default** (decision, 2026-08-01): `serve` generates (once, cached under
  the config dir) a self-signed cert whose SubjectAltName includes the resolved LAN IP
  (and `127.0.0.1`/`localhost`), using `cryptography`, then runs uvicorn with
  `ssl_keyfile`/`ssl_certfile` on port `8443`. `--no-https` opts into plain HTTP.
- Caddy is dropped from the start scripts; the built-in HTTPS replaces it.
- **AC6**: `serve` (default) serves the UI over `https://<lan-ip>:8443` with the generated
  cert; `--no-https` serves plain HTTP.
- **AC7**: after trusting the generated cert on the casting device, Chromecast lists and
  plays (the cert-trust step is documented; trust itself is manual).
- **AC8**: `--no-https` serves plain HTTP (for older DLNA renderers / the frontend dev
  proxy).

### P4 — Distribution metadata & release plumbing
- Add a `LICENSE` file and `license` metadata (the `[project.urls]` already points at one).
- Remove/repurpose the stray `main.py` "Hello from sestudio!" stub — it is not an entry
  point.
- CI release job: `npm build` → build hook → `uv build` → `uv publish`, so the published
  wheel always contains fresh pre-built assets.
- Declare the **supported platform/arch matrix** in the README, bounded by which platforms
  `imageio-ffmpeg` ships wheels for.
- **AC9**: `uvx sestudio` (from the published wheel) runs the CLI with no manual system
  deps.
- **AC10**: `pyproject.toml` has a valid `license`, a `LICENSE` file exists, and the wheel
  metadata is complete (`uv build` emits no metadata warnings).

### Non-goals
No Docker packaging changes · no Windows installer · no auto-updating · no vendoring the
Caddy binary · no change to provider/scraper/cast logic beyond the ffmpeg-location and
static-path wiring.

---

## Project Structure (new / changed)

```
pyproject.toml                       # CHANGED  + imageio-ffmpeg dep, license, build hook/force-include
LICENSE                              # NEW
src/sestudio/
  web/
    app.py                           # CHANGED  static dir = __file__.parent/"static"
    static/                          # NEW (build artifact)  bundled frontend dist, shipped in wheel
  media.py                           # NEW  resolve ffmpeg dir (system-preferred, imageio-ffmpeg fallback)
  tls.py                             # NEW  generate/cache self-signed cert with LAN-IP SAN
  downloader.py                      # CHANGED  add --ffmpeg-location from media.py
  cli.py                             # CHANGED  serve gains --https/--https-port; wires tls.py + uvicorn ssl args
main.py                              # REMOVED  stray stub
frontend/dist/                       # build input, copied into web/static by the build hook
tests/
  test_media.py                      # NEW  system-preferred vs bundled fallback
  test_tls.py                        # NEW  cert has expected SANs; cached on second call
  test_packaging.py                  # NEW  built wheel contains web/static assets
```

Build hook: a hatchling build hook (or `force-include = { "src/sestudio/web/static" = "sestudio/web/static" }`)
copies `frontend/dist` → `src/sestudio/web/static` at build time. The frontend build
(`npm run build`) runs **before** `uv build` (in CI and documented for local builds); the
Python build does not invoke npm.

---

## Code Style

- **Match the existing codebase.** Python: `from __future__ import annotations`, full type
  hints, `logging` not `print`, typed exceptions.
- `media.py` and `tls.py` are small, pure, testable helpers — no global mutable state; the
  cert path and ffmpeg dir are computed and returned, cached on disk (not in module
  globals). Example shape:

```python
def ffmpeg_location() -> str | None:
    """Directory holding ffmpeg for yt-dlp's --ffmpeg-location.

    Returns None when a system install is already on PATH (let yt-dlp use it —
    gives a real ffprobe and fuller codecs).
    """
    if shutil.which("ffmpeg"):
        return None
    import imageio_ffmpeg
    return str(Path(imageio_ffmpeg.get_ffmpeg_exe()).parent)
```

- No new comments on unchanged code; comment *why* (e.g. the system-preferred rationale),
  not *what*.

---

## Testing Strategy

- **Unit (pytest)** — the new logic is small and deterministic:
  - `media.ffmpeg_location()` returns `None` when a system ffmpeg is stubbed onto PATH,
    and a directory (mocked `imageio_ffmpeg`) otherwise (AC3/AC4).
  - `tls` cert generation: SAN includes the passed IP + `127.0.0.1`/`localhost`; a second
    call reuses the cached cert (AC6).
  - Packaging: build the wheel in a tmp dir and assert `sestudio/web/static/index.html`
    is a member (AC1). (Or assert the module-relative path resolves inside site-packages.)
- **Manual / smoke (clean environment, real network/devices)**:
  - `uvx --from ./dist/*.whl sestudio serve` → UI + assets load (AC2, AC9).
  - HLS download with system ffmpeg removed from PATH (AC3).
  - `serve --https` + Chromecast after cert trust (AC6/AC7).
- Keep existing `tests/` layout; no framework changes.

---

## Boundaries

| Always | Ask first | Never |
|---|---|---|
| Prefer a system ffmpeg when present; fall back to bundled | Add any runtime dep beyond `imageio-ffmpeg` | Vendor/commit large binaries into git |
| Resolve the static dir relative to the module (`__file__`) | Change the default bind host or default port | Ship an sdist/wheel whose UI silently 404s (assets must be verified present) |
| Run `npm build` before `uv build` so assets are fresh | Commit built `web/static` into git vs. build-hook-only | Invoke `npm` from the Python build backend |
| Cache the self-signed cert; regenerate only if missing/expired | Publish to PyPI (needs the account/token) | Enable HTTPS by default silently, or weaken the existing HTTP default |
| Verify wheel contents in CI before publish | Remove `main.py` | Commit without explicit user consent (repo git rule) |

---

## Success Criteria (testable)

1. `uv build` yields a wheel containing `sestudio/web/static/index.html` + `assets/**` (AC1).
2. In a clean env with only `uv`, `uvx --from <wheel> sestudio serve` serves the UI with
   assets loading (AC2, AC9).
3. An HLS episode downloads and merges to mp4 with **no** system ffmpeg on PATH (AC3).
4. With system ffmpeg present, bundled binaries are not used (AC4).
5. `serve --https` serves HTTPS with a self-signed cert whose SAN includes the LAN IP (AC6).
6. `serve` (no flag) behaves exactly as today (AC8).
7. `LICENSE` exists and metadata is complete (AC10).

---

## Resolved decisions (from empirical checks, 2026-08-01)

- **Project name → `sestudio`** (Sestu + studio). Chosen over the old `fstream-dl` because
  the project is heading toward a general multi-source video aggregator, not
  fstream-specific. PyPI name confirmed available (2026-08-01). **Full rename executed
  2026-08-01**: distribution name + console command (`pyproject.toml`), the four GitHub URLs
  (→ `DSestu/sestudio` — the GitHub repo must be renamed to match), and the import module
  `src/fstream_dl/` → `src/sestudio/` with all `from fstream_dl …` updated across the code
  and tests. All 55 tests pass; `sestudio` console script verified. Two follow-ups noted:
  the config dir moved to `~/.config/sestudio/` (old config not migrated — fine pre-release),
  and PyPI publishing is the user's to do.
- **ffmpeg packaging → `imageio-ffmpeg`.** Verified `static-ffmpeg` does *not* bundle its
  binaries (36 KB of pure Python; downloads platform zips from a third-party GitHub repo at
  runtime) → rejected for breaking zero-setup/offline. `imageio-ffmpeg` genuinely bundles a
  static ffmpeg in its per-platform wheel (77 MB, works offline).
- **ffprobe not required.** Verified yt-dlp's `hlsnative` HLS→mp4 download muxes via ffmpeg
  alone with no ffprobe on PATH and no ffprobe request — so `imageio-ffmpeg` (ffmpeg-only)
  is sufficient for the download path.

## Open Questions

1. **Platform matrix.** Which OS/arch combos must be supported at launch (Linux x86_64,
   Linux arm64, macOS arm64, Windows x86_64)? Bounded by `imageio-ffmpeg` wheel
   availability (it publishes wheels for the common desktop/server targets).
2. **Commit built assets or build-hook-only?** Committing `web/static` makes
   `uvx --from git+…` work without npm; a build-hook keeps the repo clean but makes
   git-install require a build step. Recommendation: build-hook + CI, document git-install
   caveat.
