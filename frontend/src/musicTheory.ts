import { useEffect, useSyncExternalStore } from 'react'
import type { AppSettings } from './api'
import { getSettings } from './api'
import { DEFAULT_THEORY, type Theory } from './harmony'

// The theory level lives in the server's settings, but every music row, the player
// and the set editor show it: one shared copy, so changing it in Settings updates
// them all at once.
let theory: Theory = DEFAULT_THEORY
let loaded = false
const listeners = new Set<() => void>()

/** Settings were read or saved: keep the shared copy in step. */
export function publishTheory(s: AppSettings) {
  const next: Theory = { level: s.music_theory_level ?? 'plain', moodWords: s.music_mood_words !== false }
  loaded = true
  if (next.level === theory.level && next.moodWords === theory.moodWords) return
  theory = next
  listeners.forEach(l => l())
}

export function useTheory(): Theory {
  const t = useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => theory)
  useEffect(() => {
    if (!loaded) { loaded = true; getSettings().then(publishTheory, () => { loaded = false }) }
  }, [])
  return t
}
