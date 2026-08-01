# Implementation Plan: sestudio uvx Packaging

Derived from `SPEC.md` (Draft). Goal: `uvx sestudio` runs the full app (CLI + web UI +
downloads + optional HTTPS casting) on a clean machine with only `uv` — no manually
installed ffmpeg, Node, or Caddy. Published to PyPI.

(Supersedes the prior "Player & Cast" plan, which is in git history and describes
already-shipped work.)

## Overview

Four concerns from the spec, sliced vertically so each task leaves a working,
independently verifiable system:

- **P1** Ship the frontend inside the wheel + resolve it relative to the module.
- **P2** Ship ffmpeg via `imageio-ffmpeg`, system-preferred.
- **P3** Self-contained HTTPS via a self-signed cert (no Caddy).
- **P4** Metadata, cleanup, and a CI release job.

## Architecture Decisions

- **Frontend bundling via hatchling `force-include`**, not a custom build hook or a
  committed `dist/`. `force-include = { "frontend/dist" = "sestudio/web/static" }` maps the
  (gitignored) build artifact into the wheel at build time. Requires `npm run build` to run
  **before** `uv build` (enforced in CI, documented for local builds).
- **Dual-path static resolution in `app.py`**: prefer module-relative `web/static/`
  (installed wheel), fall back to repo `frontend/dist` (dev / `uv run`). Keeps the dev
  workflow unchanged while making installed wheels self-contained.
- **ffmpeg: system-preferred.** `media.ffmpeg_location()` returns `None` when a system
  ffmpeg is on PATH (yt-dlp uses it, gets real ffprobe + fuller codecs), else the bundled
  `imageio-ffmpeg` binary's dir. ffprobe not needed for HLS→mp4 (verified in spec).
- **HTTPS cert SAN reuses existing LAN-IP helpers** (`dlna._local_ipv4s()`), cached under
  the config dir, generated with the existing `cryptography` dep. Caddy stays an optional
  upgrade, not a dependency.
- **Release hangs off the existing `release_please.yml`** flow, adding a build+publish job.

## Dependency Graph

```
Task 1 (module-relative static path, dev fallback)  ─┐
Task 2 (force-include → wheel bundles assets)  ──────┤  P1  → AC1, AC2
                                                     │
Task 3 (LICENSE + license metadata + drop main.py) ──┘  P4a (unblocks clean build)
        │
        ├── Task 4 (imageio-ffmpeg + media.py + downloader)   P2 → AC3, AC4   (independent)
        │
        ├── Task 5 (tls.py cert gen/cache)  ──┐
        │                                     ├── P3 → AC6, AC7, AC8
        │   Task 6 (serve --https wiring) ────┘   (Task 6 depends on Task 5)
        │
        └── Task 7 (CI release job + platform matrix)   P4b  (depends on Task 2)
Task 8 (rename leftover fix + uvx/HTTPS README docs)    cleanup (independent)
```

Order: P1 first (critical path — blocks the installed UI, highest build risk → fail fast),
then the independent P2 and P3 slices, then release plumbing.

## Task List

### Phase 1 — Self-contained package (P1 + metadata)

#### Task 1: Module-relative static resolution with dev fallback
**Description:** Make `app.py` serve the SPA from `Path(__file__).parent / "static"` when
present (installed wheel), falling back to the repo `frontend/dist` for dev. Removes the
hard-coded `_REPO_ROOT / "frontend" / "dist"` that breaks once installed.
**Acceptance criteria:**
- [ ] `create_app()` mounts `/assets` and the SPA fallback from the module-relative dir when it exists.
- [ ] With no `web/static/` present, it still serves `frontend/dist` (dev unchanged).
**Verification:**
- [ ] `.venv/bin/python -m pytest -q` still green.
- [ ] Manual: `.venv/bin/sestudio serve` serves the UI from `frontend/dist` as today.
**Dependencies:** None
**Files:** `src/sestudio/web/app.py`
**Scope:** S

