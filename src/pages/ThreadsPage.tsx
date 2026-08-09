import { useState } from 'react'
import {
  AlertTriangle, BrainCircuit, ChevronDown, ChevronRight, Clock3,
  FileText, MoreHorizontal, Plus, Tag, Trash2,
} from 'lucide-react'
import {
  workspaceApi,
  type ChapterSummary, type Character, type PlotThread,
  type ThreadPriority, type ThreadStatus, type Workspace,
} from '../workspaceApi'
import { THREAD_PRIORITY_LABEL, THREAD_STATUSES, areaCls, inputCls, selectCls } from '../lib/constants'
import { Button, EmptyStateWrap, Field, Modal, PageHeader, SearchBox } from '../components/ui'
import { useAsyncAction } from '../hooks/useAsyncAction'

export function ThreadsPage({ workspace, reload }: { workspace: Workspace; reload: () => Promise<void> }) {
  const threads = workspace.plot_threads
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<PlotThread | null>(null)
  const charName = (id: string) => workspace.characters.find(c => c.id === id)?.name.slice(0, 1) ?? '?'
  const unresolved = threads.filter(t => t.status !== 'resolved')
  const majorUnresolved = unresolved.filter(t => t.priority === 'major')
  const matches = (t: PlotThread) => t.title.includes(query) || t.description.includes(query)

  const advance = async (t: PlotThread) => {
    const order: ThreadStatus[] = ['planted', 'hinted', 'developing', 'resolved']
    const next = order[Math.min(order.length - 1, order.indexOf(t.status) + 1)]
    if (next === 'resolved') { setEditing(t); return }
    await workspaceApi.updateThread(t.id, { status: next }); void reload()
  }

  if (threads.length === 0) return <EmptyStateWrap icon={BrainCircuit} title="还没有伏笔" desc="标记一条伏笔，开始追踪它从埋设到收束的全过程。" action={() => setCreating(true)} />

  return <div className="threads-page"><div className="threads-top">
    <PageHeader eyebrow="情节追踪" title="伏笔看板" desc="从埋设到收束，持续跟踪每一条线索。" actions={<><Button>关系图</Button><Button kind="primary" onClick={() => setCreating(true)}><Plus size={14} />新建伏笔</Button></>} />
    {majorUnresolved.length > 0 && <div className="warning"><AlertTriangle size={16} /><span><strong>{majorUnresolved.length} 条主线伏笔需要留意</strong>「{majorUnresolved[0].title}」尚未收束。</span><button onClick={() => setEditing(majorUnresolved[0])}>查看</button></div>}
    <div className="board-tools"><SearchBox text="搜索伏笔" value={query} onChange={setQuery} /><Button><Tag size={13} />全部优先级<ChevronDown size={12} /></Button><span>{threads.length} 条伏笔 · {unresolved.length} 条未收束</span></div>
  </div>
    <div className="kanban">{THREAD_STATUSES.map(col => {
      const cards = threads.filter(t => t.status === col.id && matches(t))
      return <section key={col.id}><header><i className={col.tone} /><strong>{col.label}</strong><span>{cards.length}</span><button onClick={() => setCreating(true)}><Plus size={14} /></button></header>
        {cards.map(t => <article className={'thread-card ' + t.priority} key={t.id} onClick={() => setEditing(t)}><label>{THREAD_PRIORITY_LABEL[t.priority]}</label><button onClick={e => { e.stopPropagation(); if (confirm('删除此伏笔？')) { void workspaceApi.deleteThread(t.id).then(reload) } }}><MoreHorizontal size={15} /></button><h3>{t.title}</h3><p>{t.description}</p><footer><span><FileText size={11} />第 {workspace.chapters.find(c => c.id === t.planted_chapter_id)?.order ?? '—'} 章</span>{t.status !== 'resolved' && <span><Clock3 size={11} />{THREAD_PRIORITY_LABEL[t.priority]}</span>}</footer>{t.related_characters.length > 0 && <div>{t.related_characters.slice(0, 3).map(id => <b key={id}>{charName(id)}</b>)}{t.related_characters.length > 3 && <em>+{t.related_characters.length - 3}</em>}</div>}</article>)}
        {col.id !== 'resolved' && <button className="add-card" onClick={() => setCreating(true)}><Plus size={13} />添加伏笔</button>}
      </section>})}
    </div>
    {creating && <ThreadForm novelId={workspace.novel.id} chapters={workspace.chapters} characters={workspace.characters} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await reload() }} />}
    {editing && <ThreadForm novelId={workspace.novel.id} chapters={workspace.chapters} characters={workspace.characters} initial={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload() }} onDelete={async () => { await workspaceApi.deleteThread(editing.id); setEditing(null); await reload() }} onAdvance={advance} />}
  </div>
}

