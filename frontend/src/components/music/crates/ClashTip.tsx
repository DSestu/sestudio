import { useState } from 'react'
import { openHarmonyBasics } from '../harmony/store'

const KEY = 'sestudio.clashTipSeen'

/** The first time a set has a clash: what an amber join means. Got it hides it for good on this device. */
export default function ClashTip() {
  const [seen, setSeen] = useState(() => { try { return !!localStorage.getItem(KEY) } catch { return false } })
  if (seen) return null
  const dismiss = () => { try { localStorage.setItem(KEY, '1') } catch { /* private mode: hidden for this visit only */ } setSeen(true) }
  return (
    <div role="note" className="flex flex-col gap-2 rounded-xl bg-warning/10 px-4 py-3 text-sm">
      <p><b className="text-warning">Amber joins clash.</b> The two tracks share 5 notes or fewer, so the overlap can sound off. Tap an amber join to see what fits between, or keep it if you like the tension.</p>
      <div className="flex gap-2">
        <button onClick={dismiss} className="btn btn-sm">Got it</button>
        <button onClick={() => openHarmonyBasics(1)} className="btn btn-ghost btn-sm">Why?</button>
      </div>
    </div>
  )
}
