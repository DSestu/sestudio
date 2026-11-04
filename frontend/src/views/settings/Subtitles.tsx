import { useState } from 'react'
import type { SubtitleStyle } from '../../subtitleStyle'
import {
  DEFAULT_SUBTITLE_STYLE,
  FONT_FAMILIES,
  loadSubtitleStyle,
  saveSubtitleStyle,
} from '../../subtitleStyle'
import { RowSelect, SettingRow, SettingsGroup, ToggleRow } from './rows'

/** Percent label for a 0–1 opacity, e.g. 0.6 → "60%". */
function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** A slider row: the label, then the range with its value beside it. */
function Slider({ id, label, help, value, min, max, onChange }: {
  id: string
  label: string
  help?: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <SettingRow label={label} help={help} htmlFor={id} stacked>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          className="range range-primary range-xs flex-1"
          min={min}
          max={max}
          step={0.05}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
        />
        <span className="w-11 text-right text-sm tabular-nums text-base-content/70">{pct(value)}</span>
      </div>
    </SettingRow>
  )
}

/**
 * Settings › Subtitles: how they look.
 *
 * Self-contained rather than driven by `onUpdate`: these live in player
 * preferences (which already sync server-side), not in AppSettings, so the
 * section owns its own state and writes straight through.
 */
export default function Subtitles() {
  const [style, setStyle] = useState(loadSubtitleStyle)

  function update(patch: Partial<SubtitleStyle>) {
    setStyle(saveSubtitleStyle(patch))
  }

  return (
    <>
      {/* Live preview over a busy, colourful backdrop — a box that looks fine on
          flat grey can still be unreadable on animation, which is the real use
          case. Pinned, so it stays in view while the sliders below move. */}
      <div
        aria-hidden="true"
        className="sticky top-3 md:top-28 z-10 h-30 rounded-[14px] overflow-hidden flex items-end justify-center pb-3.5 bg-[radial-gradient(circle_at_72%_28%,rgb(255_196_120/.55),transparent_42%),radial-gradient(circle_at_18%_82%,rgb(80_160_255/.4),transparent_46%),linear-gradient(160deg,#5b3a1e,#1d3550_55%,#0d1b2a)]"
      >
        <span
          className="px-2 py-0.5 rounded leading-snug text-center"
          style={{
            fontFamily: FONT_FAMILIES[style.fontFamily],
            fontSize: `${style.fontSize * 1.125}rem`,
            color: `rgba(255,255,255,${style.textOpacity})`,
            backgroundColor: `rgba(0,0,0,${style.bgOpacity})`,
            backdropFilter: style.blur ? 'blur(8px)' : undefined,
            textShadow: style.shadow ? '0 0 2px rgba(0,0,0,.9)' : 'none',
          }}
        >
          Subtitles look like this
        </span>
      </div>

      <SettingsGroup
        footnote={
          <button className="text-primary font-medium" onClick={() => setStyle(saveSubtitleStyle(DEFAULT_SUBTITLE_STYLE))}>
            Reset to defaults
          </button>
        }
      >
        <SettingRow label="Font" htmlFor="set-sub-font" help="The wide one keeps I, l and 1 apart on small screens">
          <RowSelect id="set-sub-font" value={style.fontFamily} onChange={e => update({ fontFamily: e.target.value })}>
            {Object.keys(FONT_FAMILIES).map(name => <option key={name} value={name}>{name}</option>)}
          </RowSelect>
        </SettingRow>
        <Slider id="set-sub-size" label="Size" value={style.fontSize} min={0.5} max={2} onChange={fontSize => update({ fontSize })} />
        <Slider
          id="set-sub-pip-size"
          label="Size in picture-in-picture"
          help="Used while popped out; an open window follows it live"
          value={style.pipFontSize}
          min={0.5}
          max={3}
          onChange={pipFontSize => update({ pipFontSize })}
        />
        <Slider
          id="set-sub-bg"
          label="Background"
          help="Around 60% stays readable over animation"
          value={style.bgOpacity}
          min={0}
          max={1}
          onChange={bgOpacity => update({ bgOpacity })}
        />
        <ToggleRow
          label="Blur behind text"
          help="Frosts the picture behind each line, even at 0% background"
          checked={style.blur}
          onChange={blur => update({ blur })}
        />
        <ToggleRow
          label="Outline"
          help="A fallback where the background is too faint"
          checked={style.shadow}
          onChange={shadow => update({ shadow })}
        />
      </SettingsGroup>
    </>
  )
}