function ThreadForm({ novelId, chapters, characters, initial, onClose, onSaved, onDelete, onAdvance }: { novelId: string; chapters: ChapterSummary[]; characters: Character[]; initial?: PlotThread; onClose: () => void; onSaved: () => void; onDelete?: () => void; onAdvance?: (t: PlotThread) => Promise<void> }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [status, setStatus] = useState<ThreadStatus>(initial?.status ?? 'planted')
  const [priority, setPriority] = useState<ThreadPriority>(initial?.priority ?? 'minor')
  const [planted, setPlanted] = useState(initial?.planted_chapter_id ?? '')
  const [related, setRelated] = useState<string[]>(initial?.related_characters ?? [])
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const { busy, error, run } = useAsyncAction()
  const submit = () => run(async () => {
    const data = { title: title.trim() || '未命名伏笔', description, status, priority, planted_chapter_id: planted || null, related_characters: related, notes }
    if (initial) await workspaceApi.updateThread(initial.id, data); else await workspaceApi.createThread(novelId, data)
    onSaved()
  })
  return <Modal eyebrow={initial ? '编辑伏笔' : '新建伏笔'} title={title || '新伏笔'} icon={BrainCircuit} onClose={onClose}
    footer={<div className="form-actions">{initial && onDelete && onAdvance && <><Button onClick={() => void onAdvance(initial)}><ChevronRight size={13} />推进状态</Button><Button kind="danger" onClick={() => { if (confirm('删除此伏笔？')) void onDelete() }}><Trash2 size={13} />删除</Button><b /></>}{error && <span className="form-error">{error}</span>}<Button onClick={onClose}>取消</Button><Button kind="primary" onClick={submit} disabled={busy}>{busy ? '保存中…' : '保存'}</Button></div>}>
    <div className="form-body">
      <Field label="标题"><input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} autoFocus /></Field>
      <Field label="描述"><textarea className={areaCls} value={description} onChange={e => setDescription(e.target.value)} placeholder="这条伏笔埋了什么？" /></Field>
      <div className="form-row-3">
        <Field label="状态"><select className={selectCls} value={status} onChange={e => setStatus(e.target.value as ThreadStatus)}>{THREAD_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
        <Field label="优先级"><select className={selectCls} value={priority} onChange={e => setPriority(e.target.value as ThreadPriority)}><option value="major">主线</option><option value="minor">支线</option><option value="detail">细节</option></select></Field>
        <Field label="埋设章节"><select className={selectCls} value={planted} onChange={e => setPlanted(e.target.value)}><option value="">（未指定）</option>{chapters.map(c => <option key={c.id} value={c.id}>第 {c.order} 章</option>)}</select></Field>
      </div>
      <Field label="关联角色"><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{characters.map(c => <button key={c.id} onClick={() => setRelated(r => r.includes(c.id) ? r.filter(x => x !== c.id) : [...r, c.id])} style={{ padding: '4px 9px', borderRadius: 14, fontSize: 10, border: `1px solid ${related.includes(c.id) ? c.color : '#dcd9d0'}`, background: related.includes(c.id) ? c.color : '#fffefa', color: related.includes(c.id) ? 'white' : '#6b6f6b' }}>{c.name}</button>)}</div></Field>
      <Field label="收束计划 / 备注"><textarea className={areaCls} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    </div>
  </Modal>
}
