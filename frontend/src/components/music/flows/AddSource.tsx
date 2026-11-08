import { useEffect, useRef, useState } from 'react'
import {
  KIND_LABEL, KIND_ORDER, defaultRule, fetchOptions, type Rule, type Source, type SourceKind, type SourceOption,
} from '../../../flowSources'

// Add a source (SPEC-flows-tab §2): four tabs, a search, the list with counts, how strictly.
// A popover under its button on desktop, a sheet from the bottom on a phone.

let options: Promise<Record<SourceKind, SourceOption[]>> | null = null
const load = () => (options ??= fetchOptions().catch(e => { options = null; throw e }))

export default function AddSource({ onAdd, onClose, start = 'genre' }: {
  onAdd: (s: Source) => void; onClose: () => void; start?: SourceKind
}) {
  const [kind, setKind] = useState<SourceKind>(start)
  const [query, setQuery] = useState('')
  const [lists, setLists] = useState<Record<SourceKind, SourceOption[]> | null>(null)
  const [failed, setFailed] = useState(false)
  const [pick, setPick] = useState<SourceOption | null>(null)
  const [rule, setRule] = useState<Rule>(defaultRule(start))
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => { load().then(setLists, () => setFailed(true)) }, [])
  // Focus goes back to whatever opened this when it closes.
  const [back] = useState(() => document.activeElement as HTMLElement | null)
  useEffect(() => () => back?.focus?.(), [back])
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const down = (e: PointerEvent) => { const t = e.target as Element
      if (box.current && !box.current.contains(t) && !t.closest?.('[data-source-toggle]')) onClose() }
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', down)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', down) }
  }, [onClose])

  const tab = (k: SourceKind) => { setKind(k); setQuery(''); setPick(null); setRule(defaultRule(k)) }
  const q = query.trim().toLowerCase()
  const all = lists?.[kind] ?? []
  const shown = (q ? all.filter(o => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(q)) : all).slice(0, 60)
  const add = () => { if (pick) { onAdd({ kind, value: pick.value, label: pick.label, rule }); onClose() } }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 sm:hidden" aria-hidden="true" />
      <div
        ref={box} role="dialog" aria-label="Add a source"
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col gap-2.5 rounded-t-2xl bg-base-200 p-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl outline-1 outline-white/10 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:max-h-[min(34rem,70vh)] sm:w-96 sm:rounded-2xl sm:p-3"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-base-300 sm:hidden" aria-hidden="true" />
        <h2 className="text-base font-semibold sm:sr-only">Add a source</h2>
        <div role="tablist" aria-label="Kind" className="flex rounded-lg bg-base-100 p-0.5 outline-1 outline-white/8">
          {KIND_ORDER.map(k => (
            <button key={k} role="tab" aria-selected={kind === k} onClick={() => tab(k)}
              className={`flex-1 rounded-md py-1.5 text-xs ${kind === k ? 'bg-base-300 text-base-content' : 'text-base-content/60 hover:text-base-content'}`}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <input
          type="search" value={query} onChange={e => setQuery(e.target.value)} autoFocus
          placeholder={`Search ${all.length || ''} ${kind === 'library' ? 'libraries' : `${kind}s`}`.replace('  ', ' ')}
          aria-label={`Search ${kind}s`} className="input input-sm w-full"
        />
        <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto">
          {failed ? <li className="px-2 py-3 text-sm text-error">Could not load your library’s {kind}s.</li>
            : !lists ? <li className="px-2 py-3"><span className="loading loading-dots loading-sm text-base-content/40" /></li>
            : !shown.length ? <li className="px-2 py-3 text-sm text-base-content/55">No {kind} matches.</li>
            : shown.map(o => (
              <li key={o.value}>
                <button aria-pressed={pick?.value === o.value} onClick={() => setPick(o)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm sm:py-1.5 ${pick?.value === o.value ? 'bg-base-300' : 'hover:bg-white/5'}`}>
                  <span className="min-w-0 flex-1 truncate">{o.label}{o.sub && <span className="ml-1.5 text-xs text-base-content/45">{o.sub}</span>}</span>
                  <span className="text-xs tabular-nums text-base-content/45">{o.count}</span>
                </button>
              </li>
            ))}
        </ul>
        <div className="flex flex-col gap-2 border-t border-white/7 pt-2.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-base-content/55">How strictly</span>
            <div role="radiogroup" aria-label="How strictly" className="ml-auto flex rounded-lg bg-base-100 p-0.5 outline-1 outline-white/8 sm:ml-0">
              {(['only', 'lean'] as Rule[]).map(r => (
                <button key={r} role="radio" aria-checked={rule === r} onClick={() => setRule(r)}
                  className={`rounded-md px-2.5 py-1 ${rule === r ? 'bg-base-300 text-base-content' : 'text-base-content/60 hover:text-base-content'}`}>
                  {r === 'only' ? 'Only' : 'Lean on it'}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs leading-snug text-base-content/50">
            <b className="font-medium text-base-content/80">Only</b>: nothing from outside it.{' '}
            <b className="font-medium text-base-content/80">Lean on it</b>: picked first when it fits the shape, others fill in.
          </p>
          <button onClick={add} disabled={!pick} className="btn btn-primary btn-sm max-sm:h-11 sm:self-end">
            {pick ? `Add ${pick.label}` : `Pick ${kind === 'album' || kind === 'artist' ? 'an' : 'a'} ${kind}`}
          </button>
        </div>
      </div>
    </>
  )
}
