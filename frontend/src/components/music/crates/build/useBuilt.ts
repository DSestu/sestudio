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
    buildSet(JSON.parse(key)).then(
      built => live && setLast({ key, built }),
      (e: Error) => live && setLast({ key, error: e.message }),
    )
    return () => { live = false }
  }, [key])
  const cur = last?.key === key ? last : undefined
  return { built: cur?.built, error: cur?.error, busy: !!key && !cur }
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
