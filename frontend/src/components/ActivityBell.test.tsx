import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { setBell } from '../pageHeader'
import { ActivityBell } from './PageHeader'

describe('ActivityBell', () => {
  it('renders nothing with the lab flag off', () => {
    setBell(false, 3)
    expect(renderToStaticMarkup(<ActivityBell />)).toBe('')
  })
  it('shows the unread count and links to Activity with the flag on', () => {
    setBell(true, 3)
    const html = renderToStaticMarkup(<ActivityBell />)
    expect(html).toContain('href="#/notifications"')
    expect(html).toContain('Activity, 3 unread')
    expect(html).toContain('>3<')
  })
  it('shows no badge at zero', () => {
    setBell(true, 0)
    expect(renderToStaticMarkup(<ActivityBell />)).not.toContain('badge')
  })
})
