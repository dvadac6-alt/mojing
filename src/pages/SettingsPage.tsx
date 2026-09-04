import { useCallback, useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'
import {
  BarChart3, Bot, Check, CircleHelp, Database, Download, HardDrive, MapPin, Moon, Palette, PenLine, Plus, RefreshCw, Settings, ShieldCheck, Sun, Trash2, Upload,
} from 'lucide-react'
import {
  chooseDataDirectory, workspaceApi,
  type AIConfig, type StorageInfo, type Workspace,
} from '../workspaceApi'
import {
  AUTOSAVE_MS_STEPS, EDITOR_FONT_STEPS, readAutosaveMs, readEditorFont, readFocusGoal,
  readPresenceGap, writeAutosaveMs, writeEditorFont, writeFocusGoal, writePresenceGap,
} from '../lib/constants'
import { useTheme } from '../hooks/useTheme'
import { areaCls, fmt, inputCls, selectCls } from '../lib/constants'
import { Button, Field, FormFooter, Modal, PageHeader, Scroll } from '../components/ui'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { confirmDialog } from '../components/Confirm'
import { toast } from '../components/Toast'

export function SettingsPage({ workspace, reload }: { workspace: Workspace; reload: () => Promise<void> }) {
  const sections: [ElementType, string][] = [[Settings, '通用'], [Palette, '外观'], [Bot, 'AI 模型'], [BarChart3, '使用统计'], [Download, '导出'], [HardDrive, '数据与备份'], [CircleHelp, '关于']]
  const [active, setActive] = useState('AI 模型')
  return <div className="settings-page">
    <aside>
      <UpdateBanner />
      <div><label>应用偏好</label><strong>设置</strong></div><nav>{sections.map(([Icon, text]) => { const I = Icon; return <button className={active === text ? 'active' : ''} key={text} onClick={() => setActive(text)}><I size={15} />{text}</button> })}</nav>
    </aside>
    <section>
      {active === 'AI 模型' && <AISection onSaved={reload} />}
      {active === '使用统计' && <UsageStatsSection />}
      {active === '导出' && <ExportSection workspace={workspace} />}
      {active === '通用' && <GeneralSection />}
      {active === '外观' && <AppearanceSection />}
      {active === '数据与备份' && <DataSection reload={reload} />}
      {active === '关于' && <AboutSection />}
    </section>
  </div>
}

/** 设置卡片：标题/说明放进卡片内，与行内容共用同一内边距，左右边缘严格对齐。 */
function PrefCard({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return <section className="pref-card">
    <header><h2>{title}</h2><p>{desc}</p></header>
    {children}
  </section>
}

/** 偏好设置行：左侧标题+单行说明，右侧控件（grid 布局，控件永不换行掉到文字下方）。 */
function PrefRow({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return <div className="pref-row">
    <div className="pref-label"><strong>{label}</strong>{hint && <small>{hint}</small>}</div>
    {children && <div className="pref-ctrl">{children}</div>}
  </div>
}

/** 通用设置：跨作品的全局偏好（存于本机 localStorage，不上传）。 */
function GeneralSection() {
  const [gap, setGap] = useState(readPresenceGap)
  const [autosave, setAutosave] = useState(readAutosaveMs)
  const [goal, setGoal] = useState(readFocusGoal)
  const changeGap = (delta: number) => {
    const next = Math.max(1, Math.min(99, gap + delta))
    setGap(next)
    writePresenceGap(next)
  }
  const changeAutosave = (ms: number) => { setAutosave(ms); writeAutosaveMs(ms) }
  const changeGoal = (delta: number) => { const next = Math.max(100, goal + delta); setGoal(next); writeFocusGoal(next) }
  return <Scroll>
    <div style={{ maxWidth: 'min(720px, 100%)', margin: '0 auto' }}>
      <PageHeader eyebrow="应用偏好" title="通用设置" desc="这些设置只保存在当前设备，不上传任何数据。" />
      <div className="pref-list">
        <PrefCard title="角色登场提醒" desc="角色超过阈值章数未在正文登场时，概览页与角色列表会标记提醒。">
          <PrefRow label="空窗提醒阈值" hint={`当前 ${gap} 章，也可在角色页单独调整`}>
            <div className="pref-stepper" role="group" aria-label="空窗提醒阈值">
              <button onClick={() => changeGap(1)} aria-label="增加一章">＋</button>
              <span className="pref-value">{gap}<small>章</small></span>
              <button onClick={() => changeGap(-1)} aria-label="减少一章" disabled={gap <= 1}>－</button>
            </div>
          </PrefRow>
        </PrefCard>
        <PrefCard title="保存与专注" desc="停稿落盘节奏，以及进入专注模式时的默认字数目标。">
          <PrefRow label="自动保存间隔" hint="停稿后多久落盘；切换章节或关窗时立即补存">
            <div className="pref-segments" role="group" aria-label="自动保存间隔">
              {AUTOSAVE_MS_STEPS.map(ms => (
                <button key={ms} className={autosave === ms ? 'active' : ''} onClick={() => changeAutosave(ms)}>
                  {ms / 1000} 秒
                </button>
              ))}
            </div>
          </PrefRow>
          <PrefRow label="专注目标" hint="写作页按 F4 进入专注模式后的本次默认字数目标">
            <div className="pref-stepper" role="group" aria-label="专注目标字数">
              <button onClick={() => changeGoal(-500)} aria-label="减少 500 字" disabled={goal <= 100}>－</button>
              <span className="pref-value">{goal}<small>字</small></span>
              <button onClick={() => changeGoal(500)} aria-label="增加 500 字">＋</button>
            </div>
          </PrefRow>
        </PrefCard>
        <div className="pref-note">
          <ShieldCheck size={14} />
          所有作品数据保存在本地 SQLite（见「数据与备份」）；本页偏好仅写入浏览器 localStorage，不随作品迁移。
        </div>
      </div>
    </div>
  </Scroll>
}

/** 外观设置：界面主题与正文显示。 */
function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const [font, setFont] = useState(readEditorFont)
  const changeFont = (size: number) => { setFont(size); writeEditorFont(size) }
  return <Scroll>
    <div style={{ maxWidth: 'min(720px, 100%)', margin: '0 auto' }}>
      <PageHeader eyebrow="界面" title="外观设置" desc="主题与正文显示，改动立即生效。" />
      <div className="pref-list">
        <PrefCard title="界面外观" desc="已打开的写作页下次进入时刷新为最新字号。">
          <PrefRow label="正文字号" hint="小 14 · 标准 15 · 大 17">
            <div className="pref-segments" role="group" aria-label="正文字号">
              {EDITOR_FONT_STEPS.map(size => (
                <button key={size} className={font === size ? 'active' : ''} onClick={() => changeFont(size)}>
                  {size === 14 ? '小' : size === 15 ? '标准' : '大'}
                </button>
              ))}
            </div>
          </PrefRow>
          <PrefRow label="界面主题" hint="与标题栏切换按钮实时同步">
            <div className="theme-switch" role="group" aria-label="切换昼夜主题">
              <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}><Sun size={13} /><span>白天</span></button>
              <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}><Moon size={13} /><span>夜间</span></button>
            </div>
          </PrefRow>
        </PrefCard>
      </div>
    </div>
  </Scroll>
}

