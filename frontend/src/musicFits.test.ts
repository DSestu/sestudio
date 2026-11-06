import { expect, it } from 'vitest'
import { filtersOf, plainKind, relaxations } from './musicFits'

it('offers one button per active filter', () => {
  const labels = relaxations({ harmony: 'same', mood: 'any', energy: 'lift', genre: 'same', tempo: 'near' }).map(r => r.label)
  expect(labels).toEqual(['Allow close notes', 'Any energy', 'Any genre', 'Any tempo'])
  expect(relaxations({ harmony: 'any', mood: 'any', energy: 'any', genre: 'any', tempo: 'any' })).toEqual([])
})

it('starts harmony from the settings rule and keeps the picks over it', () => {
  expect(filtersOf({}, 'same')).toEqual({ harmony: 'same', mood: 'any', energy: 'any', genre: 'any', tempo: 'near' })
  expect(filtersOf({ harmony: 'any', energy: 'lift' }, 'same')).toMatchObject({ harmony: 'any', energy: 'lift' })
  expect(filtersOf({}).harmony).toBe('close')
})

it('names joins in plain words', () => {
  expect(['same-key', 'pivot', 'modal-shift', 'next-door', 'clash', null].map(k => plainKind(k as never)))
    .toEqual(['smooth', 'smooth', 'next door', 'next door', 'clash', 'key not known'])
})
