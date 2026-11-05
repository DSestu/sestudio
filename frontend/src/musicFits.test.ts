import { expect, it } from 'vitest'
import { relaxations } from './musicFits'

it('offers one button per active filter', () => {
  const labels = relaxations({ harmony: 'same', mood: 'any', energy: 'lift', genre: 'same', tempo: 'near' }).map(r => r.label)
  expect(labels).toEqual(['Allow close notes', 'Any energy', 'Any genre', 'Any tempo'])
  expect(relaxations({ harmony: 'any', mood: 'any', energy: 'any', genre: 'any', tempo: 'any' })).toEqual([])
})
