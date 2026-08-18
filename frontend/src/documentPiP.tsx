import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { OutPortal } from './reversePortal'
import type { PortalNode } from './portalNode'
import { setPiPWindow, usePiPWindow } from './pipSession'
import { applyPiPSubtitleStyle } from './subtitleStyle'

/**
 * Document Picture-in-Picture: the whole player in a floating OS window.
 *
 * The browser's *element* PiP (what vidstack's own button uses) lifts only the
 * `<video>` element's pixels into the floating window, which loses the caption
 * overlay — vidstack renders cues as sibling DOM, not into the video frame, and
 * that is exactly what makes them stylable. Document PiP instead opens a real
 * window that hosts arbitrary DOM, so moving the player there carries the
 * captions and controls along with it, fully styled.
 *
 * This reuses the reverse-portal node the mini-player already relies on: the
 * node is never recreated, only relocated, so the video keeps playing as it
 * moves between documents.
 *
 * Chromium-only. Everything here is behind `isDocumentPiPSupported`.
 */

interface DocumentPiP {
  requestWindow(options?: {
    width?: number
    height?: number
    /** Drop the "back to tab" button from the window's title bar. */
    disallowReturnToOpener?: boolean
  }): Promise<Window>
  window: Window | null
}

function api(): DocumentPiP | null {
  return (window as unknown as { documentPictureInPicture?: DocumentPiP })
    .documentPictureInPicture ?? null
}

export function isDocumentPiPSupported(): boolean {
  return api() !== null
}

/**
 * Clone the page's styles into *target*.
 *
 * A PiP window starts with an empty document — none of the app's CSS applies,
 * so without this the player renders unstyled. Same-origin sheets are inlined
 * from their parsed rules; anything that throws on `cssRules` (a cross-origin
 * sheet) is re-linked by href instead.
 */
function copyStyles(target: Window): void {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const text = Array.from(sheet.cssRules)
        .map(rule => rule.cssText)
        .join('\n')
      const style = target.document.createElement('style')
      style.textContent = text
      target.document.head.appendChild(style)
    } catch {
      if (!sheet.href) continue
      const link = target.document.createElement('link')
      link.rel = 'stylesheet'
      link.href = sheet.href
      target.document.head.appendChild(link)
    }
  }
}

/**
 * Mirror the page's `<html>` onto the PiP document's.
 *
 * Cloning stylesheets is not enough: two things live on the root *element*, not
 * in any sheet, and both break visibly without this.
 *
 * - `data-theme` (index.html) selects the daisyUI palette. Absent, every theme
 *   variable falls back to the default light theme, and the surface around the
 *   letterboxed video turns pale — it reads as a window border.
 * - The `--media-user-*` caption variables are set as inline style on the root
 *   by `applySubtitleStyle`, so subtitles would otherwise revert to vidstack's
 *   own defaults instead of the user's chosen font, size and background.
 *
 * Copying the whole attribute set rather than an allow-list means anything
 * added to `<html>` later comes along without needing to be remembered here.
 */
function syncRoot(target: Window): void {
  const from = document.documentElement
  const to = target.document.documentElement
  for (const attr of Array.from(from.attributes)) {
    to.setAttribute(attr.name, attr.value)
  }
}

/** Pointer events a drag needs to finish. `pointerup` is the one that commits. */
const DRAG_EVENTS = ['pointermove', 'pointerup', 'pointercancel'] as const

/**
 * Forward pointer events from the PiP window onto the page's document.
 *
 * The player's sliders — the timeline, the volume bar — track a drag by
 * listening on `document`. That is the *page's* document, captured when the
 * player's module loaded, not the one its controls are now displayed in. So a
 * press inside the PiP window is seen by the slider element itself, and the
 * release that would commit the seek is never heard: the timeline looks
 * interactive and does nothing.
 *
 * Re-dispatching a copy on the page's document closes that loop. Coordinates
 * pass through untouched on purpose — the slider measures itself with
 * `getBoundingClientRect`, and both it and the event are in the PiP window's
 * viewport, so they already agree with each other. Translating them would be
 * the bug.
 */
function bridgeDragEvents(win: Window): void {
  // Typed as PointerEvent rather than tested with `instanceof`: the event comes
  // from another realm, where the page's PointerEvent constructor is a
  // different object and the test would always be false. Only pointer events
  // are bound below, so the type is accurate.
  const forward = (event: PointerEvent) => {
    // Only what the user actually did: a copy is dispatched on the page's
    // document, never back into this one, but the guard keeps that true if
    // anything ever re-dispatches.
    if (!event.isTrusted) return
    document.dispatchEvent(
      new PointerEvent(event.type, {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        button: event.button,
        buttons: event.buttons,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    )
  }
  // Capture, so a handler inside the player cannot stop the copy being made.
  // Nothing is unbound: the listeners die with the window they are on.
  for (const type of DRAG_EVENTS) {
    win.document.addEventListener(type, forward as EventListener, { capture: true })
  }
}

/**
 * Open the PiP window. Must be called directly from a user gesture — the
 * request is rejected otherwise, so it cannot be moved into an effect.
 *
 * Resolves to false when unsupported or when the user declines.
 */
export async function openDocumentPiP(aspect = 16 / 9): Promise<boolean> {
  const pip = api()
  if (!pip) return false

  // Wide enough for the full control bar to lay out without crowding; the
  // window is resizable from there.
  const width = 640
  try {
    const win = await pip.requestWindow({
      width,
      height: Math.round(width / aspect),
      // The watch view's own "Bring it back" closes the window, so the title
      // bar's return button is redundant. Note this only removes that button —
      // the bar itself is browser chrome and keeps its height.
      disallowReturnToOpener: true,
    })
    copyStyles(win)
    syncRoot(win)
    bridgeDragEvents(win)
    // After syncRoot, which copies the page's caption variables verbatim — this
    // overrides the size with the PiP-specific one.
    applyPiPSubtitleStyle(win)
    // The document is bare; make it a black, edge-to-edge video surface. Black
    // on the root too — the video letterboxes inside whatever aspect the user
    // drags the window to, and the gap should read as part of the picture.
    win.document.documentElement.style.background = '#000'
    win.document.body.style.margin = '0'
    win.document.body.style.background = '#000'
    win.document.body.style.overflow = 'hidden'
    // Fires when the user closes the window from its own chrome, which React
    // never hears about otherwise.
    win.addEventListener('pagehide', () => setPiPWindow(null), { once: true })
    setPiPWindow(win)
    return true
  } catch {
    // Rejected: no user gesture, or the user dismissed the prompt.
    return false
  }
}

/**
 * Mounts the shared player node inside the PiP window while one is open.
 *
 * Renders nothing when closed. Mount this exactly once, high in the tree — and
 * make sure every other `OutPortal` releases the node while PiP is active,
 * since only one mount point may hold it.
 */
export function DocumentPiPPortal({ node }: { node: PortalNode }) {
  const win = usePiPWindow()

  // Closing the tab or navigating away should not leave an orphaned window.
  useEffect(() => {
    if (!win) return
    return () => win.close()
  }, [win])

  if (!win) return null
  return createPortal(
    <div style={{ width: '100vw', height: '100vh' }}>
      <OutPortal node={node} />
    </div>,
    win.document.body,
  )
}
