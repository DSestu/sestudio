import { useEffect, useState } from 'react'
import { storagesApi, type NearbyRow, type StorageInfo } from '../../api'
import { StorageGlyph } from '../downloaded/StorageSwitcher'
import { parseAddress } from '../../storageChoice'

const KIND_LINE: Record<NearbyRow['kind'], string> = {
  smb: 'SMB share',
  ftp: 'FTP server',
  sftp: 'SFTP server',
  media: 'Media server · read only',
}

const ICON: Record<NearbyRow['kind'], string> = {
  smb: 'M4 7h16v10H4zM8 12h.01M11 12h5',
  ftp: 'M4 7h16v10H4zM8 12h.01M11 12h5',
  sftp: 'M4 7h16v10H4zM8 12h.01M11 12h5',
  media: 'M3 5h18v12H3zM10 9l4 2-4 2zM8 21h8',
}

/**
 * Add a storage › Nearby (SPEC-storage §10.5, L2): what holds files on this
 * server's network, or on a bridge's, each with Open; and a typed address when
 * it is not listed.
 */
export default function Nearby({ from, onFrom, bridges, onOpen }: {
  /** '' for this server, else a bridge's id. */
  from: string
  onFrom: (id: string) => void
  bridges: StorageInfo[]
  onOpen: (row: NearbyRow, through: string) => void
}) {
  const [scan, setScan] = useState<{ key: string; rows?: NearbyRow[]; seconds?: number; error?: string }>()
  const [round, setRound] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [typed, setTyped] = useState('')
  const key = `${from}:${round}`
  const current = scan?.key === key ? scan : undefined
  const looking = !current

  useEffect(() => {
    let live = true
    const started = Date.now()
    const tick = window.setInterval(() => { if (live) setElapsed(Math.round((Date.now() - started) / 1000)) }, 500)
    storagesApi.nearby(from || undefined).then(
      r => { if (live) setScan({ key, rows: r.found, seconds: r.seconds }) },
      e => { if (live) setScan({ key, error: (e as Error).message }) },
    ).finally(() => window.clearInterval(tick))
    return () => { live = false; window.clearInterval(tick) }
  }, [from, key])

  const bridge = bridges.find(b => b.id === from)
  const away = bridge?.state === 'offline'
  const typedRow = parseAddress(typed)

  return (
    <div className="flex flex-col gap-3">
      {bridges.length > 0 && (
        <div>
          <p className="text-sm text-base-content/60 mb-1.5">Look from</p>
          <div className="join w-full" role="radiogroup" aria-label="Look from">
            {[{ id: '', label: 'This server', s: undefined as StorageInfo | undefined }, ...bridges.map(b => ({ id: b.id, label: b.label, s: b }))].map(o => (
              <button
                key={o.id || 'here'}
                type="button"
                role="radio"
                aria-checked={from === o.id}
                onClick={() => onFrom(o.id)}
                className={`btn btn-sm join-item flex-1 gap-1.5 ${from === o.id ? 'btn-primary btn-soft' : ''}`}
              >
                <StorageGlyph storage={o.s ?? { id: 'local', kind: 'folder' }} className="w-4 h-4" />
                <span className="truncate">{o.label}</span>
              </button>
            ))}
          </div>
          {bridge?.network?.wifi && <p className="text-xs text-base-content/50 mt-1">{bridge.label} is on <b className="text-base-content/80">{bridge.network.wifi}</b></p>}
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 text-sm text-base-content/60" aria-live="polite">
          {looking
            ? <span>Looking… {elapsed} s</span>
            : current?.error
              ? <span className="text-error">{away ? `${bridge?.label} is away` : current.error}</span>
              : <span className="text-success">Found {current?.rows?.length ?? 0} {current?.rows?.length === 1 ? 'place that holds' : 'places that hold'} files · {current?.seconds} s</span>}
          {!looking && <button type="button" onClick={() => setRound(r => r + 1)} className="ml-auto link link-primary text-sm no-underline">Look again</button>}
        </div>
        <div className="h-[3px] rounded bg-base-300 overflow-hidden mt-1.5">
          <div className={`h-full bg-primary transition-[width] duration-500 ${looking ? '' : 'w-full'}`} style={looking ? { width: `${Math.min(90, elapsed * 15)}%` } : undefined} />
        </div>
      </div>

      {current?.rows && current.rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-base-300 -my-1">
          {current.rows.map(r => (
            <li key={`${r.host}:${r.kind}`} className="flex items-center gap-3 py-2.5">
              <svg className="w-5 h-5 shrink-0 text-base-content/55" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[r.kind]} /></svg>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{r.name}</p>
                <p className="text-xs text-base-content/55">{KIND_LINE[r.kind]}</p>
                {(r.name !== r.host || (r.port && ![445, 21, 22].includes(r.port))) && (
                  <p className="font-mono text-xs text-base-content/45">{r.host}{r.port && ![445, 21, 22].includes(r.port) ? `:${r.port}` : ''}</p>
                )}
              </div>
              <button
                type="button"
                disabled={r.kind === 'media'}
                title={r.kind === 'media' ? 'A media server is not opened yet: open the same box’s SMB or FTP share' : undefined}
                onClick={() => onOpen(r, from)}
                className="btn btn-sm btn-outline"
              >
                Open
              </button>
            </li>
          ))}
        </ul>
      )}

      <div>
        <p className="text-sm text-base-content/60 mb-1.5">Not listed?</p>
        <div className="join w-full">
          <input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && typedRow) { e.preventDefault(); onOpen(typedRow, from) } }}
            className="input join-item flex-1 min-w-0 font-mono text-sm"
            placeholder="smb://, ftp:// or an address"
            spellCheck={false}
            aria-label="Address"
          />
          <button type="button" disabled={!typedRow} onClick={() => typedRow && onOpen(typedRow, from)} className="btn join-item">Open</button>
        </div>
        <p className="text-xs text-base-content/50 mt-1.5">TVs, speakers and printers are left out.</p>
      </div>
    </div>
  )
}
