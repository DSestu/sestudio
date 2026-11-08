import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { blendWord, colourOf, LAYERS, type Blend, type BlendTrack, type Layer, type Lean } from '../../blend'
import { BlendRing, blendColor } from './BlendRing'

// A join's Blend (SPEC-blend story 8, board §2): one ring; hover or focus on desktop, a tap on a phone,
// opens what each layer gave. Ignored or unknown layers stay listed, greyed.

const LABEL: Record<Layer, string> = { energy: 'Energy', tempo: 'Tempo', harmony: 'Harmony', colour: 'Colour', genre: 'Genre' }
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n))}`

/** What each layer's part is about, in words. */
function values(b: Blend, a: BlendTrack, t: BlendTrack, lean: Lean, harmony?: string | null): Record<Layer, string> {
  const de = b.steps.energy, dt = b.steps.tempo
  const leanNote = lean === 'hold' || de == null ? '' : (lean === 'lift') === de >= 0 ? ` (with the ${lean})` : ` (against the ${lean})`
  const ca = colourOf(a), cb = colourOf(t)
  const ga = a.genre, gb = t.genre
  return {
    energy: de == null ? 'not read yet' : `${signed(de)}${leanNote}`,
    tempo: dt == null ? 'not read yet' : dt === 0 ? 'same BPM' : `${signed(dt)} BPM`,
    harmony: harmony ?? 'key not read yet',
    colour: ca && cb ? (ca === cb ? ca : `${ca} → ${cb}`) : 'key not read yet',
    genre: ga && gb ? (ga === gb ? gb : `${ga} → ${gb}`) : 'not known',
  }
}

/** The breakdown: the score and its word, then every layer with its part. */
export function BlendBreakdown({ b, a, t, into, lean = 'hold', harmony, foot }: {
  b: Blend; a: BlendTrack; t: BlendTrack; into?: string; lean?: Lean; harmony?: string | null; foot?: ReactNode
}) {
  const v = values(b, a, t, lean, harmony)
  return (
    <div className="text-[12.5px]">
      <p className="flex items-center gap-2 text-[13px] font-semibold">
        <BlendRing score={b.score} size={20} />Blends {blendWord(b.score)}
        <span className="ml-auto font-normal tabular-nums text-base-content/50">{Math.round(b.score * 100)}</span>
      </p>
      {into && <p className="mb-1.5 truncate text-[11.5px] text-base-content/50">into {into}</p>}
      <dl>
        {LAYERS.map(k => {
          const p = b.parts[k]
          return (
            <div key={k} className={`grid grid-cols-[64px_1fr] items-center gap-2 border-t border-white/7 py-1.5 ${p == null ? 'opacity-45' : ''}`}>
              <dt className="text-base-content/60">{LABEL[k]}</dt>
              <dd className="flex min-w-0 flex-col gap-1">
                <span className="truncate">{v[k]}{p == null && <span className="text-base-content/50"> · not counted</span>}</span>
                <span className="relative h-[5px] rounded-full bg-white/10">
                  {p != null && <b className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${p * 100}%`, background: blendColor(p) }} />}
                </span>
              </dd>
            </div>
          )
        })}
      </dl>
      {b.blocked && <p className="mt-1.5 text-[11.5px] text-error">Past a Must: nothing left met every Must here.</p>}
      {foot}
    </div>
  )
}

const usePhone = () => {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const m = window.matchMedia('(max-width: 767px)')
    const on = () => setPhone(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return phone
}

/** A join's ring. Desktop: the breakdown on hover or focus. Phone: a tap opens it in a sheet, with what to do next. */
export function BlendMark({ b, a, t, into, lean = 'hold', harmony, size = 16, actions, label }: {
  b: Blend; a: BlendTrack; t: BlendTrack; into?: string; lean?: Lean; harmony?: string | null; size?: number
  /** The sheet's buttons on a phone (Swap this track, Fits here…). */
  actions?: { label: string; run: () => void }[]
  /** Text beside the ring (the steps), when the row has room. */
  label?: ReactNode
}) {
  const phone = usePhone()
  const [open, setOpen] = useState(false)
  // Desktop: where the card goes, set while the ring is hovered or focused (rows clip, so it lives on <body>).
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const box = useRef<HTMLSpanElement>(null)
  const show = () => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.max(8, Math.min(window.innerWidth - 308, r.right - 300))
    // Below the ring, or above it near the bottom of the screen.
    setAt(r.bottom + 330 > window.innerHeight ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 })
  }
  const hide = () => setAt(null)
  useEffect(() => {
    if (!open || !phone) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open, phone])
  const card = <BlendBreakdown b={b} a={a} t={t} into={into} lean={lean} harmony={harmony} />
  return (
    <span ref={box} className="relative inline-flex shrink-0 items-center"
      onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}
      onMouseEnter={phone ? undefined : show} onMouseLeave={phone ? undefined : hide}
      onFocus={phone ? undefined : show} onBlur={phone ? undefined : hide}>
      <button type="button" aria-label={`Blends ${blendWord(b.score)} into ${into ?? 'this track'}: open the breakdown`} aria-expanded={phone ? open : undefined}
        onClick={() => { if (phone) setOpen(true) }} className="inline-flex items-center gap-1.5 rounded-full p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <BlendRing score={b.score} size={size} />
        {label && <span className="text-[11px] tabular-nums text-base-content/50">{label}</span>}
      </button>
      {!phone && at && createPortal(
        <span role="tooltip" className="pointer-events-none fixed z-[70] block w-[300px] rounded-xl bg-base-300 p-3 text-left shadow-2xl outline-1 outline-white/12"
          style={at}>
          {card}
        </span>,
        document.body,
      )}
      {phone && open && (
        <>
          <span className="fixed inset-0 z-50 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <span role="dialog" aria-modal="true" aria-label="How this join blends" className="fixed inset-x-0 bottom-0 z-50 block rounded-t-3xl bg-base-300 px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-2.5 text-left outline-1 outline-white/12">
            <span aria-hidden="true" className="mx-auto mb-3 block h-1 w-10 rounded-full bg-white/25" />
            <BlendBreakdown b={b} a={a} t={t} into={into} lean={lean} harmony={harmony} foot={actions?.length ? (
              <span className="mt-3 flex gap-2">
                {actions.map(x => <button key={x.label} className="btn btn-sm" onClick={() => { setOpen(false); x.run() }}>{x.label}</button>)}
                <button className="btn btn-ghost btn-sm ml-auto" onClick={() => setOpen(false)}>Close</button>
              </span>
            ) : undefined} />
          </span>
        </>
      )}
    </span>
  )
}
