import { beforeEach } from 'vitest'

// The store modules (collections, watchState, playerPrefs, playlistCollapsed)
// read localStorage at import time and degrade to empty when it throws. Under
// the node environment there is no localStorage at all, so tests that want to
// seed or assert cached state need a real one. This is the whole browser
// surface the pure logic touches, so a small in-memory Storage beats pulling in
// jsdom.

const data = new Map<string, string>()

const memoryStorage: Storage = {
  get length() {
    return data.size
  },
  clear: () => data.clear(),
  getItem: key => (data.has(key) ? data.get(key)! : null),
  key: index => [...data.keys()][index] ?? null,
  removeItem: key => {
    data.delete(key)
  },
  setItem: (key, value) => {
    data.set(key, String(value))
  },
}

Object.defineProperty(globalThis, 'localStorage', {
  value: memoryStorage,
  writable: true,
})

// Storage leaking between tests would make ordering matter, so wipe it up front.
beforeEach(() => {
  localStorage.clear()
})
