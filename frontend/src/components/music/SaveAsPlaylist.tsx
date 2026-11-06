import type { AddPayload } from '../../musicQueue'
import { saveAsPlaylist } from './saveList'

/** The list-saving button; on phones the label folds into the icon (its name stays for screen readers). */
export default function SaveAsPlaylist({ name, tracks, className = 'btn rounded-xl' }: {
  name: string
  tracks: AddPayload['tracks']
  className?: string
}) {
  return (
    <button onClick={() => void saveAsPlaylist(name, tracks)} disabled={!tracks.length} title="Save as playlist" className={`${className} gap-2`}>
      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true"><path d="M4 6h11M4 12h11M4 18h7M18 14v6M15 17h6" /></svg>
      <span className="max-sm:sr-only">Save as playlist</span>
    </button>
  )
}
