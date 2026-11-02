import type { CSSProperties } from 'react'
import type { DeviceCopy } from '../../deviceDownloads'
import { fmtSize } from '../../downloadedLibrary'
import Widget from './Widget'

interface Props {
  copies: DeviceCopy[]
  lone?: boolean
  style?: CSSProperties
  onOpen: () => void
}

/** On this device (S): what this browser has been handed. The only inset
 *  surface on Home: kept in your pocket, not on the server (spec §6). */
export default function DeviceWidget({ copies, lone, style, onOpen }: Props) {
  const bytes = copies.reduce((sum, c) => sum + c.size, 0)
  return (
    <Widget style={style} size="S" lone={lone} title="On this device" onOpen={onOpen} frame="f-dev">
      <p className="text-sm font-medium">
        {copies.length} {copies.length === 1 ? 'episode' : 'episodes'}
        {bytes > 0 && <span className="text-base-content/50"> · {fmtSize(bytes)}</span>}
      </p>
      <div className="mt-2 flex gap-2">
        {copies.filter(c => c.poster_url).slice(0, 3).map(c => (
          <img key={c.name} src={c.poster_url} alt="" className="w-9 h-[54px] rounded-[3px] object-cover outline outline-1 -outline-offset-1 outline-base-content/10" />
        ))}
      </div>
    </Widget>
  )
}
