import { describe, expect, it } from 'vitest'
import { linkSource, uploadCadence, videoDuration } from './videoLinks'

describe('linkSource', () => {
  it('recognises YouTube and Twitch links', () => {
    expect(linkSource('https://www.youtube.com/watch?v=abc')).toBe('youtube')
    expect(linkSource(' https://youtu.be/abc ')).toBe('youtube')
    expect(linkSource('https://m.twitch.tv/videos/1')).toBe('twitch')
  })
  it('leaves titles and other sites to the search', () => {
    expect(linkSource('dune')).toBeNull()
    expect(linkSource('https://notyoutube.com/watch')).toBeNull()
  })
})

describe('videoDuration', () => {
  it('reads like a player clock', () => {
    expect(videoDuration(184)).toBe('3:04')
    expect(videoDuration(18728)).toBe('5:12:08')
  })
})

describe('uploadCadence', () => {
  const at = (days: number[]) => days.map(d => ({ timestamp: 1_700_000_000 - d * 86_400 }) as never)
  it('reads the typical gap between uploads', () => {
    expect(uploadCadence(at([0, 4, 8, 12]))).toBe('new video every ~4 days')
    expect(uploadCadence(at([0, 1, 2]), 'stream')).toBe('new stream every day')
  })
  it('says nothing with too few dates', () => {
    expect(uploadCadence(at([0, 4]))).toBe('')
  })
})
