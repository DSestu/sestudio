import { describe, expect, it } from 'vitest'
import { gateRoute, type Route } from './nav'

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
})
