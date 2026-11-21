import { describe, expect, it } from 'vitest'
import type { DownloadedTitle, StorageInfo } from './api'
import { ALL_STORAGES, effectiveChoice, onStorage, storageIcon, titleCounts } from './storageChoice'

const st = (id: string, extra: Partial<StorageInfo> = {}): StorageInfo => ({
  id, kind: 'folder', label: id, path: `/${id}`, roles: ['video'], download: false, state: 'online', ...extra,
})

const file = (storage: string, lang = 'vf', size = 10) => ({
  path: storage === 'local' ? 'a.mkv' : `${storage}:a.mkv`, rel: 'a.mkv', storage,
  number: 1, title: 'A', lang, size, mtime: size,
})

const title = (files: ReturnType<typeof file>[]): DownloadedTitle => ({
  key: 'A|S1', folder: 'A', series: 'A', season: 1, is_film: false, poster_url: '', page_url: '',
  source: '', langs: ['vf', 'vo'], storages: [...new Set(files.map(f => f.storage))], files,
  size: files.reduce((n, f) => n + f.size, 0), mtime: 99,
})

describe('effectiveChoice', () => {
  const list = [st('local'), st('nas', { download: true }), st('music', { roles: ['music'] })]
  it('starts on the download target', () => expect(effectiveChoice(list, null)).toBe('nas'))
  it('keeps a valid pick and all', () => {
    expect(effectiveChoice(list, 'local')).toBe('local')
    expect(effectiveChoice(list, ALL_STORAGES)).toBe(ALL_STORAGES)
  })
  it('drops a pick that is gone or holds no video', () => {
    expect(effectiveChoice(list, 'removed')).toBe('nas')
    expect(effectiveChoice(list, 'music')).toBe('nas')
  })
})

describe('onStorage', () => {
  const both = title([file('local', 'vf', 10), file('nas', 'vo', 30)])
  it('keeps only that storage’s files, with sums to match', () => {
    const [t] = onStorage([both], 'nas')
    expect(t.files.map(f => f.storage)).toEqual(['nas'])
    expect([t.size, t.mtime, t.langs, t.storages]).toEqual([30, 30, ['vo'], ['nas']])
  })
  it('drops titles with nothing there, and all keeps everything', () => {
    expect(onStorage([title([file('local')])], 'nas')).toEqual([])
    expect(onStorage([both], ALL_STORAGES)).toEqual([both])
  })
  it('counts titles per storage', () => {
    expect(Object.fromEntries(titleCounts([both, title([file('local')])]))).toEqual({ local: 2, nas: 1 })
  })
})

it('tells a share by its path', () => {
  expect(storageIcon({ id: 'local', path: 'R:\\x' })).toBe('pc')
  expect(storageIcon({ id: 'f1', path: '\\\\nas\\films' })).toBe('share')
  expect(storageIcon({ id: 'f2', path: 'M:\\' })).toBe('folder')
})

it('puts each storage at the top of the folders when every one is shown', async () => {
  const { buildFolders, folderAt } = await import('./downloadedFolders')
  const t = title([
    { ...file('local'), rel: 'Show/a.mkv', path: 'Show/a.mkv' },
    { ...file('nas'), rel: 'Show/a.mkv', path: 'nas:Show/a.mkv' },
  ])
  const flat = buildFolders([t])
  expect([...flat.folders.keys()]).toEqual(['Show'])
  expect(flat.folders.get('Show')!.files).toHaveLength(2)
  const rooted = buildFolders([t], '', id => (id === 'nas' ? 'NAS films' : 'This PC'))
  expect([...rooted.folders.values()].map(n => [n.storage, n.name, n.count])).toEqual([
    ['local', 'This PC', 1], ['nas', 'NAS films', 1],
  ])
  expect(folderAt(rooted, ['nas', 'Show'])!.files[0].file.path).toBe('nas:Show/a.mkv')
})

it('says when a storage went away, with the day once it is not today', async () => {
  const { sinceLabel } = await import('./storageChoice')
  const now = new Date(2026, 10, 21, 22, 0)
  expect(sinceLabel(null, now)).toBe('')
  expect(sinceLabel(new Date(2026, 10, 21, 21, 4).getTime() / 1000, now)).toMatch(/(21|09).04/)
  expect(sinceLabel(new Date(2026, 10, 12, 21, 4).getTime() / 1000, now)).toMatch(/12.*(21|09).04/)
})
