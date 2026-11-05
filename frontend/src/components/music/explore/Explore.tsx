import { useEffect, useMemo, useRef, useState } from 'react'
import { MOOD_LADDER } from '../../../harmony'
import type { MusicTrack } from '../../../musicLibrary'
import { useSummaries } from '../../../musicMeta'
import { filtersOf, openFitsFor, proxOf, rankFits } from '../../../musicFits'
import { useSettings } from '../../../useSettings'
import ResponsiveModal from '../../ResponsiveModal'
import { useModalBack } from '../../../useModalBack'
import { useFitsPrefs } from '../../../fitsPrefs'
import { playFrom } from '../player'
import DotCard from './DotCard'
import { dotOf, PAD, place, ringRadius, type Dot } from './place'

const NOTES = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'A♭', 'E♭', 'B♭', 'F']
/** Darkest first, the way the map reads from left to right. */
const MOODS = [...MOOD_LADDER].reverse()
const moodColor = (b: number) => MOOD_LADDER.find(m => m.brightness === b)?.color ?? 'currentColor'
/** How many fitting tracks are ringed. */
const RINGED = 8

/** The width of an element, kept up to date. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)))
    ro.observe(el)
    setW(Math.round(el.clientWidth))
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const label = 'fill-base-content/60 text-[11px]'

/** One stop of the playlist's path: a playlist row (`key`) and its track. */
export interface Stop { key: string; track: MusicTrack }

/**
 * A playlist's Map view: the library as faint dots by mood (Vibe) or by note set (Notes), the playlist's
 * path drawn in order through numbered dots, the anchor of Fits next filled, clashes ringed amber and
 * what fits after the anchor ringed green. Static SVG, drawn at the pixel size of its box.
 */
