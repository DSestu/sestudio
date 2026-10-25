import { useSyncExternalStore } from 'react'

// The search page's Options fold and Sources panel: whether each is open (remembered in this
// browser, like the layout choice) and a one-line summary of what isn't at its
// default. The summary is shared because the desktop's Options button sits in
// the pinned bar, outside the results page that owns the filters.

const OPEN_KEY = 'sestudio.search.optionsOpen'
const SOURCES_KEY = 'sestudio.search.sourcesOpen'

interface State {
  open: boolean
  /** The desktop's Sources panel, also remembered. */
  sourcesOpen: boolean
  summary: string
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

let state: State = { open: readFlag(OPEN_KEY), sourcesOpen: readFlag(SOURCES_KEY), summary: '' }
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

function remember(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    // quota/unavailable — keep working in memory
  }
}

export function toggleSearchOptions() {
  remember(OPEN_KEY, !state.open)
  set({ open: !state.open })
}

export function setSourcesPanel(sourcesOpen: boolean) {
  remember(SOURCES_KEY, sourcesOpen)
  set({ sourcesOpen })
}

export function setSearchOptionsSummary(summary: string) {
  if (summary !== state.summary) set({ summary })
}

/** The id the fold renders with, so the buttons can point at it. */
export const OPTIONS_ID = 'search-options'
