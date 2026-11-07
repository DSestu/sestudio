import { PairSpans } from '../harmony/KeySpans'
import { joinColor, KINDS, type Join, type Reading } from './proximity'

/** A join as a coloured dot and its name ("Same notes"); with both keys, the dot is the small pair of runs. */
export default function JoinChip({ join, pair, className = '' }: { join: Join; pair?: { a?: Reading; b?: Reading }; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {pair?.a && pair.b ? <PairSpans a={pair.a} b={pair.b} /> : <i className="size-2 shrink-0 rounded-full" style={{ background: joinColor(join) }} />}
      <span className="truncate" style={join.semitones !== null ? { color: joinColor(join) } : undefined}>{join.semitones !== null ? `${join.kindLabel} · ${join.semitones > 0 ? 'Lift' : 'Drop'}` : join.kind ? KINDS[join.kind] : 'Unknown key'}</span>
    </span>
  )
}
