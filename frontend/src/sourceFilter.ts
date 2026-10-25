import type { SeasonCard } from './api'

// Which sources a result comes from, for the search page's source chips. A
// card can stand for several listings: pages merged into it (`alts`) and the
// other seasons folded into it (`seasons`, each with alts of its own), so one
// title can count for several sources.

/** Every source a card stands for. */
export function cardSources(card: SeasonCard): Set<string> {
  const out = new Set<string>()
  const add = (c: SeasonCard) => {
    if (c.source) out.add(c.source)
    c.alts?.forEach(add)
  }
  add(card)
  card.seasons?.forEach(add)
  return out
}

/** How many of `cards` each source would show if it were the only one picked. */
export function countBySource(cards: SeasonCard[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const card of cards) {
    for (const id of cardSources(card)) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

/** The cards at least one picked source has; all of them when none is picked. */
export function filterBySources(cards: SeasonCard[], picked: ReadonlySet<string>): SeasonCard[] {
  if (!picked.size) return cards
  return cards.filter(card => [...cardSources(card)].some(id => picked.has(id)))
}

/** The `src` URL param (comma-separated ids) as a set, and back. */
export function parseSources(value: string | null): Set<string> {
  return new Set((value ?? '').split(',').filter(Boolean))
}

export function formatSources(picked: ReadonlySet<string>): string | undefined {
  return picked.size ? [...picked].sort().join(',') : undefined
}
