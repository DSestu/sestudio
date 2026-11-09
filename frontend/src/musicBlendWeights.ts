import { useSyncExternalStore } from 'react'

// Blend by (SPEC-music-library §2.7): how much Best blend cares about harmony, mood, energy and
// genre between two tracks, and how welcome each key move is. Kept on the device and sent with
// every order, fix and bridge request; the defaults are the server's, so they change nothing.

export const AXES = ['harmony', 'mood', 'energy', 'genre'] as const
export type Axis = (typeof AXES)[number]
export type Importance = Record<Axis, number>

export const AXIS_LABEL: Record<Axis, string> = { harmony: 'Harmony', mood: 'Mood', energy: 'Energy', genre: 'Genre' }
export const AXIS_COLOR: Record<Axis, string> = {
  harmony: 'oklch(80% .14 85)', mood: 'oklch(70% .15 340)', energy: 'oklch(72% .16 230)', genre: 'oklch(75% .12 180)',
}

/** The server's moves (proximity.MOVES), in the order the panel lists them. */
export const MOVES = ['same-key', 'pivot', 'next-door', 'modal-shift', 'lift', 'drop', 'clash'] as const
export type Move = (typeof MOVES)[number]
export type Welcome = Record<Move, number>

export const MOVE_TEXT: Record<Move, [string, string]> = {
  'same-key': ['Same key', 'Same tonic and mode'],
  pivot: ['Same notes', 'Same notes, other tonic (A minor ↔ C major)'],
  'next-door': ['Next door', 'A fifth away, 6 shared notes'],
  'modal-shift': ['One note changes', 'Same tonic, brighter or darker mode'],
  lift: ['Lift', 'Same mode, 1 to 6 semitones up'],
  drop: ['Drop', 'Same mode, 1 to 6 semitones down'],
  clash: ['Clash', '5 shared notes or fewer'],
}

/** blend.DEFAULT_IMPORTANCE and proximity.DEFAULT_WELCOME. */
export const DEFAULT_IMPORTANCE: Importance = { harmony: 0.9, mood: 0.45, energy: 0.7, genre: 0.35 }
export const DEFAULT_WELCOME: Welcome = { 'same-key': 1, pivot: 0.8, 'next-door': 0.6, 'modal-shift': 0.6, lift: 0.5, drop: 0.5, clash: 0 }

export const IMPORTANCE_PRESETS: [string, Importance][] = [
  ['Balanced', { harmony: 0.7, mood: 0.7, energy: 0.7, genre: 0.7 }],
  ['Keys first', { harmony: 1, mood: 0.4, energy: 0.35, genre: 0.2 }],
  ['Keys only', { harmony: 1, mood: 0.05, energy: 0.05, genre: 0.05 }],
  ['DJ classic', { harmony: 1, mood: 0.3, energy: 0.9, genre: 0.2 }],
  ['Energy flow', { harmony: 0.4, mood: 0.3, energy: 1, genre: 0.3 }],
  ['Energy only', { harmony: 0.05, mood: 0.05, energy: 1, genre: 0.05 }],
  ['Mood first', { harmony: 0.45, mood: 1, energy: 0.4, genre: 0.3 }],
  ['Radio', { harmony: 0.4, mood: 0.9, energy: 0.4, genre: 0.9 }],
  ['Stay in genre', { harmony: 0.5, mood: 0.3, energy: 0.45, genre: 1 }],
  ['Cross genres', { harmony: 0.8, mood: 0.6, energy: 0.7, genre: 0.05 }],
]

const w = (same: number, pivot: number, next: number, modal: number, lift: number, drop: number, clash: number): Welcome =>
  ({ 'same-key': same, pivot, 'next-door': next, 'modal-shift': modal, lift, drop, clash })
export const WELCOME_PRESETS: [string, Welcome][] = [
  ['Default', DEFAULT_WELCOME],
  ['Same key only', w(1, 0.6, 0.3, 0.1, 0.05, 0, 0)],
  ['Strict keys', w(1, 0.9, 0.75, 0.4, 0.3, 0.2, 0)],
  ['Circle of fifths', w(0.8, 0.9, 1, 0.3, 0.2, 0.1, 0)],
  ['Modal', w(1, 0.8, 0.6, 0.95, 0.3, 0.2, 0)],
  ['DJ friendly', w(1, 0.9, 0.9, 0.65, 0.85, 0.6, 0)],
  ['Lift the set', w(0.9, 0.8, 0.8, 0.5, 1, 0.1, 0)],
  ['Bring it down', w(0.9, 0.8, 0.8, 0.5, 0.1, 1, 0)],
  ['Anything goes', w(1, 0.9, 0.85, 0.75, 0.75, 0.7, 0.45)],
]

export const MIN_IMPORTANCE = 0.02

/** Each axis's share of the total. */
export function shares(i: Importance): Importance {
  const s = AXES.reduce((a, k) => a + i[k], 0) || 1
  return Object.fromEntries(AXES.map(k => [k, i[k] / s])) as Importance
}

/** "Harmony first" when one axis has more than a third, else "Balanced". */
export function leadOf(i: Importance): string {
  const [k, v] = Object.entries(shares(i)).sort((a, b) => b[1] - a[1])[0]
  return v > 0.34 ? `${AXIS_LABEL[k as Axis]} first` : 'Balanced'
}

/** The preset these importances are (by shares), else "Custom". */
export function importanceName(i: Importance): string {
  const now = shares(i)
  return IMPORTANCE_PRESETS.find(([, v]) => { const p = shares(v); return AXES.every(k => Math.abs(p[k] - now[k]) < 0.02) })?.[0] ?? 'Custom'
}

export const welcomeName = (h: Welcome): string =>
  WELCOME_PRESETS.find(([, v]) => MOVES.every(k => Math.abs(v[k] - h[k]) < 0.02))?.[0] ?? 'Custom'

interface State { importance: Importance; welcome: Welcome }
const KEY = 'music.blendBy'
function read(): State {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '') as Partial<State>
    return { importance: { ...DEFAULT_IMPORTANCE, ...s.importance }, welcome: { ...DEFAULT_WELCOME, ...s.welcome } }
  } catch {
    return { importance: DEFAULT_IMPORTANCE, welcome: DEFAULT_WELCOME }
  }
}
let state = read()
const listeners = new Set<() => void>()
function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* private mode: kept for this session */ }
  listeners.forEach(l => l())
}

export const useBlendWeights = (): State => useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => state)
export const getBlendWeights = () => state
export const setImportance = (importance: Importance) =>
  set({ importance: Object.fromEntries(AXES.map(k => [k, Math.min(1, Math.max(MIN_IMPORTANCE, importance[k]))])) as Importance })
export const setWelcome = (welcome: Welcome) => set({ welcome })

/** What every order, fix and bridge request carries (`weights`, `harmony` in the server's names). */
export const blendBody = () => ({ weights: state.importance, harmony: state.welcome })
