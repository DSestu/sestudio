import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANALYSIS_RETRY_MS, applyEvent, loadAnalysis, EMPTY_QUEUE, parseAnalysis, positionNow, withStation, type QueueEvent, type QueueItem, type QueueState } from './musicQueue'

const item = (n: number): QueueItem => ({ item_id: `q${n}`, library: 'local', track_id: `t${n}` })
const base = (over: Partial<QueueState> = {}): QueueState => ({
  ...EMPTY_QUEUE, rev: 5, items: [item(1), item(2), item(3)], current: 1, position: 30, updated_at: 1000, playing: true, ...over,
})
const ev = (op: string, fields: Record<string, unknown>, rev = 6): QueueEvent => ({ rev, op, ...fields })
const ids = (s: QueueState) => s.items.map(i => i.item_id)

describe('positionNow', () => {
  it('extrapolates while playing, using the server clock offset', () => {
    // client clock 2 s behind the server: client 998 s is server 1000 s
    expect(positionNow(base(), 2, 998_000 + 10_000)).toBeCloseTo(40)
  })
  it('stands still when paused and clamps to the duration', () => {
    expect(positionNow(base({ playing: false }), 0, 9e9)).toBe(30)
    expect(positionNow(base(), 0, 1_000_000 + 500_000, 120)).toBe(120)
  })
  it('never runs backwards when the clocks disagree', () => {
    expect(positionNow(base(), 0, 900_000)).toBe(30)
  })
})

describe('applyEvent', () => {
  it('refuses an event that skips a revision', () => {
    expect(applyEvent(base(), ev('mv', { item_id: 'q1', from: 0, to: 2 }, 8), 0)).toBeNull()
  })
  it('ins before the playing row keeps the playing track current', () => {
    const s = applyEvent(base(), ev('ins', { index: 0, items: [item(9)] }), 0)!
    expect(ids(s)).toEqual(['q9', 'q1', 'q2', 'q3'])
    expect(s.current).toBe(2)
    expect(s.rev).toBe(6)
  })
  it('ins with play jumps to the new row from 0', () => {
    const s = applyEvent(base({ playing: false }), ev('ins', { index: 3, items: [item(9)], play: true }), 2000)!
    expect([s.current, s.playing, s.position, s.updated_at]).toEqual([3, true, 0, 2000])
  })
  it('ins into an empty queue makes the first row current', () => {
    const s = applyEvent(base({ items: [], current: -1 }), ev('ins', { index: 0, items: [item(1)] }), 0)!
    expect(s.current).toBe(0)
  })
  it('ord reorders the whole queue and follows the playing track', () => {
    const s = applyEvent(base(), ev('ord', { order: ['q3', 'q1', 'q2'] }), 0)!
    expect([ids(s), s.current]).toEqual([['q3', 'q1', 'q2'], base().current + 1])
    expect(applyEvent(base(), ev('ord', { order: ['q3', 'q9', 'q2'] }), 0)).toBeNull()
  })
  it('set replaces the queue and starts the first row', () => {
    const s = applyEvent(base(), ev('set', { items: [item(7), item(8)] }), 50)!
    expect([ids(s), s.current, s.playing, s.position]).toEqual([['q7', 'q8'], 0, true, 0])
  })
  it('rm of a row before the playing one shifts the index', () => {
    const s = applyEvent(base(), ev('rm', { item_id: 'q1', index: 0 }), 0)!
    expect([ids(s), s.current, s.position]).toEqual([['q2', 'q3'], 0, 30])
  })
  it('rm of the playing row slides the next one in and restarts', () => {
    const s = applyEvent(base(), ev('rm', { item_id: 'q2', index: 1 }), 77)!
    expect([ids(s), s.current, s.position, s.updated_at, s.playing]).toEqual([['q1', 'q3'], 1, 0, 77, true])
  })
  it('rm of the last row left stops the player', () => {
    const s = applyEvent(base({ items: [item(1)], current: 0 }), ev('rm', { item_id: 'q1', index: 0 }), 0)!
    expect([s.items.length, s.current, s.playing]).toEqual([0, -1, false])
  })
  it('mv follows the playing track', () => {
    const s = applyEvent(base(), ev('mv', { item_id: 'q3', from: 2, to: 0 }), 0)!
    expect(ids(s)).toEqual(['q3', 'q1', 'q2'])
    expect(s.current).toBe(2)
  })
  it('go from next/prev keeps its playing flag; from a row click starts playing', () => {
    const stopped = applyEvent(base(), ev('go', { item_id: 'q3', index: 2, playing: false }), 9)!
    expect([stopped.current, stopped.playing, stopped.position]).toEqual([2, false, 0])
    const clicked = applyEvent(base({ playing: false }), ev('go', { item_id: 'q1', index: 0 }), 9)!
    expect([clicked.current, clicked.playing]).toEqual([0, true])
  })
  it('transport sets playing, position, repeat and its own timestamp', () => {
    const s = applyEvent(base(), ev('transport', { action: 'pause', playing: false, position: 61.5, repeat: true, updated_at: 3000 }), 0)!
    expect([s.playing, s.position, s.repeat, s.updated_at]).toEqual([false, 61.5, true, 3000])
  })
  it('mix and mixd store the pair settings and the default mode', () => {
    const settings = { mode: 'fade', bars: 8, tempo: true, swap: true, nudge: 0 }
    const m = applyEvent(base(), ev('mix', { from: 'a', to: 'b', settings }), 0)!
    expect(m.mix['a>b']).toEqual(settings)
    expect(applyEvent(m, ev('mixd', { mode: 'fade' }, 7), 0)!.default_mix).toBe('fade')
  })
})

