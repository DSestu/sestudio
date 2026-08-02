interface Props {
  langs: string[]
  active: string
  onSelect: (lang: string) => void
}

/** Language selection button group (VF / VOSTFR / VO). */
export default function LangSwitcher({ langs, active, onSelect }: Props) {
  return (
    <div className="flex gap-1">
      {langs.map(l => (
        <button
          key={l}
          onClick={e => { e.stopPropagation(); onSelect(l) }}
          className={`btn sm:btn-sm font-mono uppercase ${l === active ? 'btn-primary' : 'btn-ghost'}`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}
