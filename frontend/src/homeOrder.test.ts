import { describe, expect, it } from 'vitest'
import { orderWidgets, pinTiers, type WidgetDescriptor, type WidgetId, type WidgetTier } from './homeOrder'

const ids = (widgets: WidgetDescriptor[]) => orderWidgets(widgets).map(w => w.id)

describe('orderWidgets', () => {
  it('puts Continue watching first, whatever else is fresh', () => {
    expect(ids([
      { id: 'live', size: 'M', tier: 'fresh' },
      { id: 'continue', size: 'L', tier: 'continue' },
    ])).toEqual(['continue', 'live'])
  })

  it('orders by tier: fresh, then browse, then status', () => {
    expect(ids([
      { id: 'health', size: 'M', tier: 'status' },
      { id: 'watchlist', size: 'M', tier: 'browse' },
      { id: 'new-episodes', size: 'M', tier: 'fresh' },
    ])).toEqual(['new-episodes', 'watchlist', 'health'])
  })

  it('follows catalogue order inside a tier', () => {
    expect(ids([
      { id: 'discover', size: 'M', tier: 'browse' },
      { id: 'favourites', size: 'M', tier: 'browse' },
      { id: 'watchlist', size: 'M', tier: 'browse' },
      { id: 'channels', size: 'M', tier: 'browse' },
    ])).toEqual(['channels', 'watchlist', 'favourites', 'discover'])
  })

  it('moves a widget with its tier, not its catalogue place', () => {
    expect(ids([
      { id: 'live', size: 'M', tier: 'fresh' },
      { id: 'channels', size: 'M', tier: 'fresh' },
      { id: 'upcoming', size: 'M', tier: 'browse' },
    ])).toEqual(['live', 'channels', 'upcoming'])
    expect(ids([
      { id: 'live', size: 'M', tier: 'fresh' },
      { id: 'channels', size: 'M', tier: 'browse' },
      { id: 'watchlist', size: 'M', tier: 'browse' },
    ])).toEqual(['live', 'channels', 'watchlist'])
  })

  it('drops absent widgets: only what is passed in is placed', () => {
    expect(orderWidgets([])).toEqual([])
    expect(ids([{ id: 'favourites', size: 'M', tier: 'browse' }])).toEqual(['favourites'])
  })

  it('pairs S widgets, pulling the partner up beside the first', () => {
    const placed = orderWidgets([
      { id: 'downloads', size: 'S', tier: 'status' },
      { id: 'watchlist', size: 'M', tier: 'browse' },
      { id: 'device', size: 'S', tier: 'status' },
      { id: 'new-episodes', size: 'S', tier: 'fresh' },
    ])
    expect(placed.map(w => [w.id, w.lone])).toEqual([
      ['new-episodes', false],
      ['downloads', false],
      ['watchlist', false],
      ['device', true],
    ])
  })

  it('marks a lone S, and never an M or L', () => {
    const placed = orderWidgets([
      { id: 'continue', size: 'L', tier: 'continue' },
      { id: 'device', size: 'S', tier: 'status' },
      { id: 'discover', size: 'M', tier: 'browse' },
    ])
    expect(placed.map(w => w.lone)).toEqual([false, false, true])
  })

  it('does not mutate its input', () => {
    const input: WidgetDescriptor[] = [
      { id: 'discover', size: 'M', tier: 'browse' },
      { id: 'continue', size: 'L', tier: 'continue' },
    ]
    orderWidgets(input)
    expect(input.map(w => w.id)).toEqual(['discover', 'continue'])
  })
})

describe('pinTiers', () => {
  it('keeps the tier a widget had when first seen', () => {
    const seen = new Map<WidgetId, WidgetTier>()
    pinTiers([{ id: 'channels', size: 'M', tier: 'browse' }], seen)
    const later = pinTiers([
      { id: 'channels', size: 'M', tier: 'fresh' },
      { id: 'live', size: 'M', tier: 'fresh' },
    ], seen)
    expect(later.map(w => w.tier)).toEqual(['browse', 'fresh'])
  })
})