function AISection({ onSaved }: { onSaved: () => Promise<void> }) {
  const [configs, setConfigs] = useState<AIConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AIConfig | null>(null)
  const [creating, setCreating] = useState(false)
  const [meta, setMeta] = useState<{ offline_fallback: boolean } | null>(null)
  const load = async () => {
    setLoading(true)
    try {
      // 并行拉取：配置列表与模型元信息互不依赖。
      const [cfgs, m] = await Promise.all([workspaceApi.listAIConfigs(), workspaceApi.aiModels()])
      setConfigs(cfgs); setMeta(m)
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const setActive = async (cfg: AIConfig) => { await workspaceApi.updateAIConfig(cfg.id, { is_active: true }); await load(); await onSaved() }
  // ── RAG 索引状态（RAG设计方案.md §七，v2 与写作模型解耦为独立分区）──
  const [rag, setRag] = useState<RagStatus | null>(null)
  const [rebuilding, setRebuilding] = useState(false)
  const loadRag = async () => { try { setRag(await workspaceApi.ragStatus()) } catch { /* ignore */ } }
  useEffect(() => { void loadRag() }, [configs])
  const rebuild = async () => {
    setRebuilding(true)
    try { await workspaceApi.ragRebuild(); await loadRag() } finally { setRebuilding(false) }
  }
  const remove = async (cfg: AIConfig) => { const ok = await confirmDialog({ title: '删除模型配置', message: `删除「${cfg.name}」的配置？已保存的 API Key 将一并清除。`, danger: true, confirmLabel: '删除' }); if (ok) { await workspaceApi.deleteAIConfig(cfg.id); await load() } }
  return <Scroll>
    <div style={{ maxWidth: 'min(720px, 100%)', margin: '0 auto' }}>
      <PageHeader eyebrow="AI 调度" title="AI 模型" desc="写作模型负责生成正文，RAG 模型负责向量化检索；两个分区可用不同厂商。" actions={<>
        <Button onClick={async () => { try { const r = await workspaceApi.exportAIEnv(); if (r.ok) toast.success(`已同步到 ${r.path}`); else toast.error(r.detail) } catch (e) { toast.error('同步失败：' + (e instanceof Error ? e.message : '')) } }}><Download size={14} />同步到 .env</Button>
      </>} />
      <div className="pref-list">
      <div className="pref-note" style={{ marginBottom: 0 }}>
        <ShieldCheck size={14} />
        {meta?.offline_fallback && '已启用离线兜底：未配置可用密钥时，AI 面板仍可生成示例草稿。'} API Key 加密存储于本地，永不下发至前端。点「同步到 .env」可把当前配置（含 Key 明文）写入项目根目录的 .env 文件，方便备份与查看。
      </div>

      {/* 分区一：RAG 模型 API —— 单行内联表单，无需弹窗 */}
      <PrefCard title="RAG 模型 API" desc="Embedding 向量检索服务（前文检索 / 资料库 / 语义搜索），与写作模型相互独立。">
        <RagInlineForm rag={rag} rebuilding={rebuilding} onRebuild={rebuild} onSaved={loadRag} />
      </PrefCard>

      {/* 分区二：写作模型 API —— 卡片列表 + 添加/编辑弹窗（完整表单） */}
      <PrefCard title="写作模型 API" desc="配置 OpenAI 兼容的模型（GPT / DeepSeek / Claude 兼容端点）。未配置时将自动使用本地离线生成。">
        <div className="settings-config-list">
          {loading && <p style={{ color: '#999', fontSize: 11 }}>读取配置…</p>}
          {!loading && configs.length === 0 && <div className="empty-state"><span><Bot size={22} /></span><h3>还没有配置模型</h3><p>添加一个 OpenAI 兼容模型以启用真实 AI 续写；在此之前将使用离线生成。</p><Button kind="primary" onClick={() => setCreating(true)}><Plus size={14} />添加模型</Button></div>}
          {configs.map(cfg => <div className={'config-card' + (cfg.is_active ? ' active' : '')} key={cfg.id}>
            <span className="cfg-icon"><Bot size={18} /></span>
            <div className="cfg-body"><strong>{cfg.name} · {cfg.model}</strong><small>{cfg.base_url || '无 base_url'} · temperature {cfg.temperature} · max {cfg.max_tokens}</small></div>
            {cfg.is_active ? <span className="badge">当前</span> : <Button onClick={() => void setActive(cfg)}>设为当前</Button>}
            <Button onClick={() => setEditing(cfg)}><PenLine size={13} />编辑</Button>
            <button className="icon-button" onClick={() => void remove(cfg)}><Trash2 size={15} /></button>
          </div>)}
          <button className="add-config-btn" onClick={() => setCreating(true)}><Plus size={14} />添加写作模型</button>
        </div>
      </PrefCard>
      </div>
    </div>
    {creating && <AIConfigForm onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await load() }} />}
    {editing && <AIConfigForm initial={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load() }} />}
  </Scroll>
}

