import { beforeEach, describe, expect, it } from 'vitest'
import { hydrateLibraryLayout } from './libraryLayout'

const STORAGE_KEY = 'sestudio.libraryLayout.v1'

/** What the store persisted, which is also what it holds in memory. */
function stored(): Record<string, string> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
}

describe('layout preferences', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults search to the poster grid', () => {
    hydrateLibraryLayout(null)
    expect(stored().search).toBe('grid')
  })

  it('keeps a stored search layout', () => {
    hydrateLibraryLayout({ search: 'detail' })
    expect(stored().search).toBe('detail')
  })

  // The server may still hold a blob written before search had a layout choice.
  it('falls back to the default for a surface the stored blob predates', () => {
    hydrateLibraryLayout({ watching: 'detail', watchlist: 'grid', favourites: 'grid' })
    const prefs = stored()
    expect(prefs.search).toBe('grid')
    expect(prefs.watching).toBe('detail')
  })

  // Browse and search are separate surfaces, so one does not follow the other.
  it('keeps browse and search independent', () => {
    hydrateLibraryLayout({ search: 'detail', browse: 'grid' })
    expect(stored().search).toBe('detail')
    expect(stored().browse).toBe('grid')
  })

  it('ignores a nonsense value rather than storing it', () => {
    hydrateLibraryLayout({ search: 'sideways' })
    expect(stored().search).toBe('grid')
  })
})
