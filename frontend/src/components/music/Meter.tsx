import { REEF } from './format'

/** Balance meter: the track's mean bass, mids and highs as three bars. */
export default function Meter({ balance }: { balance: [number, number, number] }) {
  return (
    <span className="flex items-end gap-0.5 h-4 shrink-0" title="Bass, mids, highs" aria-hidden="true">
      {balance.map((v, i) => (
        <i
          key={i}
          className="w-1 rounded-sm"
          style={{ height: Math.max(3, v * 30), background: REEF[i], boxShadow: `0 0 6px color-mix(in oklch, ${REEF[i]} 80%, transparent)` }}
        />
      ))}
    </span>
  )
}
