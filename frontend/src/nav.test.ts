import { describe, expect, it } from 'vitest'
import { gateRoute, navTabs, type Route } from './nav'

const route = (view: Route['view']): Route => ({ view, params: new URLSearchParams(), visit: 1 })

describe('gateRoute', () => {
  it('lets the lab route through when the flag is on', () => {
    expect(gateRoute(route('lab/music'), true).view).toBe('lab/music')
  })
  it('sends the lab route home when the flag is off', () => {
    expect(gateRoute(route('lab/music'), false).view).toBe('home')
  })
  it('leaves other routes alone', () => {
    expect(gateRoute(route('settings'), false).view).toBe('settings')
  })
  it('sends the Music route home without the flag', () => {
    expect(gateRoute(route('music'), false).view).toBe('home')
    expect(gateRoute(route('music'), true).view).toBe('music')
  })
})

describe('navTabs', () => {
  it('keeps the five tabs, Activity included, with the lab flag off', () => {
    expect(navTabs(false)).toEqual(['home', 'search', 'library', 'media', 'notifications'])
  })
  it('puts Music in and Activity out with the lab flag on', () => {
    expect(navTabs(true)).toEqual(['home', 'media', 'search', 'music', 'library'])
  })
})
