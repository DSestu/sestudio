import { useEffect, useState } from 'react'
import type { AppSettings } from '../../api'
import { getServerLog } from '../../api'
import { useLibraries } from '../../musicLibraries'
import { thisMachine, useActiveServer } from '../../servers'
import { loadPlayerPrefs, qualityValue } from '../../playerPrefs'
import { loadSubtitleStyle } from '../../subtitleStyle'
import { useAiSetup } from '../../useAiSetup'

/** Something to fix, shown above the phone's list and as a dot on the desktop's. */
export interface Problem {
  category: string
  title: string
  text: string
}

/** How long the server has been up: "4 min", "2 h 5 min". */
export function uptime(started: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() / 1000 - started) / 60))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/**
 * What each category's row says on the phone's list of categories, and what
 * needs fixing (docs/SPEC-settings.md §2). The server's uptime is asked once,
 * not polled: the Server category itself follows it.
 */
export function useSettingsStatus(settings: AppSettings): { summary: Record<string, string>; problems: Problem[] } {
  const libraries = useLibraries()
  const active = useActiveServer()
  const [setup] = useAiSetup()
  const [server, setServer] = useState<{ started: number } | null | undefined>()

  // Past the newest line, so the answer carries the start time and no lines.
  useEffect(() => { void getServerLog(Number.MAX_SAFE_INTEGER).then(setServer) }, [])

  const quality = qualityValue(loadPlayerPrefs().quality)
  const subtitles = loadSubtitleStyle()
  const off = settings.disabled_sites?.length ?? 0
  const ai = settings.frame_interpolation !== false

  const summary: Record<string, string> = {
    playback: [
      settings.lang.toUpperCase(),
      quality === 'source' ? 'Source quality' : quality === 'auto' ? 'Auto quality' : `${quality}p`,
      ai ? 'AI frames on' : 'AI frames off',
    ].join(' · '),
    subtitles: [subtitles.fontFamily, `${Math.round(subtitles.fontSize * 100)}%`, subtitles.blur && 'blur'].filter(Boolean).join(' · '),
    sources: [off ? `${off} site${off > 1 ? 's' : ''} off` : 'All sites on', settings.tmdb_configured ? 'TMDB connected' : 'No TMDB key'].join(' · '),
    downloads: settings.download_destination === 'server' ? `Server · ${settings.output_root}` : 'This device',
    music: `${libraries.length} librar${libraries.length === 1 ? 'y' : 'ies'} · ${libraries.reduce((n, l) => n + l.count, 0)} tracks`,
    notifications: !settings.notifications_enabled ? 'Off'
      : settings.callmebot_configured ? 'WhatsApp on' : 'WhatsApp on · number or key missing',
    server: server === undefined ? '' : server ? `Running · up ${uptime(server.started)}` : 'Not answering',
    servers: active ? `Using ${active.name}${active.down ? ' · not answering' : ''}` : thisMachine(),
    share: 'Android app · Google Colab',
  }

  const problems: Problem[] = []
  if (settings.js_runtime === '') {
    problems.push({ category: 'server', title: "YouTube can't play.", text: 'The server needs Node.js or Deno.' })
  }
  if (!settings.tmdb_configured) {
    problems.push({ category: 'sources', title: 'No TMDB key.', text: 'Posters, ratings and Trending are off.' })
  }
  if (ai && setup?.step === 'failed') {
    problems.push({ category: 'playback', title: 'AI frame rates failed to set up.', text: 'Reinstall to try again.' })
  }

  return { summary, problems }
}