export default function Explore({ library, path, anchor, clash, onPick, action, onPlaylist }: {
  library: MusicTrack[]
  path: Stop[]
  /** The row Fits next is anchored to. */
  anchor?: Stop
  /** Rows whose join to a neighbour clashes. */
  clash: ReadonlySet<string>
  /** A path dot's tap makes its row the anchor. */
  onPick: (key: string) => void
  /** What a library dot's card offers first ("Insert after …"). */
  action?: { label: string; onPick: (t: MusicTrack) => void }
  onPlaylist: (t: MusicTrack) => void
}) {
  const [view, setView] = useState<'vibe' | 'notes'>('vibe')
  const [sel, setSel] = useState<string>()
  useModalBack(!!sel, () => setSel(undefined))
  const [settings] = useSettings()
  const prefs = useFitsPrefs()
  const { get, v } = useSummaries(useMemo(() => library.map(t => t.id), [library]))
  const [box, w] = useWidth()
  const h = Math.round(w < 520 ? w * 1.1 : w * 0.78)
  const R = ringRadius(w, h)
  const taken = useMemo(() => new Set(path.map(s => s.track.id)), [path])
  const dotsById = useMemo(() => {
    const out = new Map<string, Dot>()
    for (const t of library) {
      const d = dotOf(t.id, get(t.id))
      if (d && (view === 'vibe' || d.set !== undefined)) out.set(t.id, d)
    }
    return out
  }, [library, view, v]) // eslint-disable-line react-hooks/exhaustive-deps
  const stops = path.flatMap((s, i) => { const d = dotsById.get(s.track.id); return d ? [{ ...s, n: i + 1, d }] : [] })
  const faint = useMemo(() => library.filter(t => dotsById.has(t.id) && !taken.has(t.id)), [library, dotsById, taken])
  // The tracks Fits next would list first, as far as the map shows them.
  const fits = useMemo(() => {
    if (!anchor) return new Set<string>()
    const pool = faint.map(t => proxOf(t, get(t.id)))
    return new Set(rankFits(proxOf(anchor.track, get(anchor.track.id)), pool, filtersOf(prefs, settings.music_harmony_rule)).slice(0, RINGED).map(r => r.id))
  }, [anchor, faint, prefs, settings.music_harmony_rule, v]) // eslint-disable-line react-hooks/exhaustive-deps
  const picked = sel ? library.find(t => t.id === sel) : undefined
  const small = w < 520
  const r0 = view === 'vibe' && small ? 4.5 : 6

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="Map view" className="inline-flex rounded-full bg-white/6 p-0.5">
          {([['vibe', 'Vibe'], ['notes', 'Notes']] as const).map(([id, text]) => (
            <button key={id} onClick={() => setView(id)} aria-pressed={view === id} className={`relative hit h-8 rounded-full px-3 text-xs font-medium ${view === id ? 'bg-primary/20 text-primary' : 'text-base-content/70 hover:text-base-content'}`}>{text}</button>
          ))}
        </div>
        <span className="text-xs text-base-content/60">{stops.length + faint.length} of {library.length} tracks placed</span>
      </div>
      <ul aria-label="Legend" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/70">
        {MOODS.map(m => (
          <li key={m.mode} className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full" style={{ background: m.color }} aria-hidden="true" />{m.word}</li>
        ))}
        {anchor && (
          <li className="inline-flex max-w-full items-center gap-1.5"><i className="size-2.5 shrink-0 rounded-full border-2 border-success" aria-hidden="true" /><span className="truncate">fits after {anchor.track.title}</span></li>
        )}
        {clash.size > 0 && <li className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-full border-2 border-warning" aria-hidden="true" />clash</li>}
      </ul>
      <div ref={box} className="w-full">
        {w > 0 && (
          <svg width={w} height={h} role="group" aria-label={view === 'vibe' ? 'Tracks by mood, darker to brighter, and energy, calm to intense' : 'Tracks by note set on the circle of fifths'} className="rounded-2xl bg-white/3">
            {view === 'vibe' ? (
              <>
                <text x={PAD} y={h - 6} className={label}>← darker</text>
                <text x={w - PAD} y={h - 6} textAnchor="end" className={label}>brighter →</text>
                <text x={8} y={14} className={label}>↑ intense</text>
                <line x1={w / 2} x2={w / 2} y1={24} y2={h - 24} stroke="currentColor" strokeOpacity={0.06} />
                <line x1={PAD} x2={w - PAD} y1={h / 2} y2={h / 2} stroke="currentColor" strokeOpacity={0.06} />
              </>
            ) : (
              <>
                {NOTES.map((n, k) => {
                  const a = (k / 12) * Math.PI * 2 - Math.PI / 2
                  return (
                    <g key={n}>
                      <line x1={w / 2} y1={h / 2} x2={w / 2 + Math.cos(a) * R} y2={h / 2 + Math.sin(a) * R} stroke="currentColor" strokeOpacity={0.06} />
                      <text x={w / 2 + Math.cos(a) * (R + 14)} y={h / 2 + Math.sin(a) * (R + 14) + 4} textAnchor="middle" className={label}>{n}</text>
                    </g>
                  )
                })}
                <circle cx={w / 2} cy={h / 2} r={R * 0.32} fill="none" stroke="currentColor" strokeOpacity={0.08} />
                <circle cx={w / 2} cy={h / 2} r={R * 0.94} fill="none" stroke="currentColor" strokeOpacity={0.08} />
                <text x={w / 2} y={h / 2 + 4} textAnchor="middle" className={label}>dark</text>
              </>
            )}
            {faint.map(t => {
              const d = dotsById.get(t.id)!
              const [x, y] = place(d, view, w, h)
              const ringed = fits.has(t.id)
              return (
                <g key={t.id} className="cursor-pointer" onClick={() => setSel(t.id)}>
                  <circle cx={x} cy={y} r={r0} fill={moodColor(d.brightness)} fillOpacity={ringed ? 0.95 : 0.35} stroke="transparent" strokeWidth={20}>
                    <title>{t.title}</title>
                  </circle>
                  {ringed && <circle cx={x} cy={y} r={r0 + 5} fill="none" stroke="var(--color-success)" strokeWidth={2} pointerEvents="none" />}
                </g>
              )
            })}
            {stops.length > 1 && (
              <polyline points={stops.map(s => place(s.d, view, w, h).join(',')).join(' ')} fill="none" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1.5} strokeDasharray="4 3" pointerEvents="none" />
            )}
            {[...stops.filter(s => s.key !== anchor?.key), ...stops.filter(s => s.key === anchor?.key)].map(s => {
              const [x, y] = place(s.d, view, w, h)
              const on = s.key === anchor?.key
              const bad = clash.has(s.key)
              return (
                <g
                  key={s.key} role="button" tabIndex={0} aria-pressed={on}
                  aria-label={`${s.n}. ${s.track.title}${bad ? ', clashes' : ''}`}
                  className="group cursor-pointer outline-none" onClick={() => onPick(s.key)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(s.key) } }}
                >
                  <title>{s.track.title}</title>
                  <circle cx={x} cy={y} r={22} fill="transparent" />
                  <circle cx={x} cy={y} r={on ? 13 : 11} fill={on ? 'var(--color-primary)' : moodColor(s.d.brightness)} stroke="var(--color-base-100)" strokeWidth={1.5} />
                  {bad && <circle cx={x} cy={y} r={on ? 17 : 15} fill="none" stroke="var(--color-warning)" strokeWidth={2} />}
                  <circle cx={x} cy={y} r={on ? 20 : 18} fill="none" stroke="currentColor" strokeWidth={2} className="opacity-0 group-focus-visible:opacity-100" />
                  <text x={x} y={y + 4} textAnchor="middle" className="pointer-events-none text-[11px] font-semibold" fill={on ? 'var(--color-primary-content)' : 'var(--color-base-100)'}>{s.n}</text>
                </g>
              )
            })}
          </svg>
        )}
      </div>
      {view === 'notes' && <p className="text-xs text-base-content/60">Neighbours on the circle share 6 of 7 notes. The nearer the centre, the darker the mood.</p>}
      {picked && (
        <ResponsiveModal onClose={() => setSel(undefined)}>
          <DotCard
            track={picked}
            s={get(picked.id)}
            onPlay={() => { void playFrom(library, picked); setSel(undefined) }}
            onSet={() => onPlaylist(picked)}
            onFits={() => { setSel(undefined); openFitsFor(picked.id) }}
            insert={action && { label: action.label, onInsert: () => { action.onPick(picked); setSel(undefined) } }}
          />
          <button onClick={() => setSel(undefined)} className="btn btn-ghost mt-2 h-11 w-full">Close</button>
        </ResponsiveModal>
      )}
    </div>
  )
}
