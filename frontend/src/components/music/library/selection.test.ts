import { describe, expect, it } from 'vitest'
import { clearSelection, clickSelect, getSelection, idsIn, selectIds } from './selection'

const order = ['a', 'b', 'c', 'd', 'e']
const sel = () => [...idsIn(getSelection(), 'tape')].sort()

describe('selection', () => {
  it('click, Ctrl/⌘ toggle, Shift range from the anchor', () => {
    clickSelect('tape', 'b', order)
    expect(sel()).toEqual(['b'])
    clickSelect('tape', 'd', order, { toggle: true })
    expect(sel()).toEqual(['b', 'd'])
    clickSelect('tape', 'b', order, { toggle: true })
    expect(sel()).toEqual(['d'])
    clickSelect('tape', 'a', order, { shift: true })
    expect(sel()).toEqual(['a', 'b', 'd'])
    clickSelect('tape', 'c', order)
    clickSelect('tape', 'e', order, { shift: true })
    expect(sel()).toEqual(['c', 'd', 'e'])
  })
  it('one scope at a time; a box adds or replaces; Esc clears', () => {
    selectIds('tape', ['a', 'b'])
    clickSelect('set', 'x', ['x'])
    expect(sel()).toEqual([])
    selectIds('tape', ['c'])
    selectIds('tape', ['e'], true)
    expect(sel()).toEqual(['c', 'e'])
    clearSelection()
    expect(sel()).toEqual([])
  })
})