#### Task 2: Bundle frontend into the wheel via force-include
**Description:** Add `[tool.hatch.build.targets.wheel.force-include]` mapping
`frontend/dist` → `sestudio/web/static`, so a built wheel contains the assets. Document the
`npm run build` prerequisite.
**Acceptance criteria (AC1):**
- [ ] After `npm --prefix frontend run build && uv build`, the wheel lists `sestudio/web/static/index.html` and `sestudio/web/static/assets/*`.
- [ ] Build fails loudly (or warns) if `frontend/dist` is absent at build time.
**Verification:**
- [ ] `python -m zipfile -l dist/sestudio-*.whl | grep web/static/index.html`.
- [ ] AC2: `uvx --from ./dist/sestudio-*.whl sestudio serve` in a clean dir serves the SPA with assets (no 404 on `/assets/*`).
**Dependencies:** Task 1
**Files:** `pyproject.toml`, (README build note)
**Scope:** S

#### Task 3: LICENSE, license metadata, drop stray main.py
**Description:** Add a `LICENSE` file + `license` field in `[project]`; remove `main.py`
(the "Hello from sestudio!" stub — not an entry point).
**Acceptance criteria (AC10):**
- [ ] `LICENSE` exists; `pyproject.toml` declares `license`.
- [ ] `main.py` removed; nothing imports it (`rg 'main:main|import main'` clean).
- [ ] `uv build` emits no metadata warnings.
**Verification:**
- [ ] `uv build` clean; `rg -n 'from main|import main' src tests` empty.
**Dependencies:** None
**Files:** `LICENSE` (new), `pyproject.toml`, remove `main.py`
**Scope:** XS

### Checkpoint: Foundation (after Tasks 1–3)
- [ ] Tests pass; `uv build` clean.
- [ ] Built wheel installed in a clean env serves the UI with assets (AC1, AC2, AC9 core).
- [ ] Review with human before proceeding.

### Phase 2 — Bundled ffmpeg (P2)

#### Task 4: imageio-ffmpeg resolver wired into downloads
**Description:** Add `imageio-ffmpeg` to `dependencies`. New `media.ffmpeg_location()`:
`None` if system ffmpeg on PATH, else the bundled binary's dir. `downloader.download()`
appends `--ffmpeg-location <dir>` when non-None.
**Acceptance criteria:**
- [ ] `media.ffmpeg_location()` returns `None` with a system ffmpeg stubbed on PATH; a dir otherwise (AC4/AC3).
- [ ] yt-dlp command includes `--ffmpeg-location` only when resolver returns a dir.
**Verification:**
- [ ] New `tests/test_media.py` passes (both branches, `imageio_ffmpeg` mocked).
- [ ] Manual (optional): HLS download with system ffmpeg removed from PATH succeeds (AC3).
**Dependencies:** None (Phase 1 checkpoint recommended first)
**Files:** `pyproject.toml`, `src/sestudio/media.py` (new), `src/sestudio/downloader.py`, `tests/test_media.py` (new)
**Scope:** M

### Checkpoint: ffmpeg (after Task 4)
- [ ] `tests/test_media.py` green; existing tests green.
- [ ] Download path verified (manual, optional) without system ffmpeg.

### Phase 3 — Self-contained HTTPS (P3)

#### Task 5: Self-signed cert generation + caching
**Description:** New `tls.py`: generate a self-signed cert/key (SAN = resolved LAN IPs via
`dlna._local_ipv4s()` + `127.0.0.1` + `localhost`), cached under the config dir; regenerate
only if missing/expired. Uses the existing `cryptography` dep.
**Acceptance criteria (AC6 support):**
- [ ] `tls.ensure_cert()` returns `(cert_path, key_path)`; SAN includes the LAN IP(s), `127.0.0.1`, `localhost`.
- [ ] Second call reuses the cached files (no regeneration).
**Verification:**
- [ ] New `tests/test_tls.py`: SAN assertions + cache-reuse.
**Dependencies:** None
**Files:** `src/sestudio/tls.py` (new), `tests/test_tls.py` (new)
**Scope:** M

