import { useEffect, useState } from 'react'
import { listRenderers, type Renderer } from '../../api'
import { describeCastError, loadCast } from '../../cast'
import { sendToChromecast, sendToDlna, useMusicCasting } from '../../musicCast'

const CAST_ICON = 'M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2h-5M3 11a6 6 0 016 6M3 15a2 2 0 012 2M3 19h.01'

/** The cast button (transport, player bar): a list of the TVs this browser can reach; picking one sends the queue there. */
export default function SendToTv({ className = 'size-12 rounded-xl bg-white/6 hover:bg-white/10' }: { className?: string }) {
  const casting = useMusicCasting()
  const [open, setOpen] = useState(false)
  const [renderers, setRenderers] = useState<Renderer[] | null>(null)
  const [chromecast, setChromecast] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    loadCast().then(setChromecast)
    listRenderers().then(setRenderers).catch(() => setRenderers([]))
  }, [open])

  async function send(label: string, run: () => Promise<void>) {
    setBusy(label)
    setError('')
    try {
      await run()
      setOpen(false)
    } catch (e) {
      setError(describeCastError(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <button
        aria-label="Send to TV"
        aria-expanded={open}
        disabled={!!casting}
        className={`grid place-items-center disabled:text-primary ${className}`}
        onClick={() => { setError(''); setOpen(o => !o) }}
      >
        <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={CAST_ICON} /></svg>
      </button>
      {open && (
        <>
          <button aria-label="Close" className="fixed inset-0 z-50 cursor-default" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute bottom-full right-0 mb-2 z-50 w-64 rounded-2xl glass p-2 text-sm">
            {chromecast && (
              <button role="menuitem" disabled={!!busy} className="w-full text-left rounded-xl px-3 py-2 hover:bg-white/8 disabled:opacity-50"
                onClick={() => void send('chromecast', () => sendToChromecast())}>
                Chromecast{busy === 'chromecast' && '…'}
              </button>
            )}
            {renderers?.map(r => (
              <button key={r.udn} role="menuitem" disabled={!!busy} className="w-full text-left rounded-xl px-3 py-2 hover:bg-white/8 disabled:opacity-50"
                onClick={() => void send(r.udn, () => sendToDlna(r.udn, r.name))}>
                {r.name}{busy === r.udn && '…'}
              </button>
            ))}
            {renderers === null && <p className="px-3 py-2 text-base-content/60">Looking for TVs…</p>}
            {renderers?.length === 0 && !chromecast && <p className="px-3 py-2 text-base-content/60">No TV found on this network.</p>}
            {error && <p role="alert" className="px-3 py-2 text-error">{error}</p>}
          </div>
        </>
      )}
    </div>
  )
}
