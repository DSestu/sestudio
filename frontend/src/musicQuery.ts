import { useSyncExternalStore } from 'react'

// The Music page's search text, shared by the header card's field (desktop)
// and the page's own field (phones, which have no header card).

/** A pasted YouTube link: the Music page opens it rather than searching. */
export const LINK_RE = /^https?:\/\/(\S+\.)?(youtube\.com|youtu\.be)\//i

let query = ''
const listeners = new Set<() => void>()

export const setMusicQuery = (q: string) => {
  query = q
  listeners.forEach(l => l())
}

export const useMusicQuery = (): string =>
  useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => query)
