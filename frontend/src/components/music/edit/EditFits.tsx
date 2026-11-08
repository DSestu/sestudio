import { formatDuration, type MusicTrack } from '../../../musicLibrary'
import { useSummary } from '../../../musicMeta'
import { plainKind, proxOf } from '../../../musicFits'
import { useTheory } from '../../../musicTheory'
import { join, joinColor, type Join } from '../crates/proximity'
import { spotsFor } from './spots'
import { isClash, type SetTrack } from '../crates/setBuilder'
import { togglePin, type Drag } from './focus'
import { analyseOnline, useRun } from './onlineAnalysis'

// The editor's Fits column when it is about a track that is not in the playlist yet
// (Where it fits), or about a drag over the playlist (Drop preview). SPEC-playlist-edit.

function JoinText({ j, label }: { j: Join; label: string }) {
  const theory = useTheory().level === 'theory'
  const kind = theory ? (j.kindLabel ?? 'Key not known') : plainKind(j.kind)
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs">
      <span className="w-7 shrink-0 text-base-content/45">{label}</span>
      <i className="inline-block size-2 shrink-0 rounded-full" style={{ background: joinColor(j) }} aria-hidden="true" />
      <span style={{ color: joinColor(j) }}>{kind[0].toUpperCase() + kind.slice(1)}</span>
      {j.energy.step && <span className="text-base-content/50">· energy {j.energy.step}</span>}
      {j.tempoJump && <span className="text-warning">· tempo jump</span>}
    </span>
  )
}

const where = (gap: number, n: number, titleOf: (i: number) => string) =>
  n === 0 ? 'As the first track' : gap === 0 ? `At the start, before ${titleOf(0)}` : gap === n ? `At the end, after ${titleOf(n - 1)}` : `Between ${gap} ${titleOf(gap - 1)} and ${gap + 1} ${titleOf(gap)}`

