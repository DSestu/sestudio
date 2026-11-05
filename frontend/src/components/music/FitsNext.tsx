import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { keyDisplay } from '../../harmony'
import { formatDuration, type MusicTrack } from '../../musicLibrary'
import { useAnalysing, useSummaries } from '../../musicMeta'
import { filtersOf, plainKind, proxOf, rankFits, relaxations, type FitsFilters } from '../../musicFits'
import { useTheory } from '../../musicTheory'
import { useSettings } from '../../useSettings'
import { bridges, joinColor, type Join } from './crates/proximity'
import { openHarmonyBasics } from './harmony/store'
import { openKeyCard } from './harmony/keyCardStore'

// "What plays well next", the same list wherever it shows: beside a playlist, in the
// player's Add to queue, or for any track. The filters are shared too, so a choice made
// in one place holds in the others.

const SHOWN = 30

/** One song across libraries: its title and artist, ignoring case. */
const songKey = (t?: MusicTrack) => t && `${t.title}\u0000${t.artist}`.toLowerCase()

type Prefs = Partial<FitsFilters>
let prefs: Prefs = {}
const listeners = new Set<() => void>()
const setPref = (p: Prefs) => { prefs = { ...prefs, ...p }; listeners.forEach(l => l()) }
const usePrefs = () => useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => prefs)

const MORE: { key: keyof FitsFilters; label: string; options: [string, string][] }[] = [
  { key: 'mood', label: 'Mood', options: [['any', 'Any'], ['up', 'Brighter'], ['same', 'Same'], ['down', 'Darker']] },
  { key: 'genre', label: 'Genre', options: [['any', 'Any'], ['same', 'Same']] },
  { key: 'tempo', label: 'Tempo', options: [['near', '±6%'], ['any', 'Any']] },
]
const ENERGY: [FitsFilters['energy'], string][] = [['any', 'Any energy'], ['lift', 'Lift'], ['hold', 'Hold'], ['ease', 'Ease off']]

/** One choice of a few, as joined pills; tall enough for a thumb on phones. */
function Choice<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-full bg-white/6 p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          onClick={() => onPick(v)}
          aria-pressed={v === value}
          className={`relative hit h-8 rounded-full px-3 text-xs font-medium ${v === value ? 'bg-primary/20 text-primary' : 'text-base-content/70 hover:text-base-content'}`}
        >{text}</button>
      ))}
    </div>
  )
}

/** Why a row fits: the kind of join in its colour, the energy step and any tempo jump; notes shared at the theory level. */
function Why({ j, then, theory }: { j: Join; then?: Join; theory: boolean }) {
  const kind = (x: Join) => theory ? (x.kindLabel ?? 'Key not known') : plainKind(x.kind)
  const tempo = j.tempoJump || then?.tempoJump
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-xs">
      <i className="inline-block size-2 shrink-0 rounded-full" style={{ background: joinColor(j) }} aria-hidden="true" />
      <span style={{ color: joinColor(j) }}>{kind(j)}</span>
      {theory && j.shared != null && <span className="text-base-content/50">· {j.shared} of 7 notes</span>}
      {then
        ? <span className="text-base-content/50">· then {kind(then)}</span>
        : j.energy.step && <span className="text-base-content/50">· {j.energy.step}</span>}
      {tempo && <span className="text-base-content/50">· tempo jump</span>}
    </span>
  )
}

interface Props {
  /** The track the list ranks after. */
  anchor: MusicTrack
  /** With it, the list is what fits between `anchor` and this track. */
  then?: MusicTrack
  /** Where the anchor sits, after its title ("last in the queue"). */
  where?: string
  /** The tracks to rank. */
  library: MusicTrack[]
  /** Tracks never offered (already in the playlist or queue). */
  exclude?: readonly string[]
  /** What the + on a row does, and its name for screen readers ("Insert", "Add to queue"). */
  action: { label: string; onPick: (t: MusicTrack) => void }
  /** Leave "between" and rank after the anchor again. */
  onAfter?: () => void
  onClose?: () => void
  footer?: ReactNode
}