type RagStatus = { enabled: boolean; embed_model: string; chunks: { total: number; chapter: number; library: number; pending: number }; stale_model_chunks: number }

/** 使用统计（设置 → 使用统计）：跨作品的 AI 用量总账。
 *  总量 / 输入缓存命中拆分 / 按模型分类表，另附每日消耗迷你柱图。 */
type UsageStats = {
  days: number
  totals: { calls: number; prompt: number; cached: number; uncached_input: number; completion: number; total: number }
  series: { date: string; total: number; calls: number; cached: number }[]
  by_model: { model: string; calls: number; prompt: number; cached: number; completion: number; total: number }[]
}

function UsageStatsSection() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<UsageStats | null>(null)
  const [loading, setLoading] = useState(true)
  const load = async (d: number) => {
    setLoading(true)
    try { setData(await workspaceApi.aiUsageStats(d)) } finally { setLoading(false) }
  }
  useEffect(() => { void load(days) }, [days])
  const t = data?.totals
  const maxDay = Math.max(1, ...(data?.series.map(s => s.total) ?? [1]))
  const hitPct = t && t.prompt > 0 ? Math.round((t.cached / t.prompt) * 100) : 0
  return <Scroll>
    <div style={{ maxWidth: 'min(720px, 100%)', margin: '0 auto' }}>
      <PageHeader eyebrow="AI 调度" title="使用统计" desc="全部作品的 AI 调用与 token 消耗总账，按模型分类；缓存命中是输入中享受折扣计费的部分。" />
      <div className="pref-list">
        <PrefCard title="用量总览" desc={`统计范围可切换，跨所有作品汇总。`}>
          <div className="usage-days">
            <div className="pref-segments" role="group" aria-label="统计范围">
              {[7, 30, 90].map(d => (
                <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>{d} 天</button>
              ))}
            </div>
          </div>
          {loading && !data && <p style={{ color: '#999', fontSize: 11, padding: '0 18px' }}>读取用量…</p>}
          {t && <>
            <div className="usage-stat-cards">
              <div className="usage-stat-card"><label>总消耗</label><strong>{fmt(t.total)}</strong><small>tokens · {fmt(t.calls)} 次调用</small></div>
              <div className="usage-stat-card"><label>输入</label><strong>{fmt(t.prompt)}</strong><small>tokens（提示词）</small></div>
              <div className="usage-stat-card hit"><label>缓存命中</label><strong>{fmt(t.cached)}</strong><small>占输入 {hitPct}%</small></div>
              <div className="usage-stat-card miss"><label>输入未缓存</label><strong>{fmt(t.uncached_input)}</strong><small>tokens</small></div>
              <div className="usage-stat-card"><label>输出</label><strong>{fmt(t.completion)}</strong><small>tokens（生成）</small></div>
            </div>
            <div className="usage-daily">
              <strong>每日消耗</strong>
              <div className="usage-daily-bars">
                {data.series.map(s => (
                  <div key={s.date} className="usage-daily-bar" title={`${s.date}：${fmt(s.total)} tokens · ${s.calls} 次 · 缓存命中 ${fmt(s.cached)}`}>
                    <span style={{ height: `${Math.max(2, Math.round((s.total / maxDay) * 100))}%` }} />
                  </div>
                ))}
              </div>
              <small>近 {data.series.length} 天 · 单日峰值 {fmt(maxDay)} tokens</small>
            </div>
          </>}
        </PrefCard>
        <PrefCard title="按模型分类" desc="输入拆分为缓存命中 / 未缓存两列；缓存命中通常按折扣计费（如 DeepSeek 约为原价 1/10）。">
          {data && data.by_model.length > 0
            ? <div className="usage-model-table">
              <header><span>模型</span><span>调用</span><span>输入</span><span>缓存命中</span><span>未缓存</span><span>输出</span><span>合计</span></header>
              {data.by_model.map(m => (
                <div key={m.model} className="usage-model-row">
                  <strong title={m.model}>{m.model}</strong>
                  <span>{fmt(m.calls)}</span>
                  <span>{fmt(m.prompt)}</span>
                  <span className="hit">{fmt(m.cached)}</span>
                  <span className="miss">{fmt(Math.max(0, m.prompt - m.cached))}</span>
                  <span>{fmt(m.completion)}</span>
                  <strong>{fmt(m.total)}</strong>
                </div>
              ))}
            </div>
            : !loading && <div className="empty-state" style={{ margin: '14px 18px' }}><h3>暂无用量记录</h3><p>使用 AI 续写、润色或生成简介后，这里会出现统计。</p></div>}
          <small className="usage-note">旧版本记录未上报缓存命中数，均计入「未缓存」列。</small>
        </PrefCard>
      </div>
    </div>
  </Scroll>
}

