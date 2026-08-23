import { useMemo, useState } from 'react'
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
import { confirmDialog } from '../components/Confirm'
import { Button, EmptyStateWrap, Field, FormFooter, Modal, PageHeader, SearchBox } from '../components/ui'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { useEntityList } from '../hooks/useEntityList'

export function ThreadsPage({ workspace, reload }: { workspace: Workspace; reload: () => Promise<void> }) {
  const novelId = workspace.novel.id
  // #2 懒加载：伏笔/角色按需拉取 + 缓存；章节元数据来自瘦身后的 workspace。
  const { items: threads, loading, patch: patchThreads } = useEntityList('plot-threads', novelId, workspaceApi.listThreads)
  const { items: characters } = useEntityList('characters', novelId, workspaceApi.listCharacters)
  const chapters: ChapterSummary[] = workspace.chapters
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<PlotThread | null>(null)
  // id → 姓氏首字索引：每个伏笔卡片头像从 O(N) find 降为 O(1) 查表。
  const charNameById = useMemo(
    () => new Map(characters.map(c => [c.id, c.name.slice(0, 1)])),
    [characters],
  )
  const charName = (id: string) => charNameById.get(id) ?? '?'
  const unresolved = threads.filter(t => t.status !== 'resolved')
  const majorUnresolved = unresolved.filter(t => t.priority === 'major')
  const matches = (t: PlotThread) => t.title.includes(query) || t.description.includes(query)

  // 状态推进/新增/删除都会改变"未收束"计数（侧栏 + 状态栏）→ patch 后补轻量 reload。
  const upsert = (saved: PlotThread) => {
    patchThreads(prev =>
      prev.some(t => t.id === saved.id) ? prev.map(t => (t.id === saved.id ? saved : t)) : [...prev, saved])
    void reload()
  }

  const advance = async (t: PlotThread) => {
    const order: ThreadStatus[] = ['planted', 'hinted', 'developing', 'resolved']
    const next = order[Math.min(order.length - 1, order.indexOf(t.status) + 1)]
    if (next === 'resolved') { setEditing(t); return }
    const saved = await workspaceApi.updateThread(t.id, { status: next })
    upsert(saved)
  }

  if (loading) return <div className="page-loading-fallback">加载中…</div>
  if (threads.length === 0) return <><EmptyStateWrap icon={BrainCircuit} title="还没有伏笔" desc="标记一条伏笔，开始追踪它从埋设到收束的全过程。" action={() => setCreating(true)} />{creating && <ThreadForm novelId={novelId} chapters={chapters} characters={characters} onClose={() => setCreating(false)} onSaved={saved => { setCreating(false); upsert(saved) }} />}</>

  return <div className="threads-page"><div className="threads-top">
    <PageHeader eyebrow="情节追踪" title="伏笔看板" desc="从埋设到收束，持续跟踪每一条线索。" actions={<><Button>关系图</Button><Button kind="primary" onClick={() => setCreating(true)}><Plus size={14} />新建伏笔</Button></>} />
    {majorUnresolved.length > 0 && <div className="warning"><AlertTriangle size={16} /><span><strong>{majorUnresolved.length} 条主线伏笔需要留意</strong>「{majorUnresolved[0].title}」尚未收束。</span><button onClick={() => setEditing(majorUnresolved[0])}>查看</button></div>}
    <div className="board-tools"><SearchBox text="搜索伏笔" value={query} onChange={setQuery} /><Button><Tag size={13} />全部优先级<ChevronDown size={12} /></Button><span>{threads.length} 条伏笔 · {unresolved.length} 条未收束</span></div>
  </div>
    <div className="kanban">{THREAD_STATUSES.map(col => {
      const cards = threads.filter(t => t.status === col.id && matches(t))
      return <section key={col.id}><header><i className={col.tone} /><strong>{col.label}</strong><span>{cards.length}</span><button onClick={() => setCreating(true)}><Plus size={14} /></button></header>
        {cards.map(t => <article className={'thread-card ' + t.priority} key={t.id} onClick={() => setEditing(t)}><label>{THREAD_PRIORITY_LABEL[t.priority]}</label><button aria-label="更多操作" onClick={e => { e.stopPropagation(); void confirmDialog({ title: '删除伏笔', message: `删除伏笔「${t.title}」？`, danger: true }).then(ok => { if (ok) void workspaceApi.deleteThread(t.id).then(() => patchThreads(prev => prev.filter(x => x.id !== t.id))) }) }}><MoreHorizontal size={15} /></button><h3>{t.title}</h3><p>{t.description}</p><footer><span><FileText size={11} />第 {chapters.find(c => c.id === t.planted_chapter_id)?.order ?? '—'} 章</span>{t.status !== 'resolved' && <span><Clock3 size={11} />{THREAD_PRIORITY_LABEL[t.priority]}</span>}</footer>{t.related_characters.length > 0 && <div>{t.related_characters.slice(0, 3).map(id => <b key={id}>{charName(id)}</b>)}{t.related_characters.length > 3 && <em>+{t.related_characters.length - 3}</em>}</div>}</article>)}
        {col.id !== 'resolved' && <button className="add-card" onClick={() => setCreating(true)}><Plus size={13} />添加伏笔</button>}
      </section>})}
    </div>
    {creating && <ThreadForm novelId={novelId} chapters={chapters} characters={characters} onClose={() => setCreating(false)} onSaved={saved => { setCreating(false); upsert(saved) }} />}
    {editing && <ThreadForm novelId={novelId} chapters={chapters} characters={characters} initial={editing} onClose={() => setEditing(null)} onSaved={saved => { setEditing(null); upsert(saved) }} onDelete={async () => { await workspaceApi.deleteThread(editing.id); patchThreads(prev => prev.filter(x => x.id !== editing.id)); void reload(); setEditing(null) }} onAdvance={advance} />}
  </div>
}

