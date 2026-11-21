import { useEffect, useState } from 'react'
import { storagesApi, type FolderCheck, type NewStorage } from '../../api'
import { fmtSize } from '../../downloadedLibrary'
import FolderPicker from '../music/crates/FolderPicker'
import ResponsiveModal from '../ResponsiveModal'

const KINDS = [
  { id: 'folder', label: 'Folder' },
  { id: 'server', label: 'Server' },
  { id: 'remote_sestudio', label: 'Another sestudio' },
  { id: 'ytmusic_account', label: 'YouTube Music' },
] as const

/** Read in the app, over their own protocol (SPEC-storage §9). */
const PROTOCOLS = [
  { id: 'smb', label: 'SMB', port: 445, hint: 'Windows shares, most NAS' },
  { id: 'sftp', label: 'SFTP', port: 22, hint: 'Over SSH' },
  { id: 'ftp', label: 'FTP', port: 21, hint: 'Seedboxes, old NAS' },
] as const
type Protocol = (typeof PROTOCOLS)[number]['id']
type Kind = (typeof KINDS)[number]['id']

const HOLDS = [
  { id: 'video', label: 'Video', roles: ['video'] },
  { id: 'music', label: 'Music', roles: ['music'] },
  { id: 'both', label: 'Both', roles: ['video', 'music'] },
] as const

const RCLONE_MOUNT = 'https://rclone.org/commands/rclone_mount/'

/**
 * "Add a storage" (SPEC-storage §8.2): a folder this server can open (a disk, a
 * network share, an rclone mount of an FTP server), checked as it is typed; or
 * one of the music-only sources, another sestudio or a YouTube Music account.
 * What a folder holds is asked, with no default (Q2).
 */