/** What a hovered, picked or tapped track would do in the playlist. */
export function WhereItFits({ track, flat, titleOf, onPut }: { track: MusicTrack; flat: SetTrack[]; titleOf: (i: number) => string; onPut: (gap: number) => void }) {
  const s = useSummary(track.id)
  const run = useRun(track.id)
  const x = proxOf(track, s)
  const known = !!(x.harmony?.track || x.camelot)
  const head = (
    <header className="flex items-center gap-3 px-4 pb-2">
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-base font-semibold tracking-tight">{track.title}</span>
        <span className="block truncate text-xs text-base-content/60">{track.artist || 'Unknown artist'} · {track.libraryLabel}{x.bpm ? ` · ${Math.round(x.bpm)} bpm` : ''}{track.duration ? ` · ${formatDuration(track.duration)}` : ''}</span>
      </span>
    </header>
  )
  if (!known) {
    const online = track.library === 'online'
    const running = run?.state === 'run'
    return (
      <>
        {head}
        <div className="mx-3 rounded-xl bg-white/4 p-3 text-sm">
          <p className="font-medium">{running ? 'Analysing…' : 'Where would it fit? It needs its key first.'}</p>
          <p className="mt-1 text-xs text-base-content/60">
            {online
              ? 'Tempo, key and energy take about as long as downloading the track. It stays analysed, then ranks in Fits like your own files.'
              : 'This file has not been analysed yet; the library analysis gets to it on its own.'}
          </p>
          {online && (running
            ? <p className="mt-2 inline-flex items-center gap-2 text-xs text-primary"><span className="loading loading-spinner loading-xs" />{run.bpm ? `Tempo ${Math.round(run.bpm)} · key…` : `${Math.round(run.progress * 100)}%`}</p>
            : <button onClick={() => void analyseOnline(track.id)} className="btn btn-primary btn-sm mt-3">Analyse {track.title}</button>)}
        </div>
        {online && <p className="px-4 pt-3 text-xs text-base-content/55">You can drop it in now: its joins stay grey until the analysis lands.</p>}
      </>
    )
  }
  const spots = spotsFor(flat, x, titleOf, track.title)
  const copy = flat.findIndex((_, i) => titleOf(i).toLowerCase() === track.title.toLowerCase())
  return (
    <>
      {head}
      {copy >= 0 && <p className="px-4 pb-2 text-xs text-success">Already in this playlist as track {copy + 1}.</p>}
      <p className="px-4 pb-1 text-[11px] font-semibold tracking-wider text-base-content/45">BEST PLACES</p>
      <ol className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3">
        {spots.map((sp, n) => (
          <li key={sp.gap} className={`flex items-start gap-2.5 rounded-xl p-3 ${n ? 'bg-white/4' : 'bg-primary/10 ring-1 ring-primary/35'}`}>
            <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${n ? 'bg-primary/20 text-primary' : 'bg-primary text-primary-content'}`}>{n + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-snug">{where(sp.gap, flat.length, titleOf)}</span>
              <span className="mt-1.5 flex flex-col gap-0.5">
                {sp.in && <JoinText j={sp.in} label="In" />}
                {sp.out && <JoinText j={sp.out} label="Out" />}
              </span>
              {sp.fixes && <span className="mt-1 block text-xs text-success">Replaces a clash with two smooth joins.</span>}
            </span>
            <button onClick={() => onPut(sp.gap)} className="btn btn-sm btn-soft btn-primary h-11 shrink-0 sm:h-8">Put here</button>
          </li>
        ))}
        {!spots.length && <li className="px-1 py-6 text-center text-sm text-base-content/55">It is already in this playlist.</li>}
      </ol>
    </>
  )
}

/** The verdict on dropping the dragged track at its gap: the joins in and out, the clashes and the length after. */
export function DropPreview({ drag, flat, titleOf, x }: { drag: Drag; flat: SetTrack[]; titleOf: (i: number) => string; x: SetTrack }) {
  if (drag.gap === undefined) {
    return <p className="px-4 py-6 text-sm text-base-content/60">Move over the playlist to pick a place for <b>{drag.track.title}</b>. Release elsewhere to cancel.</p>
  }
  const from = drag.item ? flat.findIndex(t => t.id === drag.item) : -1
  const rest = from >= 0 ? flat.filter((_, i) => i !== from) : flat
  const g = from >= 0 && from < drag.gap ? drag.gap - 1 : drag.gap
  const after = [...rest.slice(0, g), x, ...rest.slice(g)]
  const a = after[g - 1]
  const b = after[g + 1]
  const ji = a && join(a, x)
  const jo = b && join(x, b)
  const clashes = (l: SetTrack[]) => l.slice(1).filter((t, i) => isClash(join(l[i], t))).length
  const len = (l: SetTrack[]) => l.reduce((s, t) => s + (t.duration || 0), 0)
  const known = !!(x.harmony?.track || x.camelot)
  const good = known && [ji, jo].every(j => !j || (j.safe && !j.tempoJump))
  const titles = flat.map((_, i) => titleOf(i)).filter((_, i) => i !== from)
  const titleAfter = (i: number) => (i < g ? titles[i] : titles[i - 1])
  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <div className="leading-tight">
        <p className="truncate text-base font-semibold tracking-tight">{drag.track.title} → place {g + 1}</p>
        <p className="truncate text-xs text-base-content/60">{a ? `after ${titleAfter(g - 1)}` : 'at the start'}{b ? ` · before ${titleAfter(g + 1)}` : ' · at the end'}</p>
      </div>
      <div className="rounded-xl bg-white/4 p-3">
        <p className={`text-sm font-semibold ${!known ? '' : good ? 'text-success' : 'text-warning'}`}>
          {!known ? 'Not analysed: its joins stay grey until you analyse it' : good ? 'Good drop: both joins stay smooth' : 'This drop makes a rough join'}
        </p>
        {known && <div className="mt-2 flex flex-col gap-0.5">{ji && <JoinText j={ji} label="In" />}{jo && <JoinText j={jo} label="Out" />}</div>}
        <dl className="mt-2 grid grid-cols-[5rem_1fr] gap-y-0.5 text-xs tabular-nums">
          <dt className="text-base-content/50">Clashes</dt><dd>{clashes(flat)} → {clashes(after)}</dd>
          <dt className="text-base-content/50">Length</dt><dd>{formatDuration(len(flat))} → {formatDuration(len(after))}</dd>
        </dl>
      </div>
    </div>
  )
}

/** What Fits follows, and the Pin that freezes it. */
export function FocusBar({ pinned, label }: { pinned: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-3 text-xs text-base-content/55">
      {pinned
        ? <svg className="size-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z" /></svg>
        : <i className="inline-block size-1.5 rounded-full bg-primary ring-3 ring-primary/20" aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <button onClick={togglePin} aria-pressed={pinned} className={`btn btn-xs h-7 gap-1 ${pinned ? 'btn-soft btn-primary' : 'btn-ghost bg-white/5'}`}>{pinned ? 'Pinned' : 'Pin'}</button>
    </div>
  )
}
