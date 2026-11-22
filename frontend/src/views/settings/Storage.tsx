import { useRef, useState } from 'react'
import { storagesApi, type StorageInfo } from '../../api'
import AddStorage, { type Kind } from '../../components/storage/AddStorage'
import { StorageGlyph } from '../../components/downloaded/StorageSwitcher'
import { fmtSize, refreshDownloadedLibrary, useDownloadedLibrary } from '../../downloadedLibrary'
import { librariesApi, reloadLibraries, useLibraries } from '../../musicLibraries'
import { NETWORK_KINDS, refreshStorages, sinceLabel, titleCounts, useStorages, whereOf } from '../../storageChoice'

const KIND_LINE: Record<string, string> = {
  ytmusic_account: 'YouTube Music · likes',
}

/** After any change: the switcher, the shelf and the music page all read storages. */
async function refreshAll() {
  await Promise.all([refreshStorages(), refreshDownloadedLibrary(), reloadLibraries().catch(() => {})])
}

function DiskCard({ s, titles, tracks, onLookAround, opened = [], titleCounts: openedTitles }: {
  s: StorageInfo
  titles: number
  tracks?: number
  onLookAround: () => void
  /** For a bridge: the shares opened through it (SPEC-storage §10.5, K1). */
  opened?: StorageInfo[]
  titleCounts?: Map<string, number>
}) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(s.label)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')
  const menu = useRef<HTMLDetailsElement>(null)
  const folder = s.kind === 'folder'
  // A folder or a server read in the app: both hold video (SPEC-storage §9).
  const files = folder || NETWORK_KINDS.includes(s.kind) || s.kind === 'remote_sestudio' || s.kind === 'upnp'
  const away = s.state === 'offline'

  const act = (p: Promise<unknown>) =>
    p.then(refreshAll, e => setError((e as Error).message))
  const close = () => { if (menu.current) menu.current.open = false }
  function toggleRole(role: 'video' | 'music') {
    const roles = s.roles.includes(role) ? s.roles.filter(r => r !== role) : [...s.roles, role]
    if (!roles.length) { setError('A storage holds video, music, or both.'); return }
    setError('')
    void act(storagesApi.edit(s.id, { roles: (['video', 'music'] as const).filter(r => roles.includes(r)) }))
  }

  const used = s.usage ? s.usage.total - s.usage.free : 0
  const counts = [
    s.roles.includes('video') && files ? `${titles} ${titles === 1 ? 'title' : 'titles'}` : '',
    s.roles.includes('music') && tracks !== undefined ? `${tracks} ${tracks === 1 ? 'track' : 'tracks'}` : '',
  ].filter(Boolean).join(' · ')

  return (
    <div className={`rounded-[14px] bg-base-200 p-4 flex flex-col gap-2.5 border-[1.5px] ${s.download ? 'border-success/60' : 'border-transparent'} ${away ? 'opacity-80' : ''}`}>
      <div className="flex items-center gap-2.5 min-h-8">
        <StorageGlyph storage={s} className="w-5 h-5 text-base-content/70" />
        {renaming ? (
          <form className="flex-1 flex gap-1.5" onSubmit={e => { e.preventDefault(); setRenaming(false); void act(storagesApi.edit(s.id, { label: name })) }}>
            <input value={name} onChange={e => setName(e.target.value)} aria-label="Name" className="input input-sm flex-1 min-w-0" autoFocus />
            <button type="submit" className="btn btn-sm btn-primary">Save</button>
          </form>
        ) : (
          <span className="font-semibold flex-1 min-w-0 truncate">
            {s.label}
            {s.bridge && <span className="ml-2 align-middle text-[11px] font-medium rounded-full px-2 py-0.5 bg-base-300 text-base-content/80">Bridge</span>}
            {s.kind === 'upnp' && <span className="ml-2 align-middle text-[11px] font-medium rounded-full px-2 py-0.5 bg-base-300 text-base-content/80">Read only</span>}
          </span>
        )}
        {away
          ? <span className="text-xs rounded-full px-2 py-0.5 bg-error/15 text-error whitespace-nowrap">Offline{s.since ? ` since ${sinceLabel(s.since)}` : ''}</span>
          : <span className="size-2 rounded-full bg-success shrink-0" aria-label="Online" />}
        <details ref={menu} className="dropdown dropdown-end">
          <summary className="btn btn-ghost btn-sm btn-square list-none" aria-label={`More for ${s.label}`}>⋯</summary>
          <ul className="menu dropdown-content z-20 mt-1 w-44 p-1 bg-base-300 rounded-box shadow-lg">
            <li><button type="button" onClick={() => { close(); setName(s.label); setRenaming(true) }}>Rename</button></li>
            {s.kind === 'remote_sestudio' && (
              <li><button type="button" onClick={() => { close(); void act(storagesApi.edit(s.id, { bridge: !s.bridge })) }}>
                {s.bridge ? 'Stop using as a bridge' : 'Use as a bridge'}
              </button></li>
            )}
            {folder && s.roles.includes('music') && (
              <li><button type="button" onClick={() => { close(); void act(librariesApi.reanalyse(s.id)) }}>Reanalyse music</button></li>
            )}
            {s.id !== 'local' && (
              <li><button type="button" className="text-error" onClick={() => { close(); setRemoving(true) }}>Remove</button></li>
            )}
          </ul>
        </details>
      </div>

      {s.bridge && !away && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-48"><BridgeNetworkLine s={s} /></div>
          <button type="button" onClick={onLookAround} className="btn btn-sm btn-primary gap-1.5 max-sm:w-full">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
            Look around
          </button>
        </div>
      )}
      <div className="font-mono text-xs text-base-content/55 break-all">{KIND_LINE[s.kind] ?? whereOf(s)}</div>

      {folder && (
        <>
          <div className="h-2 rounded bg-base-300 overflow-hidden" role="meter" aria-label="Disk used" aria-valuemin={0} aria-valuemax={s.usage?.total ?? 1} aria-valuenow={used}>
            {s.usage && <div className="h-full bg-primary" style={{ width: `${(100 * used) / s.usage.total}%` }} />}
          </div>
          <div className="flex justify-between gap-2 text-xs text-base-content/55">
            <span>{counts}</span>
            <span>{away ? 'away' : s.usage ? `${fmtSize(s.usage.free)} free of ${fmtSize(s.usage.total)}` : ''}</span>
          </div>
        </>
      )}
      {!folder && (counts || away) && (
        <div className="flex justify-between gap-2 text-xs text-base-content/55">
          <span>{counts}</span>
          {away && <span>away</span>}
        </div>
      )}

      <div className="flex gap-1.5" role="group" aria-label="What it holds">
        {(['video', 'music'] as const).map(role => (
          <button
            key={role}
            type="button"
            aria-pressed={s.roles.includes(role)}
            disabled={(!files && role === 'video') || (s.kind === 'upnp' && role === 'music')}
            title={!files && role === 'video' ? 'This kind of storage holds music only, for now'
              : s.kind === 'upnp' && role === 'music' ? 'A media server holds video only, for now' : undefined}
            onClick={() => toggleRole(role)}
            className={`btn btn-sm flex-1 ${s.roles.includes(role) ? 'btn-primary btn-soft' : 'btn-ghost bg-base-300'}`}
          >
            {role === 'video' ? 'Video' : 'Music'}
          </button>
        ))}
      </div>

      {folder && (
        <label className={`flex items-center gap-2 text-sm ${s.download ? 'text-success' : 'text-base-content/60'}`}>
          <input
            type="radio"
            name="download-target"
            className="radio radio-sm radio-success"
            checked={s.download}
            onChange={() => void act(storagesApi.edit(s.id, { download: true }))}
          />
          {s.download ? 'New downloads go here' : 'Send downloads here'}
        </label>
      )}

      {s.bridge && opened.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-base-content/55">Opened through {s.label}</p>
          {opened.map(o => <OpenedRow key={o.id} o={o} titles={openedTitles?.get(o.id) ?? 0} bridge={s} onError={setError} />)}
          {opened.some(o => o.auto && o.wifi) && (
            <p className="text-xs text-base-content/50">
              Saved for {[...new Set(opened.filter(o => o.auto && o.wifi).map(o => o.wifi))].map((w, i) => <span key={w}>{i > 0 && ', '}<b className="text-base-content/70">{w}</b></span>)}: opens by itself when {s.label} joins it again.
            </p>
          )}
        </div>
      )}

      {removing && (
        <div className="rounded-lg bg-base-300 p-3 flex flex-col gap-2">
          <p className="text-sm">Remove “{s.label}”? Its files are not touched; they just stop being listed.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRemoving(false)} className="btn btn-sm btn-ghost">Cancel</button>
            <button type="button" onClick={() => { setRemoving(false); void act(storagesApi.remove(s.id)) }} className="btn btn-sm btn-error">Remove</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-error">{error}</p>}
    </div>
  )
}

