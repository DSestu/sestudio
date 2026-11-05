import { useEffect, useState } from 'react'
import type { AppSettings } from './api'
import { getSettings, putSettings } from './api'
import { publishTheory } from './musicTheory'

const DEFAULTS: AppSettings = {
  output_root: '.', lang: 'vf', download_destination: 'server', tmdb_configured: false,
  tmdb_merge: false, tmdb_posters: true,
}

/**
 * Server-backed settings. Owned by the shell rather than the settings form, so
 * the values are available even while the settings drawer is closed.
 */
export function useSettings(): [AppSettings, (patch: Partial<AppSettings>) => Promise<void>] {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS)

  useEffect(() => {
    getSettings().then(s => { setSettings(s); publishTheory(s) }).catch(() => {})
  }, [])

  async function update(patch: Partial<AppSettings>) {
    const s = await putSettings(patch)
    setSettings(s)
    publishTheory(s)
  }

  return [settings, update]
}
