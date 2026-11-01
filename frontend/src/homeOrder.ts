// How Home lays out its widgets (docs/SPEC-home-dashboard.md §4): Continue
// watching first, then the rest by urgency tier, and by catalogue order inside
// a tier. Pure, so the order is tested without rendering anything.

export type WidgetSize = 'S' | 'M' | 'L'
export type WidgetTier = 'continue' | 'fresh' | 'browse' | 'status'

/** Every widget Home knows, in catalogue order (spec §3). */
export const CATALOGUE = [
  'continue', 'new-episodes', 'live', 'channels', 'upcoming', 'downloads', 'device',
  'for-you', 'watchlist', 'favourites', 'discover', 'health',
] as const
export type WidgetId = (typeof CATALOGUE)[number]

/** A present widget; an absent one is simply not passed in. */
export interface WidgetDescriptor {
  id: WidgetId
  size: WidgetSize
  tier: WidgetTier
}

export interface PlacedWidget extends WidgetDescriptor {
  /** An S with no S to pair with: it stretches to a full row. */
  lone: boolean
}

const TIERS: WidgetTier[] = ['continue', 'fresh', 'browse', 'status']

export function orderWidgets(widgets: WidgetDescriptor[]): PlacedWidget[] {
  const sorted = [...widgets].sort((a, b) =>
    TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) ||
    CATALOGUE.indexOf(a.id) - CATALOGUE.indexOf(b.id))

  // An S pairs with the next S in order, even a less urgent one: the grid packs
  // densely, so pull the partner up beside it and keep the DOM in visual order.
  const placed: PlacedWidget[] = []
  while (sorted.length) {
    const w = sorted.shift()!
    if (w.size !== 'S') { placed.push({ ...w, lone: false }); continue }
    const i = sorted.findIndex(o => o.size === 'S')
    if (i < 0) { placed.push({ ...w, lone: true }); continue }
    placed.push({ ...w, lone: false }, { ...sorted.splice(i, 1)[0], lone: false })
  }
  return placed
}

/**
 * Pin each widget to the tier it had when first seen, so Home never reflows
 * while it is on screen (spec §2): a tier that depends on live data ("new since
 * the last visit") would otherwise move a widget under the user's thumb. Keep
 * `seen` for the life of the view; a remount starts afresh.
 */
export function pinTiers(widgets: WidgetDescriptor[], seen: Map<WidgetId, WidgetTier>): WidgetDescriptor[] {
  return widgets.map(w => {
    if (!seen.has(w.id)) seen.set(w.id, w.tier)
    return { ...w, tier: seen.get(w.id)! }
  })
}
