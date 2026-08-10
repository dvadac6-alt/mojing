import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import { workspaceApi, type AIConfig } from '../workspaceApi'

/**
 * Model picker for the AI panels: lists every configured model and lets the
 * user choose which one a generation call uses (config_id is sent upstream).
 * Renders nothing when no AI config exists yet (the mock/offline path runs).
 */
export function ModelSelect({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const [configs, setConfigs] = useState<AIConfig[]>([])
  useEffect(() => {
    workspaceApi.listAIConfigs().then(setConfigs).catch(() => {})
  }, [])
  if (configs.length === 0) return null
  return (
    <label className="form-field">
      <span>使用模型</span>
      <div className="model-select-row">
        <Bot size={13} />
        <select className="form-select" value={value ?? ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">默认（当前启用）</option>
          {configs.map(c => <option key={c.id} value={c.id}>{c.name} · {c.model}{c.is_active ? '（当前）' : ''}</option>)}
        </select>
      </div>
    </label>
  )
}
