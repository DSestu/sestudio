import { describe, expect, it } from 'vitest'
import type { MusicTrack } from '../../../musicLibrary'
import { factsOf, levelOf, type Facts } from './facts'
import { DEFAULT_GROUPING, fileTreeOf, findNode, leavesOf, presetOf, sortTracks, tempoBand, treeOf, type Grouping } from './grouping'

const tr = (id: string, p: Partial<MusicTrack> = {}): MusicTrack => ({
  id, library: 'L1', libraryLabel: 'Deadmau5', title: id, artist: 'deadmau5', album: 'Vexillology', duration: 300, folder: 'Vexillology', ...p,
})
const T = [
  tr('Bot', { duration: 420 }),
  tr('Arguru', { duration: 200 }),
  tr('Strobe', { album: 'FLOAN', folder: 'FLOAN', duration: 630 }),
  tr('Ghosts', { album: 'RFTF', folder: 'RFTF' }),
  tr('Hope', { library: 'L2', libraryLabel: 'neuro soundcloud', artist: 'Emperor', album: '', folder: '', path: 'R:\\Musique\\neuro\\hope.mp3' }),
  tr('Deep', { library: 'L2', libraryLabel: 'neuro soundcloud', artist: 'Noisia', album: '', folder: 'sub/deeper', path: 'R:\\Musique\\neuro\\sub\\deeper\\a deep one.opus' }),
]
const BPM: Record<string, number> = { Bot: 128, Arguru: 126, Strobe: 128, Ghosts: 130, Hope: 174, Deep: 172 }
const MODE: Record<string, string> = { Bot: 'Dorian', Arguru: 'Lydian', Strobe: 'Aeolian', Ghosts: 'Dorian', Hope: 'Phrygian' }
const facts: Facts = id => factsOf(MODE[id] ? { bpm: BPM[id], harmony: { track: { tonic: 'F', mode: MODE[id], notes: [] } }, energyScale: { track: BPM[id] - 100 }, genre: BPM[id] > 150 ? 'Drum & bass' : 'Progressive house' } : { bpm: BPM[id] })
const g = (p: Partial<Grouping>): Grouping => ({ ...DEFAULT_GROUPING, ...p })

describe('grouping', () => {
  it('albums A–Z, tracks by title inside', () => {
    const t = treeOf(T, DEFAULT_GROUPING, facts)
    expect(t.map(n => n.name)).toEqual(['deeper', 'FLOAN', 'neuro soundcloud', 'RFTF', 'Vexillology'])
    expect(findNode(t, 'Vexillology')!.all.map(x => x.title)).toEqual(['Arguru', 'Bot'])
    expect(t.every(n => n.kids === null)).toBe(true)
  })
  it('artist › album stacks two levels, artists by count', () => {
    const t = treeOf(T, g({ dims: ['artist', 'album'] }), facts)
    expect(t.map(n => `${n.name}:${n.all.length}`)).toEqual(['deadmau5:4', 'Emperor:1', 'Noisia:1'])
    expect(t[0].kids!.map(n => n.key)).toEqual(['deadmau5|FLOAN', 'deadmau5|RFTF', 'deadmau5|Vexillology'])
    expect(findNode(t, 'deadmau5|RFTF')!.all[0].title).toBe('Ghosts')
    expect(leavesOf(t)).toHaveLength(5)
  })
  it('mood, tempo and energy keep their natural order, unread last', () => {
    expect(treeOf(T, g({ dims: ['mood'] }), facts).map(n => n.name)).toEqual(['Floating', 'Smooth', 'Dark', 'Menacing', 'Unread'])
    expect(treeOf(T, g({ dims: ['tempo'] }), facts).map(n => n.name)).toEqual(['126–130', '160–179'])
    expect(tempoBand(undefined)).toBe('No tempo')
    expect(tempoBand(131)).toBe('131–139')
    expect(levelOf(0)).toBe('Calm')
    expect(levelOf(100)).toBe('Intense')
    expect(treeOf(T, g({ dims: ['energy'] }), facts).map(n => n.name)).toEqual(['Steady', 'Driving', 'Unread'])
  })
  it('group and track sorts override the natural order', () => {
    expect(treeOf(T, g({ dims: ['mood'], groupSort: 'az' }), facts).map(n => n.name)).toEqual(['Dark', 'Floating', 'Menacing', 'Smooth', 'Unread'])
    expect(treeOf(T, g({ dims: ['mood'], groupSort: 'count' }), facts)[0].name).toBe('Smooth')
    expect(sortTracks(T, g({ trackSort: 'length' }), facts).map(t => t.title)).toEqual(['Arguru', 'Deep', 'Ghosts', 'Hope', 'Bot', 'Strobe'])
    expect(sortTracks(T, g({ trackSort: 'mood' }), facts).map(t => t.title).slice(0, 2)).toEqual(['Arguru', 'Bot'])
    expect(sortTracks(T, g({ dims: ['tempo'] }), facts).map(t => t.title)[0]).toBe('Arguru')
  })
  it('flat and presets', () => {
    const flat = treeOf(T, g({ dims: [] }), facts)
    expect(flat).toHaveLength(1)
    expect(flat[0].all.map(t => t.title)).toEqual(['Arguru', 'Bot', 'Deep', 'Ghosts', 'Hope', 'Strobe'])
    expect(presetOf(DEFAULT_GROUPING)).toBe('album')
    expect(presetOf(g({ dims: ['artist', 'album'] }))).toBe('artist')
    expect(presetOf(g({ dims: ['mood', 'artist'] }))).toBeUndefined()
    expect(presetOf(g({ files: true }))).toBe('files')
  })
  it('file explorer: libraries › folders › files, folders first, real file names', () => {
    const t = fileTreeOf(T)
    expect(t.map(n => n.name)).toEqual(['Deadmau5', 'neuro soundcloud'])
    expect(t[0].kids!.map(n => n.name)).toEqual(['FLOAN', 'RFTF', 'Vexillology'])
    expect(t[0].files).toEqual([])
    const neuro = t[1]
    expect(neuro.files!.map(f => f.title)).toEqual(['Hope'])
    expect(neuro.kids!.map(n => n.key)).toEqual(['L2|sub'])
    expect(neuro.kids![0].kids![0].key).toBe('L2|sub|deeper')
    expect(findNode(t, 'L2|sub|deeper')!.files![0].title).toBe('Deep')
    const leaves = leavesOf(t)
    expect(leaves.map(l => l.key)).toEqual(['L1|FLOAN', 'L1|RFTF', 'L1|Vexillology', 'L2', 'L2|sub|deeper'])
  })
})
