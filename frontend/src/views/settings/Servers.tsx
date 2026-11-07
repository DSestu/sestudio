import { useEffect, useState, type FormEvent } from 'react'
import { addServer, checkServer, getServers, removeServer, trustServer, type ServerRow, type ServersList } from '../../api'
import BottomSheet from '../../components/watch/BottomSheet'
import { timeAgo } from '../../notifications'
import { switchServer, thisMachine } from '../../servers'
import { SettingRow, SettingsGroup } from './rows'

/** A centred dialog on desktop, a sheet from the bottom on phones. */
const DIALOG = 'md:inset-x-auto md:bottom-auto md:left-1/2 md:top-[18vh] md:w-[26rem] md:-translate-x-1/2 md:rounded-[20px]'

/**
 * Settings › Servers (docs/SPEC-remote-servers.md §4 A and B): the other
 * sestudio servers this one can stand in front of, their state, trust and the
 * switch; and this machine's own addresses for the other side to add.
 */
export default function Servers() {
  const [list, setList] = useState<ServersList | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [trusting, setTrusting] = useState<ServerRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Opening the page checks every server, so the rows say how they are now.
  useEffect(() => {
    void getServers(true).then(setList).catch(e => setError(e.message))
  }, [])

  function replace(row: ServerRow) {
    setList(l => l && { ...l, servers: l.servers.map(s => (s.id === row.id ? row : s)) })
  }

  async function remove(id: string) {
    await removeServer(id)
    setList(l => l && { ...l, servers: l.servers.filter(x => x.id !== id) })
  }

  async function act(id: string, action: () => Promise<void>) {
    setBusy(id)
    setError('')
    try { await action() } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }

  const self = thisMachine()
  const local = !list?.active

  return (
    <>
      {error && <p role="alert" className="rounded-[14px] bg-error/12 p-3 text-sm text-error">{error}</p>}

      <SettingsGroup
        title="Using"
        footnote={`Checked when this page opens. Pick one and every page shows its library, downloads and music; casts go to the TV next to ${self.toLowerCase()}.`}
      >
        <SettingRow label={self} help="Its own library and downloads">
          {local
            ? <InUse />
            : <button className="btn btn-sm btn-primary" disabled={busy !== null} onClick={() => act('self', () => switchServer(null))}>Use</button>}
        </SettingRow>
        {list?.servers.map(s => (
          // On the phone, Remove is a long press on the row (Android's context menu).
          <div
            key={s.id}
            onContextMenu={e => {
              if (window.matchMedia('(min-width: 48rem)').matches) return
              e.preventDefault()
              if (window.confirm(`Remove ${s.name}?`)) void act(s.id, () => remove(s.id))
            }}
          >
          <SettingRow
            label={s.name}
            help={
              <>
                <span className="font-mono">{s.url}</span>
                <br />
                <State row={s} />
              </>
            }
          >
            <div className="flex shrink-0 items-center gap-1">
              <button className="btn btn-sm btn-ghost hidden md:inline-flex" disabled={busy !== null} onClick={() => act(s.id, async () => replace(await checkServer(s.id)))}>Check</button>
              <button className="btn btn-sm btn-ghost hidden md:inline-flex" disabled={busy !== null} onClick={() => act(s.id, () => remove(s.id))}>Remove</button>
              <RowAction row={s} busy={busy !== null} onCheck={() => act(s.id, async () => replace(await checkServer(s.id)))} onTrust={() => setTrusting(s)} onUse={() => act(s.id, () => switchServer(s.id))} />
            </div>
          </SettingRow>
          </div>
        ))}
      </SettingsGroup>

      <div>
        <button className="btn btn-sm" onClick={() => setAdding(true)}>+ Add server</button>
      </div>

      <SettingsGroup title={self} footnote="What another sestudio needs to add this one. Compare the fingerprint when it asks to trust this one.">
        <SettingRow label="Address" help={list ? <span className="font-mono break-all">{list.self.addresses.join(' · ') || 'Not on a network'}</span> : '…'}>
          {list && list.self.addresses.length > 0 && navigator.clipboard && (
            <CopyButton text={list.self.addresses[0]} />
          )}
        </SettingRow>
        {list?.self.fingerprint && (
          <SettingRow label="Certificate" help={<span className="font-mono break-all">SHA-256 {fingerprint(list.self.fingerprint)}</span>} />
        )}
      </SettingsGroup>

      <AddSheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={row => {
          setAdding(false)
          setList(l => l && { ...l, servers: [...l.servers, row] })
          if (row.reachable && !row.trusted) setTrusting(row)
        }}
      />
      <TrustSheet
        row={trusting}
        onClose={() => setTrusting(null)}
        onTrusted={async row => {
          replace(row)
          setTrusting(null)
          await act(row.id, () => switchServer(row.id))
        }}
      />
    </>
  )
}

