/** How many frames a drawing may be held and still be drawn across as one by
 *  AI: anime draws on twos and threes. The server's `ai_max_hold`, shown in
 *  the settings and under the player's frame rate. */
export default function AiHeldFrames({ id, value, onChange }: {
  id: string
  value: number
  onChange: (hold: number) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm text-base-content/60 mb-1 block">
        Anime: smooth held drawings
      </label>
      <select
        id={id}
        className="select select-bordered select-sm w-full max-w-xs"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      >
        <option value={0}>Off</option>
        <option value={2}>Held up to 2 frames (on twos)</option>
        <option value={3}>Held up to 3 frames (on threes)</option>
        <option value={4}>Held up to 4 frames</option>
      </select>
      <p className="text-xs text-base-content/50 mt-1">
        Anime shows each drawing for several frames. With this on, AI frames
        move smoothly from one drawing to the next instead of repeating it.
        A drawing held longer is a pause, and stays still. No effect on live action.
      </p>
    </div>
  )
}
