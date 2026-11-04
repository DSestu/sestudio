import { useEffect, useRef, useState } from 'react'
import type { LogLine, RestartWay } from '../../api'
import { getServerLog, restartServer, serverRestartWay } from '../../api'
import { SettingRow, SettingsGroup, ToggleRow } from './rows'
import { uptime } from './useSettingsStatus'
import type { SettingsProps } from './SettingsView'

/** Settings › Server: whether it runs, its log, restarting it, and Nightly in the Android app. */
export default function Server({ settings }: Pick<SettingsProps, 'settings'>) {
  return (
    <>
      {settings.js_runtime === '' && (
        <p role="alert" className="rounded-[14px] bg-warning/12 p-3 text-sm leading-snug">
          <span className="font-semibold text-warning">YouTube can't play.</span> The server needs Node.js
          or Deno and found neither. Install one (nodejs.org), then restart the server.
        </p>
      )}

      <ServerLog />

      <SettingsGroup title="Restart">
        {window.SestudioApp?.setNightly && <NightlyToggle />}
        <RestartServer />
      </SettingsGroup>
    </>
  )
}

const RESTART_WAY: Record<RestartWay, string> = {
  launcher: 'Runs the command it was started with again, from the same folder',
  uvx: 'Starts it again with uvx, on the latest release',
  python: 'Starts the same Python again, on the code now in its folder',
}

/** Restarts the server, then reloads the page once it answers again. What
 *  plays or casts stops for the few seconds it is away. Shared by Restart
 *  server and Nightly. */
function useRestart() {
  const [state, setState] = useState<'idle' | 'restarting' | 'failed'>('idle')

  /** [restart]: how; the Android app restarts it itself when Nightly flips. */
  async function run(restart: () => unknown = restartServer) {
    if (!window.confirm('Restart the server? Playback and casts stop for a few seconds.')) return false
    setState('restarting')
    try {
      await restart()
    } catch {
      setState('failed')
      return
    }
    // Gone, then back: the new one waits for this one to let go of its ports.
    await new Promise(r => setTimeout(r, 1500))
    for (let i = 0; i < 120; i++) {
      if (await serverRestartWay()) {
        window.location.reload()
        return true
      }
      await new Promise(r => setTimeout(r, 1000))
    }
    setState('failed')
    return true
  }

  return { state, run }
}

/** The Android app's Nightly: its server on GitHub's main branch instead of
 *  the latest release. Flipping it restarts the server on the other one. */
function NightlyToggle() {
  const app = window.SestudioApp!
  const [on, setOn] = useState(() => app.nightly!())
  const { state, run } = useRestart()

  async function flip(next: boolean) {
    setOn(next)
    if (!(await run(() => app.setNightly!(next)))) setOn(!next)
  }

  return (
    <ToggleRow
      label="Nightly"
      help={state === 'failed'
        ? 'Not back yet: the first start on new code can take a few minutes. Reload the page later.'
        : 'The newest code on GitHub instead of the latest release: new features first, and new bugs. Posters need your own TMDB key'}
      danger
      checked={on}
      disabled={state === 'restarting'}
      busy={state === 'restarting'}
      onChange={next => { void flip(next) }}
    />
  )
}

function RestartServer() {
  const [way, setWay] = useState<{ restart: RestartWay; command: string } | null>(null)
  const { state, run } = useRestart()
  useEffect(() => { void serverRestartWay().then(setWay) }, [])

  return (
    <SettingRow
      label="Restart server"
      help={state === 'failed'
        ? 'It did not come back. Start it again from where it was launched.'
        : <>
            {way ? RESTART_WAY[way.restart] : 'Starts it again on newer code'}
            {way && <code className="block mt-1 break-all text-base-content/60">{way.command}</code>}
          </>}
    >
      <button
        type="button"
        className="btn btn-sm btn-error btn-outline gap-2"
        disabled={state === 'restarting'}
        onClick={() => { void run() }}
      >
        {state === 'restarting' && <span className="loading loading-spinner loading-xs" />}
        {state === 'restarting' ? 'Restarting…' : 'Restart'}
      </button>
    </SettingRow>
  )
}

