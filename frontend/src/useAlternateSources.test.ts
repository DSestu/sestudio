import { describe, expect, it } from 'vitest'
import { listingKey, normalize } from './useAlternateSources'

describe('normalize', () => {
  // Real pairs captured from /api/search: the same film as spelled by fstream
  // and by senpai. Matching sources across sites depends on these agreeing.
  it.each([
    [
      'Harry Potter et les Reliques de la mort - 1ère partie', // nbsp
      'Harry Potter et les Reliques de la mort - 1ère partie',
    ],
    [
      "Harry Potter et l\\'Ordre du Phénix", // backslash-escaped apostrophe
      "Harry Potter et l'Ordre du Phénix",
    ],
    ['Harry Potter à l\\\'école des sorciers', "Harry Potter à l'école des sorciers"],
  ])('treats %s and %s as the same title', (a, b) => {
    expect(normalize(a)).toBe(normalize(b))
  })

  it('ignores accents and case', () => {
    expect(normalize('Le Prisonnier d’Azkaban')).toBe(normalize('LE PRISONNIER DAZKABAN'))
  })

  it('still separates genuinely different titles', () => {
    expect(normalize('Naruto')).not.toBe(normalize('Naruto Shippuden'))
    expect(normalize('Harry Potter et la Coupe de feu')).not.toBe(
      normalize('Harry Potter et la Chambre des secrets'),
    )
  })
})

describe('listingKey', () => {
  it('matches one page served from two mirror hosts', () => {
    expect(listingKey('french-manga', 'https://french-manga.net/1497644-x.html')).toBe(
      listingKey('french-manga', 'https://w16.french-manga.net/1497644-x.html'),
    )
  })

  it('keeps different pages and different sites apart', () => {
    const key = listingKey('french-manga', 'https://w16.french-manga.net/1-a.html')
    expect(listingKey('french-manga', 'https://w16.french-manga.net/2-b.html')).not.toBe(key)
    expect(listingKey('fstream', 'https://w16.french-manga.net/1-a.html')).not.toBe(key)
  })
})
