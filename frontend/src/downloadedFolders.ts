import type { DownloadedFile, DownloadedTitle } from './api'

// The download root's folder structure, derived from the paths already in the
// listing. Two views read it — the tree outline and the card browser — so it
// lives here rather than in either of them, and neither can drift from the
// other about what is on disk.

/** A file, paired with the title it was grouped into. */
export interface Leaf {
  file: DownloadedFile
  title: DownloadedTitle
}

export interface FolderNode {
  name: string
  /** Path from the root, for navigating and for React keys. */
  path: string
  folders: Map<string, FolderNode>
  files: Leaf[]
  /** Everything below, so a folder can be judged without opening it. */
  count: number
  size: number
}

function emptyNode(name: string, path: string): FolderNode {
  return { name, path, folders: new Map(), files: [], count: 0, size: 0 }
}

/**
 * The download root as it actually sits on disk.
 *
 * Folders are only created for files that survive `needle`, so a filter never
 * leaves an empty folder behind. Single-child folders are deliberately *not*
 * collapsed: the point is to show the arrangement as it is, awkward parts and
 * all.
 */
export function buildFolders(titles: DownloadedTitle[], needle = ''): FolderNode {
  const root = emptyNode('', '')
  for (const title of titles) {
    for (const file of title.files) {
      if (needle && !file.path.toLowerCase().includes(needle)) continue
      // Everything but the filename: the leaf is the file itself.
      const parts = file.path.split('/').slice(0, -1)
      let node = root
      root.count += 1
      root.size += file.size
      for (const part of parts) {
        let next = node.folders.get(part)
        if (!next) {
          next = emptyNode(part, node.path ? `${node.path}/${part}` : part)
          node.folders.set(part, next)
        }
        next.count += 1
        next.size += file.size
        node = next
      }
      node.files.push({ file, title })
    }
  }
  return root
}

/** The node at *path*, or null when it no longer exists — which happens when a
 *  filter prunes the folder you were standing in. */
export function folderAt(root: FolderNode, path: string[]): FolderNode | null {
  let node = root
  for (const part of path) {
    const next = node.folders.get(part)
    if (!next) return null
    node = next
  }
  return node
}

/** Child folders, then files, each in natural order. */
export function sortedChildren(node: FolderNode): {
  folders: FolderNode[]
  files: Leaf[]
} {
  return {
    folders: [...node.folders.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    ),
    files: [...node.files].sort((a, b) =>
      a.file.path.localeCompare(b.file.path, undefined, { numeric: true }),
    ),
  }
}
