import { useEffect, useState } from 'react'
import { getServerLan, type ServerLan } from './api'
import { loadCast } from './cast'
import { refreshDlna } from './dlnaControl'

export function isLoopback(host: string): boolean {
  return host === 'localhost' || /^127\./.test(host) || host === '[::1]'
}

/** Missed answers, after a network change, before a page on the server's own
 *  machine moves to localhost. */
const MISSES_BEFORE_MOVING = 2

/**
 * Where phones and TVs reach the server, followed across network changes, so
 * casting keeps working without reloading the app:
 *
 * - back on a network (this device's or the server's), the cast library and
 *   the DLNA state are picked up again;
 * - on the server's own machine, a page opened on its old LAN address moves to
 *   localhost, which always reaches it.
 */
export function useServerLan(): [ServerLan | null, () => Promise<void>] {
  const [lan, setLan] = useState<ServerLan | null>(null)

  useEffect(() => {
    let last: ServerLan | null = null
    let misses = 0
    let networkChanged = false

    async function check() {
      const next = await getServerLan()
      if (next) {
        if (networkChanged || misses > 0) {
          void loadCast()
          void refreshDlna()
        }
        last = next
        misses = 0
        networkChanged = false
        setLan(next)
        return
      }
      misses += 1
      // Only after a network change: a server restarting from Settings also
      // stops answering for a while, and localhost would then show an error page.
      if (networkChanged && misses >= MISSES_BEFORE_MOVING && last?.here && !isLoopback(location.hostname)) {
        const port = last.lan?.http_port
        location.replace(`${port ? `http://localhost:${port}` : `${location.protocol}//localhost:${location.port}`}/${location.hash}`)
      }
    }

    function onNetwork() {
      networkChanged = true
      void check()
    }

    void check()
    const timer = window.setInterval(check, 10_000)
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection
    window.addEventListener('online', onNetwork)
    window.addEventListener('offline', onNetwork)
    connection?.addEventListener('change', onNetwork)
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', onNetwork)
      window.removeEventListener('offline', onNetwork)
      connection?.removeEventListener('change', onNetwork)
      window.removeEventListener('focus', check)
    }
  }, [])

  async function recheck() {
    const next = await getServerLan(true)
    if (next) setLan(next)
  }

  return [lan, recheck]
}
