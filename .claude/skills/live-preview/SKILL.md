---
name: live-preview
description: Start an ephemeral live preview of the current worktree so the user can try a change interactively without checking it out. Use as soon as work starts on anything the user can see, hear or feel in the app — UI, UX, frontend, layout, styling, animation, music visuals or audio behaviour, interaction, copy, or a backend change that alters what the app shows or does — and post the URL before the work is finished.
---

# Live preview

The user works across many worktrees and wants to try each change in the real app while it's in progress, without checking anything out. Every worktree gets its own fixed port, so previews run side by side.

## Start it at the start of the work

Run from anywhere inside the worktree:

```bash
.claude/skills/live-preview/preview.sh            # frontend only: vite with HMR, /api -> live server
.claude/skills/live-preview/preview.sh --backend  # also this worktree's backend, on copies
```

It prints the desktop URL, the phone URL (LAN, WSL is in mirrored networking) and the log paths. Post both URLs in your reply straight away, then keep working: frontend edits hot-reload by themselves.

Pick the mode:

| The change touches | Mode |
|---|---|
| `frontend/` only | default; real data from the live server, read and write |
| `src/` (API, music, cast, settings…) | `--backend` |

- `--backend` runs this worktree's `src/` against copies of the live `config.json` and `library.db` in `/tmp/sestudio-preview/<worktree>/`, with watchers, music analysis and phone notifications off and downloads going to that tmp dir. It never touches the live server's files.
- The backend doesn't reload: after a backend edit, run the same command again (it restarts both and re-copies the DB) and tell the user the preview restarted.
- Default mode talks to the **live** API: clicking Download, Delete or Save there acts on the live server. Use `--backend` when testing anything that writes.

## Stop it

```bash
.claude/skills/live-preview/preview.sh --stop
```

Stop when the work is merged or abandoned, or the user is done testing.

## Limits

- Not from the main checkout: its `node_modules` is Windows-installed. Use a worktree.
- The phone URL needs the Windows firewall to allow the port; if the phone can't connect, say so instead of guessing.
- Music libraries in the copied config point at `/mnt/<drive>/…`, so local music plays only if that drive is mounted in WSL.
