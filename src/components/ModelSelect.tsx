import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import { workspaceApi, type AIConfig } from '../workspaceApi'

// 模块级缓存 + 请求去重 + 30s TTL：写作页 QuickAI / Agent / 世界观页的
// ModelSelect 会同时挂载多个，之前每个实例都各自请求一遍配置列表。
let _cache: { at: number; promise: Promise<AIConfig[]> } | null = null
const CONFIG_TTL_MS = 30_000
function loadConfigs(): Promise<AIConfig[]> {
  if (!_cache || Date.now() - _cache.at > CONFIG_TTL_MS) {
    const promise = workspaceApi.listAIConfigs().catch(e => { _cache = null; throw e })
    _cache = { at: Date.now(), promise }
  }
  return _cache.promise
}

/**
 * Model picker for the AI panels: lists every configured model and lets the
 * user choose which one a generation call uses (config_id is sent upstream).
 * Renders nothing when no AI config exists yet (the mock/offline path runs).
 */
export function ModelSelect({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const [configs, setConfigs] = useState<AIConfig[]>([])
  useEffect(() => {
    let cancelled = false
    loadConfigs().then(list => { if (!cancelled) setConfigs(list) }).catch(() => {})
    return () => { cancelled = true }
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
