import { describe, expect, it } from 'vitest'
import { isOwnQualityCut, withHeight } from './frameRates'

describe('withHeight', () => {
  const master = 'http://h:8080/api/stream/proxy?token=a%2Bb'

  it('cuts to the best variant for Best, never the whole master', () => {
    const url = withHeight(master, 0)
    expect(url).toBe('http://h:8080/api/stream/proxy?token=a%2Bb&best=1')
    expect(isOwnQualityCut(url)).toBe(true)
  })

  it('swaps one pick for another', () => {
    expect(withHeight(withHeight(master, 0), 720)).toBe('http://h:8080/api/stream/proxy?token=a%2Bb&height=720')
  })

  it('leaves the server ladders and the bare master out', () => {
    expect(isOwnQualityCut(master)).toBe(false)
    expect(isOwnQualityCut('http://h/api/stream/hls?token=x&live=1')).toBe(false)
  })
})
