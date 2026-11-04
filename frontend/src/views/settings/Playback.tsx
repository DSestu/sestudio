import { useState } from 'react'
import AiHeldFrames from '../../components/AiHeldFrames'
import AiSetupProgress from '../../components/AiSetupProgress'
import { runAiSetup } from '../../api'
import { setBrowserQuality } from '../../browserFps'
import { loadPlayerPrefs, qualityPref, qualityValue } from '../../playerPrefs'
import { isSettingUp, useAiSetup } from '../../useAiSetup'
import { forgetMediaOptions } from '../../useMediaOptions'
import type { SettingsProps } from './SettingsView'

/** Settings › Playback: language, quality, play on open, and AI frame rates. */
export default function Playback({ settings, onUpdate }: SettingsProps) {
  return (
    <>
      <section aria-labelledby="settings-playback" className="flex flex-col gap-4">
        <h3
          id="settings-playback"
          className="text-xs font-semibold uppercase tracking-wide text-base-content/50"
        >
          Playback
        </h3>

        <div>
          <label htmlFor="set-lang" className="text-sm text-base-content/60 mb-1 block">
            Preferred language
          </label>
          <select
            id="set-lang"
            className="select select-bordered w-full"
            value={settings.lang}
            onChange={e => onUpdate({ lang: e.target.value })}
          >
            <option value="vf">VF</option>
            <option value="vostfr">VOSTFR</option>
            <option value="vo">VO</option>
          </select>
          <p className="text-xs text-base-content/50 mt-1">
            Used when opening a title; a title without it falls back to what it has.
          </p>
        </div>

        <VideoQualitySetting />

        <div>
          <label className="flex items-center gap-3 cursor-pointer text-sm">
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-sm"
              checked={settings.autoplay_on_open !== false}
              onChange={e => onUpdate({ autoplay_on_open: e.target.checked })}
            />
            <span>Play on open</span>
          </label>
          <p className="text-xs text-base-content/50 mt-1">
            Off means opening a title only shows its description and episodes —
            nothing starts until you press play, so whatever you are already
            watching keeps running.
          </p>
        </div>
      </section>

      <div className="divider my-0" />

      <AiSection settings={settings} onUpdate={onUpdate} />
    </>
  )
}

/** Heights offered in the settings, before any video says which it has. */
const QUALITY_STEPS = [2160, 1440, 1080, 720, 480, 360, 240, 144]

/** The quality the player starts each video at: the same remembered choice
 *  as the dropdown beside the player, so changing either changes both. */
function VideoQualitySetting() {
  const [value, setValue] = useState(() => qualityValue(loadPlayerPrefs().quality))
  return (
    <div>
      <label htmlFor="set-quality" className="text-sm text-base-content/60 mb-1 block">
        Video quality
      </label>
      <select
        id="set-quality"
        className="select select-bordered w-full"
        value={value}
        onChange={e => {
          setValue(e.target.value)
          setBrowserQuality(qualityPref(e.target.value))
        }}
      >
        <option value="source">Source — the video's own picture</option>
        <option value="auto">Auto — follows the connection</option>
        {QUALITY_STEPS.map(h => <option key={h} value={h}>{h}p</option>)}
      </select>
      <p className="text-xs text-base-content/50 mt-1">
        Where each video starts. A video without that quality plays the closest
        below it; the dropdown beside the player changes this too.
      </p>
    </div>
  )
}

/** An execution provider as the user knows it: "TensorRT", "DirectML". */
function engineName(provider: string): string {
  const name = provider.replace(/ExecutionProvider$/, '')
  return ({ Tensorrt: 'TensorRT', Dml: 'DirectML', ROCM: 'ROCm' } as Record<string, string>)[name] ?? name
}

/**
 * AI frame rates: on or off, and the local setup they need — its progress,
 * what it found, and a way to run it (again).
 */
function AiSection({ settings, onUpdate }: SettingsProps) {
  const [setup, setSetup] = useAiSetup()
  const [error, setError] = useState('')
  const enabled = settings.frame_interpolation !== false
  const busy = isSettingUp(setup)
  const engine = setup?.providers[0]
  const status = !setup ? '…'
    : busy ? 'Setting up'
      : setup.step === 'ready' ? 'Ready'
        : setup.step === 'failed' ? 'Failed'
          : 'Not set up yet'

  function run() {
    if (setup?.step !== 'idle' && !window.confirm(
      'Download the model again and rebuild the GPU engine? AI frame rates are off until it is done.',
    )) return
    setError('')
    runAiSetup().then(setSetup, (e: Error) => setError(e.message))
  }

  return (
    <section aria-labelledby="settings-ai" className="flex flex-col gap-4">
      <h3
        id="settings-ai"
        className="text-xs font-semibold uppercase tracking-wide text-base-content/50"
      >
        AI frame rates
      </h3>

      <div>
        <label className="flex items-center gap-3 cursor-pointer text-sm">
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm"
            checked={enabled}
            onChange={e => {
              // Pickers ask again, so the AI rates come or go at once.
              forgetMediaOptions()
              void onUpdate({ frame_interpolation: e.target.checked })
            }}
          />
          <span>Offer frame rates drawn by AI</span>
        </label>
        <p className="text-xs text-base-content/50 mt-1">
          Smoother motion: frames in between the real ones are drawn on the
          server's GPU. Off means nothing is downloaded and only the video's own
          rate, or a lower one, is offered.
        </p>
      </div>

      {enabled && (
        <AiHeldFrames
          id="set-ai-max-hold"
          value={settings.ai_max_hold ?? 0}
          onChange={hold => void onUpdate({ ai_max_hold: hold })}
        />
      )}

      {enabled && setup && (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-base-content/60">Status</dt>
            <dd>{status}</dd>
            <dt className="text-base-content/60">NVIDIA GPU</dt>
            <dd>{setup.nvidia_gpu ?? 'None found'}</dd>
            <dt className="text-base-content/60">Engine</dt>
            <dd>{engine ? engineName(engine) : '—'}</dd>
            <dt className="text-base-content/60">Runtime</dt>
            <dd>{setup.runtime ?? '—'}</dd>
            <dt className="text-base-content/60">Speed</dt>
            <dd>{setup.speed ? `${Math.round(setup.speed)} frames drawn a second at 720p` : '—'}</dd>
          </dl>

          {engine === 'CPUExecutionProvider' && (
            <p className="text-xs text-warning">
              No GPU reachable: the CPU is far too slow to keep up, so no AI frame
              rate is offered.
            </p>
          )}
          {(setup.error || error) && !busy && (
            <p className="text-xs text-error break-words">{error || setup.error}</p>
          )}

          <AiSetupProgress setup={setup} />

          <div>
            <button onClick={run} disabled={busy} className="btn btn-sm">
              {setup.step === 'idle' ? 'Set up now' : 'Reinstall'}
            </button>
            <p className="text-xs text-base-content/50 mt-1">
              Otherwise the setup runs by itself the first time a video is opened.
              Reinstalling fetches the model and rebuilds the GPU engine; the
              runtime itself is only reinstalled if it is not in use.
            </p>
          </div>
        </>
      )}
    </section>
  )
}
