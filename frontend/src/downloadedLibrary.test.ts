import { describe, expect, it } from 'vitest'
import type { DownloadedFile, DownloadedTitle } from './api'
import { fileFor, langsFor } from './downloadedLibrary'

const file = (number: number, lang: string): DownloadedFile =>
  ({ path: `S01E0${number}.${lang}.mkv`, number, title: '', lang, size: 1, mtime: 0 })

const title = (files: DownloadedFile[]): DownloadedTitle => ({
  key: 'Britannia|S1', folder: 'Britannia', series: 'Britannia', season: 1, is_film: false,
  poster_url: '', page_url: '', source: '', langs: [], files, size: 1, mtime: 0,
})

describe('a file stored without a language', () => {
  const all = [title([file(1, 'other'), file(2, 'vostfr'), file(2, 'other')])]

  it('plays in whatever language a site calls it', () => {
    expect(fileFor(all, 'Britannia', 1, 1, 'vf')?.path).toBe('S01E01.other.mkv')
  })

  it('loses to a file stored in the language asked for', () => {
    expect(fileFor(all, 'Britannia', 1, 2, 'vostfr')?.path).toBe('S01E02.vostfr.mkv')
  })

  it('counts as the language on screen', () => {
    expect(langsFor(all[0], 1, 'vf')).toEqual(['other', 'vf'])
    expect(langsFor(all[0], 1)).toEqual(['other'])
  })
})
