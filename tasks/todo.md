# Task List: DaisyUI Migration

## Phase 1 — Foundation

- [ ] **T1** Install DaisyUI v5, configure dark theme in `index.css`, add `data-theme="dark"` to `index.html`
  - AC: `npm run dev` starts; DaisyUI base styles active; page visually unchanged

## Phase 2 — Simple/Isolated Components

- [ ] **T2** SearchBar — swap input to `input input-bordered w-full text-lg`
  - AC: search works; focus ring shows violet; placeholder visible

- [ ] **T3** SettingsPanel — swap container to `card bg-base-200`, input to `input input-bordered input-sm`, select to `select select-bordered select-sm`
  - AC: settings panel renders; values persist

### CHECKPOINT A — settings + search visually correct, no regressions

## Phase 3 — Download Queue

- [ ] **T4** DownloadQueue — swap `StatusBadge` to `badge badge-{ghost|info|success|error}`, progress bar to `<progress className="progress progress-primary">`, "Clear history" to `btn btn-ghost btn-xs`
  - AC: job rows show; progress animates; badge colors match status

## Phase 4 — Cards and Grid

- [ ] **T5** ResultsGrid — swap type badges (Film/Anime/Series) to `badge badge-{info|error|warning} badge-sm`; keep card border-color utilities
  - AC: grid renders; all 3 badge types show correct colors; card selection works

### CHECKPOINT B — search → select cards → visual correct

## Phase 5 — Modals

- [ ] **T6** SeasonTree — swap overlay/dialog to `modal modal-open`/`modal-box`, checkboxes to `checkbox checkbox-primary checkbox-sm`, lang buttons to `btn btn-primary|ghost btn-xs`, provider badges to `badge badge-ghost badge-sm`, action button to `btn btn-primary btn-sm`
  - AC: modal opens/closes; episode selection works; language switch works; download queues

- [ ] **T7** ConfirmDownloadModal — swap overlay/dialog to `modal`/`modal-box`, cancel to `btn btn-ghost btn-sm`, confirm to `btn btn-primary btn-sm`, existing-file badge to `badge badge-warning badge-xs`
  - AC: file tree renders; amber warning on existing files; cancel/confirm work

## Phase 6 — App Layout + Cleanup

- [ ] **T8** App.tsx — swap bulk floating bar to `card card-bordered bg-base-200 shadow-xl`, "Clear" to `btn btn-ghost btn-sm`, "Download all" to `btn btn-primary btn-sm`
  - AC: bulk bar appears when cards checked; buttons work

- [ ] **T9** Cleanup — delete `App.css`, remove its import from `App.tsx`, replace stale `bg-zinc-9xx`/`border-zinc-7xx` with `bg-base-*`/`border-base-*` where DaisyUI now covers them
  - AC: `npm run build` succeeds; no unused CSS; full flow works

### CHECKPOINT C — full end-to-end: search → select → season tree → confirm → download queue