/** A share opened through a bridge, inside the bridge's card (K1): Disconnect
 *  closes it and keeps its login; Open opens it again; Forget drops the login. */
function OpenedRow({ o, titles, bridge, onError }: { o: StorageInfo; titles: number; bridge: StorageInfo; onError: (e: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const act = (p: Promise<unknown>) => {
    setBusy(true)
    onError('')
    return p.then(refreshAll, e => onError((e as Error).message)).finally(() => setBusy(false))
  }
  const closed = o.state === 'closed'
  const away = o.state === 'offline'
  return (
    <div className={`rounded-[10px] border border-base-300 bg-base-100 px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 ${closed ? 'opacity-75' : ''}`}>
      <StorageGlyph storage={o} className="w-5 h-5 text-base-content/60" />
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-sm font-semibold truncate">{o.label}</p>
        <p className="font-mono text-xs text-base-content/55 break-all">
          {o.proto === 'upnp' ? `media server · ${o.host} · read only` : `${o.proto}://${o.host}${o.share ? `/${o.share}` : ''}`}
        </p>
        <p className={`text-xs ${away ? 'text-warning' : 'text-base-content/55'}`}>
          {closed
            ? 'Disconnected · its login is kept'
            : away
              ? `Away${o.since ? ` since ${sinceLabel(o.since)}` : ''}${o.wifi ? ` · join ${o.wifi} on ${bridge.label}` : ''}`
              : `${titles} ${titles === 1 ? 'title' : 'titles'}`}
        </p>
      </div>
      <div className="flex gap-1.5 max-sm:ml-8">
        {closed
          ? <button type="button" disabled={busy} onClick={() => void act(storagesApi.edit(o.id, { connected: true }))} className="btn btn-sm btn-primary">{busy ? 'Opening…' : 'Open'}</button>
          : <button type="button" disabled={busy} onClick={() => void act(storagesApi.edit(o.id, { connected: false }))} className="btn btn-sm btn-outline gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" aria-hidden="true"><path d="M12 5l7 8H5zM5 18h14" /></svg>
              Disconnect
            </button>}
        {forgetting
          ? <button type="button" disabled={busy} onClick={() => void act(storagesApi.remove(o.id))} className="btn btn-sm btn-error">Forget it</button>
          : <button type="button" onClick={() => setForgetting(true)} className="btn btn-sm btn-ghost" title="Forget this share and its login">Forget</button>}
      </div>
    </div>
  )
}

/** Where a bridge is (SPEC-storage §10.5, K1): the Wi-Fi it is on, or why that is unknown. */
function BridgeNetworkLine({ s }: { s: StorageInfo }) {
  const wifi = s.network?.wifi
  return (
    <div className="flex items-center gap-1.5 text-xs text-success">
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
        <path d="M2.5 9a14 14 0 0119 0M5.5 12.5a9.5 9.5 0 0113 0M8.6 15.9a5 5 0 016.8 0M12 19h.01" />
      </svg>
      {wifi
        ? <span>Online · on <b className="font-semibold text-base-content">{wifi}</b></span>
        : s.network?.wifi_blocked
          ? <span className="text-warning">Online · allow “Wi-Fi name” on {s.label} to see its network</span>
          : <span>Online · not on Wi-Fi</span>}
    </div>
  )
}

/** Settings › Storage (SPEC-storage §8.2): every place files live, as disk cards. */
export default function Storage() {
  const list = useStorages()
  const counts = titleCounts(useDownloadedLibrary())
  const tracks = new Map(useLibraries().map(l => [l.id, l.count]))
  const [adding, setAdding] = useState<{ kind?: Kind; from?: string } | null>(null)

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* A share opened through a bridge sits inside the bridge's card (K1). */}
        {list.filter(s => s.kind !== 'bridged').map(s => (
          <DiskCard
            key={`${s.id}:${s.label}`}
            s={s}
            titles={counts.get(s.id) ?? 0}
            tracks={tracks.get(s.id)}
            onLookAround={() => setAdding({ kind: 'nearby', from: s.id })}
            opened={list.filter(o => o.kind === 'bridged' && o.via === s.id)}
            titleCounts={counts}
          />
        ))}
      </div>
      <button
        onClick={() => setAdding({})}
        className="self-start flex items-center gap-2 min-h-12 px-1.5 text-[15px] font-medium text-primary"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
        Add a storage
      </button>
      {adding && <AddStorage initial={adding} onClose={() => setAdding(null)} onAdded={() => void refreshAll()} />}
    </>
  )
}
