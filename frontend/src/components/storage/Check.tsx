/** A checkbox that can also be half ticked: a season or folder with some of its files picked. */
export default function Check({ state, label, onChange }: {
  state: boolean | 'part'
  label: string
  /** Ticks everything when it was not fully ticked, clears it otherwise. */
  onChange: (on: boolean) => void
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="checkbox checkbox-primary checkbox-sm shrink-0"
      checked={state === true}
      ref={el => { if (el) el.indeterminate = state === 'part' }}
      onClick={e => e.stopPropagation()}
      onChange={() => onChange(state !== true)}
    />
  )
}
