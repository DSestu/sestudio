import { useState } from 'react'
import AiHeldFrames from '../../components/AiHeldFrames'
import AiSetupProgress from '../../components/AiSetupProgress'
import { runAiSetup } from '../../api'
import { setBrowserQuality } from '../../browserFps'
import { loadPlayerPrefs, qualityPref, qualityValue } from '../../playerPrefs'
import { isSettingUp, useAiSetup } from '../../useAiSetup'
import { forgetMediaOptions } from '../../useMediaOptions'
import { Choice, RowSelect, SettingRow, SettingsGroup, ToggleRow } from './rows'
import type { SettingsProps } from './SettingsView'

const LANGS = [
  { value: 'vf', label: 'VF' },
  { value: 'vostfr', label: 'VOSTFR' },
  { value: 'vo', label: 'VO' },
]

/** Settings › Playback: language, quality, play on open, and AI frame rates. */
export default function Playback({ settings, onUpdate }: SettingsProps) {
  return (
    <>
      <SettingsGroup>
        <SettingRow label="Language" help="A title without it opens in what it has">
          <Choice label="Language" value={settings.lang} options={LANGS} onChange={lang => onUpdate({ lang })} />
        </SettingRow>
        <VideoQualitySetting />
        <ToggleRow
          label="Play on open"
          help="Off: opening a title only shows it, and what's playing keeps going"
          checked={settings.autoplay_on_open !== false}
          onChange={on => onUpdate({ autoplay_on_open: on })}
        />
      </SettingsGroup>

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
    <SettingRow
      label="Quality"
      htmlFor="set-quality"
      help="Where each video starts, or the closest below; the player's menu changes it too"
    >
      <RowSelect
        id="set-quality"
        value={value}
        onChange={e => {
          setValue(e.target.value)
          setBrowserQuality(qualityPref(e.target.value))
        }}
      >
        <option value="source">Source</option>
        <option value="auto">Auto</option>
        {QUALITY_STEPS.map(h => <option key={h} value={h}>{h}p</option>)}
      </RowSelect>
    </SettingRow>
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
  const [status, tone] = !setup ? ['…', 'text-base-content/50']
    : busy ? ['Setting up', 'text-info']
      : setup.step === 'ready' ? ['Ready', 'text-success']
        : setup.step === 'failed' ? ['Failed', 'text-error']
          : ['Not set up', 'text-warning']
  // What the setup found, as one line: "NVIDIA GeForce RTX 4090 · TensorRT · onnxruntime 1.31.1 · 160 fps at 720p".
  const found = setup && [
    setup.nvidia_gpu ?? 'No NVIDIA GPU',
    engine && engineName(engine),
    setup.runtime,
    setup.speed && `${Math.round(setup.speed)} frames drawn a second at 720p`,
  ].filter(Boolean).join(' · ')

  function run() {
    if (setup?.step !== 'idle' && !window.confirm(
      'Download the model again and rebuild the GPU engine? AI frame rates are off until it is done.',
    )) return
    setError('')
    runAiSetup().then(setSetup, (e: Error) => setError(e.message))
  }

  return (
    <SettingsGroup
      title="AI frame rates"
      footnote={enabled && setup && (
        <div className="flex flex-col gap-1.5">
          {engine === 'CPUExecutionProvider' && (
            <p className="text-warning">
              No GPU reachable: the CPU is far too slow to keep up, so no AI frame rate is offered.
            </p>
          )}
          {(setup.error || error) && !busy && <p className="text-error break-words">{error || setup.error}</p>}
          <AiSetupProgress setup={setup} />
          <p>
            {setup.step === 'idle'
              ? 'Sets itself up the first time a video opens.'
              : 'Reinstall fetches the model and rebuilds the GPU engine; the runtime is kept while in use.'}
          </p>
        </div>
      )}
    >
      <ToggleRow
        label="Offer AI frame rates"
        help="Smoother motion, frames drawn on the server's GPU. Off downloads nothing"
        checked={enabled}
        onChange={on => {
          // Pickers ask again, so the AI rates come or go at once.
          forgetMediaOptions()
          void onUpdate({ frame_interpolation: on })
        }}
      />
      {enabled && (
        <SettingRow
          label="Anime: smooth held drawings"
          htmlFor="set-ai-max-hold"
          help="AI frames glide between drawings instead of repeating them. No effect on live action"
        >
          <AiHeldFrames
            id="set-ai-max-hold"
            className="select select-sm w-auto max-w-[55%] shrink-0 bg-base-100 border-0 text-sm"
            value={settings.ai_max_hold ?? 0}
            onChange={hold => void onUpdate({ ai_max_hold: hold })}
          />
        </SettingRow>
      )}
      {enabled && setup && (
        <SettingRow label="Engine" help={found}>
          <span className={`text-xs font-medium whitespace-nowrap ${tone}`}>{status}</span>
          <button onClick={run} disabled={busy} className="btn btn-sm">
            {setup.step === 'idle' ? 'Set up now' : 'Reinstall'}
          </button>
        </SettingRow>
      )}
    </SettingsGroup>
  )
}
