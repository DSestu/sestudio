import { useEffect, useState } from 'react'
import type { SiteInfo } from '../../api'
import { getSites } from '../../api'
import { ExternalLink, LinkRow, RowSelect, SettingRow, SettingsGroup, ToggleRow } from './rows'
import type { SettingsProps } from './SettingsView'

/** Where to get a TMDB key, linked from the field itself. */
const TMDB_GUIDE_URL = 'https://duckkota.gitlab.io/guides/tmdb/'

/** Settings › Sources & search: which sites are searched, how results fold, the TMDB key and the Twitch token. */
export default function Sources({ settings, onUpdate }: SettingsProps) {
  // The key is write-only — the server never sends it back — so this field
  // cannot be pre-filled and instead sets or replaces whatever is stored.
  const [keyDraft, setKeyDraft] = useState('')
  const [twitchDraft, setTwitchDraft] = useState('')
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

  async function saveTwitch(value: string) {
    setSaving(true)
    try {
      await onUpdate({ twitch_auth_token: value })
      setTwitchDraft('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SettingsGroup
        title="Sites searched"
        footnote="Off only hides a site from search: what you saved from it still plays and downloads."
      >
        {sites.length === 0 ? (
          <SettingRow label="No sources available" />
        ) : sites.map(site => (
          <ToggleRow
            key={site.id}
            label={site.display_name}
            help={site.url && <ExternalLink href={site.url}>{new URL(site.url).hostname}</ExternalLink>}
            checked={!disabled.includes(site.id)}
            onChange={on => toggleSite(site.id, on)}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup title="Results">
        <SettingRow
          label="Preferred source"
          htmlFor="set-preferred-site"
          help="Listed first, and used when several sites have the same title"
        >
          <RowSelect
            id="set-preferred-site"
            value={settings.preferred_site ?? ''}
            onChange={e => onUpdate({ preferred_site: e.target.value })}
          >
            {sites.map(site => <option key={site.id} value={site.id}>{site.display_name}</option>)}
          </RowSelect>
        </SettingRow>
        <ToggleRow
          label="One card per show"
          help="A show's seasons fold into one result; off lists each season"
          checked={settings.collapse_seasons !== false}
          onChange={on => onUpdate({ collapse_seasons: on })}
        />
      </SettingsGroup>

      <SettingsGroup
        title="TMDB"
        footnote={<ExternalLink href={TMDB_GUIDE_URL} className="text-primary">How to get a TMDB API key</ExternalLink>}
      >
        <SettingRow
          label="API key"
          htmlFor="set-tmdb"
          // State carried by icon and text, never colour alone.
          help={settings.tmdb_configured
            ? <span className="text-success">✓ Stored: posters, ratings and Trending are on</span>
            : 'No key: posters, ratings and Trending stay off'}
          stacked
        >
          <div className="flex gap-2">
            <input
              id="set-tmdb"
              type="password"
              autoComplete="off"
              spellCheck={false}
              className="input input-sm h-9 flex-1 min-w-0 bg-base-100 border-0 font-mono"
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
              className="btn btn-sm h-9 btn-primary"
            >
              Save
            </button>
            {settings.tmdb_configured && (
              <button onClick={() => void saveKey('')} disabled={saving} className="btn btn-sm h-9 btn-ghost text-error">
                Remove
              </button>
            )}
          </div>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Twitch"
        footnote="Signed in on twitch.tv, open the browser's developer tools (F12) › Application › Cookies › twitch.tv and copy auth-token. It acts as your Twitch login and stays on this server; logging out of Twitch in that browser ends it."
      >
        <SettingRow
          label="Account token"
          htmlFor="set-twitch"
          // State carried by icon and text, never colour alone.
          help={settings.twitch_configured
            ? <span className="text-success">✓ Stored: your subscriptions' VODs play here</span>
            : 'No token: subscriber-only VODs stay locked'}
          stacked
        >
          <div className="flex gap-2">
            <input
              id="set-twitch"
              type="password"
              autoComplete="off"
              spellCheck={false}
              className="input input-sm h-9 flex-1 min-w-0 bg-base-100 border-0 font-mono"
              // Never pre-filled: the server returns only whether one is set.
              placeholder={settings.twitch_configured ? 'Replace the stored token' : 'Paste auth-token'}
              value={twitchDraft}
              onChange={e => setTwitchDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && twitchDraft.trim()) void saveTwitch(twitchDraft.trim())
              }}
            />
            <button
              onClick={() => void saveTwitch(twitchDraft.trim())}
              disabled={saving || !twitchDraft.trim()}
              className="btn btn-sm h-9 btn-primary"
            >
              Save
            </button>
            {settings.twitch_configured && (
              <button onClick={() => void saveTwitch('')} disabled={saving} className="btn btn-sm h-9 btn-ghost text-error">
                Remove
              </button>
            )}
          </div>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup>
        <LinkRow
          href="#/creators"
          label="YouTube & Twitch"
          help="Follow channels, pick which download on their own, import subscriptions"
        />
      </SettingsGroup>
    </>
  )
}
