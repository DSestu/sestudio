import type { Layout } from '../../libraryLayout'

interface Props {
  layout: Layout
  onChange: (layout: Layout) => void
}

const OPTIONS: { id: Layout; label: string; path: string }[] = [
  // Grid: four squares. Detail: stacked rows.
  { id: 'grid', label: 'Grid', path: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'detail', label: 'Details', path: 'M4 6h4v4H4zM10 7h10M10 10h6M4 14h4v4H4zM10 15h10M10 18h6' },
]

/**
 * Grid-or-detail switch for the active library tab.
 *
 * Two `aria-pressed` toggles rather than a radiogroup: radios would owe the user
 * arrow-key navigation, and the tablist beside this already owns that contract —
 * a second one on the same header reads as inconsistent.
 */
export default function LayoutToggle({ layout, onChange }: Props) {
  return (
    <div className="join" role="group" aria-label="Layout">
      {OPTIONS.map(option => (
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
