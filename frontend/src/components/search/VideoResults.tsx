import { useEffect, useState } from 'react'
import type { SeasonCard, VideoInfo } from '../../api'
import { searchVideos } from '../../api'
import EmptyState from '../EmptyState'
import VideoGrid from '../VideoGrid'

interface Fetched {
  query: string
  videos?: VideoInfo[]
  error?: string
}

/** Search's Videos kind: YouTube's own results, asked only when picked so the
 *  title search stays as fast as it was. */
export default function VideoResults({ query, onOpen }: { query: string; onOpen: (card: SeasonCard) => void }) {
  const [fetched, setFetched] = useState<Fetched | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    searchVideos(query).then(
      videos => { if (live) setFetched({ query, videos }) },
      (e: Error) => { if (live) setFetched({ query, error: e.message }) },
    )
    return () => { live = false }
  }, [query, attempt])

  const current = fetched?.query === query ? fetched : null
  if (!current) {
    return (
      <div aria-busy="true" aria-label="Searching YouTube" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="aspect-video rounded-box bg-base-300 animate-pulse motion-reduce:animate-none" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
    )
  }
  if (!current.videos) {
    return (
      <EmptyState
        title="YouTube didn't answer"
        message={current.error ?? 'Try again in a moment.'}
        action={{ label: 'Retry', onClick: () => { setFetched(null); setAttempt(a => a + 1) } }}
      />
    )
  }
  if (!current.videos.length) {
    return <EmptyState title={`No videos for “${query}”`} message="YouTube found nothing by that name." />
  }
  return <VideoGrid videos={current.videos} onOpen={onOpen} showChannel />
}
