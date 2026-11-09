import { useState } from 'react'
import { MOVE_TEXT, MOVES, setWelcome, useBlendWeights, welcomeName, WELCOME_PRESETS, type Move } from '../../../musicBlendWeights'
import { Ic } from './icons'

// Harmony moves (SPEC-music-library §2.7): inside Blend by, how welcome each key move is,
// 0 (avoid) to 100 (as good as the same key). A slider per move with a two-scale picture and
// how many joins of the set make that move; 9 presets.

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const DORIAN = [0, 2, 3, 5, 7, 9, 10]
const SHIFT: Record<Move, number> = { 'same-key': 0, pivot: 0, 'next-door': 7, 'modal-shift': 0, lift: 2, drop: -2, clash: 6 }

/** Two rows of 12 cells: the first scale's notes, then the second's; shared notes lit together. */
function Picture({ move }: { move: Move }) {
  const b = move === 'modal-shift' ? DORIAN : MAJOR.map(n => (n + SHIFT[move] + 12) % 12)
  const row = (s: number[], other: number[]) => (
    <span className="flex gap-px">
      {Array.from({ length: 12 }, (_, i) => <i key={i} className={`h-1.5 w-1 rounded-[1px] ${s.includes(i) ? (other.includes(i) ? 'bg-primary/80' : 'bg-warning/80') : 'bg-white/10'}`} />)}
    </span>
  )
  return <span className="flex shrink-0 flex-col gap-px" aria-hidden="true">{row(MAJOR, b)}{row(b, MAJOR)}</span>
}

export default function HarmonyMoves({ counts }: {
  /** Joins of the set per move. */
  counts: Partial<Record<Move, number>>
}) {
  const { welcome } = useBlendWeights()
  const [open, setOpen] = useState(() => localStorage.getItem('music.harmonyMovesOpen') === '1')
  // The slider moves freely; the set re-orders once it is let go.
  const [draft, setDraft] = useState<Partial<Record<Move, number>>>({})
  const toggle = () => { setOpen(o => { localStorage.setItem('music.harmonyMovesOpen', o ? '0' : '1'); return !o }) }
  const commit = (k: Move) => {
    const v = draft[k]
    if (v === undefined) return
    setWelcome({ ...welcome, [k]: v })
    setDraft(d => { const n = { ...d }; delete n[k]; return n })
  }
  const name = welcomeName(welcome)
  return (
    <section className="rounded-xl bg-white/4">
      <button onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
        <Ic name="right" size={12} width={2.4} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        <b className="font-semibold">Harmony moves</b>
        <span className="text-xs text-primary">{name}</span>
        <small className="text-[11px] text-base-content/45">how welcome each key move is</small>
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          <div className="flex flex-wrap gap-1">
            {WELCOME_PRESETS.map(([n, v]) => (
              <button key={n} onClick={() => setWelcome(v)} aria-pressed={name === n} className={`rounded-lg px-2 py-1 text-xs ${name === n ? 'bg-primary/20 text-primary' : 'bg-white/6 text-base-content/70 hover:bg-white/10'}`}>{n}</button>
            ))}
          </div>
          {MOVES.map(k => {
            const v = Math.round((draft[k] ?? welcome[k]) * 100)
            return (
              <label key={k} className="grid grid-cols-[auto_1fr_8rem_2rem_2rem] items-center gap-2 text-xs">
                <Picture move={k} />
                <span className="min-w-0 leading-tight"><b className="font-medium">{MOVE_TEXT[k][0]}</b><small className="block truncate text-[11px] text-base-content/45">{MOVE_TEXT[k][1]}</small></span>
                <input type="range" min={0} max={100} value={v} aria-label={`${MOVE_TEXT[k][0]}: how welcome`}
                  onChange={e => setDraft(d => ({ ...d, [k]: +e.target.value / 100 }))} onPointerUp={() => commit(k)} onKeyUp={() => commit(k)}
                  className="range range-xs range-primary" />
                <em className="text-right not-italic tabular-nums">{v}</em>
                <span className="text-right tabular-nums text-base-content/45" title="Joins like this in your set">{counts[k] ? `${counts[k]}×` : ''}</span>
              </label>
            )
          })}
          <p className="text-[11px] text-base-content/45">Lift and drop are transpositions: same mode, moved up or down. 0 means avoid, 100 means as good as the same key.</p>
        </div>
      )}
    </section>
  )
}
