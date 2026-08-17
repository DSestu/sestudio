/** A labelled switch for a results toolbar, with an optional busy spinner.
 *
 * Shared by every listing that offers the same options — search and the
 * downloaded shelf both grade results with the same settings, so the control
 * has to look and behave the same in each.
 */
export default function ToolbarToggle({ label, title, checked, onChange, busy }: {
  label: string
  title: string
  checked: boolean
  onChange: (checked: boolean) => void
  busy?: boolean
}) {
  return (
    <label
      className="flex items-center gap-2 text-sm text-base-content/60 hover:text-base-content transition-colors cursor-pointer"
      title={title}
    >
      <input
        type="checkbox"
        className="toggle toggle-xs toggle-primary"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      {label}
      {busy && <span className="loading loading-spinner loading-xs" aria-label="Working" />}
    </label>
  )
}
