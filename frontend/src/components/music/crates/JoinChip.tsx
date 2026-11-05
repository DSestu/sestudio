import { joinColor, KINDS, type Join } from './proximity'

/** A join as a coloured dot and its name ("Same notes"). */
export default function JoinChip({ join, className = '' }: { join: Join; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <i className="size-2 shrink-0 rounded-full" style={{ background: joinColor(join) }} />
      <span className="truncate">{join.kind ? KINDS[join.kind] : 'Unknown key'}</span>
    </span>
  )
}
