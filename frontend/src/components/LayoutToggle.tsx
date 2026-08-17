import type { Layout } from '../libraryLayout'

interface Props {
  layout: Layout
  onChange: (layout: Layout) => void
  /** Which layouts this surface offers. Defaults to grid and detail; only the
   *  downloaded shelf has folders to show, so only it asks for `tree`. */
  only?: Layout[]
}

const OPTIONS: { id: Layout; label: string; path: string }[] = [
  // Grid: four squares. Detail: stacked rows. Tree: a branching outline.
  { id: 'grid', label: 'Grid', path: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'detail', label: 'Details', path: 'M4 6h4v4H4zM10 7h10M10 10h6M4 14h4v4H4zM10 15h10M10 18h6' },
  { id: 'tree', label: 'Tree', path: 'M4 4v14a2 2 0 002 2h3M4 9h5m-5 0V4m5 11h11M9 15v-6m0 6h11M20 9H9' },
  // Browse: a folder, opened.
  { id: 'folders', label: 'Browse', path: 'M4 7v10a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-6L9 5H6a2 2 0 00-2 2zM9 13h6' },
]

const DEFAULT_ONLY: Layout[] = ['grid', 'detail']

/**
 * Grid-or-detail switch for a list surface — the active library tab, or search.
 *
 * Two `aria-pressed` toggles rather than a radiogroup: radios would owe the user
 * arrow-key navigation, and the tablist beside this already owns that contract —
 * a second one on the same header reads as inconsistent.
 */
export default function LayoutToggle({ layout, onChange, only = DEFAULT_ONLY }: Props) {
  return (
    <div className="join" role="group" aria-label="Layout">
      {OPTIONS.filter(o => only.includes(o.id)).map(option => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          aria-pressed={layout === option.id}
          aria-label={`${option.label} layout`}
          title={`${option.label} layout`}
          className={`btn btn-sm join-item gap-1.5 ${
            layout === option.id ? 'btn-active' : 'btn-ghost'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d={option.path} />
          </svg>
          {/* Label appears once there's room; the icon carries it on a phone. */}
          <span className="hidden sm:inline">{option.label}</span>
        </button>
      ))}
    </div>
  )
}
