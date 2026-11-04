import { pullBackFromTv, setTvVolume, stepVolume, toggleTvMute, useMusicCasting } from '../../musicCast'
import { setVolume, useVolume } from './engine'

const Speaker = ({ muted }: { muted: boolean }) => (
  <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 5L6 9H3v6h3l5 4z" />
    {muted ? <path d="M16 9l5 6m0-6l-5 6" /> : <path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" />}
  </svg>
)

/** This device's own volume, when nothing is cast; same steps as the TV's. */
function DeviceVolume() {
  const v = useVolume()
  const shown = v.muted ? 0 : v.level
  const step = (d: 1 | -1) => setVolume({ level: stepVolume(shown, d), muted: false })
  return (
    <div
      // No room on a phone on its side; its own volume buttons do this.
      className="flex short:hidden items-center gap-2.5 rounded-2xl glass px-3 h-11 text-xs"
      onWheel={e => { e.stopPropagation(); step(e.deltaY < 0 ? 1 : -1) }}
    >
      <button aria-label={v.muted ? 'Unmute' : 'Mute'} className="size-8 shrink-0 rounded-lg grid place-items-center hover:bg-white/8" onClick={() => setVolume({ muted: !v.muted })}>
        <Speaker muted={shown === 0} />
      </button>
      <input
        type="range" min={0} max={100} step={1} value={shown}
        aria-label="Volume" className="range range-primary range-xs flex-1 min-w-0"
        onChange={e => setVolume({ level: Number(e.target.value), muted: false })}
      />
      <span className="w-7 text-right tabular-nums text-base-content/60 shrink-0">{shown}</span>
    </div>
  )
}

/** "Playing on ‹TV›": mute and the TV's own volume (not the stream's gain); wheel and ↑/↓ step 5 (SPEC-music-player §9.5). */
export default function CastStrip() {
  const c = useMusicCasting()
  if (!c) return <DeviceVolume />
  const shown = c.muted ? 0 : c.volume
  const step = (d: 1 | -1) => setTvVolume(c, stepVolume(shown, d))
  return (
    <div
      tabIndex={0}
      aria-label={`Playing on ${c.device}`}
      className="flex items-center gap-2.5 rounded-2xl glass px-3 h-11 text-xs outline-none focus-visible:ring-2 ring-primary/60"
      onWheel={e => { e.stopPropagation(); step(e.deltaY < 0 ? 1 : -1) }}
      onKeyDown={e => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        step(e.key === 'ArrowUp' ? 1 : -1)
      }}
    >
      <span className="min-w-0 truncate text-base-content/70">Playing on <b className="font-medium text-base-content">{c.device}</b></span>
      <button aria-label={c.muted ? 'Unmute the TV' : 'Mute the TV'} className="size-8 shrink-0 rounded-lg grid place-items-center hover:bg-white/8 ml-auto" onClick={() => toggleTvMute(c)}>
        <Speaker muted={c.muted} />
      </button>
      <input
        type="range" min={0} max={100} step={1} value={shown}
        aria-label="TV volume" className="range range-primary range-xs w-28 shrink-0"
        onChange={e => setTvVolume(c, Number(e.target.value))}
      />
      <span className="w-7 text-right tabular-nums text-base-content/60 shrink-0">{shown}</span>
      <button className="h-8 shrink-0 rounded-lg px-2.5 bg-white/8 hover:bg-white/14" onClick={() => void pullBackFromTv(c)}>Pull back</button>
    </div>
  )
}
