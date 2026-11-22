import { useEffect, useMemo, useState } from 'react'
import { transfersApi, type OnConflict, type StorageInfo } from '../../api'
import { fmtSize } from '../../downloadedLibrary'
import { sinceLabel, useStorages, whereOf } from '../../storageChoice'
import { commonDir, destFor, refreshTransfers, relOf, writable, type TransferRequest } from '../../transfers'
import { useModalBack } from '../../useModalBack'
import ResponsiveModal from '../ResponsiveModal'
import { StorageGlyph } from '../downloaded/StorageSwitcher'

const CLASH: [OnConflict, string, string][] = [
  ['skip', 'Skip', 'Files that are already there are left alone.'],
  ['replace', 'Replace', 'Files that are already there are overwritten.'],
  ['keep_both', 'Keep both', 'The new copy is saved beside it as “name (2)”.'],
]

/** Can it take `bytes`? A server says nothing about its room, so it is given the benefit. */
function fit(s: StorageInfo, bytes: number): { ok: boolean; text: string } {
  if (s.state === 'offline') return { ok: false, text: `Offline${s.since ? ` since ${sinceLabel(s.since)}` : ''}` }
  if (!s.usage) return { ok: true, text: 'Free space not known' }
  if (s.usage.free < bytes) return { ok: false, text: `Not enough room: needs ${fmtSize(bytes)}, ${fmtSize(s.usage.free)} free` }
  return { ok: true, text: `Fits · ${fmtSize(s.usage.free)} free` }
}

/**
 * Where to copy or move files, and what to do with ones already there (SPEC-storage
 * §9, X2, picker P2): the other storages with their room, a folder chooser inside
 * the one picked, and the conflict rule. A full page on a phone, two columns on a
 * desktop.
 */
