import type { SortKey, SortOption } from '../sortItems'

interface Props {
  options: SortOption[]
  value: SortKey
  onChange: (key: SortKey) => void
  /** Distinguishes the control when a page has more than one. */
  id?: string
}

/**
 * The sort picker shared by the library tabs, a person's filmography and
 * search results. Styled like the browse panel's sort so the two read as the
 * same control even though one queries TMDB and this one reorders in place.
 */
export default function SortSelect({ options, value, onChange, id }: Props) {
  return (
    <select
      id={id}
      className="select select-bordered select-sm"
      value={value}
      onChange={e => onChange(e.target.value as SortKey)}
      aria-label="Sort by"
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
