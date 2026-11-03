export interface Crate {
  /** '' for "All". */
  id: string
  label: string
  count: number
}

/** The LIBRARIES list, a column on desktop and the body of the phone's sheet. */
export default function Crates({ crates, active, onPick }: {
  crates: Crate[]
  active: string
  onPick: (id: string) => void
}) {
  return (
    <nav aria-label="Libraries">
      <h3 className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-base-content/50">LIBRARIES</h3>
      <ul className="flex flex-col gap-0.5">
        {crates.map(c => (
          <li key={c.id}>
            <button
              onClick={() => onPick(c.id)}
              aria-current={c.id === active}
              className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 h-10 text-sm text-left transition-colors ${
                c.id === active ? 'bg-primary/20 font-semibold' : 'hover:bg-white/5 text-base-content/80'
              }`}
            >
              <span className="truncate">{c.label}</span>
              <span className="text-xs tabular-nums text-base-content/50">{c.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