/** Same cap as the server's buffer: older lines are gone there too. */
const LOG_KEPT = 1000

/** A log level as the terminal tags it, and its colour. */
const LEVEL_TAG: Record<string, [string, string]> = {
  DEBUG: ['DBG', 'text-base-content/40'],
  INFO: ['INFO', 'text-success'],
  WARNING: ['WARN', 'text-warning'],
  ERROR: ['ERR', 'text-error'],
  CRITICAL: ['ERR', 'text-error'],
}

/** The Android app's own bridge, when the page runs inside it. */
declare global {
  interface Window {
    SestudioApp?: { stopServer?: () => void; nightly?: () => boolean; setNightly?: (on: boolean) => void }
  }
}

/**
 * Whether the server runs and for how long, then its own output as its
 * terminal shows it: polled while this category is shown, newest at the
 * bottom, following along unless scrolled up.
 */
function ServerLog() {
  const [lines, setLines] = useState<LogLine[]>([])
  const [started, setStarted] = useState<number | null>(null)
  const [reachable, setReachable] = useState(true)
  const [copied, setCopied] = useState(false)
  const [, tick] = useState(0)
  const box = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let last = 0
    const poll = () =>
      getServerLog(last).then(answer => {
        setReachable(answer !== null)
        if (!answer) return
        setStarted(answer.started)
        tick(n => n + 1) // the uptime moves on even when nothing is logged
        if (!answer.lines.length) return
        last = answer.lines[answer.lines.length - 1].seq
        const el = box.current
        const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 24
        setLines(prev => [...prev, ...answer.lines].slice(-LOG_KEPT))
        if (atBottom) requestAnimationFrame(() => el?.scrollTo({ top: el.scrollHeight }))
      })
    poll()
    const timer = setInterval(poll, 2000)
    return () => clearInterval(timer)
  }, [])

  function copy() {
    navigator.clipboard
      .writeText(lines.map(line => line.text).join('\n'))
      .then(() => setCopied(true))
      .catch(() => {})
  }

  const stopServer = window.SestudioApp?.stopServer

  return (
    <SettingsGroup footnote="What the server prints in its terminal: requests, warnings and errors.">
      <SettingRow
        label={
          <span className="inline-flex items-center gap-2">
            <span className={`size-2 rounded-full ${reachable ? 'bg-success' : 'bg-error'}`} aria-hidden="true" />
            {reachable ? 'Running' : 'Not answering'}
          </span>
        }
        help={reachable && started ? `Up for ${uptime(started)}` : undefined}
      >
        {navigator.clipboard && lines.length > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={copy}>{copied ? 'Copied' : 'Copy log'}</button>
        )}
        {stopServer && (
          <button
            className="btn btn-sm btn-outline btn-error"
            onClick={() => { if (window.confirm('Stop the server? The app closes.')) stopServer() }}
          >
            Stop
          </button>
        )}
      </SettingRow>
      <pre
        ref={box}
        role="log"
        aria-label="Server log"
        className="h-72 overflow-auto rounded-b-[14px] bg-[#05070b] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-base-content/70"
      >
        {lines.length === 0 ? (
          <span className="text-base-content/40">Nothing logged yet.</span>
        ) : (
          lines.map(line => {
            // "HH:MM:SS message", as the server formats it.
            const time = line.text.slice(0, 8)
            const [tag, colour] = LEVEL_TAG[line.level] ?? [line.level, '']
            return (
              <div key={line.seq}>
                <span className="text-base-content/35">{time}</span>{' '}
                <span className={`inline-block w-9 font-semibold ${colour}`}>{tag}</span>
                {line.text.slice(9)}
              </div>
            )
          })
        )}
      </pre>
    </SettingsGroup>
  )
}
