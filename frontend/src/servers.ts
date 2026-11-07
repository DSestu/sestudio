import { useEffect, useSyncExternalStore } from 'react'
import { checkServer, getServers, setActiveServer, type ServerRow } from './api'

/**
 * The server in use (docs/SPEC-remote-servers.md): null while this machine
 * serves its own library. Read by the "via" chip on every page and the card
 * shown when that server stops answering. Switching reloads the page: every
 * view's data comes from the other side from then on.
 */
export interface ActiveServer {
  id: string
  name: string
  /** The last check failed: the card with "Switch back" shows. */
  down: boolean
  /** Unix seconds it last answered, for "last seen". */
  lastSeen: number | null
}

let active: ActiveServer | null = null
const listeners = new Set<() => void>()

function set(next: ActiveServer | null) {
  active = next
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function fromRow(row: ServerRow): ActiveServer {
  return { id: row.id, name: row.name, down: row.reachable === false, lastSeen: row.last_seen }
}

/** Asks the server which one is in use; called once at start and after a switch. */
export async function refreshActiveServer(): Promise<void> {
  try {
    const list = await getServers()
    const row = list.servers.find(s => s.id === list.active)
    set(row ? fromRow(row) : null)
  } catch {
    // The local server itself is away (restarting): keep what we had.
  }
}

/** Probes the server in use now; the card's "Check again". */
export async function recheckActiveServer(): Promise<void> {
  if (!active) return
  try {
    set(fromRow(await checkServer(active.id)))
  } catch {
    set({ ...active, down: true })
  }
}

/** Switch to [id], or back to this machine with null, then start over on the new data. */
export async function switchServer(id: string | null): Promise<void> {
  await setActiveServer(id)
  window.location.reload()
}

export function useActiveServer(): ActiveServer | null {
  return useSyncExternalStore(subscribe, () => active)
}

/** The phrase for this side, in the Android app or not. */
export function thisMachine(): string {
  return window.SestudioApp ? 'This phone' : 'This machine'
}

const POLL_MS = 30_000

/** Keeps the store current: one load, then a check every 30 s while switched. */
export function useActiveServerWatch(): void {
  useEffect(() => {
    void refreshActiveServer()
    const timer = setInterval(() => { if (active) void recheckActiveServer() }, POLL_MS)
    return () => clearInterval(timer)
  }, [])
}
