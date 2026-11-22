import { useEffect, useState } from 'react'
import { getServers, setServerBridge, storagesApi, type NearbyAccess, type NearbyRow, type ServerRow, type StorageInfo } from '../../api'
import { StorageGlyph } from '../downloaded/StorageSwitcher'
import { parseAddress, refreshStorages } from '../../storageChoice'
import FreeboxPanel from './FreeboxPanel'
import { thisMachine } from '../../servers'

const KIND_LINE: Record<NearbyRow['kind'], string> = {
  smb: 'SMB share',
  ftp: 'FTP server',
  sftp: 'SFTP server',
  media: 'Media server · read only',
}

/** "This phone" before it is a bridge: picking it asks first (SPEC-storage §10, B1″, P1). */
const SELF = 'self'
const SELF_LABEL = thisMachine()

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
  // Typed addresses are checked like found places, above them.
  const [typedRows, setTypedRows] = useState<NearbyRow[]>([])
  const addTyped = (row: NearbyRow) => {
    setTypedRows(rows => [row, ...rows.filter(r => r.host !== row.host || r.kind !== row.kind)])
    setTyped('')
  }
  const key = `${from}:${round}`
  const current = scan?.key === key ? scan : undefined
  const looking = !current

  // Connected to another server: this machine can be its bridge (SPEC-storage §10, B1′).
  const [home, setHome] = useState<ServerRow>()
  const [asking, setAsking] = useState<'' | 'busy' | string>('')
  useEffect(() => {
    let live = true
    getServers().then(r => { if (live) setHome(r.servers.find(s => s.in_use)) }, () => {})
    return () => { live = false }
  }, [])
  const own = home?.bridge ?? ''
  async function bridgeHere(on: boolean) {
    if (!home) return
    setAsking('busy')
    try {
      const row = await setServerBridge(home.id, on)
      await refreshStorages()
      setHome(row)
      setAsking('')
      onFrom(on ? row.bridge ?? '' : '')
    } catch (e) {
      setAsking((e as Error).message)
    }
  }

  useEffect(() => {
    if (from === SELF) return
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
      {(bridges.length > 0 || home) && (
        <div>
          <p className="text-sm text-base-content/60 mb-1.5">Look from</p>
          <div className="join w-full" role="radiogroup" aria-label="Look from">
            {[
              { id: '', label: home?.name ?? 'This server', s: undefined as StorageInfo | undefined },
              ...bridges.filter(b => b.id !== own).map(b => ({ id: b.id, label: b.label, s: b })),
              ...(home ? [{ id: own || SELF, label: SELF_LABEL, s: { id: 'phone', kind: 'remote_sestudio', bridge: true } as StorageInfo }] : []),
            ].map(o => (
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
          {bridge?.network?.wifi && <p className="text-xs text-base-content/50 mt-1">{from === own ? 'It' : bridge.label} is on <b className="text-base-content/80">{bridge.network.wifi}</b></p>}
          {home && own && from === own && (
            <p className="text-xs text-base-content/50 mt-1">
              {home.name} reaches {SELF_LABEL.toLowerCase()} ·{' '}
              <button type="button" disabled={asking === 'busy'} onClick={() => void bridgeHere(false)} className="link">Stop</button>
            </p>
          )}
        </div>
      )}

      {home && from === SELF && (
        <div role="group" aria-label={`Let ${home.name} reach ${SELF_LABEL.toLowerCase()}`} className="flex items-start gap-3 rounded-box border border-warning/40 bg-base-200 p-3">
          <svg className="w-5 h-5 shrink-0 text-warning mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>
          <div className="min-w-0">
            <p className="font-semibold">Let {home.name} reach {SELF_LABEL.toLowerCase()}?</p>
            <p className="text-sm text-base-content/60 mt-0.5">
              To look around this Wi-Fi and open the shares it finds, {home.name} reaches {SELF_LABEL.toLowerCase()} over
              Tailscale. This turns on its sharing, for {home.name} only. Stop it any time here or in Settings › Servers.
            </p>
            {asking && asking !== 'busy' && <p role="alert" className="text-sm text-error mt-1">{asking}</p>}
            <div className="flex gap-2 mt-2.5">
              <button type="button" disabled={asking === 'busy'} onClick={() => void bridgeHere(true)} className="btn btn-sm btn-primary">
                {asking === 'busy' ? 'Allowing…' : 'Allow'}
              </button>
              <button type="button" onClick={() => { setAsking(''); onFrom('') }} className="btn btn-sm btn-ghost">Not now</button>
            </div>
          </div>
        </div>
      )}

      {from !== SELF && <>
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

      {(typedRows.length > 0 || (current?.rows?.length ?? 0) > 0) && (
        <ul className="flex flex-col divide-y divide-base-300 -my-1">
          {[...typedRows, ...(current?.rows ?? [])].map(r => (
            <FoundPlace key={`${r.host}:${r.kind}:${r.port ?? ''}`} row={r} from={from} onOpen={row => onOpen(row, from)} />
          ))}
        </ul>
      )}

      <div>
        <p className="text-sm text-base-content/60 mb-1.5">Not listed?</p>
        <div className="join w-full">
          <input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && typedRow) { e.preventDefault(); addTyped(typedRow) } }}
            className="input join-item flex-1 min-w-0 font-mono text-sm"
            placeholder="smb://, ftp:// or an address"
            spellCheck={false}
            aria-label="Address"
          />
          <button type="button" disabled={!typedRow} onClick={() => typedRow && addTyped(typedRow)} className="btn join-item">Check</button>
        </div>
        <p className="text-xs text-base-content/50 mt-1.5">TVs, speakers and printers are left out.</p>
      </div>
      </>}
    </div>
  )
}


