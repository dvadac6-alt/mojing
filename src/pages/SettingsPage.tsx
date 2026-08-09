import { useEffect, useState, type ElementType } from 'react'
import {
  Bot, BrainCircuit, Check, CircleHelp, Database, Download, Feather,
  FileText, HardDrive, MapPin, PenLine, Plus, Settings, ShieldCheck, Trash2,
} from 'lucide-react'
import {
  chooseDataDirectory, workspaceApi,
  type AIConfig, type StorageInfo, type Workspace,
} from '../workspaceApi'
import { areaCls, inputCls, selectCls } from '../lib/constants'
import { Button, Field, Modal, PageHeader, Scroll } from '../components/ui'
import { useAsyncAction } from '../hooks/useAsyncAction'

export function SettingsPage({ workspace, reload }: { workspace: Workspace; reload: () => Promise<void> }) {
  const sections: [ElementType, string][] = [[Settings, '通用'], [PenLine, '编辑器'], [Bot, 'AI 模型'], [Download, '导出'], [HardDrive, '数据与备份'], [CircleHelp, '关于']]
  const [active, setActive] = useState('AI 模型')
  return <div className="settings-page"><aside><div><label>应用偏好</label><strong>设置</strong></div><nav>{sections.map(([Icon, text], i) => { const I = Icon; return <button className={active === text ? 'active' : ''} key={text} onClick={() => setActive(text)}><I size={15} />{text}</button> })}</nav></aside>
    <section>
      {active === 'AI 模型' && <AISection onSaved={reload} />}
      {active === '导出' && <ExportSection workspace={workspace} />}
      {active === '通用' && <PageHeader title="通用设置" desc="这些设置只保存在当前 Windows 用户配置中。" />}
      {active === '编辑器' && <PageHeader title="编辑器设置" desc="字号、主题与自动保存间隔。" />}
      {active === '数据与备份' && <DataSection reload={reload} />}
      {active === '关于' && <AboutSection />}
    </section>
  </div>
}

function AISection({ onSaved }: { onSaved: () => Promise<void> }) {
  const [configs, setConfigs] = useState<AIConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AIConfig | null>(null)
  const [creating, setCreating] = useState(false)
  const [meta, setMeta] = useState<{ offline_fallback: boolean } | null>(null)
  const load = async () => { setLoading(true); try { setConfigs(await workspaceApi.listAIConfigs()); setMeta(await workspaceApi.aiModels()) } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  const setActive = async (cfg: AIConfig) => { await workspaceApi.updateAIConfig(cfg.id, { is_active: true }); await load(); await onSaved() }
  const remove = async (cfg: AIConfig) => { if (confirm('删除此模型配置？')) { await workspaceApi.deleteAIConfig(cfg.id); await load() } }
  return <Scroll>
    <PageHeader eyebrow="AI 调度" title="AI 模型" desc="配置 OpenAI 兼容的模型（GPT / DeepSeek / Claude 兼容端点）。未配置时将自动使用本地离线生成。" actions={<Button kind="primary" onClick={() => setCreating(true)}><Plus size={14} />添加模型</Button>} />
    <div style={{ maxWidth: 720, margin: '0 auto 18px', padding: '12px 14px', border: '1px solid #e2dfd6', borderRadius: 9, background: '#fffefa', fontSize: 11, color: '#6b6f6b' }}>
      <ShieldCheck size={14} style={{ verticalAlign: -2, marginRight: 6, color: '#6e7e74' }} />
      {meta?.offline_fallback && '已启用离线兜底：未配置可用密钥时，AI 面板仍可生成示例草稿。'} API Key 加密存储于本地，永不下发至前端。
    </div>
    <div style={{ maxWidth: 720, margin: '0 auto' }} className="settings-config-list">
      {loading && <p style={{ color: '#999', fontSize: 11 }}>读取配置…</p>}
      {!loading && configs.length === 0 && <div className="empty-state"><span><Bot size={22} /></span><h3>还没有配置模型</h3><p>添加一个 OpenAI 兼容模型以启用真实 AI 续写；在此之前将使用离线生成。</p><Button kind="primary" onClick={() => setCreating(true)}><Plus size={14} />添加模型</Button></div>}
      {configs.map(cfg => <div className={'config-card' + (cfg.is_active ? ' active' : '')} key={cfg.id}>
        <span className="cfg-icon"><Bot size={18} /></span>
        <div className="cfg-body"><strong>{cfg.name} · {cfg.model}</strong><small>{cfg.base_url || '无 base_url'} · temperature {cfg.temperature} · max {cfg.max_tokens}</small></div>
        {cfg.is_active ? <span className="badge">当前</span> : <Button onClick={() => void setActive(cfg)}>设为当前</Button>}
        <Button onClick={() => setEditing(cfg)}><PenLine size={13} />编辑</Button>
        <button className="icon-button" onClick={() => void remove(cfg)}><Trash2 size={15} /></button>
      </div>)}
    </div>
    {creating && <AIConfigForm onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await load() }} />}
    {editing && <AIConfigForm initial={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load() }} />}
  </Scroll>
}

