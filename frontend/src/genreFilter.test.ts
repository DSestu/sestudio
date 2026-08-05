import { describe, expect, it } from 'vitest'
import { matchesAllGenres } from './genreFilter'

const sel = (...names: string[]) => new Set(names)

describe('matchesAllGenres', () => {
  it('lets everything through when nothing is selected', () => {
    expect(matchesAllGenres(['Action'], sel())).toBe(true)
    expect(matchesAllGenres(undefined, sel())).toBe(true)
  })

  it('matches a title carrying the selected genre', () => {
    expect(matchesAllGenres(['Action', 'Comédie'], sel('Action'))).toBe(true)
  })

  it('narrows rather than widens: every selected genre must be present', () => {
    expect(matchesAllGenres(['Action', 'Comédie'], sel('Action', 'Comédie'))).toBe(true)
    // Has one of the two, so it is out — this is the AND the browse filter uses.
    expect(matchesAllGenres(['Action'], sel('Action', 'Comédie'))).toBe(false)
  })

  it('rejects a title with no genres once a genre is selected', () => {
    // No TMDB match, so nothing to test against — not a free pass.
    expect(matchesAllGenres(undefined, sel('Action'))).toBe(false)
    expect(matchesAllGenres([], sel('Action'))).toBe(false)
  })

  it('is exact about names rather than matching loosely', () => {
    expect(matchesAllGenres(['Action & Adventure'], sel('Action'))).toBe(false)
  })
})
