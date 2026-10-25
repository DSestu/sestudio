import { useState } from 'react'
import type { CatalogValues, FilterField } from '../../api'
import ResponsiveModal from '../ResponsiveModal'
import { useModalBack } from '../../useModalBack'
import { valueOf } from './values'

function rangeOf(field: FilterField, value: string): [number, number] {
  const [lo, hi] = value.split(',').map(Number)
  return [Number.isFinite(lo) ? lo : field.min, Number.isFinite(hi) ? hi : field.max]
}

/** How a non-default value reads on a pill, e.g. "Fantasy" or "2000–2010". */
function summaries(field: FilterField, value: string): { label: string; without: string }[] {
  if (field.type === 'multi') {
    const picked = value.split(',').filter(Boolean)
    return picked.map(v => ({
      label: field.options.find(o => o.value === v)?.label ?? v,
      without: picked.filter(p => p !== v).join(','),
    }))
  }
  if (field.type === 'range') {
    const [lo, hi] = rangeOf(field, value)
    const text = lo > field.min && hi < field.max ? `${lo}–${hi}` : lo > field.min ? `≥ ${lo}` : `≤ ${hi}`
    return [{ label: `${field.label} ${text}`, without: field.default }]
  }
  return []
}

interface Props {
  fields: FilterField[]
  values: CatalogValues
  onChange: (field: FilterField, value: string) => void
  onClear: () => void
}

const chip = 'flex items-center gap-1.5 shrink-0 rounded-full border border-base-300 px-3 h-8 text-sm'

/**
 * The quick row under the search bar: the Filters button, every single-choice
 * field as a native select (the phone's own picker), and a removable pill per
 * active multi/range value. The rest of each field lives in the sheet.
 */
export default function CatalogFilters({ fields, values, onChange, onClear }: Props) {
  const [open, setOpen] = useState(false)
  const active = fields.filter(f => valueOf(f, values) !== f.default).length

  return (
    <>
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap" role="group" aria-label="Filters">
        <button
          onClick={() => setOpen(true)}
          className={`${chip} border-primary/50 bg-primary/15 text-primary font-semibold`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M6 12h12M10 18h4" />
          </svg>
          Filters
          {active > 0 && <span className="badge badge-primary badge-sm">{active}</span>}
        </button>
        {fields.filter(f => f.type === 'select').map(f => (
          <label key={f.key} className={`${chip} cursor-pointer`}>
            <span className="text-base-content/50">{f.label}</span>
            <select
              value={valueOf(f, values)}
              onChange={e => onChange(f, e.target.value)}
              aria-label={f.label}
              className="bg-transparent outline-none cursor-pointer max-w-36"
            >
              {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ))}
        {fields.filter(f => f.type !== 'select').flatMap(f => {
          const pills = summaries(f, valueOf(f, values))
          if (!pills.length || valueOf(f, values) === f.default) {
            return [
              <button key={f.key} onClick={() => setOpen(true)} className={`${chip} text-base-content/70`}>
                {f.label} <span aria-hidden="true">▾</span>
              </button>,
            ]
          }
          return pills.map(p => (
            <button
              key={`${f.key}-${p.label}`}
              onClick={() => onChange(f, p.without)}
              aria-label={`Remove ${p.label}`}
              className={`${chip} bg-base-300 border-transparent`}
            >
              {p.label} <span aria-hidden="true">✕</span>
            </button>
          ))
        })}
      </div>
      {open && (
        <FiltersSheet
          fields={fields}
          values={values}
          onChange={onChange}
          onClear={onClear}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function FiltersSheet({ fields, values, onChange, onClear, onClose }: Props & { onClose: () => void }) {
  useModalBack(true, onClose)
  return (
    <ResponsiveModal onClose={onClose} boxClassName="sm:max-w-xl flex flex-col gap-5">
      <h3 className="text-lg font-semibold">Filters</h3>
      {fields.map(f => (
        <fieldset key={f.key} className="flex flex-col gap-2">
          <legend className="text-xs font-semibold uppercase tracking-wide text-base-content/50 mb-2">
            {f.label}
          </legend>
          <FieldControl field={f} value={valueOf(f, values)} onChange={v => onChange(f, v)} />
        </fieldset>
      ))}
      <div className="grid grid-cols-3 gap-3 pt-1">
        <button onClick={onClear} className="btn btn-ghost border-base-300">Clear</button>
        <button onClick={onClose} className="btn btn-primary col-span-2">Done</button>
      </div>
    </ResponsiveModal>
  )
}

function FieldControl({ field, value, onChange }: { field: FilterField; value: string; onChange: (v: string) => void }) {
  const option = (active: boolean) =>
    `badge badge-lg cursor-pointer transition-colors ${active ? 'badge-primary' : 'badge-ghost hover:badge-outline'}`

  if (field.type === 'range') {
    const [lo, hi] = rangeOf(field, value)
    const input = (label: string, v: number, set: (n: number) => string) => (
      <label className="flex items-center gap-2 text-sm text-base-content/70">
        {label}
        <input
          type="number"
          min={field.min}
          max={field.max}
          step={field.step}
          value={v}
          onChange={e => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange(set(Math.max(field.min, Math.min(field.max, n))))
          }}
          className="input input-bordered input-sm w-24"
        />
      </label>
    )
    // Moving one bound past the other pushes it along, so the range stays valid.
    return (
      <div className="flex flex-wrap gap-4">
        {input('From', lo, n => `${n},${Math.max(n, hi)}`)}
        {input('To', hi, n => `${Math.min(lo, n)},${n}`)}
      </div>
    )
  }

  if (field.type === 'multi') {
    const picked = value.split(',').filter(Boolean)
    const full = field.max_selected > 0 && picked.length >= field.max_selected
    return (
      <div className="flex flex-wrap gap-1.5">
        {field.options.map(o => {
          const on = picked.includes(o.value)
          return (
            <button
              key={o.value}
              onClick={() => onChange(on ? picked.filter(p => p !== o.value).join(',') : [...picked, o.value].join(','))}
              aria-pressed={on}
              disabled={!on && full}
              className={`${option(on)} disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {o.label}
            </button>
          )
        })}
        {field.max_selected > 0 && (
          <p className="w-full text-xs text-base-content/40">Up to {field.max_selected} at once.</p>
        )}
      </div>
    )
  }

  // A short choice reads at a glance as chips; a long one (years) is a picker.
  if (field.options.length <= 6) {
    return (
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={field.label}>
        {field.options.map(o => (
          <button
            key={o.value}
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={option(o.value === value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    )
  }
  return (
    <select value={value} onChange={e => onChange(e.target.value)} aria-label={field.label} className="select select-bordered select-sm w-full sm:w-60">
      {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
