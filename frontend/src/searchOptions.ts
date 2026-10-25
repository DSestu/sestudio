import { useSyncExternalStore } from 'react'

// The search page's Options fold: whether it is open (remembered in this
// browser, like the layout choice) and a one-line summary of what isn't at its
// default. The summary is shared because the desktop's Options button sits in
// the pinned bar, outside the results page that owns the filters.

const OPEN_KEY = 'sestudio.search.optionsOpen'

interface State {
  open: boolean
  summary: string
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

let state: State = { open: readOpen(), summary: '' }
const listeners = new Set<() => void>()

function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}

export function useSearchOptions(): State {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => state,
  )
}

export function toggleSearchOptions() {
  const open = !state.open
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  } catch {
    // quota/unavailable — keep working in memory
  }
  set({ open })
}

export function setSearchOptionsSummary(summary: string) {
  if (summary !== state.summary) set({ summary })
}

/** The id the fold renders with, so the buttons can point at it. */
export const OPTIONS_ID = 'search-options'
