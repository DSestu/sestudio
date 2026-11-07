import { useState } from 'react'
import { ExternalLink, RowSelect, SettingRow, SettingsGroup, ToggleRow } from './rows'
import { INTERVALS } from '../../watcherKinds'
import type { SettingsProps } from './SettingsView'

/** Where to get a CallMeBot key — you message their bot and it replies with one. */
const CALLMEBOT_GUIDE_URL = 'https://www.callmebot.com/blog/free-api-whatsapp-messages/'

const SOURCES = [
  { key: 'watcher_interval_twitch', label: 'Twitch channels', fallback: 300 },
  { key: 'watcher_interval_youtube', label: 'YouTube channels', fallback: 86400 },
  { key: 'watcher_interval_other', label: 'Episodes, films and searches', fallback: 86400 },
] as const

const FIELD = 'input input-sm h-9 w-full bg-base-100 border-0 font-mono'

/**
 * Settings › Notifications: outbound messages for watcher findings.
 *
 * WhatsApp via CallMeBot: unofficial and rate-limited, but it needs no business
 * account, no registered number and no template approval. Messages are coalesced
 * to one per watcher per check, so a whole season arriving is a single message.
 *
 * The key is write-only, exactly like the TMDB one — the server returns only
 * whether a number and key are both stored.
 */
export default function Notifications({ settings, onUpdate }: SettingsProps) {
  const [phone, setPhone] = useState(settings.callmebot_phone ?? '')
  const [keyDraft, setKeyDraft] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await onUpdate({
        callmebot_phone: phone.replace(/\D/g, ''),
        ...(keyDraft.trim() ? { callmebot_apikey: keyDraft.trim() } : {}),
      })
      setKeyDraft('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SettingsGroup>
        <ToggleRow
          label="Message me on WhatsApp"
          help="One message per watcher per check; Activity keeps everything either way"
          checked={settings.notifications_enabled === true}
          onChange={on => onUpdate({ notifications_enabled: on })}
        />
      </SettingsGroup>

      <SettingsGroup
        title="How often watchers check"
        footnote="For watchers set to Default. A watcher’s own frequency, in Activity, overrides it."
      >
        {SOURCES.map(s => (
          <SettingRow key={s.key} label={s.label} htmlFor={`set-${s.key}`}>
            <RowSelect
              id={`set-${s.key}`}
              value={settings[s.key] ?? s.fallback}
              onChange={e => onUpdate({ [s.key]: Number(e.target.value) })}
            >
              {INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
            </RowSelect>
          </SettingRow>
        ))}
      </SettingsGroup>

      <SettingsGroup
        title="CallMeBot"
        footnote={
          <div className="flex flex-col gap-1">
            {/* State carried by text, never colour alone. */}
            <span className={settings.callmebot_configured ? 'text-success' : ''}>
              {settings.callmebot_configured
                ? '✓ Number and key stored.'
                : 'Both a number and a key are needed before anything is sent.'}
            </span>
            <ExternalLink href={CALLMEBOT_GUIDE_URL} className="text-primary self-start">How to get a CallMeBot key</ExternalLink>
          </div>
        }
      >
        <SettingRow label="WhatsApp number" htmlFor="set-cmb-phone" help="International format, without the “+”" stacked>
          <input
            id="set-cmb-phone"
            type="tel"
            autoComplete="off"
            className={FIELD}
            placeholder="33612345678"
            value={phone}
            onChange={e => setPhone(e.target.value)}
          />
        </SettingRow>
        <SettingRow label="API key" htmlFor="set-cmb-key" stacked>
          <div className="flex gap-2">
            <input
              id="set-cmb-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              className={FIELD}
              placeholder={settings.callmebot_configured ? 'Replace the stored key' : 'Paste your key'}
              value={keyDraft}
              onChange={e => setKeyDraft(e.target.value)}
            />
            <button
              onClick={() => void save()}
              disabled={saving || (!keyDraft.trim() && phone === (settings.callmebot_phone ?? ''))}
              className="btn btn-sm h-9 btn-primary"
            >
              Save
            </button>
          </div>
        </SettingRow>
      </SettingsGroup>
    </>
  )
}
