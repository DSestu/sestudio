import { loadPlayerPrefs, savePlayerPrefs } from '../../playerPrefs'

/** The lighter heights a cast can be sent at; the server's `HLS_LADDER` below
 *  1080p, the most a TV is sent. A file smaller than the pick gets its own size. */
const HEIGHTS = [720, 480, 360, 240, 144]

/** Picks the quality a TV is sent at, and remembers it for the next cast. */
export default function CastQuality({ onChange, disabled }: {
  /** Told the height (0 for the best) after it is saved, e.g. to re-send
   *  what is playing. */
  onChange?: (quality: number) => void
  disabled?: boolean
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-base-content/60">Quality</span>
      <select
        className="select select-sm select-bordered"
        disabled={disabled}
        // Uncontrolled: the saved pref is the state, read fresh on each mount.
        defaultValue={loadPlayerPrefs().tvQuality ?? 0}
        onChange={e => {
          const height = Number(e.target.value)
          savePlayerPrefs({ tvQuality: height || undefined })
          onChange?.(height)
        }}
      >
        <option value={0}>Best</option>
        {HEIGHTS.map(h => <option key={h} value={h}>{h}p</option>)}
      </select>
    </label>
  )
}
