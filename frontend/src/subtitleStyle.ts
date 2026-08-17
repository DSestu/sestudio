import { loadPlayerPrefs, savePlayerPrefs } from './playerPrefs'
import { getPiPWindow } from './pipSession'

/**
 * Subtitle appearance, applied through vidstack's `--media-user-*` caption
 * variables.
 *
 * vidstack's own Caption Styles menu writes these same variables, but only for
 * the session — so a carefully tuned setup is lost on reload. Persisting them
 * here (through `playerPrefs`, which already syncs server-side, #24) makes the
 * choice stick and follow you across devices.
 *
 * The variables are set on `:root` rather than the player element because CSS
 * custom properties inherit: one write covers the main player, the mini-player,
 * and any player mounted later, with no wiring between them.
 */

/** Font stacks for the caption families, keyed by the label shown to the user. */
export const FONT_FAMILIES: Record<string, string> = {
  // The default, and the most legible of the set: proportional spacing, large
  // x-height, open apertures. Everything else is a stylistic downgrade.
  'Sans-serif': "'Helvetica Neue', Helvetica, Arial, sans-serif",
  // Wider letterforms and unambiguous I/l/1 — better on small screens.
  'Sans-serif (wide)': "Verdana, Geneva, sans-serif",
  Serif: "Georgia, 'Times New Roman', serif",
  Monospace: "'Courier New', Courier, monospace",
}

export interface SubtitleStyle {
  /** A key of FONT_FAMILIES. */
  fontFamily: string
  /** Multiplier against the player's default cue size; 1 = default. */
  fontSize: number
  textColor: string
  /** 0–1, folded into the text colour. */
  textOpacity: number
  bgColor: string
  /** 0–1. Opaque-ish boxes beat shadows on busy animation. */
  bgOpacity: number
  /**
   * vidstack frosts the area behind each cue with `blur(8px)`, which stays
   * visible even at zero background opacity — the blur is a `backdrop-filter`,
   * independent of the background colour. Off by default: it smears the picture
   * behind every line, and the background box already does the readability work.
   */
  blur: boolean
  /** Outline shadow, as a fallback wherever the box still isn't enough. */
  shadow: boolean
  /**
   * Caption size inside the picture-in-picture window, replacing `fontSize`
   * there. Separate because the constraint is the surface, not the preference:
   * a size tuned for a full-width player is unreadable in a 640px window.
   */
  pipFontSize: number
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: 'Sans-serif',
  fontSize: 1.2,
  textColor: '#ffffff',
  textOpacity: 1,
  bgColor: '#000000',
  bgOpacity: 0.6,
  blur: false,
  shadow: true,
  pipFontSize: 2,
}

/**
 * Caption size inside the mini-player, overriding the user's own setting.
 *
 * The mini surface is a fraction of the watch view's width, so a size tuned for
 * full screen becomes unreadable there. Absolute rather than a multiple of the
 * user's choice: the constraint is the surface, not the preference.
 */
export const MINI_PLAYER_FONT_SIZE = 2

/** `#rrggbb` + alpha → `rgba(r, g, b, a)`. Falls back to opaque black. */
function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(0, 0, 0, ${alpha})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** A four-way outline; a single offset shadow leaves one edge unreadable. */
const OUTLINE =
  '-1px -1px 1px rgba(0,0,0,.9), 1px -1px 1px rgba(0,0,0,.9),' +
  ' -1px 1px 1px rgba(0,0,0,.9), 1px 1px 1px rgba(0,0,0,.9)'

export function loadSubtitleStyle(): SubtitleStyle {
  return { ...DEFAULT_SUBTITLE_STYLE, ...(loadPlayerPrefs().subtitleStyle ?? {}) }
}

/**
 * Write the style to a document's root element, so every player inside it picks
 * it up.
 *
 * *root* defaults to this page, but a PiP window is a separate document with its
 * own root — these are inline custom properties, not stylesheet rules, so
 * cloning the page's stylesheets does not carry them across.
 *
 * *sizeOverride* replaces `fontSize` when the surface dictates the size rather
 * than the preference (the PiP window).
 */
export function applySubtitleStyle(
  style: SubtitleStyle = loadSubtitleStyle(),
  root: HTMLElement = document.documentElement,
  sizeOverride?: number,
): void {
  const css = root.style
  css.setProperty(
    '--media-user-font-family',
    FONT_FAMILIES[style.fontFamily] ?? FONT_FAMILIES['Sans-serif'],
  )
  css.setProperty('--media-user-font-size', String(sizeOverride ?? style.fontSize))
  css.setProperty('--media-user-text-color', rgba(style.textColor, style.textOpacity))
  css.setProperty('--media-user-text-bg', rgba(style.bgColor, style.bgOpacity))
  // Not a `--media-user-*` variable: the blur is vidstack's own cue backdrop,
  // which no caption-style setting reaches.
  css.setProperty('--media-cue-backdrop', style.blur ? 'blur(8px)' : 'none')
  css.setProperty('--media-user-text-shadow', style.shadow ? OUTLINE : 'none')
}

/** Apply the style to an open PiP window, at its own caption size. */
export function applyPiPSubtitleStyle(
  win: Window,
  style: SubtitleStyle = loadSubtitleStyle(),
): void {
  applySubtitleStyle(style, win.document.documentElement, style.pipFontSize)
}

/** Persist a partial change and apply it immediately, everywhere it shows. */
export function saveSubtitleStyle(patch: Partial<SubtitleStyle>): SubtitleStyle {
  const next = { ...loadSubtitleStyle(), ...patch }
  savePlayerPrefs({ subtitleStyle: next })
  applySubtitleStyle(next)
  // Keep an open PiP window in step, so the sliders are live there too.
  const pip = getPiPWindow()
  if (pip) applyPiPSubtitleStyle(pip, next)
  return next
}
