// The visual vocabulary for watcher kinds, in one place so the watcher list and
// the timeline cannot drift into two different colour schemes.
//
// Tones avoid `primary` (the app's own action colour, used by the Active toggles
// right next to these) and `warning`/`error`, which the same rows use for failure
// badges. Reusing either would make a healthy search watcher look like a problem.
//
// Colour is never the only signal: every use pairs the tone with an icon and a
// word, so the kinds stay distinguishable without relying on hue.

export type KindFamily = 'series' | 'film' | 'search' | 'criteria'

export interface KindMeta {
  family: KindFamily
  /** Full label for the watcher list. */
  label: string
  /** Short label for dense timeline rows. */
  short: string
  /** daisyUI badge tone. */
  badge: string
  /** Left-edge accent, for grouping a list at a glance. */
  edge: string
}

const SERIES: KindMeta = {
  family: 'series',
  label: 'Episodes & languages',
  short: 'Episode',
  badge: 'badge-info',
  edge: 'border-info',
}

const META: Record<string, KindMeta> = {
  title_lang: SERIES,
  // A language-filtered series watcher is the same thing to the eye: it reports
  // episodes of one title, just fewer of them.
  series_episodes: { ...SERIES, label: 'New episodes', short: 'Episode' },
  film_available: {
    family: 'film',
    label: 'Film availability',
    short: 'Film',
    badge: 'badge-secondary',
    edge: 'border-secondary',
  },
  saved_search: {
    family: 'search',
    label: 'Saved search',
    short: 'Search',
    badge: 'badge-accent',
    edge: 'border-accent',
  },
  tmdb_criteria: {
    family: 'criteria',
    label: 'Genre & rating',
    short: 'Criteria',
    badge: 'badge-success',
    edge: 'border-success',
  },
}

const UNKNOWN: KindMeta = {
  family: 'series',
  label: 'Watcher',
  short: 'Watcher',
  badge: 'badge-ghost',
  edge: 'border-base-300',
}

/** Styling for a kind. Falls back to neutral for a kind this build predates. */
export function kindMeta(kind: string): KindMeta {
  return META[kind] ?? UNKNOWN
}
