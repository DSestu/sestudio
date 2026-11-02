import { describe, expect, it } from 'vitest'
import type { VideoInfo } from './api'
import { summarizeChannels } from './homeChannels'

const video = (channel: string, timestamp: number, is_live = false): VideoInfo => ({
  source: 'youtube', page_url: `${channel}/${timestamp}`, title: 't', channel,
  channel_url: channel, thumbnail: '', duration: 60, is_live, timestamp, view_count: 0,
})

describe('summarizeChannels', () => {
  const latest = [video('a', 300), video('live', 290, true), video('b', 200), video('a', 150), video('c', 100)]

  it('counts uploads since the last visit, faces of those channels only', () => {
    const s = summarizeChannels(latest, 180_000)
    expect(s.fresh).toBe(2)
    expect(s.faces).toEqual(['a', 'b'])
  })

  it('leaves live streams out', () => {
    expect(summarizeChannels(latest, 0).videos.map(v => v.channel)).toEqual(['a', 'b', 'a', 'c'])
  })

  it('with nothing new, faces the latest channels and badges nothing', () => {
    const s = summarizeChannels(latest, 400_000)
    expect(s.fresh).toBe(0)
    expect(s.faces).toEqual(['a', 'b', 'c'])
  })

  it('a first visit marks nothing new', () => {
    expect(summarizeChannels(latest, 0).fresh).toBe(0)
  })
})
