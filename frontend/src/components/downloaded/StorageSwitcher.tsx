import { useRef } from 'react'
import type { StorageInfo } from '../../api'
import { useDownloadedLibrary } from '../../downloadedLibrary'
import {
  ALL_STORAGES, setStorageChoice, sinceLabel, storageIcon, titleCounts, useStorageChoice, useStorages, videoStorages, whereOf,
} from '../../storageChoice'

const ICONS = {
  pc: 'M3 5a1 1 0 011-1h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1zM8 20h8M12 16v4',
  share: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  folder: 'M4 7v10a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-6L9 5H6a2 2 0 00-2 2z',
  phone: 'M7 3.5A1.5 1.5 0 018.5 2h7A1.5 1.5 0 0117 3.5v17a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 017 20.5zM11 18.5h2',
  all: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
}

export function StorageGlyph({ storage, className = 'w-4 h-4' }: { storage?: Pick<StorageInfo, 'id' | 'path' | 'kind' | 'bridge'>; className?: string }) {
  const d = storage ? ICONS[storageIcon(storage)] : ICONS.all
  return (
    <svg className={`${className} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/**
 * Which storage the Media page is on (SPEC-storage §8.1): like a drive in a file
 * explorer, one at a time, with every storage together at the bottom. Shown
 * once there is more than one storage to be on.
 */
export default function StorageSwitcher() {
  const list = videoStorages(useStorages())
  const choice = useStorageChoice()
  const titles = useDownloadedLibrary()
  const menu = useRef<HTMLDetailsElement>(null)
  if (list.length < 2) return null

  const counts = titleCounts(titles)
  const current = list.find(s => s.id === choice)
  const pick = (id: string) => {
    setStorageChoice(id)
    if (menu.current) menu.current.open = false
  }

  return (
    <details ref={menu} className="dropdown w-full md:w-auto">
      <summary
        className={`flex items-center gap-2 h-9 px-3 rounded-field bg-base-100/70 border border-primary/25 hover:border-primary/50 cursor-pointer list-none text-sm min-w-0 w-full md:w-auto md:max-w-md`}
        aria-label={`Storage: ${current?.label ?? 'All storages'}`}
      >
        <StorageGlyph storage={current} />
        <span className="font-medium whitespace-nowrap">{current?.label ?? 'All storages'}</span>
        {current?.state === 'offline' && <span className="text-error text-xs whitespace-nowrap">offline</span>}
        {current && (
          <span className="font-mono text-xs text-base-content/50 truncate min-w-0">{whereOf(current)}</span>
        )}
        <svg className="w-3 h-3 ml-auto shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <ul className={`menu dropdown-content z-30 mt-1 p-1.5 bg-base-200 rounded-box shadow-xl border border-base-300 w-full md:w-88 max-w-[90vw]`}>
        {list.map(s => (
          <li key={s.id}>
            <button type="button" onClick={() => pick(s.id)} aria-pressed={s.id === choice} className={`items-start gap-2.5 ${s.id === choice ? 'menu-active' : ''}`}>
              <StorageGlyph storage={s} className="w-4.5 h-4.5 mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">
                  {s.label}{' '}
                  {s.state === 'offline'
                    ? <span className="text-error text-xs">· offline{s.since ? ` since ${sinceLabel(s.since)}` : ''}</span>
                    : <span className="text-base-content/50 text-xs">· {counts.get(s.id) ?? 0} titles</span>}
                </span>
                <span className="block font-mono text-xs text-base-content/50 truncate">{whereOf(s)}</span>
              </span>
            </button>
          </li>
        ))}
        <li className="my-1 h-px bg-base-300 p-0 pointer-events-none" aria-hidden="true" />
        <li>
          <button type="button" onClick={() => pick(ALL_STORAGES)} aria-pressed={choice === ALL_STORAGES} className={`items-start gap-2.5 ${choice === ALL_STORAGES ? 'menu-active' : ''}`}>
            <StorageGlyph className="w-4.5 h-4.5 mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm">All storages</span>
              <span className="block text-xs text-base-content/50">{titles.length} titles</span>
            </span>
          </button>
        </li>
      </ul>
    </details>
  )
}
