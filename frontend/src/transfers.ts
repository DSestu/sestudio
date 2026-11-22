import { useSyncExternalStore } from 'react'
import { transfersApi, type DownloadedFile, type StorageInfo, type TransferJob } from './api'
import { refreshDownloadedLibrary } from './downloadedLibrary'
import type { FolderNode } from './downloadedFolders'
import { NETWORK_KINDS } from './storageChoice'

// Copy and move between storages (SPEC-storage §9, X2): what is picked, where it
// lands, and the server's transfers as the Queue shows them.

/** One file to send, with the folder its path is kept from: "Pick another
 *  folder" puts what sits under `base` into the chosen folder. */
export interface TransferEntry {
  file: DownloadedFile
  base: string
}

/** What the picker opens with. */
export interface TransferRequest {
  mode: 'copy' | 'move'
  /** "Stargate SG-1", "12 files": what the picker's title names. */
  name: string
  entries: TransferEntry[]
}

export type OnTransfer = (request: TransferRequest) => void

export const relOf = (file: DownloadedFile) => file.rel ?? file.path
export const parentOf = (path: string) => path.split('/').slice(0, -1).join('/')

/** Where an entry lands under `folder` on the destination. */
export function destFor(entry: TransferEntry, folder: string): string {
  const rel = relOf(entry.file)
  const tail = entry.base && rel.startsWith(`${entry.base}/`) ? rel.slice(entry.base.length + 1) : rel
  return [folder, tail].filter(Boolean).join('/')
}

/** The folder every one of `paths` sits in. */
export function commonDir(paths: string[]): string {
  if (!paths.length) return ''
  let common = parentOf(paths[0]).split('/')
  for (const p of paths.slice(1)) {
    const parts = parentOf(p).split('/')
    let i = 0
    while (i < common.length && common[i] === parts[i]) i++
    common = common.slice(0, i)
  }
  return common.join('/')
}

/** Every file in a folder, however deep. */
export function leaves(node: FolderNode): DownloadedFile[] {
  return [...node.files.map(l => l.file), ...[...node.folders.values()].flatMap(leaves)]
}

/** A folder of the Tree or Browse as entries: it lands as itself, by name. */
export function folderEntries(node: FolderNode, byStorage: boolean): TransferEntry[] {
  // With every storage shown, a storage's top folder is the first part of the path.
  const rel = byStorage ? node.path.split('/').slice(1).join('/') : node.path
  const base = parentOf(rel)
  return leaves(node).map(file => ({ file, base }))
}

/** Files a title's modal sends: each keeps the title's folder and what is under it. */
export function titleEntries(files: DownloadedFile[]): TransferEntry[] {
  const base = parentOf(commonDir(files.map(relOf)))
  return files.map(file => ({ file, base }))
}

/** A storage files can be written to and read from here. */
export const writable = (s: StorageInfo) => s.kind === 'folder' || NETWORK_KINDS.includes(s.kind)

/** Whether files on `id` can be copied anywhere: it is writable and another one is. */
export function canSendFrom(list: StorageInfo[], id: string): boolean {
  const from = list.find(s => s.id === id)
  return Boolean(from && writable(from) && list.some(s => s.id !== id && writable(s)))
}

// --- the server's transfers, polled while something shows them -----------------

let jobs: TransferJob[] = []
let timer: number | undefined
const listeners = new Set<() => void>()
const running = (j: TransferJob) => j.status === 'queued' || j.status === 'running' || j.status === 'paused'

export async function refreshTransfers(): Promise<void> {
  try {
    const next = await transfersApi.list()
    // A transfer that just finished changed what is on disk.
    if (jobs.some(j => running(j) && next.some(n => n.id === j.id && !running(n)))) {
      void refreshDownloadedLibrary()
    }
    jobs = next
    listeners.forEach(l => l())
  } catch { /* keep what was listed */ }
  window.clearTimeout(timer)
  if (listeners.size) timer = window.setTimeout(refreshTransfers, jobs.some(running) ? 1500 : 10000)
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  if (listeners.size === 1) void refreshTransfers()
  return () => {
    listeners.delete(cb)
    if (!listeners.size) window.clearTimeout(timer)
  }
}

/** Every transfer the server holds, newest first. */
export function useTransfers(): TransferJob[] {
  return useSyncExternalStore(subscribe, () => jobs)
}

// --- select mode in the Tree and Browse (option T2): ticks are files ------------

/** How much of a folder is ticked. */
export function tickState(files: DownloadedFile[], picked: Set<string>): boolean | 'part' {
  const n = files.filter(f => picked.has(f.path)).length
  return n === 0 ? false : n === files.length ? true : 'part'
}

/** What is ticked, as entries: a fully ticked folder lands as itself, a lone
 *  file by its name. `ok` says which files can be sent at all. */
export function pickedEntries(
  root: FolderNode,
  picked: Set<string>,
  byStorage: boolean,
  ok: (f: DownloadedFile) => boolean,
): { names: string[]; entries: TransferEntry[] } {
  const names: string[] = []
  const entries: TransferEntry[] = []
  const walk = (node: FolderNode) => {
    for (const child of node.folders.values()) {
      const files = leaves(child).filter(ok)
      const state = tickState(files, picked)
      if (state === true) {
        names.push(child.name)
        entries.push(...folderEntries(child, byStorage).filter(e => ok(e.file)))
      } else if (state === 'part') {
        walk(child)
      }
    }
    for (const { file } of node.files) {
      if (ok(file) && picked.has(file.path)) {
        names.push(relOf(file).split('/').pop() ?? file.title)
        entries.push({ file, base: parentOf(relOf(file)) })
      }
    }
  }
  walk(root)
  return { names, entries }
}
