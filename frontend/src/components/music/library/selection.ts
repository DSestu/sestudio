import { useSyncExternalStore } from 'react'

// Selection on the tape and in the set (SPEC-music-library §2.4, §2.6): click selects one,
// Ctrl/⌘-click toggles, Shift-click selects the range from the last click, a box adds what it
// covers. One scope at a time: selecting in the set clears the tape's, and the other way round.

export type Scope = 'tape' | 'set'

export interface Selection {
  scope: Scope
  ids: ReadonlySet<string>
  /** The last plain or Ctrl/⌘ click, where a Shift range starts. */
  anchor?: string
}

export interface Mods { shift?: boolean; toggle?: boolean }

const EMPTY: ReadonlySet<string> = new Set()
let state: Selection = { scope: 'tape', ids: EMPTY }
const listeners = new Set<() => void>()
const set = (s: Selection) => { state = s; listeners.forEach(l => l()) }

export const useSelection = (): Selection => useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => state)
export const getSelection = () => state

/** The ids selected in `scope`, empty when another scope holds the selection. */
export const idsIn = (s: Selection, scope: Scope): ReadonlySet<string> => (s.scope === scope ? s.ids : EMPTY)

/** A click on `id` in `scope`, where `order` is the order on screen (for Shift ranges). */
export function clickSelect(scope: Scope, id: string, order: readonly string[], mods: Mods = {}) {
  const cur = idsIn(state, scope)
  if (mods.shift && state.scope === scope && state.anchor) {
    const a = order.indexOf(state.anchor), b = order.indexOf(id)
    if (a >= 0 && b >= 0) {
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1)
      set({ scope, ids: new Set([...cur, ...range]), anchor: state.anchor })
      return
    }
  }
  if (mods.toggle) {
    const next = new Set(cur)
    if (!next.delete(id)) next.add(id)
    set({ scope, ids: next, anchor: id })
    return
  }
  set({ scope, ids: new Set([id]), anchor: id })
}

/** Select exactly `ids` (a box, Ctrl/⌘-A); `add` keeps what was selected in the scope. */
export function selectIds(scope: Scope, ids: Iterable<string>, add = false) {
  set({ scope, ids: new Set([...(add ? idsIn(state, scope) : []), ...ids]), anchor: state.scope === scope ? state.anchor : undefined })
}

export const clearSelection = () => { if (state.ids.size) set({ scope: state.scope, ids: EMPTY }) }
