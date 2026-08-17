import { useEffect, useState } from 'react'
import RankRow from '../components/RankRow'
import { DEFAULT_HOST_ORDER } from '../downloadPrefs'
import type { AppSettings, SiteInfo } from '../api'
import { getSites } from '../api'
import type { SubtitleStyle } from '../subtitleStyle'
import {
  DEFAULT_SUBTITLE_STYLE,
  FONT_FAMILIES,
  loadSubtitleStyle,
  saveSubtitleStyle,
} from '../subtitleStyle'

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
  const [sites, setSites] = useState<SiteInfo[]>([])

  useEffect(() => { void getSites().then(setSites) }, [])

  const disabled = settings.disabled_sites ?? []

  function toggleSite(id: string, enabled: boolean) {
    const next = enabled ? disabled.filter(s => s !== id) : [...disabled, id]
    void onUpdate({ disabled_sites: next })
  }

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

        <div>
          <label className="flex items-center gap-3 cursor-pointer text-sm">
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-sm"
              checked={settings.autoplay_on_open !== false}
              onChange={e => onUpdate({ autoplay_on_open: e.target.checked })}
            />
            <span>Play on open</span>
          </label>
          <p className="text-xs text-base-content/50 mt-1">
            Off means opening a title only shows its description and episodes —
            nothing starts until you press play, so whatever you are already
            watching keeps running.
          </p>
        </div>

        <div>
          <label className="flex items-center gap-3 cursor-pointer text-sm">
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-sm"
              checked={settings.collapse_seasons !== false}
              onChange={e => onUpdate({ collapse_seasons: e.target.checked })}
            />
            <span>One card per show in search</span>
          </label>
          <p className="text-xs text-base-content/50 mt-1">
            A show's seasons fold into a single result carrying the season count.
            Off lists every season as its own card.
          </p>
        </div>
      </section>

      <div className="divider my-0" />

      <SubtitleStyleSection />

      <div className="divider my-0" />

      <section aria-labelledby="settings-sources" className="flex flex-col gap-4">
        <h3
          id="settings-sources"
          className="text-xs font-semibold uppercase tracking-wide text-base-content/50"
        >
          Sources
        </h3>

        {sites.length === 0 ? (
          <p className="text-sm text-base-content/50">No sources available.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sites.map(site => (
              <label
                key={site.id}
                className="flex items-center gap-3 cursor-pointer text-sm"
              >
                <input
                  type="checkbox"
                  className="toggle toggle-primary toggle-sm"
                  checked={!disabled.includes(site.id)}
                  onChange={e => toggleSite(site.id, e.target.checked)}
                />
                <span>{site.display_name}</span>
              </label>
            ))}
          </div>
        )}
        <p className="text-xs text-base-content/50">
          Which sites searches look in. Turning one off only hides it from
          search — titles already saved from it still play and download.
        </p>

        <div>
          <label htmlFor="set-preferred-site" className="text-sm text-base-content/60 mb-1 block">
            Preferred source
          </label>
          <select
            id="set-preferred-site"
            className="select select-bordered w-full"
            value={settings.preferred_site ?? ''}
            onChange={e => onUpdate({ preferred_site: e.target.value })}
          >
            {sites.map(site => (
              <option key={site.id} value={site.id}>{site.display_name}</option>
            ))}
          </select>
          <p className="text-xs text-base-content/50 mt-1">
            Listed first in search results, and the one you get when the same
            title is found on several sites.
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
          <span className="text-sm text-base-content/60 mb-1 block">Download order</span>
          <p className="text-xs text-base-content/50 mb-2 leading-snug">
            Click a chip to add it to the order — the first click is choice 1,
            the next is choice 2, and so on; click a numbered chip to take it
            out. A download tries your order from the top and moves to the next
            one whenever a site or host fails, so the order decides what is used
            first, never what is possible. Unnumbered entries are still tried,
            after the numbered ones. Senpai Stream leads by default because it
            serves its own files, so there is no third-party host to be down.
          </p>
          <div className="flex flex-col gap-2">
            <RankRow
              label="Site"
              options={sites.map(site => ({ value: site.id, label: site.display_name }))}
              order={settings.preferred_sites ?? []}
              onChange={order => void onUpdate({ preferred_sites: order })}
            />
            <RankRow
              label="Host"
              options={(settings.known_hosts ?? []).map(h => ({ value: h, label: h }))}
              order={settings.preferred_hosts ?? []}
              onChange={order => void onUpdate({ preferred_hosts: order })}
            />
          </div>
          <button
            onClick={() =>
              void onUpdate({
                preferred_sites: ['senpai'],
                preferred_hosts: settings.default_hosts ?? DEFAULT_HOST_ORDER,
              })
            }
            className="btn btn-ghost btn-xs mt-2"
          >
            Reset order
          </button>
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

/** Percent label for a 0–1 opacity, e.g. 0.6 → "60%". */
function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

