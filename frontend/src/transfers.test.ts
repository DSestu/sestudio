import { describe, expect, it } from 'vitest'
import type { DownloadedFile, DownloadedTitle } from './api'
import { buildFolders, folderAt } from './downloadedFolders'
import { commonDir, destFor, folderEntries, pickedEntries, titleEntries } from './transfers'

const file = (rel: string, storage = 'local'): DownloadedFile => ({
  path: storage === 'local' ? rel : `${storage}:${rel}`, rel, storage, number: 0, title: rel, lang: '', size: 10, mtime: 0,
})
const ep1 = file('Series/SG-1/Season 1/e1.mkv')
const ep2 = file('Series/SG-1/Season 2/e2.mkv')
const film = file('Films/Heat.mkv')
const title = { files: [ep1, ep2, film] } as DownloadedTitle

describe('transfers', () => {
  it('finds the folder files share', () => {
    expect(commonDir([ep1.rel!, ep2.rel!])).toBe('Series/SG-1')
    expect(commonDir([ep1.rel!])).toBe('Series/SG-1/Season 1')
    expect(commonDir([ep1.rel!, film.rel!])).toBe('')
  })

  it('keeps a title its own folder, seasons and all, in another folder', () => {
    const [a, b] = titleEntries([ep1, ep2])
    expect(destFor(a, 'TV')).toBe('TV/SG-1/Season 1/e1.mkv')
    expect(destFor(b, '')).toBe('SG-1/Season 2/e2.mkv')
  })

  it('sends a folder as itself, and with every storage shown, without the storage', () => {
    const root = buildFolders([title], '', id => id)
    const sg = folderAt(root, ['local', 'Series', 'SG-1'])!
    expect(folderEntries(sg, true).map(e => destFor(e, 'TV'))).toEqual(['TV/SG-1/Season 1/e1.mkv', 'TV/SG-1/Season 2/e2.mkv'])
  })

  it('turns ticks into whole folders where it can', () => {
    const root = buildFolders([title])
    const picked = new Set([ep1.path, ep2.path, film.path])
    const all = pickedEntries(root, picked, false, () => true)
    expect(all.names.sort()).toEqual(['Films', 'Series'])
    const one = pickedEntries(root, new Set([ep1.path]), false, () => true)
    expect(one.names).toEqual(['Season 1'])
    expect(destFor(one.entries[0], 'X')).toBe('X/Season 1/e1.mkv')
  })
})
