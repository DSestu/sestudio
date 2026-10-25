import { useEffect, useRef, useState } from 'react'

/** True while the page is being scrolled down past `offset`, false again as
 *  soon as it scrolls back up. A change is held for 300 ms: folding something
 *  shifts the layout, and that shift must not read as a scroll the other way. */
export function useScrolledDown(offset = 64): boolean {
  const [down, setDown] = useState(false)
  const downRef = useRef(false)
  useEffect(() => {
    let last = window.scrollY
    let lockUntil = 0
    // Browsers already fire scroll at most once per frame.
    const onScroll = () => {
      const y = window.scrollY
      const now = performance.now()
      const next = y > offset && (y > last + 4 ? true : y < last - 4 ? false : downRef.current)
      if (now >= lockUntil && next !== downRef.current) {
        downRef.current = next
        lockUntil = now + 300
        setDown(next)
      }
      last = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [offset])
  return down
}