function InUse() {
  return <span className="rounded-full bg-base-content/8 px-2.5 py-0.5 text-xs font-medium">In use</span>
}

/** One line: how the server was at its last check. */
function State({ row }: { row: ServerRow }) {
  if (row.reachable === null) return <span className="text-base-content/50">Not checked yet</span>
  if (!row.reachable) {
    return (
      <span className="text-error">
        <Dot /> Not answering{row.last_seen ? ` · last seen ${timeAgo(row.last_seen)}` : ''}
      </span>
    )
  }
  const parts = ['Reachable', row.version, row.rtt_ms !== null && `${row.rtt_ms} ms`].filter(Boolean)
  if (!row.trusted) return <span className="text-warning"><Dot /> {parts.join(' · ')} · not trusted</span>
  return <span className="text-success"><Dot /> {parts.join(' · ')}</span>
}

function Dot() {
  return <span aria-hidden="true" className="inline-block size-2 rounded-full bg-current align-middle mr-0.5" />
}

/** The one button a row needs now: Use when it can be used, Trust when it is
 *  reachable but not accepted, Check when it is down. */
function RowAction({ row, busy, onCheck, onTrust, onUse }: {
  row: ServerRow
  busy: boolean
  onCheck: () => void
  onTrust: () => void
  onUse: () => void
}) {
  if (row.in_use) return <InUse />
  if (!row.reachable) return <button className="btn btn-sm btn-ghost md:hidden" disabled={busy} onClick={onCheck}>Check</button>
  if (!row.trusted) return <button className="btn btn-sm btn-primary" disabled={busy} onClick={onTrust}>Trust</button>
  return <button className="btn btn-sm btn-primary" disabled={busy} onClick={onUse}>Use</button>
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="btn btn-sm btn-ghost"
      onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => {})}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

/** "9f3c…7e0b" is enough to compare by eye; the title holds the whole of it. */
function fingerprint(hex: string): string {
  const pairs = hex.match(/.{2}/g) ?? []
  return pairs.map(p => p.toUpperCase()).join(':')
}

function AddSheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (row: ServerRow) => void }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('https://')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onAdded(await addServer(name, url))
      setName('')
      setUrl('https://')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet title="Add server" open={open} onClose={onClose} className={DIALOG}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-base-content/60">
          Name
          <input className="input input-sm w-full bg-base-100 text-[15px] text-base-content" value={name} onChange={e => setName(e.target.value)} placeholder="PC maison" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-base-content/60">
          Address
          <input className="input input-sm w-full bg-base-100 font-mono text-sm text-base-content" value={url} onChange={e => setUrl(e.target.value)} inputMode="url" autoCapitalize="off" spellCheck={false} required />
        </label>
        <p className="text-xs leading-snug text-base-content/50">Its Settings › Servers page shows the address. Over Tailscale, use the 100.x address.</p>
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Check and add'}</button>
        </div>
      </form>
    </BottomSheet>
  )
}

function TrustSheet({ row, onClose, onTrusted }: { row: ServerRow | null; onClose: () => void; onTrusted: (row: ServerRow) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <BottomSheet title={row ? `Trust ${row.name}?` : ''} open={!!row} onClose={onClose} className={DIALOG}>
      {row && (
        <div className="flex flex-col gap-3">
          <State row={{ ...row, trusted: true }} />
          <p className="text-xs leading-snug text-base-content/60">It uses a self-signed certificate. Compare with Settings › Servers on that machine:</p>
          <p className="rounded-[10px] bg-base-100 p-3 font-mono text-xs break-all text-base-content/70">SHA-256 {fingerprint(row.fingerprint)}</p>
          <p className="text-xs leading-snug text-base-content/50">If it changes later, the server is blocked until you accept again.</p>
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-sm" onClick={onClose}>Not now</button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setError('')
                try { onTrusted(await trustServer(row.id)) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
              }}
            >
              Trust and use
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  )
}