#### Task 6: `serve --https` wiring
**Description:** Add `--https` / `--https-port` to `cli.serve`; when set, call
`tls.ensure_cert()` and pass `ssl_keyfile`/`ssl_certfile` to `uvicorn.run`. Print the
`https://<lan-ip>:<port>` URL. Default (no flag) unchanged. Keep the "use Caddy if on PATH"
note in docs as an optional upgrade.
**Acceptance criteria:**
- [ ] `serve --https` serves over HTTPS on the LAN IP with the generated cert (AC6).
- [ ] `serve` (no flag) is byte-for-byte the current HTTP behavior (AC8).
**Verification:**
- [ ] Manual: `sestudio serve --https`, `curl -k https://<lan-ip>:8443/` returns the SPA.
- [ ] Manual (real device): Chromecast lists + plays after trusting the cert (AC7).
**Dependencies:** Task 5
**Files:** `src/sestudio/cli.py`
**Scope:** S

### Checkpoint: HTTPS (after Tasks 5–6)
- [ ] `test_tls.py` green; `serve` (no flag) unchanged.
- [ ] `serve --https` reachable over HTTPS on the LAN (manual).

### Phase 4 — Release plumbing & docs (P4 remainder + cleanup)

#### Task 7: CI build+publish job with asset verification
**Description:** Extend the release flow (`.github/workflows/`, alongside
`release_please.yml`): on release, `npm ci && npm run build` → `uv build` → verify the wheel
contains `web/static/index.html` → `uv publish` (token via secret). Add the supported
platform/arch matrix to the README (bounded by `imageio-ffmpeg` wheels).
**Acceptance criteria:**
- [ ] Release workflow builds the frontend before the wheel and fails if assets are missing from the wheel.
- [ ] README documents supported platforms and the `uvx sestudio` install.
**Verification:**
- [ ] Workflow YAML lints; a manual `workflow_dispatch` on a test tag builds a wheel containing assets.
**Dependencies:** Task 2
**Files:** `.github/workflows/*.yml`, `README.md`
**Scope:** M

#### Task 8: Rename leftover + usage docs
**Description:** Fix the rename miss `FSTREAM_DL_CONFIG` → `SESTUDIO_CONFIG` in `config.py`.
Add README sections for `uvx sestudio serve`, `--https` + cert-trust steps, and the
system-vs-bundled ffmpeg note.
**Acceptance criteria:**
- [ ] `config._config_path()` reads `SESTUDIO_CONFIG`; no `FSTREAM_DL` tokens remain.
- [ ] README covers uvx install, HTTPS casting, and ffmpeg behavior.
**Verification:**
- [ ] `rg -i 'FSTREAM_DL'` returns nothing; `test_config.py` still green (update if it referenced the old env var).
**Dependencies:** None
**Files:** `src/sestudio/config.py`, `README.md`, maybe `tests/test_config.py`
**Scope:** S

### Checkpoint: Complete
- [ ] All acceptance criteria met; full test suite green.
- [ ] `uvx --from <wheel> sestudio serve` works end-to-end in a clean env.
- [ ] Ready for review + PyPI publish (user-driven).

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `frontend/dist` drifts from source (stale committed assets) | Med | `dist/` is committed (git-install support); rebuild+commit on frontend changes — CI check/automation in Task 7 keeps it fresh. |
| `imageio-ffmpeg` lacks a wheel for a target arch | Med | Pin the platform matrix to its published wheels; document unsupported arches; system-ffmpeg fallback still works there. |
| force-include path/layout wrong → assets silently missing | Med (silent) | AC1 zipfile check in CI is a hard gate; build fails if assets absent. |
| Self-signed cert trust is manual on the cast device | Low (expected) | Document the trust step (same as Caddy today); not automatable. |
| `serve --https` regresses the HTTP default | Low | AC8 pins no-flag behavior; keep the flag purely additive. |

## Resolved (2026-08-01)

1. **Platform matrix:** Linux x86_64, Linux arm64, macOS arm64, Windows x86_64 (all four).
   Task 7's README matrix lists these; all are covered by `imageio-ffmpeg` wheels.
2. **Commit `frontend/dist`:** YES — un-gitignore and commit the built assets so
   `uvx --from git+…` works without a local npm build. `force-include` still maps
   `frontend/dist` → `sestudio/web/static` in the wheel. Trade-off accepted: build
   artifacts live in git; rebuild+commit `dist/` on frontend changes (CI can automate).