/** RAG embedding 配置（RAG设计方案.md §七）：与写作模型完全解耦的独立分区，
 *  压成一行内联表单——模型 / Base URL / Key 三个输入并排，保存与测试随行。 */
const RAG_PRESETS = [
  { key: 'siliconflow', label: '硅基流动（推荐）', base_url: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3' },
  { key: 'openai', label: 'OpenAI', base_url: 'https://api.openai.com/v1', model: 'text-embedding-3-small' },
]

function RagInlineForm({ rag, rebuilding, onRebuild, onSaved }: {
  rag: RagStatus | null
  rebuilding: boolean
  onRebuild: () => Promise<void>
  onSaved: () => Promise<void>
}) {
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [keyHint, setKeyHint] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  const { busy, error, run } = useAsyncAction()

  useEffect(() => {
    void workspaceApi.getRagConfig().then(cfg => {
      setModel(cfg.model); setBaseUrl(cfg.base_url)
      setHasKey(cfg.has_key); setKeyHint(cfg.key_hint)
    }).catch(() => {})
  }, [])

  const payload = () => {
    const data: { model?: string; base_url?: string; api_key?: string } = { model: model.trim(), base_url: baseUrl.trim() }
    if (apiKey !== '') data.api_key = apiKey
    return data
  }
  const submit = () => run(async () => {
    await workspaceApi.saveRagConfig(payload())
    setApiKey('')
    toast.success('RAG 配置已保存')
    await onSaved()
  })
  const test = async () => {
    setTesting(true); setTestResult('')
    try {
      const res = await workspaceApi.testRagConfig(payload())
      setTestResult(res.detail)
    } catch (e) { setTestResult(e instanceof Error ? e.message : '测试失败') } finally { setTesting(false) }
  }
  return <div className="rag-inline">
    <div className="segments" style={{ alignSelf: 'flex-start' }}>
      {RAG_PRESETS.map(p => <button key={p.key} className={baseUrl === p.base_url ? 'active' : ''} onClick={() => { setBaseUrl(p.base_url); setModel(p.model) }}>{p.label}</button>)}
    </div>
    <div className="rag-inline-row">
      <input className={inputCls} value={model} onChange={e => setModel(e.target.value)} placeholder="Embedding 模型 ID，如 BAAI/bge-m3" />
      <input className={inputCls} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="Base URL（需含 /v1/embeddings）" />
      <input className={inputCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={hasKey ? `Key 已保存（${keyHint}），留空保持` : 'API Key'} />
      <Button onClick={test} disabled={testing || busy || !model.trim() || !baseUrl.trim()}>{testing ? '测试中…' : '测试'}</Button>
      <Button kind="primary" onClick={submit} disabled={busy}>保存</Button>
    </div>
    {error && <div className="form-error">{error}</div>}
    {testResult && <div className="form-error" style={{ color: testResult.startsWith('连接成功') ? '#5a7d6a' : undefined }}>{testResult}</div>}
    <div className="rag-inline-status">
      {rag?.enabled
        ? <span>已启用 · 模型 {rag.embed_model} · 章节 {rag.chunks.chapter} 块 / 资料 {rag.chunks.library} 块{rag.chunks.pending ? ` · 待向量化 ${rag.chunks.pending}` : ''}</span>
        : <span>未启用——填写并保存后自动启用前文检索 / 资料库 / 语义搜索。</span>}
      {rag && rag.stale_model_chunks > 0 && <span className="rag-warn">检测到 {rag.stale_model_chunks} 块使用旧模型向量，请重建索引。</span>}
      <Button onClick={() => void onRebuild()} disabled={rebuilding || !rag?.enabled}>{rebuilding ? '重建中…' : '重建索引'}</Button>
    </div>
    <small style={{ color: 'var(--text-muted)', lineHeight: 1.7 }}>
      启用后切块文本将发送至该服务商做向量化；正文与索引仍完整保存在本地。
    </small>
  </div>
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
  const [maxTokens, setMaxTokens] = useState(String(initial?.max_tokens ?? 50000))
  const [isActive, setIsActive] = useState(initial?.is_active ?? false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  // Model list fetched from the provider (with context windows) for the picker.
  const [models, setModels] = useState<{ id: string; context_length: number | null }[] | null>(null)
  const [manualModel, setManualModel] = useState(false)
  // Multi-select: when adding (not editing) the user can tick several models and
  // they are all created in one go, each as its own switchable config.
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
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
    setSelectedModels(new Set())
  }
  const submit = () => run(async () => {
    // Batch create: multiple models ticked in the picker (add flow only).
    const batch = (!initial && models && !manualModel && selectedModels.size > 0) ? [...selectedModels] : null
    const base: Record<string, unknown> = { provider, base_url: baseUrl, temperature: Number(temperature) || 0.85, max_tokens: Number(maxTokens) || 50000, is_active: isActive }
    if (apiKey !== '') base.api_key = apiKey
    if (batch) {
      for (const mid of batch) {
        const m = models?.find(x => x.id === mid)
        await workspaceApi.createAIConfig({ ...base, name: mid, model: mid, context_length: m?.context_length ?? null, api_key: apiKey })
      }
      onSaved()
      return
    }
    const data: Record<string, unknown> = { ...base, name: name.trim() || '默认模型', model, context_length: contextLength }
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
      setSelectedModels(new Set())
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
  const toggleSelected = (id: string) => {
    setSelectedModels(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      // Keep the single `model` field in sync with the last-toggled for display.
      setModel(id)
      const m = models?.find(x => x.id === id)
      setContextLength(m?.context_length ?? null)
      return next
    })
  }
  const fmtContext = (n: number | null) => n ? (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : String(n)) : null
  const keyPlaceholder = initial?.has_key ? `已保存（${initial.key_hint}），留空保持不变` : 'sk-…'
  return <Modal eyebrow={initial ? '编辑模型' : '添加模型'} title={name || '新模型'} icon={Bot} onClose={onClose}
    footer={<FormFooter error={error} busy={busy} onClose={onClose} onSubmit={submit} />}>
    <div className="form-body">
      <Field label="服务商预设（自动填写地址与模型，可再修改）">
        <div className="segments">
          <button className={preset === 'custom' ? 'active' : ''} onClick={() => { setPreset('custom'); setName('自定义模型'); setProvider('openai'); setBaseUrl(''); setModel(''); setModels(null); setManualModel(false); setSelectedModels(new Set()) }}>自定义 API</button>
          <button className={preset === 'opencode' ? 'active' : ''} onClick={() => applyPreset({ key: 'opencode', label: 'OpenCode Go', provider: 'opencode', base_url: 'https://opencode.ai/zen/go/v1', model: 'opencode/deepseek-v4-flash' })}>OpenCode Go</button>
          <button className={preset === 'openai' ? 'active' : ''} onClick={() => applyPreset({ key: 'openai', label: 'OpenAI', provider: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' })}>OpenAI</button>
          <button className={preset === 'deepseek' ? 'active' : ''} onClick={() => applyPreset({ key: 'deepseek', label: 'DeepSeek', provider: 'deepseek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' })}>DeepSeek</button>
        </div>
      </Field>
      <div className="form-row"><Field label="显示名称"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} autoFocus /></Field><Field label="Provider"><select className={selectCls} value={provider} onChange={e => setProvider(e.target.value)}><option value="openai">OpenAI 兼容</option><option value="deepseek">DeepSeek</option><option value="opencode">OpenCode Go</option><option value="claude">Claude (兼容)</option><option value="custom">自定义</option></select></Field></div>
      {models && !manualModel ? (
        initial ? (
          // 编辑现有配置：单选下拉
          <Field label="模型 ID（来自平台列表）">
            <div className="model-picker">
              <select className={selectCls} value={model} onChange={e => pickModel(e.target.value)}>
                {models.map(m => <option key={m.id} value={m.id}>{m.id}{fmtContext(m.context_length) ? ` · 上下文 ${fmtContext(m.context_length)}` : ''}</option>)}
              </select>
              <Button onClick={() => setManualModel(true)}>手动输入</Button>
            </div>
          </Field>
        ) : (
          // 新建：多选勾选，可一次批量创建多个模型配置
          <Field label={`模型 ID（勾选要添加的，已选 ${selectedModels.size} 个）`}>
            <div className="model-multi">
              <div className="model-multi-list">
                {models.map(m => (
                  <label key={m.id} className={'model-multi-item' + (selectedModels.has(m.id) ? ' checked' : '')}>
                    <input type="checkbox" checked={selectedModels.has(m.id)} onChange={() => toggleSelected(m.id)} />
                    <span className="mm-id">{m.id}</span>
                    {fmtContext(m.context_length) && <small>{fmtContext(m.context_length)}</small>}
                  </label>
                ))}
              </div>
              <div className="model-multi-actions">
                <Button onClick={() => setSelectedModels(new Set(models.map(m => m.id)))}>全选</Button>
                <Button onClick={() => setSelectedModels(new Set())}>清空</Button>
                <Button onClick={() => setManualModel(true)}>手动输入单个</Button>
              </div>
            </div>
          </Field>
        )
      ) : (
        <Field label="模型 ID"><input className={inputCls} value={model} onChange={e => setModel(e.target.value)} placeholder="opencode/gpt-5.5 · opencode/deepseek-v4-flash · gpt-4o-mini · deepseek-chat" /></Field>
      )}
      {!initial && models && !manualModel && selectedModels.size > 0 && <div className="model-context">将创建 <b>{selectedModels.size}</b> 个模型配置，保存后可在生成时切换。</div>}
      {contextLength && (initial || selectedModels.size <= 1) && <div className="model-context">{selectedModels.size === 1 ? '选中模型' : '该模型'}上下文窗口：<b>{fmtContext(contextLength)}</b> tokens（来自平台默认设置）</div>}
      <Field label="Base URL（填到 /v1，后端自动拼接 /chat/completions）"><input className={inputCls} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://your-api.com/v1（标准 Chat Completions 格式）" /></Field>
      <Field label="API Key"><input className={inputCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={keyPlaceholder} /></Field>
      <div className="ai-fetch-row"><Button onClick={fetchModels} disabled={testing || busy}><Bot size={13} />{testing ? '获取中…' : '测试并获取模型列表'}</Button><span>{testResult || '连接平台后自动拉取可用模型与上下文窗口'}</span></div>
      <div className="form-row"><Field label="Temperature"><input className={inputCls} type="number" step="0.05" value={temperature} onChange={e => setTemperature(e.target.value)} /></Field><Field label="Max tokens"><input className={inputCls} type="number" value={maxTokens} onChange={e => setMaxTokens(e.target.value)} /></Field></div>
      <PrefRow label="设为当前使用模型" hint="同一时刻仅一个模型生效"><button className={'toggle ' + (isActive ? 'on' : '')} onClick={() => setIsActive(v => !v)} aria-label="设为当前使用模型"><i /></button></PrefRow>
    </div>
  </Modal>
}

function ExportSection({ workspace }: { workspace: Workspace }) {
  const { novel } = workspace
  const [busy, setBusy] = useState('')
  const download = async (format: 'txt' | 'markdown' | 'docx' | 'epub') => {
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
  return <Scroll>
    <div style={{ maxWidth: 'min(720px, 100%)', margin: '0 auto' }}>
      <PageHeader eyebrow="导出" title="导出作品" desc={`将《${novel.title}》导出为本地文件，共 ${workspace.chapters.length} 章。`} />
      <div className="pref-list">
        <PrefCard title="导出格式" desc="导出会包含全部章节正文与章节标题。">
          <PrefRow label="EPUB 电子书" hint="带目录与封面页，适合阅读器与手机阅读">
            <Button kind="primary" onClick={() => download('epub')} disabled={!!busy}>{busy === 'epub' ? '导出中…' : '导出'}</Button>
          </PrefRow>
          <PrefRow label="Word 文档 DOCX" hint="带章节标题层级，适合投稿与排版">
            <Button onClick={() => download('docx')} disabled={!!busy}>{busy === 'docx' ? '导出中…' : '导出'}</Button>
          </PrefRow>
          <PrefRow label="纯文本 TXT" hint="适合投稿、备份与外部排版工具">
            <Button onClick={() => download('txt')} disabled={!!busy}>{busy === 'txt' ? '导出中…' : '导出'}</Button>
          </PrefRow>
          <PrefRow label="Markdown" hint="章节带标题层级，适合发布与版本管理">
            <Button onClick={() => download('markdown')} disabled={!!busy}>{busy === 'markdown' ? '导出中…' : '导出'}</Button>
          </PrefRow>
        </PrefCard>
      </div>
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
  const [migrateBusy, setMigrateBusy] = useState(false)
  const [migrateMsg, setMigrateMsg] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
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
    // 切数据目录是重操作（迁移全部数据），先确认再执行。
    const ok = await confirmDialog({ title: '恢复默认路径', message: '将把数据目录切回默认位置并迁移现有数据，期间请勿关闭应用。确认继续？', confirmLabel: '恢复默认' })
    if (!ok) return
    setBusy(true); setError('')
    try { await workspaceApi.resetStorage(); await loadInfo(); await reload() }
    catch (e) { setError(e instanceof Error ? e.message : '恢复失败') } finally { setBusy(false) }
  }

  // Bundle the whole data dir into a zip and download it — for moving to
  // another machine or off-site backup. WAL is checkpointed server-side first
  // so the snapshot is consistent on its own.
  const doExport = async () => {
    setMigrateBusy(true); setMigrateMsg('')
    try {
      const blob = await workspaceApi.exportData()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mojing-backup-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      setMigrateMsg(`已导出 ${(blob.size / 1024 / 1024).toFixed(1)} MB 备份，可在另一台电脑用「导入备份」恢复。`)
    } catch (e) { setMigrateMsg(e instanceof Error ? e.message : '导出失败') } finally { setMigrateBusy(false) }
  }

  // Restore from a backup zip: the server extracts to a fresh sibling dir and
  // switches storage to it (the old data stays on disk, so a bad import is
  // revertible via "选择保存路径" → pick the previous folder).
  const doImport = async (file: File) => {
    setMigrateBusy(true); setMigrateMsg('')
    try {
      await workspaceApi.importData(file)
      await loadInfo()
      await reload()
      setMigrateMsg('导入成功，已切换到恢复的数据。当前作品列表已刷新。')
    } catch (e) { setMigrateMsg(e instanceof Error ? e.message : '导入失败') } finally {
      setMigrateBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const sizeLabel = info ? (info.db_size_kb >= 1024 ? `${(info.db_size_kb / 1024).toFixed(1)} MB` : `${info.db_size_kb} KB`) : '—'
  return <Scroll>
    <div style={{ maxWidth: 'min(720px, 100%)', margin: '0 auto' }}>
      <PageHeader eyebrow="本地存储" title="数据与备份" desc="所有创作数据都保存在本地 SQLite，无需联网。可自定义保存位置。" />
      <div className="pref-list">
      {error && <div style={{ color: '#a3483f', fontSize: 11 }}>{error}</div>}
      <PrefCard title="数据保存位置" desc="默认保存在程序目录下的「墨境数据」文件夹，可改为任意位置（含数据会被一并迁移过去）。">
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
      </PrefCard>
      <PrefCard title="默认路径" desc="未自定义时，数据保存在这里。">
        <div className="config-card"><span className="cfg-icon"><HardDrive size={18} /></span><div className="cfg-body"><strong>墨境数据（默认）</strong><small style={{ wordBreak: 'break-all' }}>{info?.default_dir ?? '—'}</small></div></div>
      </PrefCard>
      <PrefCard title="自动备份" desc="每次启动与每天首次写作自动创建滚动备份（保留最近 10 份），防止文件损坏或误删丢失全部作品。">
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
      </PrefCard>
      <PrefCard title="跨设备迁移" desc="把全部作品打包成一个 zip，拷到另一台电脑后用「导入备份」即可恢复（含所有章节、角色、地点、地图涂鸦、AI 配置）。">
        <div className="database-card">
          <span><Upload size={20} /></span>
          <div>
            <strong>导出 / 导入完整备份</strong>
            <p>{migrateMsg || '导出会先把数据库 WAL 落盘，确保快照自洽；导入会切到新数据目录，原数据保留可回退。'}</p>
          </div>
          <Button onClick={doExport} disabled={migrateBusy}>{migrateBusy ? '处理中…' : '导出备份'}</Button>
          <Button onClick={() => fileInputRef.current?.click()} disabled={migrateBusy}><Download size={13} />导入备份</Button>
          <input ref={fileInputRef} type="file" accept=".zip,application/zip" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) void doImport(f) }} />
        </div>
      </PrefCard>
      <WebDavSection />
      </div>
    </div>
    {editing && info && <PathForm defaultPath={info.data_dir} hasNativePicker={hasNativePicker} onClose={() => setEditing(false)} onApply={apply} busy={busy} />}
  </Scroll>
}

/** F12 WebDAV 自动备份：配置坚果云/NAS 等 WebDAV 目标，每日备份后自动上传，
 *  远端保留 keep 份轮换。密码加密落库，响应只回 has_password。 */
function WebDavSection() {
  const [cfg, setCfg] = useState<{ configured: boolean; url: string; username: string; has_password: boolean; keep: number } | null>(null)
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [keep, setKeep] = useState(5)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      const c = await workspaceApi.getWebdavConfig()
      setCfg(c); setUrl(c.url); setUsername(c.username); setKeep(c.keep)
    } catch { /* 静默：未配置 */ }
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async () => {
    setBusy('save'); setError(''); setMsg('')
    try {
      const saved = await workspaceApi.saveWebdavConfig({
        url: url.trim(), username: username.trim(),
        password: password || undefined, // 空 = 保留已存密码；清空走下方说明
        keep,
      })
      setCfg(saved); setPassword('')
      setMsg('配置已保存。建议点「测试连接」确认可用。')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally { setBusy('') }
  }

  const test = async () => {
    setBusy('test'); setError(''); setMsg('')
    try {
      const r = await workspaceApi.testWebdavConfig()
      if (r.ok) setMsg(r.detail)
      else setError(r.detail)
    } catch (e) {
      setError(e instanceof Error ? e.message : '测试失败')
    } finally { setBusy('') }
  }

  const upload = async () => {
    setBusy('upload'); setError(''); setMsg('')
    try {
      const r = await workspaceApi.uploadWebdavBackup()
      if (r.ok) setMsg(`已上传 ${r.name}（${r.size_kb} KB），远端按保留 ${keep} 份轮换。`)
      else setError(r.detail)
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally { setBusy('') }
  }

  return <PrefCard title="WebDAV 自动备份" desc="配置 WebDAV（坚果云、NAS 等）后，每天首次写作的自动备份会同步上传到云端；远端只保留最近几份，自动轮换。凭据加密保存在本地。">
    <div className="setting-pad">
      <div className="form-row">
        <Field label="WebDAV 地址"><input className={inputCls} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://dav.jianguoyun.com/dav/墨境备份/" /></Field>
        <Field label="用户名"><input className={inputCls} value={username} onChange={e => setUsername(e.target.value)} /></Field>
      </div>
      <div className="form-row">
        <Field label={cfg?.has_password ? '密码（已保存，留空保持不变）' : '密码 / 应用密码'}>
          <input className={inputCls} type="password" value={password} onChange={e => setPassword(e.target.value)} />
        </Field>
        <Field label="远端保留份数"><input className={inputCls} type="number" min={1} max={50} value={keep} onChange={e => setKeep(Number(e.target.value) || 5)} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        <Button kind="primary" onClick={() => void save()} disabled={!!busy}>{busy === 'save' ? '保存中…' : '保存配置'}</Button>
        <Button onClick={() => void test()} disabled={!!busy || !cfg?.configured}>{busy === 'test' ? '测试中…' : '测试连接'}</Button>
        <Button onClick={() => void upload()} disabled={!!busy || !cfg?.configured}>{busy === 'upload' ? '备份上传中…' : '立即备份并上传'}</Button>
        {msg && <small style={{ color: '#5c7a52' }}>{msg}</small>}
        {error && <small style={{ color: '#a3483f' }}>{error}</small>}
      </div>
    </div>
  </PrefCard>
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
  return <Scroll>
    <div style={{ maxWidth: 'min(720px, 100%)', margin: '0 auto' }}>
      <PageHeader eyebrow="关于" title="墨境 Mojing" desc="本地优先的 AI 小说创作工作台。" />
      <div className="pref-list">
        <PrefCard title="版本信息" desc="墨境 0.3.0 · Electron + FastAPI + React · SQLite 本地存储。">
          <PrefRow label="核心功能" hint="多作品管理 · 章节版本 · 角色 / 地点 / 世界观 / 伏笔 · 时间线 · 地图涂鸦" />
          <PrefRow label="AI 能力" hint="多模型切换 · 前文检索（RAG）· 续写 / 润色 / 多角色对话 · 离线兜底" />
        </PrefCard>
      </div>
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
