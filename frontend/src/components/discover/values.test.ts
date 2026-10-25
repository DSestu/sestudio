import { describe, expect, it } from 'vitest'
import type { FilterField } from '../../api'
import { pickCatalog } from '../../useCatalogs'
import { valueOf, withValue } from './values'

const sort: FilterField = {
  key: 'sort', label: 'Sort', type: 'select', options: [], default: 'trending',
  min: 0, max: 0, step: 1, reload: false, max_selected: 0, quick: false,
}

describe('catalogue filter values', () => {
  it('reads the default until a value is chosen', () => {
    expect(valueOf(sort, {})).toBe('trending')
    expect(valueOf(sort, { sort: 'new' })).toBe('new')
  })

  it('drops a value set back to its default, so the URL stays clean', () => {
    const chosen = withValue({}, sort, 'new')
    expect(chosen).toEqual({ sort: 'new' })
    expect(withValue(chosen, sort, 'trending')).toEqual({})
  })
})

describe('pickCatalog', () => {
  const catalogs = [
    { id: 'uniquestream', label: 'UniqueStream', description: '', url: '' },
    { id: 'tmdb', label: 'TMDB', description: '', url: '' },
  ]

  it('prefers the asked-for catalogue, else falls back to the first', () => {
    expect(pickCatalog(catalogs, 'tmdb')).toBe('tmdb')
    expect(pickCatalog(catalogs, 'gone')).toBe('uniquestream')
    expect(pickCatalog([], null)).toBe('')
  })
})