/**
 * Subtitle appearance controls.
 *
 * Self-contained rather than driven by `onUpdate`: these live in player
 * preferences (which already sync server-side), not in AppSettings, so the
 * section owns its own state and writes straight through.
 */
function SubtitleStyleSection() {
  const [style, setStyle] = useState(loadSubtitleStyle)

  function update(patch: Partial<SubtitleStyle>) {
    setStyle(saveSubtitleStyle(patch))
  }

  return (
    <section aria-labelledby="settings-subtitles" className="flex flex-col gap-4">
      <h3
        id="settings-subtitles"
        className="text-xs font-semibold uppercase tracking-wide text-base-content/50"
      >
        Subtitles
      </h3>

      {/* Live preview over a busy backdrop — a box that looks fine on flat grey
          can still be unreadable on animation, which is the real use case. */}
      <div className="rounded-lg p-4 flex items-end justify-center min-h-24 bg-[repeating-linear-gradient(45deg,#1f2937_0,#1f2937_10px,#4b5563_10px,#4b5563_20px)]">
        <span
          className="px-2 py-0.5 rounded leading-snug text-center"
          style={{
            fontFamily: FONT_FAMILIES[style.fontFamily],
            fontSize: `${style.fontSize * 1.125}rem`,
            color: `rgba(255,255,255,${style.textOpacity})`,
            backgroundColor: `rgba(0,0,0,${style.bgOpacity})`,
            backdropFilter: style.blur ? 'blur(8px)' : undefined,
            textShadow: style.shadow ? '0 0 2px rgba(0,0,0,.9)' : 'none',
          }}
        >
          Subtitles look like this
        </span>
      </div>

      <div>
        <label htmlFor="set-sub-font" className="text-sm text-base-content/60 mb-1 block">
          Font
        </label>
        <select
          id="set-sub-font"
          className="select select-bordered w-full"
          value={style.fontFamily}
          onChange={e => update({ fontFamily: e.target.value })}
        >
          {Object.keys(FONT_FAMILIES).map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <p className="text-xs text-base-content/50 mt-1">
          Sans-serif reads best at a distance; the wide variant helps on small
          screens by keeping I, l and 1 distinct.
        </p>
      </div>

      <div>
        <label htmlFor="set-sub-size" className="text-sm text-base-content/60 mb-1 block">
          Size — {pct(style.fontSize)}
        </label>
        <input
          id="set-sub-size"
          type="range"
          className="range range-primary range-sm"
          min={0.5}
          max={2}
          step={0.05}
          value={style.fontSize}
          onChange={e => update({ fontSize: Number(e.target.value) })}
        />
      </div>

      <div>
        <label htmlFor="set-sub-pip-size" className="text-sm text-base-content/60 mb-1 block">
          Size in picture-in-picture — {pct(style.pipFontSize)}
        </label>
        <input
          id="set-sub-pip-size"
          type="range"
          className="range range-primary range-sm"
          min={0.5}
          max={3}
          step={0.05}
          value={style.pipFontSize}
          onChange={e => update({ pipFontSize: Number(e.target.value) })}
        />
        <p className="text-xs text-base-content/50 mt-1">
          Used instead of the size above while popped out, where the window is a
          fraction of the width. Adjusting this updates an open PiP window live.
        </p>
      </div>

      <div>
        <label htmlFor="set-sub-bg" className="text-sm text-base-content/60 mb-1 block">
          Background opacity — {pct(style.bgOpacity)}
        </label>
        <input
          id="set-sub-bg"
          type="range"
          className="range range-primary range-sm"
          min={0}
          max={1}
          step={0.05}
          value={style.bgOpacity}
          onChange={e => update({ bgOpacity: Number(e.target.value) })}
        />
        <p className="text-xs text-base-content/50 mt-1">
          The box behind the text. Around 60% stays readable over animation
          without blocking much of the picture.
        </p>
      </div>

      <div>
        <label className="flex items-center gap-3 cursor-pointer text-sm">
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm"
            checked={style.blur}
            onChange={e => update({ blur: e.target.checked })}
          />
          <span>Blur behind text</span>
        </label>
        <p className="text-xs text-base-content/50 mt-1">
          Frosts the picture behind each line. Independent of the background
          opacity above, so it stays visible even at 0% — turn it off here.
        </p>
      </div>

      <div>
        <label className="flex items-center gap-3 cursor-pointer text-sm">
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm"
            checked={style.shadow}
            onChange={e => update({ shadow: e.target.checked })}
          />
          <span>Outline</span>
        </label>
        <p className="text-xs text-base-content/50 mt-1">
          An outline on every side, as a fallback wherever the background box is
          too faint.
        </p>
      </div>

      <div>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => setStyle(saveSubtitleStyle(DEFAULT_SUBTITLE_STYLE))}
        >
          Reset to defaults
        </button>
      </div>
    </section>
  )
}
