import { useId, type ReactNode, type SelectHTMLAttributes } from 'react'

/**
 * The pieces every Settings category is built from (docs/SPEC-settings.md §2):
 * a group is a flat rounded panel of rows, an optional title above it and an
 * optional footnote below; a row puts its label (and one line of help) on the
 * left and its control on the right.
 */
export function SettingsGroup({ title, footnote, children }: {
  title?: string
  footnote?: ReactNode
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={title ? id : undefined} className="flex flex-col">
      {title && <h3 id={id} className="text-xs font-semibold text-base-content/50 px-1.5 pb-1.5">{title}</h3>}
      <div className="rounded-[14px] bg-base-200">{children}</div>
      {footnote && <div className="text-xs leading-relaxed text-base-content/50 px-2 pt-1.5">{footnote}</div>}
    </section>
  )
}

/** Rows share an inset hairline between them, as in a native list. */
const ROW = 'mx-3 min-h-14 py-2.5 border-base-300 not-first:border-t'

export function SettingRow({ label, help, htmlFor, children, stacked = false }: {
  label: ReactNode
  help?: ReactNode
  /** The id of the control, so a click on the label reaches it. */
  htmlFor?: string
  children?: ReactNode
  /** The control under the label instead of beside it (sliders, chips). */
  stacked?: boolean
}) {
  const text = (
    <div className="flex-1 min-w-0">
      {htmlFor ? <label htmlFor={htmlFor} className="block text-[15px] font-medium leading-snug">{label}</label>
        : <div className="text-[15px] font-medium leading-snug">{label}</div>}
      {help && <div className="text-xs text-base-content/50 mt-0.5 leading-snug">{help}</div>}
    </div>
  )
  return stacked ? (
    <div className={`${ROW} flex flex-col gap-2.5 justify-center`}>{text}{children}</div>
  ) : (
    <div className={`${ROW} flex items-center gap-3`}>{text}{children}</div>
  )
}

/** A switch row: the whole row is the label, so it is one large tap target. */
export function ToggleRow({ label, help, checked, onChange, danger = false, disabled = false, busy = false }: {
  label: ReactNode
  help?: ReactNode
  checked: boolean
  onChange: (on: boolean) => void
  /** Red, for a switch whose effect cannot be undone. */
  danger?: boolean
  disabled?: boolean
  busy?: boolean
}) {
  return (
    <label className={`${ROW} flex items-center gap-3 cursor-pointer`}>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-medium leading-snug">{label}</div>
        {help && <div className={`text-xs mt-0.5 leading-snug ${danger ? 'text-error/85' : 'text-base-content/50'}`}>{help}</div>}
      </div>
      {busy && <span className="loading loading-spinner loading-xs" />}
      <input
        type="checkbox"
        className={`toggle ${danger ? 'toggle-error' : 'toggle-primary'}`}
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
      />
    </label>
  )
}

/** A choice of two or three short values, all in sight: a radio group drawn as a segmented control. */
export function Choice<T extends string>({ label, value, options, onChange }: {
  /** Names the group for screen readers; the row shows the visible label. */
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-[10px] bg-base-100 p-0.75 gap-0.5">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
            o.value === value ? 'bg-primary/22 text-primary' : 'text-base-content/60 hover:text-base-content'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A native select inside a row: the current value and a chevron on the page's base. */
export function RowSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className="select select-sm w-auto max-w-[55%] shrink-0 bg-base-100 border-0 text-sm" />
}
