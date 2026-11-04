import { useState } from 'react'
import type { SubtitleStyle } from '../../subtitleStyle'
import {
  DEFAULT_SUBTITLE_STYLE,
  FONT_FAMILIES,
  loadSubtitleStyle,
  saveSubtitleStyle,
} from '../../subtitleStyle'

/** Percent label for a 0–1 opacity, e.g. 0.6 → "60%". */
function pct(value: number): string {
  return `${Math.round(value * 100)}%`
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
    <section aria-labelledby="settings-subtitles" className="flex flex-col gap-4">
      <h3
        id="settings-subtitles"
        className="text-xs font-semibold uppercase tracking-wide text-base-content/50"
      >
        Subtitles
      </h3>

      {/* Live preview over a busy backdrop — a box that looks fine on flat grey
          can still be unreadable on animation, which is the real use case. */}
      <div className="rounded-lg p-4 flex items-end justify-center min-h-24 bg-[repeating-linear-gradient(45deg,#1f2937_0,#1f2937_10px,#4b5563_10px,#4b5563_20px)]">
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

      <div>
        <label htmlFor="set-sub-font" className="text-sm text-base-content/60 mb-1 block">
          Font
        </label>
        <select
          id="set-sub-font"
          className="select select-bordered w-full"
          value={style.fontFamily}
          onChange={e => update({ fontFamily: e.target.value })}
        >
          {Object.keys(FONT_FAMILIES).map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <p className="text-xs text-base-content/50 mt-1">
          Sans-serif reads best at a distance; the wide variant helps on small
          screens by keeping I, l and 1 distinct.
        </p>
      </div>

      <div>
        <label htmlFor="set-sub-size" className="text-sm text-base-content/60 mb-1 block">
          Size — {pct(style.fontSize)}
        </label>
        <input
          id="set-sub-size"
          type="range"
          className="range range-primary range-sm"
          min={0.5}
          max={2}
          step={0.05}
          value={style.fontSize}
          onChange={e => update({ fontSize: Number(e.target.value) })}
        />
      </div>

      <div>
        <label htmlFor="set-sub-pip-size" className="text-sm text-base-content/60 mb-1 block">
          Size in picture-in-picture — {pct(style.pipFontSize)}
        </label>
        <input
          id="set-sub-pip-size"
          type="range"
          className="range range-primary range-sm"
          min={0.5}
          max={3}
          step={0.05}
          value={style.pipFontSize}
          onChange={e => update({ pipFontSize: Number(e.target.value) })}
        />
        <p className="text-xs text-base-content/50 mt-1">
          Used instead of the size above while popped out, where the window is a
          fraction of the width. Adjusting this updates an open PiP window live.
        </p>
      </div>

      <div>
        <label htmlFor="set-sub-bg" className="text-sm text-base-content/60 mb-1 block">
          Background opacity — {pct(style.bgOpacity)}
        </label>
        <input
          id="set-sub-bg"
          type="range"
          className="range range-primary range-sm"
          min={0}
          max={1}
          step={0.05}
          value={style.bgOpacity}
          onChange={e => update({ bgOpacity: Number(e.target.value) })}
        />
        <p className="text-xs text-base-content/50 mt-1">
          The box behind the text. Around 60% stays readable over animation
          without blocking much of the picture.
        </p>
      </div>

      <div>
        <label className="flex items-center gap-3 cursor-pointer text-sm">
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm"
            checked={style.blur}
            onChange={e => update({ blur: e.target.checked })}
          />
          <span>Blur behind text</span>
        </label>
        <p className="text-xs text-base-content/50 mt-1">
          Frosts the picture behind each line. Independent of the background
          opacity above, so it stays visible even at 0% — turn it off here.
        </p>
      </div>

      <div>
        <label className="flex items-center gap-3 cursor-pointer text-sm">
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm"
            checked={style.shadow}
            onChange={e => update({ shadow: e.target.checked })}
          />
          <span>Outline</span>
        </label>
        <p className="text-xs text-base-content/50 mt-1">
          An outline on every side, as a fallback wherever the background box is
          too faint.
        </p>
      </div>

      <div>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => setStyle(saveSubtitleStyle(DEFAULT_SUBTITLE_STYLE))}
        >
          Reset to defaults
        </button>
      </div>
    </section>
  )
}
