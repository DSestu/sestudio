import { useEffect, useState } from 'react'
import type { AppSettings } from '../api'
import { getSettings, putSettings } from '../api'

interface Props {
  onChange: (settings: AppSettings) => void
}

export default function SettingsPanel({ onChange }: Props) {
  const [settings, setSettings] = useState<AppSettings>({ output_root: '.', lang: 'vf' })

  useEffect(() => {
    getSettings().then(s => { setSettings(s); onChange(s) })
  }, [])

  async function update(patch: Partial<AppSettings>) {
    const updated = await putSettings(patch)
    setSettings(updated)
    onChange(updated)
  }

  return (
    <div className="flex items-center gap-4 card card-bordered bg-base-200 px-4 py-3">
      <span className="text-base-content/60 text-sm font-medium">Settings</span>
      <div className="flex items-center gap-2">
        <label className="text-base-content/60 text-sm">Output</label>
        <input
          className="input input-bordered input-sm w-64"
          value={settings.output_root}
          onChange={e => update({ output_root: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-base-content/60 text-sm">Lang</label>
        <select
          className="select select-bordered select-sm"
          value={settings.lang}
          onChange={e => update({ lang: e.target.value })}
        >
          <option value="vf">VF</option>
          <option value="vostfr">VOSTFR</option>
          <option value="vo">VO</option>
        </select>
      </div>
    </div>
  )
}
