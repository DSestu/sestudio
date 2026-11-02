import { useEffect, useState } from 'react'
import { getForYou, type ForYouGroup } from './api'

/** The group Home shows today: one per day in turn, so the "Because you
 *  watched" line changes daily (docs/SPEC-home-dashboard.md §8). */
export function groupOfDay(groups: ForYouGroup[], now: Date): ForYouGroup | null {
  if (!groups.length) return null
  const dayOfYear = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(now.getFullYear(), 0, 0)) / 86_400_000)
  return groups[dayOfYear % groups.length]
}

/** The For you group of the day; null while loading and when there is none. */
export function useForYou(): ForYouGroup | null {
  const [group, setGroup] = useState<ForYouGroup | null>(null)
  useEffect(() => {
    let cancelled = false
    getForYou().then(g => { if (!cancelled) setGroup(groupOfDay(g, new Date())) })
    return () => { cancelled = true }
  }, [])
  return group
}
