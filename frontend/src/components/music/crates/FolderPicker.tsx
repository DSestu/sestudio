import { useEffect, useState } from 'react'
import { foldersApi, type FolderListing, type FolderRoot } from '../../../musicLibraries'

const audioLine = (n: number, capped: boolean) => (n ? `${n}${capped ? '+' : ''} track${n === 1 && !capped ? '' : 's'}` : 'no music')

/** Pick a folder on the server without typing: suggested places, a breadcrumb, and the folders below with their track counts. */
export default function FolderPicker({ onPick }: { onPick: (path: string, name: string) => void }) {
  const [roots, setRoots] = useState<FolderRoot[]>([])
  const [at, setAt] = useState('')
  const [listing, setListing] = useState<FolderListing>()
  const [error, setError] = useState('')
  const [typed, setTyped] = useState(false)
  const [text, setText] = useState('')

  useEffect(() => { foldersApi.roots().then(setRoots, e => setError((e as Error).message)) }, [])
  useEffect(() => {
    if (!at) return
    let live = true
    foldersApi.browse(at).then(l => { if (live) { setListing(l); setError('') } }, e => { if (live) setError((e as Error).message) })
    return () => { live = false }
  }, [at])

  const row = 'flex items-center gap-3 w-full min-h-12 px-3 py-2 text-left rounded-lg hover:bg-base-200 active:bg-base-200'
  const name = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" aria-label="Suggested locations">
        {roots.map(r => (
          <button key={r.path} type="button" onClick={() => setAt(r.path)} className={`btn btn-sm ${at === r.path ? 'btn-primary' : ''}`}>{r.label}</button>
        ))}
      </div>

      {at && listing && (
        <>
          <nav aria-label="Folder path" className="flex items-center gap-1 overflow-x-auto whitespace-nowrap text-sm text-base-content/60">
            <button type="button" onClick={() => setAt('')} className="link link-hover">Places</button>
            {listing.crumbs.map((c, i) => (
              <span key={c.path} className="flex items-center gap-1">
                <span aria-hidden>/</span>
                {i === listing.crumbs.length - 1
                  ? <span className="text-base-content font-medium">{c.name}</span>
                  : <button type="button" onClick={() => setAt(c.path)} className="link link-hover">{c.name}</button>}
              </span>
            ))}
          </nav>
          <ul className="flex flex-col max-h-[40vh] overflow-y-auto -mx-1">
            {!listing.readable && <li className="px-3 py-2 text-sm text-base-content/60">This folder cannot be read.</li>}
            {listing.readable && listing.folders.length === 0 && <li className="px-3 py-2 text-sm text-base-content/60">No folders inside.</li>}
            {listing.folders.map(f => (
              <li key={f.path}>
                <button type="button" disabled={!f.readable} onClick={() => setAt(f.path)} className={`${row} disabled:opacity-50`}>
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="text-xs text-base-content/50 shrink-0">{f.readable ? audioLine(f.audio, f.capped) : 'cannot be read'}</span>
                  <span aria-hidden className="text-base-content/40 w-3">{f.has_children ? '›' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => onPick(listing.path, name(listing.path))} className="btn btn-primary">
            Use “{name(listing.path)}”
          </button>
        </>
      )}
      {!(at && listing) && !error &&<p className="text-sm text-base-content/60">Pick a place above to look for your music.</p>}
      {error && <p role="alert" className="text-sm text-error">{error}</p>}

      <div>
        <button type="button" onClick={() => setTyped(v => !v)} className="link link-hover text-xs text-base-content/50">
          {typed ? 'Hide' : 'Or type a path'}
        </button>
        {typed && (
          <div className="flex gap-2 mt-1">
            <input value={text} onChange={e => setText(e.target.value)} className="input input-bordered w-full font-mono" placeholder="Z:\Music or /mnt/nas/music" aria-label="Folder path" />
            <button type="button" disabled={!text.trim()} onClick={() => setAt(text.trim())} className="btn">Open</button>
          </div>
        )}
      </div>
    </div>
  )
}
