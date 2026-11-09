import { describe, expect, it } from 'vitest'
import type { MusicTrack } from '../../../musicLibrary'
import { GAP, JOIN_W, MARGIN, MIN_W, ZOOM, fitTape, layoutTape, solveZoom, type TapeGroup } from './tapeLayout'

const tr = (id: string, duration: number): MusicTrack => ({ id, library: 'L', libraryLabel: 'L', title: id, artist: 'a', album: 'b', duration, folder: '' })
const G: TapeGroup[] = [
  { key: 'A', head: '', name: 'A', tracks: [tr('a1', 300), tr('a2', 60)] },
  { key: 'B', head: '', name: 'B', tracks: [tr('b1', 600)] },
]

describe('tape layout', () => {
  it('width by duration, never under the minimum, a gap between groups', () => {
    const l = layoutTape(G)
    expect(l.items.map(i => i.w)).toEqual([60, MIN_W, 120])
    expect(l.items[0].x).toBe(MARGIN)
    expect(l.items[1].x).toBe(MARGIN + 60)
    expect(l.items[2].x).toBe(MARGIN + 60 + MIN_W + GAP)
    expect(l.heads.map(h => h.x)).toEqual([MARGIN, MARGIN + 60 + MIN_W + GAP])
    expect(l.end).toBe(MARGIN + 60 + MIN_W + GAP + 120)
  })
  it('leaves room for join diamonds in one flat group', () => {
    const l = layoutTape([{ key: 'x', head: '', name: '', tracks: [tr('1', 300), tr('2', 300), tr('3', 300)] }], ZOOM, MIN_W, GAP, true)
    expect(l.items.map(i => i.x)).toEqual([MARGIN, MARGIN + 60 + JOIN_W, MARGIN + 120 + 2 * JOIN_W])
  })
  it('stretches to fill the viewport exactly, keeping proportions', () => {
    const l = fitTape(G, 1000)
    expect(l.end).toBeCloseTo(1000 - MARGIN, 0)
    expect(l.zoom).toBeGreaterThan(ZOOM)
    expect(l.items[2].w / l.items[0].w).toBeCloseTo(2, 3)
  })
  it('does not shrink a tape that already overflows', () => {
    expect(solveZoom(G, 100)).toBe(ZOOM)
    expect(fitTape([], 800).items).toEqual([])
  })
})
