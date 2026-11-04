// The player's one toast: what an add or a remove did, with an Undo for 4 s.

export interface Note {
  id: number
  text: string
  undo?: () => void
}

let note: Note | null = null
let seq = 0
let timer = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

export function toast(text: string, undo?: () => void) {
  note = { id: ++seq, text, undo }
  window.clearTimeout(timer)
  timer = window.setTimeout(() => { note = null; emit() }, undo ? 4000 : 1800)
  emit()
}

export const dismiss = () => { window.clearTimeout(timer); note = null; emit() }
export const getNote = () => note
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
