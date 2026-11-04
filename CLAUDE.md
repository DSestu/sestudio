# fstream_downloader

## Frontend

- After any change under `frontend/`, run `npm run build` in `frontend/` right away. Don't rely on the `frontend-build` pre-commit hook to do it: the running server serves the committed `frontend/dist`, so a change isn't live, or testable in the app, until it's rebuilt.

- Draw animation-heavy visuals (anything redrawn every frame, like the music timeline and its light) with WebGL, not Canvas 2D or animated DOM/CSS layers. Canvas 2D's full-screen copies, clears and blurs held the music player at about 25 fps at 1440p; on the GPU the same frame is a few draw calls. Keep text on a 2D canvas or in the DOM. The TV station renders in headless Chromium without a GPU (SwiftShader, which is also what the preview browser uses), where every full-screen pass and MSAA buffer is expensive: a first WebGL timeline with an MSAA offscreen target and a full-screen light pass took the station from 47 to 9 fps. Keep passes to the pixels that change (the timeline's canvas covers only its band), anti-alias in the shader instead of with MSAA, and blur at low resolution and let the page scale it up. Measure the station with Playwright headless on `/?tv` at 1920×1080 before shipping.

## UI/UX

- When discussing UI or UX, produce mockups for both mobile and desktop, unless told not to. If the discussion is scoped to one platform, still ask whether the other needs a mockup too, especially when the change makes a big UX difference there. The app is used on phones and desktop, and a change designed for one layout often has a large, unexpected effect on the other.

## Git

- In this repo, "commit" means the full flow: create a branch, commit, push, open a PR (title only, `--body ""`), wait for the GitHub Actions checks, then merge. Push and open the PR in the foreground, then run the CI wait and merge as one background Bash command (`gh pr checks <n> --watch --fail-fast && gh pr merge <n> --squash`), not a subagent: an agent took up to 10 minutes per PR. If checks fail, don't merge; report the failure. Still commit only when the user explicitly says "commit".

## Live server

- A live instance of this service runs on the user's Windows machine (the repo is worked on from WSL at `/mnt/d/projets_python_ssd/Sencrop/perso/fstream_downloader`). Before anything that restarts the server or rewrites on-disk state (DB, downloads dir, config), say it will hit the live server and confirm first. Prefer Windows-compatible paths and commands when touching runtime config. Rebuilding the frontend is pre-approved and doesn't need this confirmation.