function ThreadForm({ novelId, chapters, characters, initial, onClose, onSaved, onDelete, onAdvance }: { novelId: string; chapters: ChapterSummary[]; characters: Character[]; initial?: PlotThread; onClose: () => void; onSaved: (saved: PlotThread) => void; onDelete?: () => void; onAdvance?: (t: PlotThread) => Promise<void> }) {
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
    if (initial) { const saved = await workspaceApi.updateThread(initial.id, data); onSaved(saved) }
    else { const saved = await workspaceApi.createThread(novelId, data); onSaved(saved) }
  })
  return <Modal eyebrow={initial ? '编辑伏笔' : '新建伏笔'} title={title || '新伏笔'} icon={BrainCircuit} onClose={onClose}
    footer={<FormFooter error={error} busy={busy} onClose={onClose} onSubmit={submit} extra={initial && onDelete && onAdvance ? <>
      <Button onClick={() => void onAdvance(initial)}><ChevronRight size={13} />推进状态</Button>
      <Button kind="danger" onClick={async () => { const ok = await confirmDialog({ title: '删除伏笔', message: `删除伏笔「${initial?.title ?? ''}」？`, danger: true }); if (ok) void onDelete() }}><Trash2 size={13} />删除</Button>
      <b />
    </> : undefined} />}>
    <div className="form-body">
      <Field label="标题"><input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} autoFocus /></Field>
      <Field label="描述"><textarea className={areaCls} value={description} onChange={e => setDescription(e.target.value)} placeholder="这条伏笔埋了什么？" /></Field>
      <div className="form-row-3">
        <Field label="状态"><select className={selectCls} value={status} onChange={e => setStatus(e.target.value as ThreadStatus)}>{THREAD_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
        <Field label="优先级"><select className={selectCls} value={priority} onChange={e => setPriority(e.target.value as ThreadPriority)}><option value="major">主线</option><option value="minor">支线</option><option value="detail">细节</option></select></Field>
        <Field label="埋设章节"><select className={selectCls} value={planted} onChange={e => setPlanted(e.target.value)}><option value="">（未指定）</option>{chapters.map(c => <option key={c.id} value={c.id}>第 {c.order} 章</option>)}</select></Field>
      </div>
      <Field label="关联角色"><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{characters.map(c => <button key={c.id} onClick={() => setRelated(r => r.includes(c.id) ? r.filter(x => x !== c.id) : [...r, c.id])} style={{ padding: '4px 9px', borderRadius: 14, fontSize: 10, border: `1px solid ${related.includes(c.id) ? c.color : 'var(--line-2)'}`, background: related.includes(c.id) ? c.color : 'var(--bg-panel)', color: related.includes(c.id) ? 'white' : 'var(--text-3)' }}>{c.name}</button>)}</div></Field>
      <Field label="收束计划 / 备注"><textarea className={areaCls} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    </div>
  </Modal>
}
