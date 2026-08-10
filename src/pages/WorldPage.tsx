import { useRef, useState } from 'react'
import { ChevronRight, GitBranch, Globe2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { streamAI, workspaceApi, type WorldSetting, type Workspace } from '../workspaceApi'
import { CATEGORY_TONES, areaCls, inputCls, selectCls } from '../lib/constants'
import { Button, Field, Modal, PageHeader, Scroll, SearchBox } from '../components/ui'
import { EmptyStateWrap } from '../components/ui'
import { useAsyncAction } from '../hooks/useAsyncAction'

/** Parse the AI's strict "名称/分类/描述" output into a world-setting draft. */
function parseSettingDraft(text: string): { name: string; category: string; description: string } {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const pick = (prefix: string) => {
    const line = lines.find(l => l.startsWith(prefix))
    return line ? line.slice(prefix.length).trim() : ''
  }
  let name = pick('名称：') || pick('名称:')
  let category = pick('分类：') || pick('分类:')
  let description = pick('描述：') || pick('描述:')
  // Fallbacks if the model didn't follow the strict format.
  if (!name) name = lines[0]?.slice(0, 40) || '未命名设定'
  if (!['世界规则', '势力分布', '历史背景', '法宝物品'].includes(category)) category = '世界规则'
  if (!description) description = lines.join('\n')
  return { name, category, description }
}

export function WorldPage({ workspace, reload }: { workspace: Workspace; reload: () => Promise<void> }) {
  const settings = workspace.world_settings
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('全部')
  const [editing, setEditing] = useState<WorldSetting | null>(null)
  const [creating, setCreating] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const categories = ['全部', ...Array.from(new Set(settings.map(s => s.category)))]
  const filtered = settings.filter(s => (filter === '全部' || s.category === filter) && (s.name.includes(query) || s.description.includes(query)))
  if (settings.length === 0) return <EmptyStateWrap icon={Globe2} title="还没有世界观设定" desc="维护规则、势力与物品，保持设定前后一致。" action={() => setCreating(true)} />
  return <Scroll><PageHeader eyebrow="设定资料" title="世界观" desc="集中维护规则、势力、历史与关键物品。" actions={<>
    <Button onClick={() => setAiOpen(true)}><Sparkles size={14} />AI 生成</Button>
    <Button kind="primary" onClick={() => setCreating(true)}><Plus size={14} />新建设定</Button>
  </>} />
    <div className="world-toolbar"><SearchBox text="搜索设定…" value={query} onChange={setQuery} /><div className="chips">{categories.map(c => <button key={c} className={filter === c ? 'active' : ''} onClick={() => setFilter(c)}>{c} {c !== '全部' && settings.filter(s => s.category === c).length}</button>)}</div></div>
    <div className="world-grid">{filtered.map(s => <article key={s.id} onClick={() => setEditing(s)} style={{ cursor: 'pointer' }}><span className={CATEGORY_TONES[s.category] ?? 'ink'}><Globe2 size={18} /></span><label>{s.category}</label><h2>{s.name}</h2><p>{s.description}</p><footer><GitBranch size={13} />点击编辑<ChevronRight size={14} /></footer></article>)}</div>
    {creating && <SettingForm novelId={workspace.novel.id} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await reload() }} />}
    {editing && <SettingForm novelId={workspace.novel.id} initial={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload() }} onDelete={async () => { await workspaceApi.deleteSetting(editing.id); setEditing(null); await reload() }} />}
    {aiOpen && <AiSettingModal novelId={workspace.novel.id} onClose={() => setAiOpen(false)} onSaved={async () => { setAiOpen(false); await reload() }} />}
  </Scroll>
}

