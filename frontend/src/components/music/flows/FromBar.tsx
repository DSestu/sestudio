import { useEffect, useState } from 'react'
import {
  KIND_LABEL, addSource, enoughFor, fetchScope, flipRule, readBack, removeSource, useFlowSources, type Scope, type Source,
} from '../../../flowSources'
import AddSource from './AddSource'

// The From bar (SPEC-flows-tab §2): the sources everything on the tab plays from, each chip
// Only (solid edge) or Lean on it (dashed); one sentence reads them back with how much music that is.

export function SourceChip({ source, onFlip, onRemove }: { source: Source; onFlip?: () => void; onRemove?: () => void }) {
  const only = source.rule === 'only'
  return (
    <span className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-base-100 pl-2.5 pr-1 text-[13px] ${only ? 'outline-[1.5px] outline-primary/85' : 'outline-[1.5px] outline-dashed outline-base-content/40'}`}>
      <span className="text-[11px] text-base-content/50">{KIND_LABEL[source.kind]}</span>
      <span className="max-w-48 truncate">{source.label ?? source.value}</span>
      <button onClick={onFlip} disabled={!onFlip} title={onFlip ? 'Switch between Only and Lean on it' : undefined}
        className={`rounded-md px-1.5 py-0.5 text-[11px] ${only ? 'bg-primary/22 text-primary' : 'bg-base-300 text-base-content/80'} ${onFlip ? 'hover:brightness-125' : ''}`}>
        {only ? 'Only' : 'Lean on it'}
      </button>
      {onRemove && (
        <button onClick={onRemove} aria-label={`Remove ${source.label ?? source.value}`} className="grid size-5 place-items-center rounded text-base-content/50 hover:bg-white/8 hover:text-base-content">×</button>
      )}
    </span>
  )
}

export default function FromBar() {
  const sources = useFlowSources()
  const [adding, setAdding] = useState(false)
  const [scope, setScope] = useState<{ key: string; got: Scope } | null>(null)
  const key = JSON.stringify(sources)
  useEffect(() => {
    let live = true
    const t = window.setTimeout(() => { fetchScope(sources).then(got => { if (live) setScope({ key, got }) }, () => {}) }, 150)
    return () => { live = false; window.clearTimeout(t) }
  }, [sources, key])
  const got = scope?.key === key ? scope.got : null
  const leanNames = sources.filter(s => s.rule === 'lean').map(s => s.label ?? s.value).join(' or ')
  const counts = got && (
    got.count
      ? ` · ${got.count} tracks${leanNames && got.lean ? `, ${got.lean} of them ${leanNames}` : ''} · ${enoughFor(got.seconds)}`
      : ''
  )
  return (
    <section aria-label="From" className="flex flex-col gap-2 rounded-xl bg-base-200 p-3 sm:px-4 sm:py-3.5">
      <div className="relative flex items-center gap-2 max-sm:-mx-1 max-sm:-mr-3 max-sm:overflow-x-auto max-sm:px-1 max-sm:py-0.5 max-sm:pr-3 sm:flex-wrap">
        <h2 className="mr-1 shrink-0 text-sm font-semibold">From</h2>
        {sources.map(s => (
          <SourceChip key={`${s.kind}:${s.value}`} source={s} onFlip={() => flipRule(s)} onRemove={() => removeSource(s)} />
        ))}
        <span className="shrink-0">
          <button data-source-toggle onClick={() => setAdding(a => !a)} aria-expanded={adding}
            className="h-8 rounded-lg px-3 text-[13px] text-base-content/70 outline-1 outline-dashed outline-base-content/20 hover:bg-white/5 hover:text-base-content">
            + {sources.length ? <><span className="sm:hidden">Add</span><span className="max-sm:hidden">Add a source</span></> : 'Add a genre, library, artist or album'}
          </button>
          {adding && <AddSource onAdd={addSource} onClose={() => setAdding(false)} />}
        </span>
      </div>
      <p className={`text-[13px] ${got && !got.count ? 'text-warning' : 'text-base-content/60'}`}>
        {got && !got.count ? 'Nothing in your library is in all of these: remove one or switch it to Lean on it.' : `${readBack(sources)}${counts ?? ''}`}
      </p>
    </section>
  )
}
