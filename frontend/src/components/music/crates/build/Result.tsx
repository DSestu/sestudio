import type { ReactNode } from 'react'
import { formatDuration, type MusicTrack } from '../../../../musicLibrary'
import { joinText, type Slot } from './join'

/** The built tracks with the join between each pair, a stats line above and the actions below. */
export default function Result({ slots, byId, stats, children }: {
  slots: Slot[]
  byId: ReadonlyMap<string, MusicTrack>
  stats: { duration: number; clashes: number; tempoJumps: number }
  children?: ReactNode
}) {
  const bad = (n: number, what: string) => n > 0 && <span className="text-warning"> · {n} {what}{n > 1 && what === 'clash' ? 'es' : n > 1 ? 's' : ''}</span>
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <p className="text-xs tabular-nums text-base-content/60">
        {slots.length} tracks · {formatDuration(stats.duration)}
        {stats.clashes ? bad(stats.clashes, 'clash') : ' · no clash'}
        {bad(stats.tempoJumps, 'tempo jump')}
      </p>
      <ul className="min-h-0 flex-1 overflow-y-auto max-sm:max-h-none sm:max-h-80">
        {slots.map(({ id, join }) => {
          const t = byId.get(id)
          if (!t) return null
          return (
            <li key={id}>
              {join && (
                <p className={`pl-3 text-[11px] leading-5 ${join.kind === 'clash' || join.tempoJump && !join.genreChange ? 'text-warning' : 'text-base-content/50'}`}>↓ {joinText(join)}</p>
              )}
              <div className="flex h-10 items-center gap-3 rounded-lg px-3">
                <span className="min-w-0 flex-1 truncate text-sm">{t.title} <span className="text-base-content/50">{t.artist}</span></span>
                <span className="w-10 text-right text-xs tabular-nums text-base-content/60">{formatDuration(t.duration)}</span>
              </div>
            </li>
          )
        })}
      </ul>
      {children && <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>}
    </div>
  )
}
