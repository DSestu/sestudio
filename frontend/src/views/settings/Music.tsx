import { useEffect, useState } from 'react'
import AddLibrary from '../../components/music/crates/AddLibrary'
import { librariesApi, stateLine, useLibraries, type AnalysisStatus, type ShareToken } from '../../musicLibraries'
import { SettingRow, SettingsGroup, ToggleRow } from './rows'
import type { SettingsProps } from './SettingsView'

const KIND_NAME = {
  local: 'This PC',
  local_folder: 'Folder',
  remote_sestudio: 'sestudio server',
  ytmusic_account: 'YouTube Music',
} as const

const FIELD = 'input input-sm h-9 flex-1 min-w-0 bg-base-100 border-0'

const fail = (e: Error) => window.alert(e.message)

/** The tonic-and-mode pass while it runs, polled; undefined when it is idle or done. */
function useModesProgress(): AnalysisStatus['modes'] | undefined {
  const [modes, setModes] = useState<AnalysisStatus['modes']>()
  useEffect(() => {
    let alive = true
    const poll = () => librariesApi.analysisStatus().then(s => { if (alive) setModes(s.modes) }, () => {})
    void poll()
    const id = window.setInterval(poll, 3000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])
  return modes && modes.total > 0 && modes.done < modes.total ? modes : undefined
}

/** Settings › Music: the libraries, the genre model, the YouTube Music cookies file, and the tokens other sestudio servers read this one with. */
export default function Music({ settings, onUpdate }: SettingsProps) {
  const libraries = useLibraries()
  const [adding, setAdding] = useState(false)
  const [cookies, setCookies] = useState(settings.ytmusic_cookies ?? '')
  const [tokens, setTokens] = useState<ShareToken[]>([])
  const [label, setLabel] = useState('')
  const [fresh, setFresh] = useState<{ label: string; token: string }>()

  useEffect(() => { librariesApi.tokens().then(setTokens, () => {}) }, [])
  const modes = useModesProgress()

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
  const reanalyse = (id?: string, name?: string) => {
    const what = name ? `every file in “${name}”` : 'every file in every library'
    if (window.confirm(`Analyse ${what} again? Key, mode, tempo, genre and structure are redone in the background; it can take a while.`)) {
      librariesApi.reanalyse(id).catch(fail)
    }
  }
  const analysed = libraries.filter(l => l.kind === 'local' || l.kind === 'local_folder')

  return (
    <>
      <SettingsGroup title="Libraries">
        {libraries.map(l => (
          <SettingRow
            key={l.id}
            label={<>{l.label} <span className="text-base-content/50 font-normal">· {KIND_NAME[l.kind]}</span></>}
            help={<span className="block truncate">{stateLine(l)} · {l.count} tracks{(l.path ?? l.url) ? ` · ${l.path ?? l.url}` : ''}</span>}
          >
            {analysed.includes(l) && <button onClick={() => reanalyse(l.id, l.label)} className="btn btn-ghost btn-sm">Reanalyse</button>}
            {l.kind !== 'local' && <button onClick={() => remove(l.id, l.label)} className="btn btn-ghost btn-sm">Remove</button>}
          </SettingRow>
        ))}
        {modes && (
          <SettingRow label="Reading tonic and mode" help={`${modes.done} of ${modes.total} tracks`}>
            <progress className="progress progress-primary w-24" value={modes.done} max={modes.total} aria-label="Tonic and mode progress" />
          </SettingRow>
        )}
        <button onClick={() => setAdding(true)} className="mx-3 min-h-14 w-[calc(100%-1.5rem)] text-left text-[15px] font-medium text-primary border-base-300 not-first:border-t">
          Add a library
        </button>
        {analysed.length > 1 && (
          <button onClick={() => reanalyse()} className="mx-3 min-h-14 w-[calc(100%-1.5rem)] text-left text-[15px] font-medium text-primary border-base-300 border-t">
            Reanalyse all libraries
          </button>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Genres"
        footnote="The model is Essentia's Discogs-EffNet, licensed CC BY-NC-SA 4.0 (non-commercial use)."
      >
        <ToggleRow
          label="Detect genres with an AI model"
          help="About 18 MB, downloaded once. Off: file tags, then a guess from tempo and sound"
          checked={settings.music_genre_model !== false}
          onChange={on => void onUpdate({ music_genre_model: on })}
        />
      </SettingsGroup>

      <SettingsGroup title="YouTube Music">
        <SettingRow
          label="Cookies file"
          htmlFor="set-yt-cookies"
          help="A cookies.txt from a signed-in YouTube session, to list your liked songs"
          stacked
        >
          <div className="flex gap-2">
            <input
              id="set-yt-cookies"
              className={`${FIELD} font-mono`}
              placeholder="C:\path\to\cookies.txt"
              value={cookies}
              onChange={e => setCookies(e.target.value)}
            />
            <button onClick={() => void onUpdate({ ytmusic_cookies: cookies })} disabled={cookies === (settings.ytmusic_cookies ?? '')} className="btn btn-sm h-9 btn-primary">Save</button>
          </div>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Share music with another sestudio"
        footnote="A token lets another server list and play this one's music folders, read only. Give each server its own, and revoke it to cut it off."
      >
        <SettingRow label="New token" stacked>
          <div className="flex gap-2">
            <input
              aria-label="Name of the server this token is for"
              className={FIELD}
              placeholder="Who is it for? (e.g. Laptop)"
              value={label}
              onChange={e => setLabel(e.target.value)}
            />
            <button onClick={() => void create()} className="btn btn-sm h-9 btn-primary">Create token</button>
          </div>
          {fresh && (
            <div role="status" className="rounded-lg bg-base-100 p-3 text-sm">
              <p className="text-xs text-base-content/60">Token for {fresh.label}. Copy it now: it is not shown again.</p>
              <code className="block break-all font-mono select-all">{fresh.token}</code>
            </div>
          )}
        </SettingRow>
        {tokens.map(t => (
          <SettingRow key={t.id} label={t.label} help={`Made ${new Date(t.created * 1000).toLocaleDateString()}`}>
            <button onClick={() => revoke(t)} className="btn btn-ghost btn-sm">Revoke</button>
          </SettingRow>
        ))}
      </SettingsGroup>
      {adding && <AddLibrary onClose={() => setAdding(false)} />}
    </>
  )
}
