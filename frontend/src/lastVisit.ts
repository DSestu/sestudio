import { useEffect, useState } from 'react'

// When Home was last on screen, per device (docs/SPEC-home-dashboard.md §4):
// the line between "new since your last visit" and the rest. Deliberately not
// synced to the server: each device has its own last look.

const STORAGE_KEY = 'sestudio.home.lastVisit'

function read(): number {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || 0
  } catch {
    return 0
  }
}

function stamp() {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()))
  } catch {
    // ignore
  }
}

/** The previous visit's time (ms, 0 on the first), read once at mount so what
 *  counts as new stays the same for the whole visit. Restamps the marker when
 *  Home shows and again when it leaves. */
export function useLastVisit(): number {
  const [since] = useState(read)
  useEffect(() => {
    stamp()
    return stamp
  }, [])
  return since
}
