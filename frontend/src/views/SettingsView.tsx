import { useState } from 'react'
import type { AppSettings } from '../api'

/** Where to get a TMDB key, linked from the field itself. */
const TMDB_GUIDE_URL = 'https://duckkota.gitlab.io/guides/tmdb/'

interface Props {
  settings: AppSettings
  onUpdate: (patch: Partial<AppSettings>) => void | Promise<void>
}

/**
 * Settings as a routed page rather than a modal.
 *
 * Being a real route means the back button, deep links and reloads work through
 * the normal hash routing instead of the modal back-stack, and the fields get
 * room to be grouped. Width is capped because full-width inputs on a desktop
 * content column are hard to scan.
 */
export default function SettingsView({ settings, onUpdate }: Props) {
  // The key is write-only — the server never sends it back — so this field
  // cannot be pre-filled and instead sets or replaces whatever is stored.
  const [keyDraft, setKeyDraft] = useState('')
  const [saving, setSaving] = useState(false)

  async function saveKey(value: string) {
    setSaving(true)
    try {
      await onUpdate({ tmdb_api_key: value })
      setKeyDraft('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <h2 className="text-xl font-semibold tracking-tight">Settings</h2>

      <section aria-labelledby="settings-playback" className="flex flex-col gap-4">
        <h3
          id="settings-playback"
          className="text-xs font-semibold uppercase tracking-wide text-base-content/50"
        >
          Playback
        </h3>

        <div>
          <label htmlFor="set-lang" className="text-sm text-base-content/60 mb-1 block">
            Preferred language
          </label>
          <select
            id="set-lang"
            className="select select-bordered w-full"
            value={settings.lang}
            onChange={e => onUpdate({ lang: e.target.value })}
          >
            <option value="vf">VF</option>
            <option value="vostfr">VOSTFR</option>
            <option value="vo">VO</option>
          </select>
          <p className="text-xs text-base-content/50 mt-1">
            Used when opening a title; a title without it falls back to what it has.
          </p>
        </div>
      </section>

      <div className="divider my-0" />

      <section aria-labelledby="settings-metadata" className="flex flex-col gap-4">
        <h3
          id="settings-metadata"
          className="text-xs font-semibold uppercase tracking-wide text-base-content/50"
        >
          Metadata
        </h3>

        <div>
          <label htmlFor="set-tmdb" className="text-sm text-base-content/60 block">
            TMDB API key
          </label>
          <a
            href={TMDB_GUIDE_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="link link-primary text-xs inline-flex items-center gap-1 mb-1"
          >
            How to get a TMDB API key
            {/* Marks the link as leaving the app, not colour alone. */}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 5h6v6M19 5l-8 8M10 5H5v14h14v-5" />
            </svg>
            <span className="sr-only">(opens in a new tab)</span>
          </a>

          <div className="flex gap-2">
            <input
              id="set-tmdb"
              type="password"
              autoComplete="off"
              spellCheck={false}
              className="input input-bordered w-full font-mono"
              // Never pre-filled: the server returns only whether one is set.
              placeholder={settings.tmdb_configured ? 'Replace the stored key' : 'Paste your key'}
              value={keyDraft}
              onChange={e => setKeyDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && keyDraft.trim()) void saveKey(keyDraft.trim())
              }}
            />
            <button
              onClick={() => void saveKey(keyDraft.trim())}
              disabled={saving || !keyDraft.trim()}
              className="btn btn-primary"
            >
              Save
            </button>
          </div>

          <div className="flex items-center gap-2 mt-1.5">
            {/* State carried by icon and text, never colour alone. */}
            {settings.tmdb_configured ? (
              <span className="text-xs text-success inline-flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Key configured
              </span>
            ) : (
              <span className="text-xs text-base-content/50 inline-flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path strokeLinecap="round" d="M12 8v4m0 4h.01" />
                </svg>
                No key — posters, ratings and Trending stay off
              </span>
            )}
            {settings.tmdb_configured && (
              <button
                onClick={() => void saveKey('')}
                disabled={saving}
                className="btn btn-ghost btn-xs text-error"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="divider my-0" />

      <section aria-labelledby="settings-downloads" className="flex flex-col gap-4">
        <h3
          id="settings-downloads"
          className="text-xs font-semibold uppercase tracking-wide text-base-content/50"
        >
          Downloads
        </h3>

        <div>
          <label htmlFor="set-dest" className="text-sm text-base-content/60 mb-1 block">
            Download to
          </label>
          <select
            id="set-dest"
            className="select select-bordered w-full"
            value={settings.download_destination}
            onChange={e =>
              onUpdate({ download_destination: e.target.value as AppSettings['download_destination'] })
            }
          >
            <option value="server">Server</option>
            <option value="device">This device</option>
          </select>
          <p className="text-xs text-base-content/50 mt-1">
            “This device” streams the file through the server to your browser.
          </p>
        </div>

        <div>
          <label htmlFor="set-output" className="text-sm text-base-content/60 mb-1 block">
            Download folder (server)
          </label>
          <input
            id="set-output"
            className="input input-bordered w-full"
            value={settings.output_root}
            onChange={e => onUpdate({ output_root: e.target.value })}
          />
          <p className="text-xs text-base-content/50 mt-1">
            {settings.download_destination === 'server'
              ? 'Where completed downloads are written on the server.'
              : 'Only used when downloading to the server.'}
          </p>
        </div>
      </section>
    </div>
  )
}
