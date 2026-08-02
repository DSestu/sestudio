// Persisted in-browser player preferences (volume, mute, playback rate),
// restored across episodes and reloads.

const STORAGE_KEY = 'sestudio.player.v1'

export interface PlayerPrefs {
  volume: number
  muted: boolean
  rate: number
}

const DEFAULTS: PlayerPrefs = { volume: 1, muted: false, rate: 1 }

export function loadPlayerPrefs(): PlayerPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PlayerPrefs>) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

export function savePlayerPrefs(patch: Partial<PlayerPrefs>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadPlayerPrefs(), ...patch }))
  } catch {
    // storage unavailable — prefs just won't persist
  }
}
