import { useSyncExternalStore } from 'react'
import type { FitsFilters } from './musicFits'

// The filters picked in Fits next, shared by every place it shows and by the playlist map's green rings.

type Prefs = Partial<FitsFilters>
let prefs: Prefs = {}
const listeners = new Set<() => void>()
export const setFitsPref = (p: Prefs) => { prefs = { ...prefs, ...p }; listeners.forEach(l => l()) }
export const useFitsPrefs = () => useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => prefs)
