import { describe, expect, it } from 'vitest'
import { linkSource, videoDuration } from './videoLinks'

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