function AIConfigForm({ initial, onClose, onSaved }: { initial?: AIConfig; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [provider, setProvider] = useState(initial?.provider ?? 'openai')
  const [model, setModel] = useState(initial?.model ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? '')
  // The real key never comes back from the server; editing starts blank.
  // Leaving it blank on save keeps the stored key (api_key omitted).
  const [apiKey, setApiKey] = useState('')
  const [temperature, setTemperature] = useState(String(initial?.temperature ?? 0.85))
  const [maxTokens, setMaxTokens] = useState(String(initial?.max_tokens ?? 1200))
  const [isActive, setIsActive] = useState(initial?.is_active ?? false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  const { busy, error, run } = useAsyncAction()
  const submit = () => run(async () => {
    const data: Record<string, unknown> = { name: name.trim() || '默认模型', provider, model, base_url: baseUrl, temperature: Number(temperature) || 0.85, max_tokens: Number(maxTokens) || 1200, is_active: isActive }
    // Only send the key when the user typed something — otherwise it's left
    // untouched on the server (api_key omitted => no change).
    if (apiKey !== '') data.api_key = apiKey
    if (initial) await workspaceApi.updateAIConfig(initial.id, data); else await workspaceApi.createAIConfig({ ...data, api_key: apiKey })
    onSaved()
  })
  const test = async () => {
    if (!initial) return
    setTesting(true); setTestResult('')
    try {
      const payload: { model?: string; base_url?: string; api_key?: string } = {}
      if (model) payload.model = model
      if (baseUrl) payload.base_url = baseUrl
      if (apiKey !== '') payload.api_key = apiKey
      const res = await workspaceApi.testAIConfig(initial.id, payload)
      setTestResult(res.detail)
    } catch (e) { setTestResult(e instanceof Error ? e.message : '测试失败') } finally { setTesting(false) }
  }
  const keyPlaceholder = initial?.has_key ? `已保存（${initial.key_hint}），留空保持不变` : 'sk-…'
  return <Modal eyebrow={initial ? '编辑模型' : '添加模型'} title={name || '新模型'} icon={Bot} onClose={onClose}
    footer={<div className="form-actions">{error && <span className="form-error">{error}</span>}{initial && <Button onClick={test} disabled={testing || busy}>{testing ? '测试中…' : '测试连通'}</Button>}<Button onClick={onClose}>取消</Button><Button kind="primary" onClick={submit} disabled={busy}>{busy ? '保存中…' : '保存'}</Button></div>}>
    <div className="form-body">
      <div className="form-row"><Field label="显示名称"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} autoFocus /></Field><Field label="Provider"><select className={selectCls} value={provider} onChange={e => setProvider(e.target.value)}><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="claude">Claude (兼容)</option></select></Field></div>
      <Field label="模型 ID"><input className={inputCls} value={model} onChange={e => setModel(e.target.value)} placeholder="gpt-4o-mini / deepseek-chat / …" /></Field>
      <Field label="Base URL（OpenAI 兼容）"><input className={inputCls} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" /></Field>
      <Field label="API Key"><input className={inputCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={keyPlaceholder} /></Field>
      {testResult && <div className="form-error" style={{ color: testResult.startsWith('连接成功') ? '#5a7d6a' : undefined }}>{testResult}</div>}
      <div className="form-row"><Field label="Temperature"><input className={inputCls} type="number" step="0.05" value={temperature} onChange={e => setTemperature(e.target.value)} /></Field><Field label="Max tokens"><input className={inputCls} type="number" value={maxTokens} onChange={e => setMaxTokens(e.target.value)} /></Field></div>
      <div className="setting-row" style={{ paddingLeft: 0, paddingRight: 0 }}><span><strong>设为当前使用模型</strong><small>同一时刻仅一个模型生效</small></span><button className={'toggle ' + (isActive ? 'on' : '')} onClick={() => setIsActive(v => !v)}><i /></button></div>
    </div>
  </Modal>
}

function ExportSection({ workspace }: { workspace: Workspace }) {
  const { novel } = workspace
  const [busy, setBusy] = useState('')
  const download = async (format: 'txt' | 'markdown') => {
    setBusy(format)
    try {
      const blob = await workspaceApi.exportNovel(novel.id, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${novel.title}.${format === 'markdown' ? 'md' : 'txt'}`; a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ } finally { setBusy('') }
  }
  return <Scroll><PageHeader eyebrow="导出" title="导出作品" desc={`将《${novel.title}》导出为本地文件，共 ${workspace.chapters.length} 章。`} />
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 12 }}>
      <div className="config-card"><span className="cfg-icon"><FileText size={18} /></span><div className="cfg-body"><strong>纯文本 TXT</strong><small>适合投稿、备份与外部排版工具</small></div><Button kind="primary" onClick={() => download('txt')} disabled={!!busy}>{busy === 'txt' ? '导出中…' : '导出 TXT'}</Button></div>
      <div className="config-card"><span className="cfg-icon"><FileText size={18} /></span><div className="cfg-body"><strong>Markdown</strong><small>章节带标题层级，适合发布与版本管理</small></div><Button onClick={() => download('markdown')} disabled={!!busy}>{busy === 'markdown' ? '导出中…' : '导出 Markdown'}</Button></div>
    </div>
  </Scroll>
}

function DataSection({ reload }: { reload: () => Promise<void> }) {
  const [info, setInfo] = useState<StorageInfo | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const hasNativePicker = !!window.mojingDesktop?.chooseDataDir

  const loadInfo = async () => { try { setInfo(await workspaceApi.getStorage()) } catch { /* ignore */ } }
  useEffect(() => { void loadInfo() }, [])

  const apply = async (dir: string) => {
    setBusy(true); setError('')
    try {
      await workspaceApi.setStoragePath(dir)
      await loadInfo()
      await reload()
      setEditing(false)
    } catch (e) { setError(e instanceof Error ? e.message : '切换路径失败') } finally { setBusy(false) }
  }
  const reset = async () => {
    setBusy(true); setError('')
    try { await workspaceApi.resetStorage(); await loadInfo(); await reload() }
    catch (e) { setError(e instanceof Error ? e.message : '恢复失败') } finally { setBusy(false) }
  }

  const sizeLabel = info ? (info.db_size_kb >= 1024 ? `${(info.db_size_kb / 1024).toFixed(1)} MB` : `${info.db_size_kb} KB`) : '—'
  return <Scroll>
    <PageHeader eyebrow="本地存储" title="数据与备份" desc="所有创作数据都保存在本地 SQLite，无需联网。可自定义保存位置。" />
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 12 }}>
      {error && <div style={{ color: '#a3483f', fontSize: 11 }}>{error}</div>}
      <div className="setting-block">
        <header><h2>数据保存位置</h2><p>默认保存在程序目录下的「墨境数据」文件夹，可改为任意位置（含数据会被一并迁移过去）。</p></header>
        <section>
          <div className="database-card">
            <span><Database size={20} /></span>
            <div>
              <strong>{info?.db_file ?? 'mojing.db'} · {sizeLabel}</strong>
              <p style={{ wordBreak: 'break-all' }}>{info?.data_dir ?? '读取中…'}</p>
              <small><Check size={11} />{info?.is_default ? '当前为默认位置' : '自定义位置'}{info && !info.is_default && ' · 可恢复默认'}</small>
            </div>
            <Button onClick={() => setEditing(true)}><HardDrive size={13} />选择保存路径</Button>
            {info && !info.is_default && <Button kind="ghost" onClick={reset} disabled={busy}>恢复默认</Button>}
          </div>
        </section>
      </div>
      <div className="setting-block">
        <header><h2>默认路径</h2><p>未自定义时，数据保存在这里。</p></header>
        <section><div className="config-card"><span className="cfg-icon"><HardDrive size={18} /></span><div className="cfg-body"><strong>墨境数据（默认）</strong><small style={{ wordBreak: 'break-all' }}>{info?.default_dir ?? '—'}</small></div></div></section>
      </div>
    </div>
    {editing && info && <PathForm defaultPath={info.data_dir} hasNativePicker={hasNativePicker} onClose={() => setEditing(false)} onApply={apply} busy={busy} />}
  </Scroll>
}

function PathForm({ defaultPath, hasNativePicker, onClose, onApply, busy }: { defaultPath: string; hasNativePicker: boolean; onClose: () => void; onApply: (dir: string) => void; busy: boolean }) {
  const [dir, setDir] = useState(defaultPath)
  const browse = async () => {
    const picked = await chooseDataDirectory(dir)
    if (picked) setDir(picked)
  }
  return <Modal eyebrow="自定义保存路径" title="选择数据保存位置" icon={HardDrive} onClose={onClose}
    footer={<div className="form-actions"><Button onClick={onClose}>取消</Button><Button kind="primary" onClick={() => onApply(dir.trim())} disabled={busy || !dir.trim()}>{busy ? '迁移中…' : '保存并迁移数据'}</Button></div>}>
    <div className="form-body">
      <Field label="数据文件夹路径"><textarea className={areaCls} value={dir} onChange={e => setDir(e.target.value)} rows={2} /></Field>
      {hasNativePicker
        ? <Button onClick={browse}><MapPin size={13} />浏览文件夹…</Button>
        : <small className="safe-note"><ShieldCheck size={13} />浏览器开发模式下请直接粘贴路径；桌面版可点击浏览选择文件夹。</small>}
      <small style={{ color: '#969994', lineHeight: 1.7 }}>切换后，当前数据库会被复制到新位置并立即生效。原位置的数据不会被删除（可作为备份）。</small>
    </div>
  </Modal>
}

function AboutSection() {
  return <Scroll><PageHeader eyebrow="关于" title="墨境 Mojing" desc="本地优先的 AI 小说创作工作台。" />
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 12 }}>
      <div className="config-card"><span className="cfg-icon"><Feather size={18} /></span><div className="cfg-body"><strong>墨境 0.3.0</strong><small>Electron + FastAPI + React · SQLite 本地存储</small></div></div>
      <div className="config-card"><span className="cfg-icon"><BrainCircuit size={18} /></span><div className="cfg-body"><strong>核心功能</strong><small>多作品管理 · 章节版本 · 角色 / 地点 / 世界观 / 伏笔 · AI 续写（多模型）</small></div></div>
    </div>
  </Scroll>
}
