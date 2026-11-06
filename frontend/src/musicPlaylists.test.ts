import { describe, expect, it } from 'vitest'
import { buildTree, freshName, isSet, itemsOf, locate, statsOf, visibleRows, type PlaylistItem, type PlaylistNode } from './musicPlaylists'

const node = (id: string, kind: PlaylistNode['kind'], parent: string | null, extra: Partial<PlaylistNode> = {}): PlaylistNode =>
  ({ id, kind, parent, name: id, position: 0, ...extra })
const item = (id: string): PlaylistItem => ({ item_id: id, library: 'local', track_id: id })

const nodes = [
  node('f', 'folder', null),
  node('p', 'playlist', 'f'),
  node('g', 'folder', 'f'),
  node('q', 'playlist', 'g'),
  node('s', 'smart', null),
]

describe('tree', () => {
  it('nests nodes under their folders, keeping the order', () => {
    const roots = buildTree(nodes)
    expect(roots.map(r => r.id)).toEqual(['f', 's'])
    expect(roots[0].children.map(c => c.id)).toEqual(['p', 'g'])
    expect(roots[0].children[1].children[0].id).toBe('q')
  })
  it('hides the children of collapsed folders', () => {
    const roots = buildTree(nodes)
    expect(visibleRows(roots, new Set()).map(r => [r.node.id, r.depth])).toEqual([['f', 0], ['p', 1], ['g', 1], ['q', 2], ['s', 0]])
    expect(visibleRows(roots, new Set(['g'])).map(r => r.node.id)).toEqual(['f', 'p', 'g', 's'])
    expect(visibleRows(roots, new Set(['f'])).map(r => r.node.id)).toEqual(['f', 's'])
  })
})

describe('sets', () => {
  const set = node('x', 'playlist', null, {
    items: [],
    parts: [{ id: 's1', name: 'A', items: [item('a'), item('b')] }, { id: 's2', name: 'B', items: [item('c')] }],
  })
  it('is a playlist with parts, played part after part', () => {
    expect(isSet(set)).toBe(true)
    expect(isSet(node('y', 'playlist', null, { items: [item('a')], parts: [] }))).toBe(false)
    expect(itemsOf(set).map(i => i.item_id)).toEqual(['a', 'b', 'c'])
  })
  it('finds where an item sits', () => {
    expect(locate(set, 'c')).toEqual({ part: 's2', index: 0 })
    expect(locate(set, 'b')).toEqual({ part: 's1', index: 1 })
    expect(locate(set, 'zz')).toBeNull()
  })
  it('sums a part: count, duration, tempo range', () => {
    const facts = { a: { duration: 100, bpm: 120 }, b: { duration: 50, bpm: 128 }, c: { duration: 10 } }
    const s = statsOf(set.parts![0].items.concat(set.parts![1].items), i => facts[i.item_id as keyof typeof facts])
    expect(s).toEqual({ count: 3, duration: 160, bpmMin: 120, bpmMax: 128 })
    expect(statsOf([item('q')], () => undefined)).toEqual({ count: 1, duration: 0 })
  })
})

describe('freshName', () => {
  it('uses the plain name first, then counts up past the taken ones', () => {
    expect(freshName([])).toBe('New playlist')
    expect(freshName(['New playlist'])).toBe('New playlist 2')
    expect(freshName(['New playlist', 'New playlist 3'])).toBe('New playlist 2')
    expect(freshName(['New playlist', 'New playlist 2'])).toBe('New playlist 3')
  })
})
