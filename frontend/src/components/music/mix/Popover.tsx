import { useEffect, useRef, type ReactNode } from 'react'
import { queueActions, type MixSettings } from '../../../musicQueue'
import type { SyncStatus } from '../engine'
import { fmtBpm } from '../format'
import type { Plan, Track } from '../timeline/sampling'

// The transition popover (SPEC-music-player §9.4): one pair's mix settings.

export interface PopoverProps {
  a: { track: Track; title: string }
  b: { track: Track; title: string }
  plan: Plan
  settings: MixSettings
  defaultMix: string
  /** The running beat sync, to show its lock when it is this very pair's. */
  sync: SyncStatus | null
  /** Page position of the label it opens from: its left edge and its top, the popover sits above it. */
  x: number
  above: number
  onClose: () => void
  onHear: () => void
}

const BARS = [4, 8, 16, 32]

function Seg<T extends string | number | boolean>({ label, value, options, disabled, onPick }: {
  label: string
  value: T
  options: [T, ReactNode][]
  disabled?: boolean
  onPick: (v: T) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-base-content/60">{label}</span>
      <div role="group" aria-label={label} className="flex rounded-lg bg-white/6 p-0.5">
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            type="button"
            disabled={disabled}
            aria-pressed={v === value}
            onClick={() => onPick(v)}
            className={`px-2.5 py-1 rounded-md tabular-nums transition-colors disabled:opacity-40 ${v === value ? 'bg-primary/25 text-primary' : 'hover:bg-white/8'}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

function statusLine(p: Plan, a: Track, b: Track, settings: MixSettings, sync: SyncStatus | null): string {
  if (sync) return `${sync.locked ? 'Locked' : 'Locking'} · ${sync.errMs === null ? '…' : `${sync.errMs > 0 ? '+' : ''}${sync.errMs.toFixed(0)} ms`}`
  if (p.why === 'tempo') return `Tempos ${Math.abs((a.bpm / b.bpm - 1) * 100).toFixed(1)} % apart, fading instead`
  if (p.why === 'short') return 'Track too short for that length, fading instead'
  if (p.mode === 'sync') return `${p.len.toFixed(1)} s · on the downbeat`
  return settings.mode === 'sync' ? 'No tempo for one of the tracks, fading instead' : '4 s equal-power fade'
}

export default function MixPopover({ a, b, plan, settings, defaultMix, sync, x, above, onClose, onHear }: PopoverProps) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    root.current?.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' })
    // Esc closes only the popover, not the player under it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const pair = [a.track.id, b.track.id] as const
  const set = (patch: Partial<MixSettings>) => void queueActions.setMix(...pair, { ...settings, ...patch })
  const sync_ = settings.mode === 'sync'
  const d = a.track.bpm && b.track.bpm ? (a.track.bpm / b.track.bpm - 1) * 100 : 0
  const step = (e: React.MouseEvent, sign: number) => set({ nudge: Math.max(-500, Math.min(500, settings.nudge + sign * (e.shiftKey ? 1 : 5))) })
  const running = sync?.pair === `${pair[0]}>${pair[1]}` ? sync : null

  return (
    <div
      ref={root}
      data-mix-popover
      role="dialog"
      aria-label="Transition"
      className="fixed z-30 w-74 p-3 rounded-[14px] glass text-xs flex flex-col gap-2.5 overflow-y-auto"
      // Above the queue sheet and the drop marks (z-20), opaque enough that queue rows don't read through.
      style={{ background: 'hsl(205 62% 12% / 0.97)', left:Math.max(8, Math.min(window.innerWidth - 312, x)), bottom: window.innerHeight - above + 8, maxHeight: above - 16 }}
    >
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 truncate text-[13px] font-semibold">{a.title} → {b.title}</div>
        <button type="button" aria-label="Close" onClick={onClose} className="size-6 rounded-md grid place-items-center hover:bg-white/8">
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div className="text-base-content/55 tabular-nums">
        {a.track.bpm ? fmtBpm(a.track.bpm) : '?'} → {b.track.bpm ? fmtBpm(b.track.bpm) : '?'} BPM
        {Math.abs(d) >= 0.05 && ` · ${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} %`}
      </div>
      <Seg label="Mix" value={settings.mode} options={[['fade', 'Fade'], ['sync', 'Beat sync']]} onPick={mode => set({ mode })} />
      <Seg label="Length" value={settings.bars} options={BARS.map(n => [n, `${n}`])} disabled={!sync_} onPick={bars => set({ bars })} />
      <Seg label="Tempo" value={settings.tempo} options={[[true, 'Match'], [false, 'Off']]} disabled={!sync_} onPick={tempo => set({ tempo })} />
      <Seg label="Bass swap" value={settings.swap} options={[[true, 'On'], [false, 'Off']]} disabled={!sync_} onPick={swap => set({ swap })} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-base-content/60">Nudge</span>
        <div className="flex items-center rounded-lg bg-white/6 p-0.5">
          <button type="button" aria-label="Earlier" disabled={!sync_} onClick={e => step(e, -1)} className="size-6 rounded-md hover:bg-white/8 disabled:opacity-40">−</button>
          <span className="w-14 text-center tabular-nums">{settings.nudge > 0 ? '+' : ''}{settings.nudge} ms</span>
          <button type="button" aria-label="Later" disabled={!sync_} onClick={e => step(e, 1)} className="size-6 rounded-md hover:bg-white/8 disabled:opacity-40">+</button>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1.5 border-t border-white/10">
        <span className="flex-1 min-w-0 text-base-content/60 tabular-nums" aria-live="polite">{statusLine(plan, a.track, b.track, settings, running)}</span>
        <button type="button" onClick={onHear} className="px-3 py-1.5 rounded-lg bg-primary/25 text-primary font-medium hover:bg-primary/35">Hear it</button>
      </div>
      <Seg label="Default mix" value={defaultMix as 'fade' | 'sync'} options={[['fade', 'Fade 4 s'], ['sync', 'Beat sync']]} onPick={m => void queueActions.setDefaultMix(m)} />
    </div>
  )
}
