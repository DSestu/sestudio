import { useCallback, useEffect, useState } from 'react'
import { storagesApi, type FreeboxDisk, type FreeboxSharing } from '../../api'
import { fmtSize } from '../../downloadedLibrary'
import { useModalBack } from '../../useModalBack'
import ResponsiveModal from '../ResponsiveModal'

type Step = { kind: 'loading' } | { kind: 'unpaired' } | { kind: 'waiting'; track: number; since: number }
  | { kind: 'refused'; why: string } | { kind: 'paired'; model: string; disks: FreeboxDisk[]; sharing: FreeboxSharing }

type Call = <T>(op: string, extra?: Record<string, unknown>) => Promise<T>

/** Whether it is paired and, when it is, its disks and sharing. */
async function readBox(call: Call): Promise<{ step: Step; error: string }> {
  try {
    const status = await call<{ paired: boolean; model: string }>('status')
    if (!status.paired) return { step: { kind: 'unpaired' }, error: '' }
    const [disks, sharing] = await Promise.all([call<FreeboxDisk[]>('disks'), call<FreeboxSharing>('sharing')])
    return { step: { kind: 'paired', model: status.model, disks, sharing }, error: '' }
  } catch (e) {
    return { step: { kind: 'unpaired' }, error: (e as Error).message }
  }
}

const KEY_ICON = 'M8 19a4 4 0 100-8 4 4 0 000 8zM11 12l9-9M17 6l3 3M15 8l2 2'

/**
 * A Freebox in Nearby, through Freebox OS (SPEC-storage §11, M4, F1): pair once,
 * then its disks and its Windows sharing, read from the box; turning the sharing
 * on asks first (S). Once it is on, the box's shares appear in its row as usual.
 */