export default function AddStorage({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [kind, setKind] = useState<Kind>('folder')
  const [path, setPath] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const [label, setLabel] = useState('')
  const [holds, setHolds] = useState<(typeof HOLDS)[number]['id'] | ''>('')
  const [download, setDownload] = useState(false)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [cookies, setCookies] = useState('')
  const [protocol, setProtocol] = useState<Protocol>('smb')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [share, setShare] = useState('')
  const [remotePath, setRemotePath] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [domain, setDomain] = useState('')
  const [tls, setTls] = useState(false)
  const [tested, setTested] = useState<{ key: string; ok?: number; error?: string; busy?: boolean }>()
  const [check, setCheck] = useState<{ path: string; ok?: FolderCheck; error?: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Checked as it is typed: found, how many folders, how much room.
  useEffect(() => {
    const p = path.trim()
    if (kind !== 'folder' || !p) return
    let live = true
    const id = window.setTimeout(() => {
      storagesApi.check(p).then(
        ok => {
          if (!live) return
          setCheck({ path: p, ok })
          setLabel(l => l || ok.name)
        },
        e => { if (live) setCheck({ path: p, error: (e as Error).message }) },
      )
    }, 400)
    return () => { live = false; window.clearTimeout(id) }
  }, [kind, path])
  const checked = check && check.path === path.trim() ? check : undefined

  const roles = HOLDS.find(h => h.id === holds)?.roles
  const server: NewStorage = {
    kind: protocol, roles: [...(roles ?? ['video'])], label, host: host.trim(),
    port: port.trim() ? Number(port) : null, share, path: remotePath, username, password,
    domain, tls: protocol === 'ftp' && tls,
  }
  // A test answers for the fields it was run with; changing one asks for a new one.
  const serverKey = JSON.stringify({ ...server, label: '', roles: [] })
  const testedNow = tested?.key === serverKey ? tested : undefined
  function test() {
    setTested({ key: serverKey, busy: true })
    storagesApi.test(server).then(
      r => setTested({ key: serverKey, ok: r.folders }),
      e => setTested({ key: serverKey, error: (e as Error).message }),
    )
  }
  const ready = kind === 'folder'
    ? !!checked?.ok && !!roles
    : kind === 'server' ? !!host.trim() && (protocol !== 'smb' || !!share.trim()) && !!roles
      : kind === 'remote_sestudio' ? !!url.trim() && !!token.trim() : true

  async function submit() {
    setBusy(true)
    setError('')
    try {
      if (kind === 'ytmusic_account' && cookies.trim()) {
        await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ytmusic_cookies: cookies }),
        })
      }
      const body: NewStorage = kind === 'folder'
        ? { kind, path: path.trim(), label, roles: [...(roles ?? [])], download }
        : kind === 'server' ? server
          : kind === 'remote_sestudio'
            ? { kind, url, token, label, roles: ['music'] }
            : { kind, roles: ['music'] }
      await storagesApi.add(body)
      onAdded()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const field = 'input input-bordered w-full'
  return (
    <ResponsiveModal onClose={onClose}>
      <h3 className="font-semibold text-lg">Add a storage</h3>
      <div role="tablist" className="tabs tabs-box my-3">
        {KINDS.map(k => (
          <button key={k.id} role="tab" aria-selected={kind === k.id} onClick={() => setKind(k.id)} className={`tab flex-1 ${kind === k.id ? 'tab-active' : ''}`}>{k.label}</button>
        ))}
      </div>
      <form onSubmit={e => { e.preventDefault(); if (ready && !busy) void submit() }} className="flex flex-col gap-3">
        {kind === 'folder' && (
          <>
            <p className="text-sm text-base-content/60">
              Any folder this server can open: a disk, a network share, an rclone mount.
            </p>
            <label className="block">
              <span className="text-sm text-base-content/60">Folder</span>
              <div className="flex gap-2">
                <input
                  id="storage-path"
                  value={path}
                  onChange={e => setPath(e.target.value)}
                  className={`${field} font-mono`}
                  placeholder="\\nas\films"
                  spellCheck={false}
                  autoFocus
                />
                <button type="button" onClick={() => setBrowsing(b => !b)} className="btn">Browse</button>
              </div>
              {checked?.ok && (
                <span className="text-xs text-success">
                  Found · {checked.ok.folders} {checked.ok.folders === 1 ? 'folder' : 'folders'} · {fmtSize(checked.ok.free)} free
                </span>
              )}
              {checked?.error && <span role="alert" className="text-xs text-error">{checked.error}</span>}
            </label>
            {browsing && (
              <div className="rounded-lg bg-base-200 p-3">
                <FolderPicker onPick={(p, name) => { setPath(p); setLabel(name); setBrowsing(false) }} />
              </div>
            )}
            <label className="block">
              <span className="text-sm text-base-content/60">Name</span>
              <input id="storage-label" value={label} onChange={e => setLabel(e.target.value)} className={field} placeholder="NAS films" />
            </label>
            <fieldset>
              <legend className="text-sm text-base-content/60 mb-1">What does it hold?</legend>
              <div className="join w-full">
                {HOLDS.map(h => (
                  <button
                    key={h.id}
                    type="button"
                    aria-pressed={holds === h.id}
                    onClick={() => setHolds(h.id)}
                    className={`btn join-item flex-1 ${holds === h.id ? 'btn-primary' : ''}`}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="checkbox checkbox-sm" checked={download} onChange={e => setDownload(e.target.checked)} />
              Send new downloads here
            </label>
            <p className="text-xs text-base-content/50">
              A server can also be added directly, under Server; or mounted as a folder
              with <a href={RCLONE_MOUNT} target="_blank" rel="noreferrer" className="link">rclone mount</a> and added here.
            </p>
          </>
        )}
        {kind === 'server' && (
          <>
            <div className="join w-full" role="group" aria-label="Protocol">
              {PROTOCOLS.map(p => (
                <button key={p.id} type="button" aria-pressed={protocol === p.id} onClick={() => setProtocol(p.id)} className={`btn join-item flex-1 ${protocol === p.id ? 'btn-primary' : ''}`}>{p.label}</button>
              ))}
            </div>
            <p className="text-xs text-base-content/50">{PROTOCOLS.find(p => p.id === protocol)!.hint}. Read by this server directly: nothing to mount.</p>
            <div className="flex gap-2">
              <label className="block flex-1 min-w-0">
                <span className="text-sm text-base-content/60">Server</span>
                <input value={host} onChange={e => setHost(e.target.value)} className={`${field} font-mono`} placeholder="nas.local or 192.168.1.20" spellCheck={false} autoFocus />
              </label>
              <label className="block w-24">
                <span className="text-sm text-base-content/60">Port</span>
                <input value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={`${field} font-mono`} placeholder={String(PROTOCOLS.find(p => p.id === protocol)!.port)} />
              </label>
            </div>
            {protocol === 'smb' && (
              <label className="block">
                <span className="text-sm text-base-content/60">Share</span>
                <input value={share} onChange={e => setShare(e.target.value)} className={`${field} font-mono`} placeholder="films" spellCheck={false} />
              </label>
            )}
            <label className="block">
              <span className="text-sm text-base-content/60">Folder on it (optional)</span>
              <input value={remotePath} onChange={e => setRemotePath(e.target.value)} className={`${field} font-mono`} placeholder="/video" spellCheck={false} />
            </label>
            <div className="flex gap-2">
              <label className="block flex-1 min-w-0">
                <span className="text-sm text-base-content/60">User</span>
                <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" spellCheck={false} className={field} placeholder={protocol === 'ftp' ? 'anonymous' : ''} />
              </label>
              <label className="block flex-1 min-w-0">
                <span className="text-sm text-base-content/60">Password</span>
                <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="new-password" className={field} />
              </label>
            </div>
            {protocol === 'smb' && (
              <label className="block">
                <span className="text-sm text-base-content/60">Domain (optional)</span>
                <input value={domain} onChange={e => setDomain(e.target.value)} className={field} spellCheck={false} />
              </label>
            )}
            {protocol === 'ftp' && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="checkbox checkbox-sm" checked={tls} onChange={e => setTls(e.target.checked)} />
                Encrypted (FTPS)
              </label>
            )}
            <div className="flex items-center gap-3">
              <button type="button" onClick={test} disabled={!host.trim() || testedNow?.busy} className="btn btn-sm">Test</button>
              {testedNow?.busy && <span className="text-xs text-base-content/60">Connecting…</span>}
              {testedNow?.ok !== undefined && <span className="text-xs text-success">Connected · {testedNow.ok} {testedNow.ok === 1 ? 'folder' : 'folders'}</span>}
              {testedNow?.error && <span role="alert" className="text-xs text-error">{testedNow.error}</span>}
            </div>
            <p className="text-xs text-base-content/50">The password is kept on this server only, apart from its settings.</p>
            <label className="block">
              <span className="text-sm text-base-content/60">Name</span>
              <input value={label} onChange={e => setLabel(e.target.value)} className={field} placeholder="Seedbox" />
            </label>
            <fieldset>
              <legend className="text-sm text-base-content/60 mb-1">What does it hold?</legend>
              <div className="join w-full">
                {HOLDS.map(h => (
                  <button key={h.id} type="button" aria-pressed={holds === h.id} onClick={() => setHolds(h.id)} className={`btn join-item flex-1 ${holds === h.id ? 'btn-primary' : ''}`}>{h.label}</button>
                ))}
              </div>
            </fieldset>
          </>
        )}
        {kind === 'remote_sestudio' && (
          <>
            <p className="text-sm text-base-content/60">Holds music only, for now.</p>
            <label className="block">
              <span className="text-sm text-base-content/60">Server address</span>
              <input value={url} onChange={e => setUrl(e.target.value)} className={`${field} font-mono`} placeholder="https://192.168.1.20:8443" autoFocus />
            </label>
            <label className="block">
              <span className="text-sm text-base-content/60">Token</span>
              <input value={token} onChange={e => setToken(e.target.value)} type="password" autoComplete="off" spellCheck={false} className={`${field} font-mono`} placeholder="sst_…" />
              <span className="text-xs text-base-content/50">Made on that server, in Settings › Music under “Share music with another sestudio”.</span>
            </label>
            <label className="block">
              <span className="text-sm text-base-content/60">Name</span>
              <input value={label} onChange={e => setLabel(e.target.value)} className={field} />
            </label>
          </>
        )}
        {kind === 'ytmusic_account' && (
          <label className="block">
            <span className="text-sm text-base-content/60">Cookies file of a signed-in YouTube session (optional here)</span>
            <input value={cookies} onChange={e => setCookies(e.target.value)} className={`${field} font-mono`} placeholder="C:\path\to\cookies.txt" />
            <span className="text-xs text-base-content/50">Lists your liked songs. Without the file, it waits for a sign-in; it can be set later in Settings › Music.</span>
          </label>
        )}
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button type="submit" disabled={!ready || busy} className="btn btn-primary">Add storage</button>
        </div>
      </form>
    </ResponsiveModal>
  )
}