/**
 * One found place: checked by itself with no login (anonymous, then guest), then
 * its shares, each with what it allows. Asks for a login only when none got in.
 */
function FoundPlace({ row, from, onOpen }: { row: NearbyRow; from: string; onOpen: (row: NearbyRow) => void }) {
  const [access, setAccess] = useState<NearbyAccess | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [checking, setChecking] = useState(row.kind !== 'media')
  // A share turned the guest away: its login can be typed even though others let it in.
  const [asking, setAsking] = useState(false)
  const media = row.kind === 'media'

  function check(user = '', pass = '') {
    setChecking(true)
    storagesApi.probe(from, { kind: row.kind, host: row.host, port: row.port, username: user, password: pass }).then(
      a => setAccess(a),
      e => setAccess({ error: (e as Error).message }),
    ).finally(() => setChecking(false))
  }
  // Checked once, as soon as it is listed: what it lets in is the first question.
  useEffect(() => {
    if (media) return
    let live = true
    storagesApi.probe(from, { kind: row.kind, host: row.host, port: row.port }).then(
      a => { if (live) setAccess(a) },
      e => { if (live) setAccess({ error: (e as Error).message }) },
    ).finally(() => { if (live) setChecking(false) })
    return () => { live = false }
  }, [from, row.kind, row.host, row.port, media])

  const who = access?.login === 'given' ? `as ${access.user}` : access?.user === 'anonymous' ? 'anonymous' : access?.user ? 'as guest' : 'with no login'
  const showAddress = row.name !== row.host || (row.port && ![445, 21, 22].includes(row.port))

  return (
    <li className="py-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <svg className="w-5 h-5 shrink-0 text-base-content/55" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[row.kind]} /></svg>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{row.name}</p>
          <p className="text-xs text-base-content/55">
            {KIND_LINE[row.kind]}
            {checking && ' · checking access…'}
            {!checking && access?.login && access.login !== 'needed' && ` · open ${who}`}
            {!checking && access?.login === 'needed' && <span className="text-warning"> · asks for a login</span>}
          </p>
          {showAddress && <p className="font-mono text-xs text-base-content/45">{row.host}{row.port && ![445, 21, 22].includes(row.port) ? `:${row.port}` : ''}</p>}
        </div>
        {(media || access?.error) && (
          <button
            type="button"
            disabled={media && !row.location}
            onClick={() => onOpen(row)}
            className="btn btn-sm btn-outline"
          >
            Open
          </button>
        )}
      </div>

      {access?.error && <p className="text-xs text-error ml-8">{access.error}</p>}

      {/* A Freebox: its own API says what an SMB guest cannot see (SPEC-storage §11, M4). */}
      {row.kind === 'smb' && row.name.startsWith('Freebox') && (
        <FreeboxPanel host={row.host} via={from} onSharingChanged={() => check()} />
      )}

      {access?.shares && access.shares.length > 0 && (
        <ul className="ml-8 flex flex-col gap-1.5">
          {access.shares.map(sh => (
            <li key={sh.name} className="flex items-center gap-2.5 rounded-box bg-base-200 px-2.5 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-sm truncate">{row.kind === 'smb' ? sh.name : 'Top folder'}</span>
                <span className={`block text-xs ${sh.login ? 'text-warning' : !sh.read ? 'text-error' : sh.write ? 'text-success' : 'text-base-content/60'}`}>
                  {sh.login ? 'Needs a login' : !sh.read ? 'No access' : sh.write ? 'Read & write' : sh.write === null ? 'Can read · writing not checked' : 'Read only'}
                  {sh.encrypted && <span className="text-base-content/60"> · encrypted</span>}
                </span>
              </span>
              {sh.login && !asking && (
                <button type="button" onClick={() => setAsking(true)} className="btn btn-xs btn-outline">Log in</button>
              )}
              {!sh.login && <button
                type="button"
                disabled={!sh.read}
                onClick={() => onOpen({
                  ...row,
                  share: row.kind === 'smb' ? sh.name : undefined,
                  username: access.user ?? '',
                  password: access.login === 'given' ? password : '',
                })}
                className="btn btn-xs btn-outline"
              >
                Open
              </button>}
            </li>
          ))}
        </ul>
      )}
      {access?.shares && access.shares.length === 0 && access.login !== 'needed' && (
        <p className="ml-8 text-xs text-base-content/55">
          Lets {access.user === 'guest' ? 'a guest' : access.user === 'anonymous' ? 'anonymous users' : access.user || 'anyone'} in, but shares nothing.
        </p>
      )}

      {(access?.login === 'needed' || asking) && (
        // Not a <form>: Nearby sits inside Add a storage's own form, and a form in a form submits the outer one.
        <div
          role="group"
          aria-label={`Login for ${row.name}`}
          className="ml-8 flex flex-wrap items-end gap-2"
          onKeyDown={e => { if (e.key === 'Enter' && username) { e.preventDefault(); check(username, password) } }}
        >
          <label className="flex-1 min-w-28">
            <span className="block text-xs text-base-content/60">User</span>
            <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" spellCheck={false} className="input input-sm w-full" />
          </label>
          <label className="flex-1 min-w-28">
            <span className="block text-xs text-base-content/60">Password</span>
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="new-password" className="input input-sm w-full" />
          </label>
          <button type="button" onClick={() => check(username, password)} disabled={checking || !username} className="btn btn-sm">{checking ? '…' : 'Check'}</button>
        </div>
      )}
    </li>
  )
}