describe('parseAnalysis', () => {
  it('reads tempo, hue and the three band means from 8 envelopes', () => {
    const bands = [100, 100, 50, 50, 50, 0, 0, 0].map(v => [v, v])
    const a = parseAnalysis({ bpm: 174, beat0: 0.2, hue: 200, bands })
    expect(a).toMatchObject({ bpm: 174, beat0: 0.2, hue: 200, balance: [1, 0.5, 0] })
  })
  it('copes with a bare object', () => {
    expect(parseAnalysis({})).toEqual({ bpm: undefined, beat0: undefined, hue: undefined })
  })
})

describe('withStation', () => {
  it('shows the station clock instead of the queue clock, and leaves the queue alone', () => {
    const s = base()
    const v = withStation(s, { item_id: 'q3', position: 12, playing: true, at: 1234 })
    expect(v).toMatchObject({ current: 2, position: 12, updated_at: 1234, playing: true, rev: 5 })
    expect(s.current).toBe(1)
  })
  it('keeps the queue clock without a station, or for an item it does not hold', () => {
    const s = base()
    expect(withStation(s, null)).toBe(s)
    expect(withStation(s, { item_id: null, position: 0, playing: false, at: 0 })).toBe(s)
    expect(withStation(s, { item_id: 'gone', position: 1, playing: true, at: 1 })).toBe(s)
  })
  it('runs ahead by the lead while it plays, not while paused', () => {
    const s = base()
    expect(withStation(s, { item_id: 'q3', position: 12, playing: true, at: 1 }, 0.2).position).toBeCloseTo(12.2)
    expect(withStation(s, { item_id: 'q3', position: 12, playing: false, at: 1 }, 0.2).position).toBe(12)
  })
})

describe('set with a start', () => {
  it('makes that row current', () => {
    const s = applyEvent(base(), ev('set', { items: [item(7), item(8), item(9)], start: 2 }), 50)!
    expect(s.current).toBe(2)
  })
})

describe('loadAnalysis', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('asks again after a miss, but not before the retry delay, and keeps what it found', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ bpm: 174 }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await loadAnalysis('late')).toBe(false)
    expect(await loadAnalysis('late')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(ANALYSIS_RETRY_MS + 1)
    expect(await loadAnalysis('late')).toBe(true)
    expect(await loadAnalysis('late')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
