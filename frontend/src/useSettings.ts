import { useEffect, useState } from 'react'
import type { AppSettings } from './api'
import { getSettings, putSettings } from './api'

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
    getSettings().then(setSettings).catch(() => {})
  }, [])

  async function update(patch: Partial<AppSettings>) {
    setSettings(await putSettings(patch))
  }

  return [settings, update]
}
