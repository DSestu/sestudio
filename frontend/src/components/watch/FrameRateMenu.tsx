import { Menu } from '@vidstack/react'
import { DefaultMenuButton, useDefaultLayoutContext } from '@vidstack/react/player/layouts/default'
import { fpsLabel, isDrawn } from '../../frameRates'
import AiBadge from '../AiBadge'

/**
 * "Frame rate" in the player's settings menu, built from vidstack's own menu
 * parts so it sits with Speed and Quality. Its stock radio group takes text
 * labels only, which leaves no room for the AI mark on drawn rates.
 */
export default function FrameRateMenu({ source, rates, value, onChange }: {
  /** The source's own frame rate. */
  source: number
  /** Rates on offer besides it; those above *source* are drawn by AI. */
  rates: number[]
  /** The rate playing, 0 for the source's own. */
  value: number
  onChange: (fps: number) => void
}) {
  const { icons: Icons } = useDefaultLayoutContext()
  if (!source || !rates.length) return null
  const hint = value ? fpsLabel(value) : 'Original'
  return (
    <Menu.Root className="vds-menu">
      <DefaultMenuButton label="Frame rate" hint={hint} Icon={Icons.Menu.Playback} />
      <Menu.Items className="vds-menu-items">
        <Menu.RadioGroup
          className="vds-radio-group"
          value={String(value)}
          onChange={next => onChange(Number(next))}
        >
          {[0, ...rates].map(fps => (
            <Menu.Radio className="vds-radio" value={String(fps)} key={fps}>
              <Icons.Menu.RadioCheck className="vds-icon" />
              <span className="vds-radio-label">
                {fps ? fpsLabel(fps) : `Original · ${fpsLabel(source)}`}
              </span>
              {isDrawn(fps, source) && <AiBadge />}
            </Menu.Radio>
          ))}
        </Menu.RadioGroup>
      </Menu.Items>
    </Menu.Root>
  )
}
