import type { MusicTrack } from '../../../musicLibrary'
import { dragGap, type Drag } from './focus'
import type { SourceTab } from './Sources'

// An empty playlist in the editor (.impeccable/mocks/playlist-edit/empty.html, picks B + P1):
// numbered slots to drag into on wide screens, the two sources as big buttons on phones.

const icon = (d: string, cls = 'size-5') => <svg className={`${cls} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
const FOLDER = 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'
const GLOBE = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18'
const NOTE = 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'
const CHEV = 'M9 6l6 6-6 6'
const FADE = ['', 'opacity-60', 'opacity-35', 'opacity-20']

function Way({ onClick, d, title, line }: { onClick: () => void; d: string; title: string; line: string }) {
  return (
    <button onClick={onClick} className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-white/5 px-4 text-left active:bg-white/10">
      <span className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary">{icon(d)}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="block truncate text-xs text-base-content/60">{line}</span>
      </span>
      <span className="text-base-content/35">{icon(CHEV)}</span>
    </button>
  )
}

export default function EmptyEdit({ wide, drag, byId, onDrop, onSource }: {
  wide: boolean
  drag?: Drag
  byId: ReadonlyMap<string, MusicTrack>
  /** Drop the dragged track as track 1. */
  onDrop: () => void
  /** Open a source's sheet (phones). */
  onSource: (tab: SourceTab) => void
}) {
  if (!wide) {
    const tracks = [...byId.values()].filter(t => t.library !== 'online')
    const libs = new Set(tracks.map(t => t.crate ?? t.library)).size
    return (
      <div className="flex flex-col gap-2.5 py-4">
        <div className="flex flex-col items-center gap-1 pb-3 text-center">
          <span className="text-primary">{icon(NOTE, 'size-7')}</span>
          <h3 className="mt-2 text-lg font-semibold tracking-tight">Add the first track</h3>
          <p className="text-sm text-base-content/60">Pick where it comes from.</p>
        </div>
        <Way onClick={() => onSource('lib')} d={FOLDER} title="Your libraries" line={`${tracks.length} tracks in ${libs} ${libs === 1 ? 'library' : 'libraries'}`} />
        <Way onClick={() => onSource('online')} d={GLOBE} title="Online" line="YouTube Music, SoundCloud, YouTube" />
        <p className="pt-3 text-center text-xs text-base-content/55">Fits opens once there's a track.</p>
      </div>
    )
  }

  const hot = drag?.gap === 0
  return (
    <ol
      aria-label="Empty playlist"
      className="flex min-h-[50vh] flex-col gap-2 pb-6"
      onDragOver={e => { e.preventDefault(); dragGap(0) }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) dragGap(undefined) }}
      onDrop={e => { e.preventDefault(); onDrop() }}
    >
      {FADE.map((fade, i) => {
        const first = i === 0
        return (
          <li
            key={i}
            className={`flex h-14 items-center gap-3 rounded-xl border-[1.5px] px-4 text-sm transition-colors ${fade} ${
              first && hot ? 'border-solid border-primary bg-primary/10' : first ? 'border-dashed border-primary/55' : 'border-dashed border-white/15'
            }`}
          >
            <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
              first && hot ? 'bg-primary text-primary-content' : first ? 'bg-primary/20 text-primary' : 'bg-white/6 text-base-content/60'
            }`}>{i + 1}</span>
            {first && (hot
              ? <span className="min-w-0 flex-1 truncate font-medium">{drag.track.title}</span>
              : <>
                  <span className="min-w-0 flex-1 truncate">Drag a track here</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-base-content/60">or <kbd className="kbd kbd-xs">+</kbd> on any row</span>
                </>)}
          </li>
        )
      })}
    </ol>
  )
}
