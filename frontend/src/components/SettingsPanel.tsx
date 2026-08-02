import type { AppSettings } from '../api'
import { useModalBack } from '../useModalBack'
import ResponsiveModal from './ResponsiveModal'

interface Props {
  settings: AppSettings
  onUpdate: (patch: Partial<AppSettings>) => void
  onClose: () => void
}

/** Settings drawer — a bottom sheet on phones, a centered dialog on desktop. */
export default function SettingsPanel({ settings, onUpdate, onClose }: Props) {
  useModalBack(true, onClose)

  return (
    <ResponsiveModal onClose={onClose} boxClassName="max-w-md">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-base">Settings</h2>
        <button onClick={onClose} aria-label="Close settings" className="btn btn-circle btn-ghost sm:btn-sm">✕</button>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="set-output" className="text-sm text-base-content/60 mb-1 block">
            Download folder (server)
          </label>
          <input
            id="set-output"
            className="input input-bordered w-full"
            value={settings.output_root}
            onChange={e => onUpdate({ output_root: e.target.value })}
          />
        </div>

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
        </div>

        <div>
          <label htmlFor="set-dest" className="text-sm text-base-content/60 mb-1 block">
            Download to
          </label>
          <select
            id="set-dest"
            className="select select-bordered w-full"
            value={settings.download_destination}
            onChange={e => onUpdate({ download_destination: e.target.value as AppSettings['download_destination'] })}
          >
            <option value="server">Server</option>
            <option value="device">This device</option>
          </select>
          <p className="text-xs text-base-content/50 mt-1">
            “This device” streams the file through the server to your browser.
          </p>
        </div>
      </div>
    </ResponsiveModal>
  )
}