/** AI 生成设定弹窗：输入大概意思 → 流式扩写 → 预览 → 保存为新设定。 */
function AiSettingModal({ novelId, onClose, onSaved }: { novelId: string; onClose: () => void; onSaved: () => void }) {
  const [idea, setIdea] = useState('')
  const [text, setText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const draft = text ? parseSettingDraft(text) : null

  const generate = async () => {
    if (!idea.trim() || generating) return
    setGenerating(true); setError(''); setText('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      for await (const chunk of streamAI('/ai/worldsetting', {
        novel_id: novelId,
        instruction: idea.trim(),
        mode: 'worldsetting',
        target_words: 300,
        context: { characters: false, locations: false, settings: true, threads: false, recent_chapters: 0 },
      }, controller.signal)) {
        setText(prev => prev + chunk.text)
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : 'AI 生成失败')
    } finally {
      setGenerating(false); abortRef.current = null
    }
  }

  const save = async () => {
    if (!draft) return
    await workspaceApi.createSetting(novelId, { name: draft.name, category: draft.category, description: draft.description })
    onSaved()
  }

  return <Modal eyebrow="AI 设定助手" title="AI 生成世界观设定" icon={Sparkles} onClose={() => { abortRef.current?.abort(); onClose() }}
    footer={<div className="form-actions">{error && <span className="form-error">{error}</span>}{text && <><span className="muted">可修改下方字段后再保存</span><Button onClick={generate} disabled={generating || !idea.trim()}>{generating ? '生成中…' : '重新生成'}</Button><Button kind="primary" onClick={save}>保存为新设定</Button></>}</div>}>
    <div className="form-body">
      <Field label="你的想法（大概意思）"><textarea className={areaCls} rows={3} value={idea} onChange={e => setIdea(e.target.value)} placeholder="例：写一个俊峰镇，是朝廷在雨夜里押送囚犯的中转站，镇上的人都不再点灯。" /></Field>
      {!text && <Button kind="primary" onClick={generate} disabled={generating || !idea.trim()}><Sparkles size={14} />{generating ? 'AI 扩写中…' : '开始 AI 扩写'}</Button>}
      {text && <>
        <div className="ai-draft-preview">
          <span>名称：<b>{draft?.name ?? '—'}</b></span>
          <span>分类：<b>{draft?.category ?? '—'}</b></span>
        </div>
        <Field label="生成内容（可编辑后保存）"><textarea className={areaCls} rows={9} value={text} onChange={e => setText(e.target.value)} /></Field>
      </>}
    </div>
  </Modal>
}

function SettingForm({ novelId, initial, onClose, onSaved, onDelete }: { novelId: string; initial?: WorldSetting; onClose: () => void; onSaved: () => void; onDelete?: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [category, setCategory] = useState(initial?.category ?? '世界规则')
  const [description, setDescription] = useState(initial?.description ?? '')
  const { busy, error, run } = useAsyncAction()
  const submit = () => run(async () => {
    const data = { name: name.trim() || '未命名设定', category, description }
    if (initial) await workspaceApi.updateSetting(initial.id, data); else await workspaceApi.createSetting(novelId, data)
    onSaved()
  })
  return <Modal eyebrow={initial ? '编辑设定' : '新建设定'} title={name || '新设定'} icon={Globe2} onClose={onClose}
    footer={<div className="form-actions">{initial && onDelete && <><Button kind="danger" onClick={() => { if (confirm('删除此设定？')) void onDelete() }}><Trash2 size={13} />删除</Button><b /></>}{error && <span className="form-error">{error}</span>}<Button onClick={onClose}>取消</Button><Button kind="primary" onClick={submit} disabled={busy}>{busy ? '保存中…' : '保存'}</Button></div>}>
    <div className="form-body">
      <div className="form-row"><Field label="名称"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} autoFocus /></Field><Field label="分类"><select className={selectCls} value={category} onChange={e => setCategory(e.target.value)}>{['世界规则', '势力分布', '历史背景', '法宝物品'].map(c => <option key={c}>{c}</option>)}</select></Field></div>
      <Field label="详细说明"><textarea className={areaCls} value={description} onChange={e => setDescription(e.target.value)} /></Field>
    </div>
  </Modal>
}
