/** A segmented choice, one button per option. */
export default function Seg<T extends string | number>({ options, value, onPick, label }: { options: [T, string][]; value: T; onPick: (v: T) => void; label: string }) {
  return (
    <div className="join" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} onClick={() => onPick(v)} aria-pressed={v === value} className={`btn btn-xs join-item ${v === value ? 'btn-primary' : 'btn-ghost border-white/15'}`}>{text}</button>
      ))}
    </div>
  )
}