export default function TransferPicker({ request, onClose }: { request: TransferRequest; onClose: () => void }) {
  useModalBack(true, onClose)
  const { mode, name, entries } = request
  const verb = mode === 'copy' ? 'Copy' : 'Move'
  const all = useStorages()
  const sources = useMemo(() => new Set(entries.map(e => e.file.storage ?? 'local')), [entries])
  const total = entries.reduce((n, e) => n + e.file.size, 0)
  const dests = all.filter(s => writable(s) && !sources.has(s.id))
  // A share opened through a bridge on either side: whose files a move deletes.
  const bridgedFrom = [...sources].map(id => all.find(s => s.id === id)).find(s => s?.kind === 'bridged')
  const bridgedSide = bridgedFrom ?? (dests.find(s => s.id === to)?.kind === 'bridged' ? dests.find(s => s.id === to) : undefined)
  const fromLabel = [...sources].map(id => all.find(s => s.id === id)?.label ?? id).join(' + ')

  const [to, setTo] = useState(() => dests.find(s => fit(s, total).ok)?.id ?? '')
  const dest = dests.find(s => s.id === to)
  const [other, setOther] = useState(false)
  const [path, setPath] = useState<string[]>([])
  // Keyed by what was listed, so a stale answer reads as still loading.
  const [listed, setListed] = useState<{ key: string; folders: string[] } | null>(null)
  const key = `${to}:${path.join('/')}`
  const folders = listed?.key === key ? listed.folders : null
  const [naming, setNaming] = useState<string | null>(null)
  const [clash, setClash] = useState<OnConflict>('skip')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  // A move to or from a share opened through a bridge asks first (SPEC-storage §10.5, A).
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!other || !to) return
    let live = true
    transfersApi.folders(to, path.join('/'))
      .then(r => { if (live) setListed({ key, folders: r.folders }) })
      .catch((e: Error) => { if (live) { setListed({ key, folders: [] }); setError(e.message) } })
    return () => { live = false }
  }, [other, to, path, key])

  const pickDest = (id: string) => { setTo(id); setPath([]); setError(null) }
  const here = commonDir(entries.map(e => relOf(e.file)))
  const files = entries.length === 1 ? '1 file' : `${entries.length} files`

  async function start(as: 'copy' | 'move' = mode) {
    if (!dest) return
    setBusy(true)
    setError(null)
    try {
      await transfersApi.start({
        files: entries.map(e => e.file.path),
        to: dest.id,
        mode: as,
        on_conflict: clash,
        dests: other ? entries.map(e => destFor(e, path.join('/'))) : undefined,
        label: name,
      })
      void refreshTransfers()
      setStarted(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const box = 'max-w-3xl max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:rounded-none flex flex-col'

  if (started) {
    return (
      <ResponsiveModal onClose={onClose} boxClassName="max-w-md">
        <h3 className="font-semibold text-lg">{mode === 'copy' ? 'Copying' : 'Moving'} {files} to {dest?.label}</h3>
        <p className="text-sm text-base-content/60 mt-2">
          It runs on the server, so this page can close. Follow it in the Queue tab.
        </p>
        <div className="modal-action"><button onClick={onClose} className="btn btn-sm btn-primary">OK</button></div>
      </ResponsiveModal>
    )
  }

  return (
    <ResponsiveModal onClose={onClose} boxClassName={box}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-lg truncate">{verb} {name} to…</h3>
          <p className="text-sm text-base-content/50">{files} · {fmtSize(total)} · now on {fromLabel}</p>
        </div>
        <button onClick={onClose} className="btn btn-ghost btn-square btn-sm" aria-label="Close">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 mt-4 flex-1 overflow-y-auto min-h-0">
        <section className="sm:col-start-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-base-content/50 mb-2">Where to</p>
          {dests.length === 0 && <p className="text-sm text-base-content/60">No other storage can take files. Add one in Settings › Storage.</p>}
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Where to">
            {dests.map(s => {
              const f = fit(s, total)
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={s.id === to}
                  disabled={!f.ok}
                  onClick={() => pickDest(s.id)}
                  className={`flex items-start gap-2.5 text-left rounded-box border px-3 py-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    s.id === to ? 'border-primary bg-primary/10' : 'border-base-300 hover:border-primary/50'
                  }`}
                >
                  <span className={`mt-1 w-3.5 h-3.5 rounded-full border-2 shrink-0 ${s.id === to ? 'border-primary bg-primary' : 'border-base-content/40'}`} />
                  <StorageGlyph storage={s} className="w-4.5 h-4.5 mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className="block font-mono text-xs text-base-content/50 truncate">{whereOf(s)}</span>
                    <span className={`block text-xs mt-0.5 ${f.ok ? 'text-success' : 'text-error'}`}>{f.text}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {dest && (
          <section className="sm:col-start-2 sm:row-start-1 sm:row-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-base-content/50 mb-2">Folder on {dest.label}</p>
            <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
              <input type="radio" className="radio radio-primary radio-sm mt-0.5" checked={!other} onChange={() => setOther(false)} />
              <span className="min-w-0">
                <span className="block text-sm">Same place as now</span>
                <span className="block font-mono text-xs text-base-content/50 break-all">{[whereOf(dest), here].filter(Boolean).join('/')}</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
              <input type="radio" className="radio radio-primary radio-sm mt-0.5" checked={other} onChange={() => setOther(true)} />
              <span className="text-sm">Pick another folder</span>
            </label>
            {other && (
              <div className="mt-1 rounded-box border border-base-300 p-2">
                <nav aria-label="Folder" className="flex items-center gap-1 flex-wrap text-sm px-1 pb-1.5">
                  <StorageGlyph storage={dest} />
                  <button type="button" onClick={() => setPath([])} className="link link-hover">{dest.label}</button>
                  {path.map((part, i) => (
                    <span key={`${part}-${i}`} className="flex items-center gap-1">
                      <span className="text-base-content/30">›</span>
                      {i === path.length - 1
                        ? <b className="font-semibold">{part}</b>
                        : <button type="button" onClick={() => setPath(path.slice(0, i + 1))} className="link link-hover">{part}</button>}
                    </span>
                  ))}
                </nav>
                <ul className="flex flex-col max-h-56 overflow-y-auto">
                  {folders === null && <li className="px-2 py-2"><span className="loading loading-spinner loading-xs" /></li>}
                  {folders?.map(f => (
                    <li key={f}>
                      <button type="button" onClick={() => setPath([...path, f])} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-box hover:bg-base-300/60 text-sm text-left">
                        <svg className="w-4 h-4 text-base-content/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-6L9 5H6a2 2 0 00-2 2z" /></svg>
                        <span className="truncate">{f}</span>
                      </button>
                    </li>
                  ))}
                  {folders?.length === 0 && <li className="px-2 py-1.5 text-xs text-base-content/50">No folders here.</li>}
                  <li>
                    {naming === null ? (
                      <button type="button" onClick={() => setNaming('')} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-box hover:bg-base-300/60 text-sm text-left">
                        <svg className="w-4 h-4 text-base-content/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                        New folder
                      </button>
                    ) : (
                      <form
                        className="flex items-center gap-1.5 px-1 py-1"
                        onSubmit={e => {
                          e.preventDefault()
                          const clean = naming.trim().replace(/[/\\]/g, '')
                          if (clean && clean !== '.' && clean !== '..') setPath([...path, clean])
                          setNaming(null)
                        }}
                      >
                        <input autoFocus value={naming} onChange={e => setNaming(e.target.value)} placeholder="Folder name" className="input input-sm flex-1 min-w-0" />
                        <button type="submit" className="btn btn-sm">Add</button>
                      </form>
                    )}
                  </li>
                </ul>
                <p className="text-xs text-base-content/50 px-1 pt-1.5 break-all">
                  Goes to <span className="font-mono">{[dest.label, ...path].join(' › ')}</span>
                  {naming === null && folders?.length === 0 && path.length > 0 && ' (made when it starts)'}
                </p>
              </div>
            )}
          </section>
        )}

        <section className="sm:col-start-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-base-content/50 mb-2">If a file is already there</p>
          <div className="join" role="radiogroup" aria-label="If a file is already there">
            {CLASH.map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={clash === id} onClick={() => setClash(id)} className={`join-item btn btn-sm ${clash === id ? 'btn-primary' : ''}`}>
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-base-content/50 mt-1.5">{CLASH.find(c => c[0] === clash)?.[2]}</p>
          {mode === 'move' && (
            <p className="flex items-start gap-1.5 text-xs text-success mt-3">
              <svg className="w-3.5 h-3.5 shrink-0 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              The originals are deleted only after each copy is checked.
            </p>
          )}
        </section>
      </div>

      {confirming && bridgedSide && (
        <div role="alert" className="mt-3 flex flex-col gap-2 rounded-box border border-error/40 bg-error/10 px-3 py-2.5 text-sm">
          <p>
            {bridgedFrom
              ? <>They are <b>deleted from {bridgedFrom.label}</b>, one by one, after each copy is checked. This is their {bridgedFrom.label.split(' · ')[0]}, not yours.</>
              : <>They are deleted from {fromLabel}, one by one, after each copy on {dest?.label} is checked.</>}
          </p>
          <p className="text-xs text-base-content/70">
            It goes through {bridgedSide.via_label} and their internet, so it can take a while.
            {bridgedSide.wifi ? ` ${bridgedSide.via_label} has to stay on ${bridgedSide.wifi} until it ends.` : ''}
          </p>
        </div>
      )}
      {error && <p role="alert" className="text-error text-sm mt-3">{error}</p>}
      <div className="modal-action mt-4">
        <button onClick={onClose} className="btn btn-sm">Cancel</button>
        {confirming && <button onClick={() => void start('copy')} disabled={busy} className="btn btn-sm btn-outline">Copy instead</button>}
        <button
          onClick={() => (mode === 'move' && bridgedSide && !confirming ? setConfirming(true) : void start())}
          disabled={!dest || busy}
          className={`btn btn-sm ${confirming ? 'btn-error' : 'btn-primary'}`}
        >
          {busy ? '…' : `${verb} ${files}`}
        </button>
      </div>
    </ResponsiveModal>
  )
}
