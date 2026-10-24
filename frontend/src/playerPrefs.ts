import { putPreference } from './api'
// Type-only, so the mutual import with subtitleStyle.ts is erased at build.
import type { SubtitleStyle } from './subtitleStyle'

// Player preferences (volume, mute, playback rate). Persisted to a server-side
// `preferences` row (#24) so they follow you across devices, with localStorage
// as an instant offline cache. Reads stay synchronous via the in-memory cache
// (VideoPane restores them the moment a source can play).

const STORAGE_KEY = 'sestudio.player.v1'

export interface PlayerPrefs {
  volume: number
  muted: boolean
  rate: number
  /**
   * Subtitle language to re-select on each new source, so a choice made on one
   * episode carries to the next (tracks are recreated per source, so the
   * selection cannot simply survive).
   *
   * `undefined` — never chosen; the host's own `default` track wins.
   * `null`      — explicitly turned off.
   * a string    — the language code of the chosen track.
   */
  subtitleLang?: string | null
  /**
   * Subtitle appearance (font, size, colours, background opacity).
   * `subtitleStyle.ts` owns the defaults; stored partial so an older saved blob
   * still merges cleanly when fields are added.
   */
  subtitleStyle?: Partial<SubtitleStyle>
  /**
   * The quality the player plays at, picked beside it or in the settings, and
   * re-applied to each new source. `undefined` — the source's own picture (the
   * best it has); 0 — Auto, following the connection; a height — the closest
   * at or below it.
   */
  quality?: number
  /** Frame rate last picked in the player; `undefined` — the source's own. */
  fps?: number
  /** The same for a cast, kept apart: the TV's link is not the browser's.
   *  `undefined` — the best the TV takes (Auto on a Chromecast). */
  tvQuality?: number
  /** Frame rate a cast is sent at; `undefined` — the source's own. */
  tvFps?: number
}

/** The picked quality as the dropdown holds it: "source", "auto", or a height. */
export function qualityValue(quality: number | undefined): string {
  return quality === undefined ? 'source' : quality === 0 ? 'auto' : String(quality)
}

/** The preference a dropdown value stands for (see `PlayerPrefs.quality`). */
export function qualityPref(value: string): number | undefined {
  return value === 'source' ? undefined : value === 'auto' ? 0 : Number(value)
}

const DEFAULTS: PlayerPrefs = { volume: 1, muted: false, rate: 1 }

function read(): PlayerPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PlayerPrefs>) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

let cache: PlayerPrefs = read()
let pushTimer: number | undefined

export function loadPlayerPrefs(): PlayerPrefs {
  return cache
}

export function savePlayerPrefs(patch: Partial<PlayerPrefs>): void {
  cache = { ...cache, ...patch }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // storage unavailable — prefs just won't persist locally
  }
  // Debounce the server write; dragging the volume slider fires this rapidly.
  if (pushTimer !== undefined) window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => { void putPreference('player', cache).catch(() => {}) }, 500)
}

/** Replace the cache from a server snapshot (startup hydration, #24). */
export function hydratePlayerPrefs(prefs: PlayerPrefs | null): void {
  if (!prefs) return
  cache = { ...DEFAULTS, ...prefs }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // ignore
  }
}
