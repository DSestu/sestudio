import { describe, expect, it } from 'vitest'
import { indexAfterRemoval, withBlockAt } from './playlistEdit'

const ids = ['a', 'b', 'c', 'd', 'e']

describe('indexAfterRemoval', () => {
  it('counts a drop below the row without the row itself', () => {
    expect(indexAfterRemoval(ids, 'b', 4)).toBe(3) // b dropped before e: a c d b e
    expect(indexAfterRemoval(ids, 'd', 0)).toBe(0)
    expect(indexAfterRemoval(ids, 'a', 5)).toBe(4)
  })
})

describe('withBlockAt', () => {
  it('puts the block, in its order on the list, at the slot', () => {
    expect(withBlockAt(ids, ['d', 'b'], 3)).toEqual(['a', 'c', 'b', 'd', 'e'])
    expect(withBlockAt(ids, ['e'], 0)).toEqual(['e', 'a', 'b', 'c', 'd'])
    expect(withBlockAt(ids, ['a', 'b'], 5)).toEqual(['c', 'd', 'e', 'a', 'b'])
  })
})
