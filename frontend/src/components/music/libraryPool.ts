import { useMemo } from 'react'
import { useDownloadedLibrary } from '../../downloadedLibrary'
import { useLibraryTracks } from '../../musicLibraries'
import { albumsOf, type MusicTrack } from '../../musicLibrary'

/** Every library's tracks, as MusicView lists them: this PC's, then the other libraries'. */
export function useLibraryPool(): MusicTrack[] {
  const titles = useDownloadedLibrary()
  const others = useLibraryTracks()
  return useMemo(() => [...albumsOf(titles).flatMap(a => a.tracks), ...others], [titles, others])
}
