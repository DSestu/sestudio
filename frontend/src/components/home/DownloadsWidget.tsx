import type { CSSProperties } from 'react'
import type { DownloadRow } from '../../homeDownloads'
import Widget from './Widget'

const poster = (url: string) => url
  ? <img src={url} alt="" className="w-[26px] h-[39px] shrink-0 rounded-[3px] object-cover outline outline-1 -outline-offset-1 outline-base-content/10" />
  : <span className="w-[26px] h-[39px] shrink-0 rounded-[3px] bg-base-300" />

interface Props {
  rows: DownloadRow[]
  /** The queue's overall progress, 0–100: how far the frame has filled. */
  fill: number
  lone?: boolean
  style?: CSSProperties
  onOpen: () => void
}

/** Downloads (S): the frame fills from the bottom as the queue progresses,
 *  with a Signal Blue tide line (docs/SPEC-home-dashboard.md §6). */
export default function DownloadsWidget({ rows, fill, lone, style, onOpen }: Props) {
  return (
    <Widget
      style={{ ...style, '--fill': `${fill}%` } as CSSProperties}
      size="S"
      lone={lone}
      title="Downloads"
      count={rows.length}
      onOpen={onOpen}
      frame="f-dl"
    >
      <ul className="flex flex-col gap-2.5">
        {rows.slice(0, 2).map(r => (
          <li key={r.key} className="flex items-center gap-2 min-w-0">
            {poster(r.poster_url)}
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[13px] font-medium">{r.title}</p>
              <p className="truncate text-xs text-base-content/50">{r.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </Widget>
  )
}