/** The ranked list of what plays well after a track (or between two), with why each fits. */
export default function FitsNext({ anchor, then, where, library, exclude = [], action, onAfter, onClose, footer }: Props) {
  const theory = useTheory()
  const deep = theory.level === 'theory'
  const [settings] = useSettings()
  const f = filtersOf(usePrefs(), settings.music_harmony_rule)
  const [more, setMore] = useState(false)
  const { get, v } = useSummaries(useMemo(() => library.map(t => t.id), [library]))
  const analysing = useAnalysing(anchor.id)
  const byId = useMemo(() => new Map(library.map(t => [t.id, t])), [library])
  const pool = useMemo(() => library.map(t => proxOf(t, get(t.id))), [library, v]) // eslint-disable-line react-hooks/exhaustive-deps
  const a = proxOf(anchor, get(anchor.id))
  const b = then && proxOf(then, get(then.id))
  const known = !!a.harmony?.track || !!a.camelot
  const fKey = JSON.stringify(f)
  const exKey = exclude.join(',')
  const rows = useMemo(() => {
    const skip = new Set([...exclude, anchor.id, then?.id ?? ''])
    // The same song in two libraries is one suggestion, and never the anchor (or a taken track) again.
    const seen = new Set([...skip].map(id => songKey(byId.get(id))))
    const once = (id: string) => { const k = songKey(byId.get(id)); if (!k || seen.has(k)) return false; seen.add(k); return true }
    if (b) return bridges(a, b, pool, SHOWN * 2, skip).filter(r => once(r.id)).slice(0, SHOWN).map(r => ({ id: r.id, join: r.before, then: r.after }))
    return rankFits(a, pool, f).filter(r => !skip.has(r.id) && once(r.id)).slice(0, SHOWN).map(r => ({ ...r, then: undefined }))
  }, [anchor.id, then?.id, pool, exKey, fKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const moreOn = MORE.filter(m => f[m.key] !== filtersOf({}, settings.music_harmony_rule)[m.key]).length

  const empty = analysing && !known
    ? <>Still reading the notes of <b>{anchor.title}</b>. The list fills in when it's done.</>
    : !known
      ? <>No key is known for <b>{anchor.title}</b> yet, so nothing can be ranked after it.</>
      : b ? 'Nothing in your library fits both sides.' : 'Nothing fits with these filters.'

  return (
    <section aria-label={b ? 'Fits between' : 'Fits next'} className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-2 px-4 pt-4 pb-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight">{b ? 'Fits between' : 'Fits next'}</h2>
          <p className="truncate text-xs text-base-content/60">
            {b ? <>{anchor.title} → {then!.title}</> : <>after {anchor.title}{where && ` · ${where}`}</>}
          </p>
        </div>
        <button onClick={() => openHarmonyBasics()} className="btn btn-ghost btn-sm h-11 sm:h-8 font-normal text-base-content/60">How it works</button>
        {onClose && (
          <button onClick={onClose} aria-label="Close" className="btn btn-ghost btn-circle size-11 sm:size-8">
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        )}
      </header>

      {b ? (
        onAfter && <p className="px-4 pb-2 text-xs text-base-content/60">Tracks that join both sides. <button onClick={onAfter} className="text-primary hover:underline">Rank after {anchor.title} instead</button></p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
          <Choice
            label="Harmony"
            value={deep ? f.harmony : f.harmony === 'any' ? 'any' : 'fits'}
            options={deep ? [['same', 'Same notes'], ['close', 'Close'], ['any', 'Any']] : [['fits', 'Smooth only'], ['any', 'Anything']]}
            onPick={h => setPref({ harmony: h === 'fits' ? (settings.music_harmony_rule === 'any' ? 'close' : settings.music_harmony_rule ?? 'close') : h as FitsFilters['harmony'] })}
          />
          <Choice label="Energy" value={f.energy} options={ENERGY} onPick={e => setPref({ energy: e })} />
          {deep && (
            <button onClick={() => setMore(m => !m)} aria-expanded={more} className="relative hit h-8 rounded-full bg-white/6 px-3 text-xs font-medium text-base-content/70">
              More{moreOn ? ` (${moreOn})` : ''}
            </button>
          )}
          {deep && more && MORE.map(m => (
            <span key={m.key} className="inline-flex items-center gap-1.5">
              <span className="text-xs text-base-content/50">{m.label}</span>
              <Choice label={m.label} value={f[m.key]} options={m.options} onPick={x => setPref({ [m.key]: x })} />
            </span>
          ))}
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {rows.map(r => {
          const t = byId.get(r.id)!
          const k = keyDisplay(theory, get(r.id))
          const bpm = get(r.id)?.bpm || t.bpm
          const why = <Why j={r.join} then={r.then} theory={deep} />
          return (
            <li key={r.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/5">
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-medium">{t.title}</span>
                <span className="flex items-center gap-1.5 truncate text-xs text-base-content/60">
                  <span className="truncate">{t.artist}</span>
                  {k && <span className="inline-flex shrink-0 items-center gap-1">· {k.color && <i className="inline-block size-2 rounded-full" style={{ background: k.color }} aria-hidden="true" />}{k.text}</span>}
                  {bpm ? <span className="shrink-0 tabular-nums">· {Math.round(bpm)}</span> : null}
                </span>
                {theory.level === 'tap'
                  ? <button onClick={() => openKeyCard(t.id, t.title)} aria-label={`Key card of ${t.title}`} className="mt-0.5 flex max-w-full">{why}</button>
                  : <span className="mt-0.5 flex">{why}</span>}
              </span>
              {t.duration > 0 && <span className="shrink-0 text-xs tabular-nums text-base-content/50">{formatDuration(t.duration)}</span>}
              <button onClick={() => action.onPick(t)} aria-label={`${action.label} ${t.title}`} className="btn btn-ghost btn-circle size-11 sm:size-8 text-primary">
                <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
              </button>
            </li>
          )
        })}
        {!rows.length && (
          <li className="flex flex-col items-center gap-3 px-4 py-8 text-center text-sm text-base-content/60">
            <p>{empty}</p>
            {known && !b && (
              <p className="flex flex-wrap justify-center gap-1.5">
                {relaxations(f).map(x => (
                  <button key={x.key} onClick={() => setPref({ [x.key]: x.to })} className="btn btn-sm btn-ghost bg-white/6">{x.label}</button>
                ))}
              </p>
            )}
          </li>
        )}
      </ul>
      {footer && <footer className="border-t border-white/8 px-4 py-3">{footer}</footer>}
    </section>
  )
}
