import { describe, expect, it } from 'vitest'
import { minutesLeft, relativeTime } from './rowItems'

const DAY = 86_400_000
const NOW = 1_700_000_000_000

describe('relativeTime', () => {
  it('reads "today" for anything inside the last day', () => {
    expect(relativeTime(NOW, NOW)).toBe('today')
    expect(relativeTime(NOW - DAY / 2, NOW)).toBe('today')
  })

  it('names yesterday, then counts days inside the week', () => {
    expect(relativeTime(NOW - DAY, NOW)).toBe('yesterday')
    expect(relativeTime(NOW - 3 * DAY, NOW)).toBe('3 days ago')
  })

  it('switches to weeks, then months', () => {
    expect(relativeTime(NOW - 7 * DAY, NOW)).toBe('last week')
    expect(relativeTime(NOW - 21 * DAY, NOW)).toBe('3 weeks ago')
    expect(relativeTime(NOW - 90 * DAY, NOW)).toBe('3 months ago')
  })

  it('does not report a negative age for a clock skewed forward', () => {
    expect(relativeTime(NOW + DAY, NOW)).toBe('today')
  })
})

describe('minutesLeft', () => {
  it('rounds the remaining time to whole minutes', () => {
    expect(minutesLeft(600, 1320)).toBe('12 min left')
  })

  it('never goes negative when position overshoots duration', () => {
    expect(minutesLeft(1400, 1320)).toBe('0 min left')
  })
})
