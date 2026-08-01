# Task List — sestudio uvx Packaging

Legend: `[ ]` todo · `[~]` in progress · `[x]` done. See `tasks/plan.md` for the dependency
graph, architecture decisions, risks, and checkpoints.
Do **not** start a task before its dependencies are `[x]`. Stop at each `▸ CHECKPOINT` for
human review.

(Supersedes the prior Player & Cast task list, in git history.)

---

## Phase 1 — Self-contained package

### [x] Task 1 — Module-relative static path (dev fallback)
**Deps:** none · **Scope:** S · **Files:** `src/sestudio/web/app.py`
- Resolve dist as `Path(__file__).parent / "static"` if it exists, else repo `frontend/dist`.
- Mount `/assets` + SPA fallback from whichever resolved.
- **AC:** installed layout serves from `web/static/`; dev serves from `frontend/dist`.
- **Verify:** `pytest -q` green; `sestudio serve` still serves the UI in dev.

### [x] Task 2 — Bundle frontend into the wheel (force-include) + commit dist
**Deps:** Task 1 · **Scope:** S · **Files:** `pyproject.toml`, `.gitignore`, commit `frontend/dist`, README build note
- Add `[tool.hatch.build.targets.wheel.force-include]` = `{ "frontend/dist" = "sestudio/web/static" }`.
- Un-gitignore `frontend/dist` and commit the built assets (git-install support — resolved decision).
- Note the `npm run build` prerequisite; build should fail/warn loudly if `frontend/dist` absent.
- **AC1:** built wheel lists `sestudio/web/static/index.html` + `assets/*`.
- **Verify:** `python -m zipfile -l dist/sestudio-*.whl | grep web/static/index.html`;
  **AC2:** `uvx --from ./dist/sestudio-*.whl sestudio serve` in a clean dir → SPA + assets, no `/assets/*` 404.

### [x] Task 3 — LICENSE, license metadata, drop main.py
**Deps:** none · **Scope:** XS · **Files:** `LICENSE` (new), `pyproject.toml`, remove `main.py`
- Add `LICENSE`; add `license` to `[project]`.
- Delete `main.py` (stray "Hello" stub, not an entry point).
- **AC10:** LICENSE exists; metadata valid; `main.py` gone.
- **Verify:** `uv build` clean; `rg -n 'from main|import main' src tests` empty.

### ▸ CHECKPOINT: Foundation (after Tasks 1–3) — human review
- [ ] `pytest` green; `uv build` clean.
- [ ] Clean-env wheel install serves UI + assets (AC1, AC2, AC9 core).

---

## Phase 2 — Bundled ffmpeg

### [x] Task 4 — imageio-ffmpeg resolver in downloads
**Deps:** none (do after Phase 1 checkpoint) · **Scope:** M
**Files:** `pyproject.toml`, `src/sestudio/media.py` (new), `src/sestudio/downloader.py`, `tests/test_media.py` (new)
- Add `imageio-ffmpeg` dep.
- `media.ffmpeg_location() -> str | None`: `None` if `shutil.which("ffmpeg")`, else `Path(imageio_ffmpeg.get_ffmpeg_exe()).parent`.
- In `downloader.download()`, append `--ffmpeg-location <dir>` iff non-None.
- **AC3/AC4:** resolver both branches; flag present only when a dir is returned.
- **Verify:** `tests/test_media.py` (imageio mocked, PATH stubbed) green; optional live HLS download without system ffmpeg.

### ▸ CHECKPOINT: ffmpeg (after Task 4)
- [ ] `test_media.py` + existing tests green.

---

## Phase 3 — Self-contained HTTPS

### [x] Task 5 — Self-signed cert generation + caching
**Deps:** none · **Scope:** M · **Files:** `src/sestudio/tls.py` (new), `tests/test_tls.py` (new)
- `tls.ensure_cert() -> (cert_path, key_path)`; SAN = `dlna._local_ipv4s()` + `127.0.0.1` + `localhost`.
- Cache under the config dir; regenerate only if missing/expired.
- **AC:** SAN includes LAN IP(s)/loopback/localhost; second call reuses cache.
- **Verify:** `tests/test_tls.py` (SAN + cache-reuse) green.

### [x] Task 6 — HTTPS-by-default serve wiring
**Deps:** Task 5 · **Scope:** S · **Files:** `src/sestudio/cli.py`, `start.bat`
- **HTTPS is the default** (port 8443): `ensure_cert()` → uvicorn `ssl_certfile`/`ssl_keyfile`; print `https://<lan-ip>:8443` + cert-trust hint. `--no-https` → plain HTTP.
- Drop Caddy from `start.bat` (built-in HTTPS replaces it); `start.sh` already Caddy-free.
- **AC6:** default serves HTTPS on LAN IP with generated cert. **AC8:** `--no-https` = plain HTTP.
- **Verify:** default `serve` → `https://…:8443/` 200; `--no-https` → http 200; real-device Chromecast after cert trust (AC7).

### ▸ CHECKPOINT: HTTPS (after Tasks 5–6) — human review
- [ ] `test_tls.py` green; no-flag `serve` unchanged; `--https` reachable on LAN.

---

## Phase 4 — Release plumbing & docs

### [x] Task 7 — CI build+publish with asset verification
**Deps:** Task 2 · **Scope:** M · **Files:** `.github/workflows/*.yml`, `README.md`
- Release job: `npm ci && npm run build` → `uv build` → assert wheel contains `web/static/index.html` → `uv publish` (token secret). Alongside `release_please.yml`.
- README: supported platform/arch matrix (per imageio-ffmpeg wheels) + `uvx sestudio` install.
- **AC:** frontend built before wheel; job fails if assets missing.
- **Verify:** YAML lints; `workflow_dispatch` on a test tag yields a wheel with assets.

### [x] Task 8 — Rename leftover + usage docs
**Deps:** none · **Scope:** S · **Files:** `src/sestudio/config.py`, `README.md`, maybe `tests/test_config.py`
- Fix `FSTREAM_DL_CONFIG` → `SESTUDIO_CONFIG` (rename miss; uppercase slipped the sed).
- README: `uvx sestudio serve`, `--https` + cert-trust, system-vs-bundled ffmpeg note.
- **AC:** no `FSTREAM_DL` tokens remain; README covers uvx/HTTPS/ffmpeg.
- **Verify:** `rg -i FSTREAM_DL` empty; `test_config.py` green.

### ▸ CHECKPOINT: Complete
- [ ] All ACs met; full suite green.
- [ ] `uvx --from <wheel> sestudio serve` end-to-end in a clean env.
- [ ] Ready for review + PyPI publish (user-driven).
