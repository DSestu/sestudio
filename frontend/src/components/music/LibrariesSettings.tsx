import { useEffect, useState } from 'react'
import type { AppSettings } from '../../api'
import { librariesApi, stateLine, useLibraries, type ShareToken } from '../../musicLibraries'
import AddLibrary from './crates/AddLibrary'

const KIND_NAME = {
  local: 'This PC',
  local_folder: 'Folder',
  remote_sestudio: 'sestudio server',
  ytmusic_account: 'YouTube Music',
} as const

const fail = (e: Error) => window.alert(e.message)

/** Settings: the music libraries, the YouTube Music cookies file, and the tokens other sestudio servers read this one with. */
export default function LibrariesSettings({ settings, onUpdate }: {
  settings: AppSettings
  onUpdate: (patch: Partial<AppSettings>) => Promise<void> | void
}) {
  const libraries = useLibraries()
  const [adding, setAdding] = useState(false)
  const [cookies, setCookies] = useState(settings.ytmusic_cookies ?? '')
  const [tokens, setTokens] = useState<ShareToken[]>([])
  const [label, setLabel] = useState('')
  const [fresh, setFresh] = useState<{ label: string; token: string }>()

  useEffect(() => { librariesApi.tokens().then(setTokens, () => {}) }, [])

  const create = () =>
    librariesApi.createToken(label).then(t => {
      setFresh({ label: t.label, token: t.token })
      setLabel('')
      return librariesApi.tokens().then(setTokens)
    }, fail)
  const revoke = (t: ShareToken) => {
    if (!window.confirm(`Revoke “${t.label}”? Servers using it lose access at once.`)) return
    librariesApi.revokeToken(t.id).then(() => { setFresh(undefined); return librariesApi.tokens().then(setTokens) }, fail)
  }
  const remove = (id: string, name: string) => {
    if (window.confirm(`Remove “${name}” from the libraries? Its files are not touched.`)) librariesApi.remove(id).catch(fail)
  }

  return (
    <section aria-labelledby="settings-music" className="flex flex-col gap-4">
      <h3 id="settings-music" className="text-xs font-semibold uppercase tracking-wide text-base-content/50">Music libraries</h3>

      <ul className="flex flex-col gap-1">
        {libraries.map(l => (
          <li key={l.id} className="flex items-center gap-3 text-sm">
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate">{l.label} <span className="text-base-content/50">· {KIND_NAME[l.kind]}</span></span>
              <span className="block truncate text-xs text-base-content/50">
                {l.path ?? l.url ?? ''}{(l.path ?? l.url) ? ' · ' : ''}{stateLine(l)} · {l.count} tracks
              </span>
            </span>
            {l.kind !== 'local' && <button onClick={() => remove(l.id, l.label)} className="btn btn-ghost btn-xs">Remove</button>}
          </li>
        ))}
      </ul>
      <div><button onClick={() => setAdding(true)} className="btn btn-sm">Add a library</button></div>

      <div>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm"
            checked={settings.music_genre_model !== false}
            onChange={e => void onUpdate({ music_genre_model: e.target.checked })}
          />
          <span>Detect genres with an AI model (downloads about 18 MB once)</span>
        </label>
        <p className="text-xs text-base-content/50 mt-1">
          A track's genre is its file tag when it has one, else what the model hears, else a guess from tempo and sound. Off means tags and the guess only.
          The model is Essentia's Discogs-EffNet, licensed CC BY-NC-SA 4.0 (non-commercial use).
        </p>
      </div>

      <div>
        <label htmlFor="set-yt-cookies" className="text-sm text-base-content/60 mb-1 block">YouTube Music cookies file</label>
        <div className="flex gap-2">
          <input
            id="set-yt-cookies"
            className="input input-bordered w-full font-mono"
            placeholder="C:\path\to\cookies.txt"
            value={cookies}
            onChange={e => setCookies(e.target.value)}
          />
          <button onClick={() => void onUpdate({ ytmusic_cookies: cookies })} disabled={cookies === (settings.ytmusic_cookies ?? '')} className="btn btn-primary">Save</button>
        </div>
        <p className="text-xs text-base-content/50 mt-1">A cookies.txt exported from a signed-in YouTube session. It lists your liked songs; without it the YouTube Music library needs a sign-in.</p>
      </div>

      <div>
        <h4 className="text-sm font-medium">Share music with another sestudio</h4>
        <p className="text-xs text-base-content/50 mb-2">A token lets another server list and play the music folders of this one (read only). Give each server its own, and revoke it to cut it off.</p>
        <div className="flex gap-2">
          <input
            aria-label="Name of the server this token is for"
            className="input input-bordered w-full"
            placeholder="Who is it for? (e.g. Laptop)"
            value={label}
            onChange={e => setLabel(e.target.value)}
          />
          <button onClick={() => void create()} className="btn btn-primary">Create token</button>
        </div>
        {fresh && (
          <div role="status" className="mt-2 rounded-xl bg-base-200 p-3 text-sm">
            <p className="text-xs text-base-content/60">Token for {fresh.label}. Copy it now: it is not shown again.</p>
            <code className="block break-all font-mono select-all">{fresh.token}</code>
          </div>
        )}
        <ul className="mt-2 flex flex-col gap-1">
          {tokens.map(t => (
            <li key={t.id} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{t.label} <span className="text-xs text-base-content/50">· made {new Date(t.created * 1000).toLocaleDateString()}</span></span>
              <button onClick={() => revoke(t)} className="btn btn-ghost btn-xs">Revoke</button>
            </li>
          ))}
        </ul>
      </div>
      {adding && <AddLibrary onClose={() => setAdding(false)} />}
    </section>
  )
}
