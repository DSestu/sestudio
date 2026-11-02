import { describe, expect, it } from 'vitest'
import type { ForYouGroup } from './api'
import { groupOfDay } from './forYou'

const group = (title: string) => ({ because: { title, tmdb_id: 1, kind: 'tv' }, items: [] } as ForYouGroup)
const groups = [group('A'), group('B'), group('C')]

describe('groupOfDay', () => {
  it('is null without groups', () => {
    expect(groupOfDay([], new Date(2026, 0, 1))).toBeNull()
  })

  it('moves to the next group each day and wraps', () => {
    // 1 January is day 1.
    expect(groupOfDay(groups, new Date(2026, 0, 1))?.because.title).toBe('B')
    expect(groupOfDay(groups, new Date(2026, 0, 2))?.because.title).toBe('C')
    expect(groupOfDay(groups, new Date(2026, 0, 3))?.because.title).toBe('A')
  })

  it('holds all day long', () => {
    expect(groupOfDay(groups, new Date(2026, 4, 7, 0, 1))).toBe(groupOfDay(groups, new Date(2026, 4, 7, 23, 59)))
  })
})
