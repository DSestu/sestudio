import { describe, expect, it } from 'vitest'
import type { MusicTrack } from './musicLibrary'
import { addToSet, clearSet, getSet, moveInSet, pinsOf, removeFromSet, setPinOnDrop, setSetMode, togglePin, undoRemove, unpinAll } from './musicSet'

const t = (id: string): MusicTrack => ({ id, library: 'L', libraryLabel: 'L', title: id, artist: 'a', album: '', duration: 200, folder: '' })
const ids = () => getSet().tracks.map(x => x.id)

describe('the set', () => {
  it('adds at the end without repeats, or at a slot pinned there', () => {
    clearSet()
    expect(addToSet([t('a'), t('b'), t('a')], 'x').ids).toEqual(['a', 'b'])
    expect(addToSet([t('b'), t('c')], 'y').skipped).toBe(1)
    expect(ids()).toEqual(['a', 'b', 'c'])
    const l = addToSet([t('d')], 'd', 1)
    expect(l.pinned).toBe(true)
    expect(ids()).toEqual(['a', 'd', 'b', 'c'])
    expect(pinsOf(getSet())).toEqual({ 1: 'd' })
    setPinOnDrop(false)
    addToSet([t('e')], 'e', 0)
    expect(getSet().pinned).toEqual(['d'])
    setPinOnDrop(true)
  })
  it('a drop in Best blend lands in the order on screen', () => {
    clearSet()
    addToSet([t('a'), t('b'), t('c')], 'x')
    addToSet([t('z')], 'z', 1, [t('c'), t('a'), t('b')])
    expect(ids()).toEqual(['c', 'z', 'a', 'b'])
  })
  it('removes with undo, moves into Your order, pins freeze Best blend', () => {
    clearSet()
    addToSet([t('a'), t('b'), t('c')], 'x')
    removeFromSet(['b'])
    expect(ids()).toEqual(['a', 'c'])
    expect(getSet().undo?.count).toBe(1)
    undoRemove()
    expect(ids()).toEqual(['a', 'b', 'c'])
    setSetMode('blend')
    togglePin('b', [t('c'), t('b'), t('a')])
    expect(ids()).toEqual(['c', 'b', 'a'])
    expect(pinsOf(getSet())).toEqual({ 1: 'b' })
    unpinAll()
    moveInSet('a', 0, [t('c'), t('b'), t('a')])
    expect(ids()).toEqual(['a', 'c', 'b'])
    expect(getSet().mode).toBe('mine')
  })
})
