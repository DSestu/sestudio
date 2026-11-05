import { useEffect, useState } from 'react'
import { buildSet, fetchPresets, type Arc, type BuiltSet } from '../harmonyApi'

type Params = Parameters<typeof buildSet>[0]

/** The server's set for these parameters (null: none yet); it is built again whenever they change. */
export function useBuilt(params: Params | null): { built?: BuiltSet; error?: string; busy: boolean } {
  const [last, setLast] = useState<{ key: string; built?: BuiltSet; error?: string }>()
  const key = params ? JSON.stringify(params) : ''
  useEffect(() => {
    if (!key) return
    let live = true
    // Wait a beat so a drag asks for one set, not one per pixel.
    const t = window.setTimeout(() => buildSet(JSON.parse(key)).then(
      built => live && setLast({ key, built }),
      (e: Error) => live && setLast({ key, error: e.message }),
    ), 120)
    return () => { live = false; window.clearTimeout(t) }
  }, [key])
  const cur = last?.key === key ? last : undefined
  // The previous set stays up (dimmed by `busy`) while the next one is built.
  return { built: last?.built, error: cur?.error, busy: !!key && !cur }
}

let presets: Promise<Record<string, Arc>> | undefined

/** The ready-made arcs by name, fetched once. */
export function usePresets(): Record<string, Arc> {
  const [list, setList] = useState<Record<string, Arc>>({})
  useEffect(() => {
    presets ??= fetchPresets()
    presets.then(setList, () => { presets = undefined })
  }, [])
  return list
}
