// How a source is drawn wherever it appears: a colour and two letters taken
// from its name, so it looks the same in the chips, the panel and on cards.

/** A hue from the name, so each source keeps its colour everywhere. */
export function sourceHue(name: string): number {
  let h = 7
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 360
}

/** Two letters, so FStream (FS) and French-Manga (FM) don't both read "F". */
export function sourceInitials(name: string): string {
  const words = name.split(/[\s\-_.]+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase()
}
