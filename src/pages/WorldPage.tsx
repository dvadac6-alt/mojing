import { useState } from 'react'
import { ChevronRight, GitBranch, Globe2, Plus, Trash2 } from 'lucide-react'
import { workspaceApi, type WorldSetting, type Workspace } from '../workspaceApi'
import { CATEGORY_TONES, areaCls, inputCls, selectCls } from '../lib/constants'
import { Button, Field, Modal, PageHeader, Scroll, SearchBox } from '../components/ui'
import { EmptyStateWrap } from '../components/ui'
import { useAsyncAction } from '../hooks/useAsyncAction'

export function WorldPage({ workspace, reload }: { workspace: Workspace; reload: () => Promise<void> }) {
  const settings = workspace.world_settings
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('全部')
  const [editing, setEditing] = useState<WorldSetting | null>(null)
  const [creating, setCreating] = useState(false)
  const categories = ['全部', ...Array.from(new Set(settings.map(s => s.category)))]
  const filtered = settings.filter(s => (filter === '全部' || s.category === filter) && (s.name.includes(query) || s.description.includes(query)))
  if (settings.length === 0) return <EmptyStateWrap icon={Globe2} title="还没有世界观设定" desc="维护规则、势力与物品，保持设定前后一致。" action={() => setCreating(true)} />
  return <Scroll><PageHeader eyebrow="设定资料" title="世界观" desc="集中维护规则、势力、历史与关键物品。" actions={<Button kind="primary" onClick={() => setCreating(true)}><Plus size={14} />新建设定</Button>} />
    <div className="world-toolbar"><SearchBox text="搜索设定…" value={query} onChange={setQuery} /><div className="chips">{categories.map(c => <button key={c} className={filter === c ? 'active' : ''} onClick={() => setFilter(c)}>{c} {c !== '全部' && settings.filter(s => s.category === c).length}</button>)}</div></div>
    <div className="world-grid">{filtered.map(s => <article key={s.id} onClick={() => setEditing(s)} style={{ cursor: 'pointer' }}><span className={CATEGORY_TONES[s.category] ?? 'ink'}><Globe2 size={18} /></span><label>{s.category}</label><h2>{s.name}</h2><p>{s.description}</p><footer><GitBranch size={13} />点击编辑<ChevronRight size={14} /></footer></article>)}</div>
    {creating && <SettingForm novelId={workspace.novel.id} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await reload() }} />}
    {editing && <SettingForm novelId={workspace.novel.id} initial={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload() }} onDelete={async () => { await workspaceApi.deleteSetting(editing.id); setEditing(null); await reload() }} />}
  </Scroll>
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
