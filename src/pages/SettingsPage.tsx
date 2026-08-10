import { useEffect, useState, type ElementType } from 'react'
import {
  Bot, BrainCircuit, Check, CircleHelp, Database, Download, Feather,
  FileText, HardDrive, MapPin, PenLine, Plus, RefreshCw, Settings, ShieldCheck, Trash2,
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
  return <div className="settings-page">
    <aside>
      <UpdateBanner />
      <div><label>应用偏好</label><strong>设置</strong></div><nav>{sections.map(([Icon, text], i) => { const I = Icon; return <button className={active === text ? 'active' : ''} key={text} onClick={() => setActive(text)}><I size={15} />{text}</button> })}</nav>
    </aside>
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
  // Model list fetched from the provider (with context windows) for the picker.
  const [models, setModels] = useState<{ id: string; context_length: number | null }[] | null>(null)
  const [manualModel, setManualModel] = useState(false)
  const [contextLength, setContextLength] = useState<number | null>(initial?.context_length ?? null)
  // Which preset template filled the form (purely a form convenience).
  const [preset, setPreset] = useState('custom')
  const { busy, error, run } = useAsyncAction()

  const applyPreset = (p: { key: string; label: string; provider: string; base_url: string; model: string }) => {
    setPreset(p.key)
    setName(p.label)
    setProvider(p.provider)
    setBaseUrl(p.base_url)
    setModel(p.model)
    setModels(null)
    setManualModel(false)
  }
  const submit = () => run(async () => {
    const data: Record<string, unknown> = { name: name.trim() || '默认模型', provider, model, base_url: baseUrl, temperature: Number(temperature) || 0.85, max_tokens: Number(maxTokens) || 1200, is_active: isActive }
    // Model context comes from the provider's /models metadata; null = unknown.
    data.context_length = contextLength
    // Only send the key when the user typed something — otherwise it's left
    // untouched on the server (api_key omitted => no change).
    if (apiKey !== '') data.api_key = apiKey
    if (initial) await workspaceApi.updateAIConfig(initial.id, data); else await workspaceApi.createAIConfig({ ...data, api_key: apiKey })
    onSaved()
  })
  // Fetch the provider's model list so the user picks instead of typing an id.
  const fetchModels = async () => {
    setTesting(true); setTestResult('')
    try {
      const res = await workspaceApi.listAIModels({ base_url: baseUrl, api_key: apiKey || undefined, config_id: initial?.id })
      if (!res.ok) { setTestResult(res.detail); setModels(null); return }
      setModels(res.models ?? [])
      setManualModel(false)
      const current = res.models?.find(m => m.id === model)
      if (current) setContextLength(current.context_length)
      setTestResult(res.detail)
    } catch (e) { setTestResult(e instanceof Error ? e.message : '获取模型列表失败') } finally { setTesting(false) }
  }
  const pickModel = (id: string) => {
    setModel(id)
    const m = models?.find(x => x.id === id)
    setContextLength(m?.context_length ?? null)
  }
  const fmtContext = (n: number | null) => n ? (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : String(n)) : null
  const keyPlaceholder = initial?.has_key ? `已保存（${initial.key_hint}），留空保持不变` : 'sk-…'
  return <Modal eyebrow={initial ? '编辑模型' : '添加模型'} title={name || '新模型'} icon={Bot} onClose={onClose}
    footer={<div className="form-actions">{error && <span className="form-error">{error}</span>}<Button onClick={onClose}>取消</Button><Button kind="primary" onClick={submit} disabled={busy}>{busy ? '保存中…' : '保存'}</Button></div>}>
    <div className="form-body">
      <Field label="服务商预设（自动填写地址与模型，可再修改）">
        <div className="segments">
          <button className={preset === 'custom' ? 'active' : ''} onClick={() => setPreset('custom')}>自定义</button>
          <button className={preset === 'opencode' ? 'active' : ''} onClick={() => applyPreset({ key: 'opencode', label: 'OpenCode Zen', provider: 'opencode', base_url: 'https://opencode.ai/zen/go/v1', model: 'opencode/deepseek-v4-flash' })}>OpenCode Zen</button>
          <button className={preset === 'openai' ? 'active' : ''} onClick={() => applyPreset({ key: 'openai', label: 'OpenAI', provider: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' })}>OpenAI</button>
          <button className={preset === 'deepseek' ? 'active' : ''} onClick={() => applyPreset({ key: 'deepseek', label: 'DeepSeek', provider: 'deepseek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' })}>DeepSeek</button>
        </div>
      </Field>
      <div className="form-row"><Field label="显示名称"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} autoFocus /></Field><Field label="Provider"><select className={selectCls} value={provider} onChange={e => setProvider(e.target.value)}><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="opencode">OpenCode Zen</option><option value="claude">Claude (兼容)</option></select></Field></div>
      {models && !manualModel ? (
        <Field label="模型 ID（来自平台列表）">
          <div className="model-picker">
            <select className={selectCls} value={model} onChange={e => pickModel(e.target.value)}>
              {models.map(m => <option key={m.id} value={m.id}>{m.id}{fmtContext(m.context_length) ? ` · 上下文 ${fmtContext(m.context_length)}` : ''}</option>)}
            </select>
            <Button onClick={() => setManualModel(true)}>手动输入</Button>
          </div>
        </Field>
      ) : (
        <Field label="模型 ID"><input className={inputCls} value={model} onChange={e => setModel(e.target.value)} placeholder="opencode/gpt-5.5 · opencode/deepseek-v4-flash · gpt-4o-mini · deepseek-chat" /></Field>
      )}
      {contextLength ? <div className="model-context">该模型上下文窗口：<b>{fmtContext(contextLength)}</b> tokens（来自平台默认设置）</div> : null}
      <Field label="Base URL（OpenAI 兼容）"><input className={inputCls} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://opencode.ai/zen/go/v1" /></Field>
      <Field label="API Key"><input className={inputCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={keyPlaceholder} /></Field>
      <div className="ai-fetch-row"><Button onClick={fetchModels} disabled={testing || busy}><Bot size={13} />{testing ? '获取中…' : '测试并获取模型列表'}</Button><span>{testResult || '连接平台后自动拉取可用模型与上下文窗口'}</span></div>
      <div className="form-row"><Field label="Temperature"><input className={inputCls} type="number" step="0.05" value={temperature} onChange={e => setTemperature(e.target.value)} /></Field><Field label="Max tokens"><input className={inputCls} type="number" value={maxTokens} onChange={e => setMaxTokens(e.target.value)} /></Field></div>
      <div className="setting-row" style={{ paddingLeft: 0, paddingRight: 0 }}><span><strong>设为当前使用模型</strong><small>同一时刻仅一个模型生效</small></span><button className={'toggle ' + (isActive ? 'on' : '')} onClick={() => setIsActive(v => !v)}><i /></button></div>
    </div>
  </Modal>
}

function ExportSection({ workspace }: { workspace: Workspace }) {
  const { novel } = workspace
  const [busy, setBusy] = useState('')
  const download = async (format: 'txt' | 'markdown' | 'docx') => {
    setBusy(format)
    try {
      const blob = await workspaceApi.exportNovel(novel.id, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const ext = format === 'markdown' ? 'md' : format
      a.href = url; a.download = `${novel.title}.${ext}`; a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ } finally { setBusy('') }
  }
  return <Scroll><PageHeader eyebrow="导出" title="导出作品" desc={`将《${novel.title}》导出为本地文件，共 ${workspace.chapters.length} 章。`} />
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 12 }}>
      <div className="config-card"><span className="cfg-icon"><FileText size={18} /></span><div className="cfg-body"><strong>Word 文档 DOCX</strong><small>带章节标题层级，适合投稿与排版（#5 新增）</small></div><Button kind="primary" onClick={() => download('docx')} disabled={!!busy}>{busy === 'docx' ? '导出中…' : '导出 DOCX'}</Button></div>
      <div className="config-card"><span className="cfg-icon"><FileText size={18} /></span><div className="cfg-body"><strong>纯文本 TXT</strong><small>适合投稿、备份与外部排版工具</small></div><Button onClick={() => download('txt')} disabled={!!busy}>{busy === 'txt' ? '导出中…' : '导出 TXT'}</Button></div>
      <div className="config-card"><span className="cfg-icon"><FileText size={18} /></span><div className="cfg-body"><strong>Markdown</strong><small>章节带标题层级，适合发布与版本管理</small></div><Button onClick={() => download('markdown')} disabled={!!busy}>{busy === 'markdown' ? '导出中…' : '导出 Markdown'}</Button></div>
    </div>
  </Scroll>
}

function DataSection({ reload }: { reload: () => Promise<void> }) {
  const [info, setInfo] = useState<StorageInfo | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [backups, setBackups] = useState<{ name: string; size_kb: number; modified: string }[]>([])
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState('')
  const hasNativePicker = !!window.mojingDesktop?.chooseDataDir

  const loadInfo = async () => { try { setInfo(await workspaceApi.getStorage()) } catch { /* ignore */ } }
  const loadBackups = async () => { try { setBackups((await workspaceApi.listBackups()).backups) } catch { /* ignore */ } }
  useEffect(() => { void loadInfo(); void loadBackups() }, [])

  const doBackup = async () => {
    setBackupBusy(true); setBackupMsg('')
    try {
      const r = await workspaceApi.createBackup()
      setBackupMsg(`已创建备份 ${r.name}（${r.size_kb} KB）`)
      await loadBackups()
    } catch { setBackupMsg('备份失败，请稍后重试') } finally { setBackupBusy(false) }
  }

  const apply = async (dir: string) => {
    setBusy(true); setError('')
    try {
      const res = await workspaceApi.setStoragePath(dir)
      await loadInfo()
      await reload()
      setEditing(false)
      if ((res as { mounted_existing?: boolean }).mounted_existing) {
        setError('注意：所选目录已存在数据库，已打开该数据（未覆盖当前作品）。如需覆盖请先手动删除目标目录的 mojing.db。')
      }
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
      <div className="setting-block">
        <header><h2>自动备份</h2><p>每次启动与每天首次写作自动创建滚动备份（保留最近 10 份），防止文件损坏或误删丢失全部作品。</p></header>
        <section>
          <div className="database-card">
            <span><ShieldCheck size={20} /></span>
            <div>
              <strong>{backups.length > 0 ? `已有 ${backups.length} 份备份` : '暂无备份记录'}</strong>
              <p>最近备份：{backups[0]?.modified ?? '—'}{backups[0] ? ` · ${backups[0].size_kb} KB` : ''}</p>
              <small>{backupMsg || '点击右侧按钮立即创建一份备份。'}</small>
            </div>
            <Button onClick={doBackup} disabled={backupBusy}>{backupBusy ? '备份中…' : '立即备份'}</Button>
          </div>
          {backups.length > 0 && <div className="backup-list">{backups.map(b => <div key={b.name}><span>{b.name}</span><small>{b.modified}</small><small>{b.size_kb} KB</small></div>)}</div>}
        </section>
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

/** Auto-update banner (#10): shown when the desktop shell reports a downloaded
 *  update. Dev/browser has no mojingDesktop bridge, so it renders nothing. */
function UpdateBanner() {
  const [status, setStatus] = useState<{ state: string; version: string } | null>(null)
  useEffect(() => {
    const unsub = window.mojingDesktop?.onUpdateStatus?.(setStatus)
    return () => { unsub?.() }
  }, [])
  if (!status || status.state !== 'downloaded') return null
  return <div className="update-banner">
    <RefreshCw size={15} />
    <span>新版本 <b>{status.version}</b> 已下载，重启后生效。</span>
    <Button kind="primary" onClick={() => { void window.mojingDesktop?.installUpdate?.() }}><RefreshCw size={13} />重启更新</Button>
  </div>
}