export default function FreeboxPanel({ host, via, onSharingChanged }: {
  host: string
  /** '' for this server's network, else the bridge's id. */
  via: string
  onSharingChanged: () => void
}) {
  const [step, setStep] = useState<Step>({ kind: 'loading' })
  const [error, setError] = useState('')
  const [asking, setAsking] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const call = useCallback(<T,>(op: string, extra: Record<string, unknown> = {}) =>
    storagesApi.freebox<T>({ via, op, host, ...extra }), [via, host])

  // Bumped to read the box again (after pairing, unpairing, turning sharing on).
  const [round, setRound] = useState(0)
  const load = useCallback(() => setRound(r => r + 1), [])

  useEffect(() => {
    let live = true
    readBox(call).then(r => {
      if (!live) return
      setStep(r.step)
      setError(r.error)
    })
    return () => { live = false }
  }, [call, round])

  // While waiting for the person to confirm on the box: asked every 2 s.
  useEffect(() => {
    if (step.kind !== 'waiting') return
    const id = window.setInterval(async () => {
      setNow(Date.now())
      try {
        const { status } = await call<{ status: string }>('pair_status', { track_id: step.track })
        if (status === 'granted') void load()
        else if (status === 'denied') setStep({ kind: 'refused', why: 'Refused on the Freebox.' })
        else if (status === 'timeout' || status === 'unknown') setStep({ kind: 'refused', why: 'Not confirmed in time.' })
      } catch (e) {
        setStep({ kind: 'refused', why: (e as Error).message })
      }
    }, 2000)
    return () => window.clearInterval(id)
  }, [step, call, load])

  async function pair() {
    setError('')
    try {
      const { track_id } = await call<{ track_id: number }>('pair')
      setStep({ kind: 'waiting', track: track_id, since: Date.now() })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const keyIcon = (cls: string) => (
    <svg className={`w-4 h-4 shrink-0 ${cls}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true"><path d={KEY_ICON} /></svg>
  )

  return (
    <div className="ml-8 flex flex-col gap-2">
      {step.kind === 'loading' && <p className="text-xs text-base-content/50">Asking Freebox OS…</p>}
      {(step.kind === 'unpaired' || step.kind === 'refused') && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-base-content/60 flex-1 min-w-48">
            {step.kind === 'refused' ? `${step.why} ` : ''}Pair once with Freebox OS to see its disks and turn its file sharing on.
          </p>
          <button type="button" onClick={() => void pair()} className="btn btn-sm btn-primary gap-1.5">{keyIcon('')} Pair</button>
        </div>
      )}
      {step.kind === 'waiting' && (
        <div role="status" className="flex items-start gap-2.5 rounded-box border border-warning/40 bg-base-200 px-3 py-2.5 text-sm">
          {keyIcon('text-warning mt-0.5')}
          <span>
            <b className="font-semibold">Confirm on the Freebox</b>
            <span className="block text-xs text-base-content/60">
              Press ✓ on the Freebox Server's screen, or approve sestudio in Freebox OS (Gestion des accès) or the
              Freebox Connect app. Waiting… {Math.round((now - step.since) / 1000)} s
            </span>
          </span>
        </div>
      )}
      {step.kind === 'paired' && (
        <>
          <p className="text-xs text-success flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            Paired with Freebox OS{step.model ? ` · ${step.model}` : ''}
          </p>
          <ul className="flex flex-col gap-1">
            {step.disks.length === 0 && <li className="text-xs text-base-content/55">No disk plugged in.</li>}
            {step.disks.map(d => (
              <li key={`${d.name}:${d.model}`} className="flex items-center gap-2.5 rounded-box bg-base-200 px-2.5 py-1.5">
                <svg className="w-4 h-4 shrink-0 text-base-content/55" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true"><path d="M12 3v14M8 7l4-4 4 4M7 13v3a2 2 0 002 2h6a2 2 0 002-2v-3" /></svg>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm truncate">{d.name}</span>
                  <span className="block text-xs text-base-content/55">
                    {[d.kind.toUpperCase(), d.model, `${fmtSize(d.total)} · ${fmtSize(d.free)} free`].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs flex-1 min-w-48">
              Windows sharing:{' '}
              {step.sharing.smb
                ? <span className="text-success">on · {step.sharing.logon ? `with the login “${step.sharing.user}”` : 'guest can read'}</span>
                : <span className="text-base-content/60">off · its disks are not on the network yet</span>}
            </p>
            {!step.sharing.smb && (
              <button type="button" onClick={() => setAsking(true)} className="btn btn-sm btn-outline">Turn on sharing…</button>
            )}
            <button type="button" onClick={() => void call('unpair').then(load)} className="btn btn-ghost btn-xs">Unpair</button>
          </div>
        </>
      )}
      {error && <p role="alert" className="text-xs text-error">{error}</p>}
      {asking && step.kind === 'paired' && (
        <TurnOnSharing
          onClose={() => setAsking(false)}
          onDone={() => { setAsking(false); void load(); onSharingChanged() }}
          turnOn={(user, password) => call<FreeboxSharing>('turn_on_sharing', { user, password })}
        />
      )}
    </div>
  )
}

/** Before changing their box (S): what it turns on, that it stays on, and who can read. */
function TurnOnSharing({ onClose, onDone, turnOn }: {
  onClose: () => void
  onDone: () => void
  turnOn: (user: string, password: string) => Promise<unknown>
}) {
  useModalBack(true, onClose)
  const [withLogin, setWithLogin] = useState(true)
  const [user, setUser] = useState('freebox')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function go() {
    setBusy(true)
    setError('')
    try {
      await turnOn(withLogin ? user.trim() : '', withLogin ? password : '')
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <ResponsiveModal onClose={onClose} boxClassName="sm:max-w-lg">
      <h3 className="font-semibold text-lg">Turn on the Freebox's file sharing?</h3>
      <p className="text-sm text-base-content/70 mt-2">
        Turns on its Windows sharing (SMB), which shares its disks on their network. It is a setting of their box: it
        stays on until you or they turn it off.
      </p>
      <p className="text-sm text-base-content/60 mt-4 mb-1.5">Who can read it</p>
      <div className="join w-full" role="radiogroup" aria-label="Who can read it">
        <button type="button" role="radio" aria-checked={!withLogin} onClick={() => setWithLogin(false)} className={`btn btn-sm join-item flex-1 ${!withLogin ? 'btn-primary btn-soft' : ''}`}>Anyone on their Wi-Fi (guest)</button>
        <button type="button" role="radio" aria-checked={withLogin} onClick={() => setWithLogin(true)} className={`btn btn-sm join-item flex-1 ${withLogin ? 'btn-primary btn-soft' : ''}`}>Only with a login</button>
      </div>
      {withLogin && (
        <div className="flex gap-2 mt-3">
          <label className="flex-1 min-w-0">
            <span className="block text-xs text-base-content/60">User</span>
            <input value={user} onChange={e => setUser(e.target.value)} autoComplete="off" spellCheck={false} className="input input-sm w-full" />
          </label>
          <label className="flex-1 min-w-0">
            <span className="block text-xs text-base-content/60">Password</span>
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="new-password" className="input input-sm w-full" />
          </label>
        </div>
      )}
      <p className="text-xs text-base-content/50 mt-2">
        {withLogin ? 'The login is set on the box; type it again when you open the share.' : 'Anyone on their network can then read the disks.'}
      </p>
      {error && <p role="alert" className="text-sm text-error mt-3">{error}</p>}
      <div className="modal-action">
        <button type="button" onClick={onClose} className="btn btn-sm">Cancel</button>
        <button type="button" onClick={() => void go()} disabled={busy || (withLogin && (!user.trim() || !password))} className="btn btn-sm btn-primary">
          {busy ? 'Turning it on…' : 'Turn it on'}
        </button>
      </div>
    </ResponsiveModal>
  )
}
