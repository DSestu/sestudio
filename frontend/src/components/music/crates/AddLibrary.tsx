import { useState } from 'react'
import ResponsiveModal from '../../ResponsiveModal'
import FolderPicker from './FolderPicker'
import { librariesApi, type NewLibrary } from '../../../musicLibraries'

const KINDS = [
  { id: 'local_folder', label: 'Folder' },
  { id: 'remote_sestudio', label: 'Another sestudio' },
  { id: 'ytmusic_account', label: 'YouTube Music' },
] as const
type Kind = (typeof KINDS)[number]['id']

/** "Add a library": a folder on this machine, another sestudio server (URL and its token), or a YouTube Music account. */
export default function AddLibrary({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('local_folder')
  const [path, setPath] = useState('')
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [cookies, setCookies] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const ready = kind === 'local_folder' ? !!path.trim() : kind === 'remote_sestudio' ? !!url.trim() && !!token.trim() : true

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
      const body: NewLibrary = kind === 'local_folder' ? { kind, path, label } : kind === 'remote_sestudio' ? { kind, url, token } : { kind }
      await librariesApi.add(body)
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const field = 'input input-bordered w-full'
  return (
    <ResponsiveModal onClose={onClose}>
      <h3 className="font-semibold mb-3">Add a library</h3>
      <div role="tablist" className="tabs tabs-box mb-4">
        {KINDS.map(k => (
          <button key={k.id} role="tab" aria-selected={kind === k.id} onClick={() => setKind(k.id)} className={`tab flex-1 ${kind === k.id ? 'tab-active' : ''}`}>{k.label}</button>
        ))}
      </div>
      <form onSubmit={e => { e.preventDefault(); if (ready && !busy) void submit() }} className="flex flex-col gap-3">
        {kind === 'local_folder' && (
          <>
            <span className="text-sm text-base-content/60">Folder on this server</span>
            <FolderPicker onPick={(p, name) => { setPath(p); setLabel(name) }} />
            {path && (
              <div className="rounded-lg bg-base-200 p-3 flex flex-col gap-2">
                <span className="text-xs text-base-content/60 font-mono break-all">{path}</span>
                <label className="block">
                  <span className="text-sm text-base-content/60">Name</span>
                  <input value={label} onChange={e => setLabel(e.target.value)} className={field} />
                </label>
              </div>
            )}
          </>
        )}
        {kind === 'remote_sestudio' && (
          <>
            <label className="block">
              <span className="text-sm text-base-content/60">Server address</span>
              <input value={url} onChange={e => setUrl(e.target.value)} className={`${field} font-mono`} placeholder="https://192.168.1.20:8443" autoFocus />
            </label>
            <label className="block">
              <span className="text-sm text-base-content/60">Token</span>
              <input value={token} onChange={e => setToken(e.target.value)} type="password" autoComplete="off" spellCheck={false} className={`${field} font-mono`} placeholder="sst_…" />
              <span className="text-xs text-base-content/50">Made on that server, in Settings under “Share music with another sestudio”.</span>
            </label>
          </>
        )}
        {kind === 'ytmusic_account' && (
          <label className="block">
            <span className="text-sm text-base-content/60">Cookies file of a signed-in YouTube session (optional here)</span>
            <input value={cookies} onChange={e => setCookies(e.target.value)} className={`${field} font-mono`} placeholder="C:\path\to\cookies.txt" />
            <span className="text-xs text-base-content/50">Lists your liked songs. Without the file, the library waits for a sign-in; it can be set later in Settings.</span>
          </label>
        )}
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button type="submit" disabled={!ready || busy} className="btn btn-primary">Add</button>
        </div>
      </form>
    </ResponsiveModal>
  )
}
