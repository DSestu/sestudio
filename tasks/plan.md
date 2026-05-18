# Plan: Add DaisyUI and Swap Existing Tailwind Components

## Context

The frontend uses raw Tailwind v4 utility classes throughout, producing verbose className strings with hand-rolled hover/disabled/focus states. DaisyUI provides a semantic component layer on top of Tailwind that reduces boilerplate and enforces consistent theming. Goal: install DaisyUI v5 (Tailwind v4 compatible), configure a dark theme matching the existing violet+zinc palette, then swap each component's hand-rolled patterns with DaisyUI equivalents — preserving all functionality and visual appearance.

---

## Stack

- React 19 + TypeScript + Vite 8 + Tailwind CSS 4.3 (via `@tailwindcss/vite`)
- DaisyUI v5 (first version with Tailwind v4 `@plugin` API)
- Theme config lives in `frontend/src/index.css`

---

## Dependency Graph

```
index.css (theme config)
  └── App.tsx (layout, header, bulk bar, select-all)
        ├── SearchBar.tsx         (isolated — search input only)
        ├── SettingsPanel.tsx     (isolated — output path + lang select)
        ├── ResultsGrid.tsx       (isolated — card grid, type badges)
        ├── DownloadQueue.tsx     (isolated — job list, progress, StatusBadge)
        ├── SeasonTree.tsx        (modal — checkboxes, lang buttons, episode rows)
        └── ConfirmDownloadModal.tsx (modal — file tree, confirm/cancel)
```

---

## Theme Configuration

DaisyUI v5 uses `@plugin` in CSS. Map existing palette to DaisyUI semantic tokens:

```css
@import "tailwindcss";
@plugin "daisyui";

[data-theme="dark"] {
  --color-primary: oklch(52% 0.24 291);     /* violet-600 */
  --color-primary-content: oklch(100% 0 0); /* white */
  --color-base-100: oklch(14.5% 0 0);       /* zinc-950 */
  --color-base-200: oklch(17.9% 0 0);       /* zinc-900 */
  --color-base-300: oklch(21.5% 0 0);       /* zinc-800 */
  --color-base-content: oklch(89.5% 0 0);   /* zinc-200 */
}
```

Add `data-theme="dark"` to `<html>` in `frontend/index.html`.

---

## Component Swap Reference

### SearchBar.tsx
| Before | After |
|--------|-------|
| `bg-zinc-800 border border-zinc-600 rounded-lg px-4 py-3 text-white text-lg placeholder-zinc-500 focus:outline-none focus:border-violet-500` | `input input-bordered w-full text-lg` |

### SettingsPanel.tsx
| Before | After |
|--------|-------|
| Container `bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3` | `card card-bordered bg-base-200 p-3` |
| Input `bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-sm text-white w-64 focus:*` | `input input-bordered input-sm w-64` |
| Select `bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-sm text-white focus:*` | `select select-bordered select-sm` |

### DownloadQueue.tsx — StatusBadge
| Status | Before | After |
|--------|--------|-------|
| queued | `bg-zinc-700 text-zinc-400` | `badge badge-ghost` |
| downloading | `bg-blue-900 text-blue-300` | `badge badge-info` |
| done | `bg-green-900 text-green-300` | `badge badge-success` |
| failed | `bg-red-900 text-red-300` | `badge badge-error` |
| skipped/cancelled | `bg-zinc-800 text-zinc-500` | `badge badge-ghost` |

Progress bar: `bg-zinc-700 rounded-full h-1.5` + inner `bg-violet-500` → `<progress className="progress progress-primary w-full" value={n} max="100">`

### ResultsGrid.tsx — Type badges
| Type | Before | After |
|------|--------|-------|
| Film | `bg-blue-800 text-blue-200` | `badge badge-info badge-sm` |
| Anime | `bg-rose-900 text-rose-300` | `badge badge-error badge-sm` |
| Series | `bg-orange-900 text-orange-300` | `badge badge-warning badge-sm` |

Card border colors (blue/rose/yellow/violet) — keep Tailwind utilities; DaisyUI has no semantic colored-border card variant.

### SeasonTree.tsx + ConfirmDownloadModal.tsx — Modals
| Before | After |
|--------|-------|
| `fixed inset-0 z-50 flex items-center justify-center bg-black/70` | `modal modal-open` |
| `bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col` | `modal-box max-w-2xl max-h-[80vh] flex flex-col` |
| Close button `text-zinc-400 hover:text-white text-xl` | `btn btn-sm btn-circle btn-ghost` |
| Checkboxes `accent-violet-500 w-4 h-4` | `checkbox checkbox-primary checkbox-sm` |
| Lang active `bg-violet-600 text-white` | `btn btn-primary btn-xs font-mono uppercase` |
| Lang inactive `bg-zinc-700 text-zinc-400 hover:bg-zinc-600` | `btn btn-ghost btn-xs font-mono uppercase` |
| Provider badges `bg-zinc-700 text-zinc-400 rounded px-1 text-xs` | `badge badge-ghost badge-sm` |
| Primary action button `bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-medium` | `btn btn-primary btn-sm` |
| Cancel/ghost button `text-zinc-400 hover:text-white hover:bg-zinc-800` | `btn btn-ghost btn-sm` |

### App.tsx
| Before | After |
|--------|-------|
| Bulk bar `bg-zinc-800 border border-zinc-600 rounded-xl` | `card card-bordered bg-base-200 shadow-xl` |
| Bulk "Clear" | `btn btn-ghost btn-sm` |
| Bulk "Download all" | `btn btn-primary btn-sm` |
| Select-all tri-state checkbox | Keep existing (complex state logic, no DaisyUI equivalent) |

---

## What to Keep as Tailwind Utilities

- Responsive grid: `grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4`
- Card type border colors: `border-blue-700 hover:border-blue-500`, `border-rose-700`, `border-yellow-700`, `border-violet-500`
- App title accent: `text-violet-400`
- `fixed bottom-6 left-1/2 -translate-x-1/2 z-40` (bulk bar positioning)
- Tri-state checkbox custom styling in App.tsx
- Icon sizing utilities: `w-4 h-4`, `w-3 h-3`, etc.

---

## Cleanup (Task 9)

- Delete `frontend/src/App.css` — all classes are unused Vite scaffold legacy
- Remove `import './App.css'` from `App.tsx`
- Replace remaining `bg-zinc-900`/`bg-zinc-800`/`border-zinc-700` that DaisyUI base now covers with `bg-base-200`/`bg-base-300`/`border-base-300`

---

## Verification

```bash
cd frontend
npm install          # picks up daisyui
npm run dev          # verify at http://localhost:5173

# Full flow:
# 1. Search → cards appear in grid with correct type badges
# 2. Click card → SeasonTree modal; checkboxes, lang buttons work
# 3. Select episodes → Download → ConfirmDownloadModal with file tree
# 4. Confirm → DownloadQueue: progress bar animates, status badges correct
# 5. Settings: output path + lang persist across reload

npm run build        # must succeed cleanly
```
