import { useState } from 'react'
import type { SettingsProps } from './SettingsView'

/** Where to get a CallMeBot key — you message their bot and it replies with one. */
const CALLMEBOT_GUIDE_URL = 'https://www.callmebot.com/blog/free-api-whatsapp-messages/'

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
    <section aria-labelledby="settings-notifications" className="flex flex-col gap-4">
      <h3
        id="settings-notifications"
        className="text-xs font-semibold uppercase tracking-wide text-base-content/50"
      >
        Notifications
      </h3>

      <div>
        <label className="flex items-center gap-3 cursor-pointer text-sm">
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm"
            checked={settings.notifications_enabled === true}
            onChange={e => onUpdate({ notifications_enabled: e.target.checked })}
          />
          <span>Message me on WhatsApp</span>
        </label>
        <p className="text-xs text-base-content/50 mt-1">
          One message per watcher per check, listing what it found. The Activity feed
          always records everything either way.
        </p>
      </div>

      <div>
        <label htmlFor="set-cmb-phone" className="text-sm text-base-content/60 block">
          WhatsApp number
        </label>
        <a
          href={CALLMEBOT_GUIDE_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="link link-primary text-xs inline-flex items-center gap-1 mb-1"
        >
          How to get a CallMeBot key
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 5h6v6M19 5l-8 8M10 5H5v14h14v-5" />
          </svg>
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <input
          id="set-cmb-phone"
          type="tel"
          autoComplete="off"
          className="input input-bordered w-full font-mono"
          placeholder="33612345678"
          value={phone}
          onChange={e => setPhone(e.target.value)}
        />
        <p className="text-xs text-base-content/50 mt-1">
          International format without the leading “+”.
        </p>
      </div>

      <div>
        <label htmlFor="set-cmb-key" className="text-sm text-base-content/60 mb-1 block">
          CallMeBot API key
        </label>
        <div className="flex gap-2">
          <input
            id="set-cmb-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="input input-bordered w-full font-mono"
            placeholder={
              settings.callmebot_configured ? 'Replace the stored key' : 'Paste your key'
            }
            value={keyDraft}
            onChange={e => setKeyDraft(e.target.value)}
          />
          <button
            onClick={() => void save()}
            disabled={saving || (!keyDraft.trim() && phone === (settings.callmebot_phone ?? ''))}
            className="btn btn-primary"
          >
            Save
          </button>
        </div>
        <p className="text-xs text-base-content/50 mt-1">
          {settings.callmebot_configured
            ? '✓ Number and key stored.'
            : 'Both a number and a key are needed before anything is sent.'}
        </p>
      </div>
    </section>
  )
}
