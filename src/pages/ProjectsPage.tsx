import { useEffect, useState } from 'react'
import { Feather, FilePlus2, Import, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { workspaceApi, type Novel } from '../workspaceApi'
import { COVER_TONES, fmt } from '../lib/constants'
import { Button, Field, FormFooter, Modal, PageHeader, Scroll, SearchBox } from '../components/ui'
import { inputCls, areaCls } from '../lib/constants'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { confirmDialog } from '../components/Confirm'

export function ProjectsPage({ onOpen, currentId, novels, reloadNovels }: {
  onOpen: (id: string) => void; currentId: string; novels: Novel[]; reloadNovels: () => Promise<void> | void
}) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState('')
  // novels 由 App 持有（侧栏切换器同一份）；这里只跟踪"首次就绪"以区分
  // "0 部作品"与"仍在读取"。
  const [ready, setReady] = useState(novels.length > 0)
  useEffect(() => { void Promise.resolve(reloadNovels()).then(() => setReady(true)) }, [reloadNovels])

  const remove = async (id: string) => {
    const ok = await confirmDialog({ title: '删除作品', message: '删除作品将级联删除其所有章节、角色、地点、设定与伏笔，且无法恢复。建议先导出备份。', danger: true, confirmLabel: '删除作品' })
    if (!ok) return
    setBusyId(id)
    try { await workspaceApi.deleteNovel(id); await reloadNovels() } catch { /* ignore */ } finally { setBusyId('') }
  }
  const filtered = novels.filter(n => n.title.includes(query) || n.genre.includes(query))

  return <Scroll>
    <PageHeader eyebrow="本地作品" title="我的作品" desc="所有原稿都保存在这台电脑的 SQLite 数据库中。"
      actions={<><Button><Import size={15} />导入 TXT</Button><Button kind="primary" onClick={() => setCreating(true)}><Plus size={15} />新建作品</Button></>} />
    <div className="project-toolbar"><SearchBox text="搜索作品…" value={query} onChange={setQuery} /><div className="segments"><button className="active">最近编辑</button><button>全部作品</button><button>已完结</button></div></div>
    <div className="project-grid">
      <button className="new-project" onClick={() => setCreating(true)}><span><FilePlus2 size={23} /></span><strong>创建一部新小说</strong><small>从一个名字和想法开始</small></button>
      {!ready && novels.length === 0 && <p style={{ color: '#999', fontSize: 11 }}>正在读取本地作品…</p>}
      {ready && novels.length === 0 && <div className="panel-empty" style={{ gridColumn: '1 / -1' }}>还没有作品——在左侧填写书名与类型，开始你的第一部小说。所有内容只存在这台电脑，无需联网。</div>}
      {filtered.map((n, i) => {
        const progress = n.target_words > 0 ? Math.min(100, Math.round((n.total_words / n.target_words) * 100)) : 0
        const tone = COVER_TONES[i % COVER_TONES.length]
        return <article className={'project-card' + (n.id === currentId ? ' current' : '')} key={n.id} onClick={() => onOpen(n.id)}>
          <div className={'cover ' + tone}><Feather size={25} /><span>{n.title.slice(0, 2)}</span></div>
          <div className="project-body">
            <div><em>{n.genre || '未分类'}</em><button onClick={e => { e.stopPropagation(); void remove(n.id) }} disabled={busyId === n.id}><Trash2 size={15} /></button></div>
            <h2>{n.title}</h2>
            <p>{n.chapter_count} 章 · {fmt(n.total_words)} 字 · {n.author || '佚名'}</p>
            <div className="progress"><i style={{ width: progress + '%' }} /></div>
            <footer><span>创作进度</span><strong>{progress}%</strong></footer>
          </div>
        </article>
      })}
    </div>
    <section className="backup-banner"><span><ShieldCheck size={22} /></span><div><strong>本地数据安全</strong><p>所有数据保存在本地 SQLite，无需联网。建议定期导出备份。</p></div><Button kind="ghost">管理备份</Button></section>
    {creating && <NovelForm onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); onOpen(id) }} />}
  </Scroll>
}

function NovelForm({ onClose, onSaved, initial }: { onClose: () => void; onSaved: (id: string) => void; initial?: Novel }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [genre, setGenre] = useState(initial?.genre ?? '')
  const [author, setAuthor] = useState(initial?.author ?? '')
  const [target, setTarget] = useState(String(initial?.target_words ?? 200000))
  const [desc, setDesc] = useState(initial?.description ?? '')
  const { busy, error, run } = useAsyncAction()
  const submit = () => run(async () => {
    const data = { title: title.trim() || '未命名作品', genre, author, description: desc, target_words: Number(target) || 200000, status: 'writing' as const }
    const n = initial ? await workspaceApi.updateNovel(initial.id, data) : await workspaceApi.createNovel(data)
    onSaved(n.id)
  })
  return <Modal eyebrow={initial ? '编辑作品' : '新建作品'} title={initial ? '作品设置' : '创建一部新小说'} icon={FilePlus2} onClose={onClose}
    footer={<FormFooter error={error} busy={busy} onClose={onClose} onSubmit={submit} note="作品信息保存在本地数据库" submitLabel={initial ? '保存修改' : '创建并进入'} />}>
    <div className="form-body">
      <Field label="书名"><input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="给这部小说起个名字" autoFocus /></Field>
      <div className="form-row">
        <Field label="流派"><input className={inputCls} value={genre} onChange={e => setGenre(e.target.value)} placeholder="悬疑 / 科幻 / 古言…" /></Field>
        <Field label="作者笔名"><input className={inputCls} value={author} onChange={e => setAuthor(e.target.value)} /></Field>
      </div>
      <Field label="目标字数"><input className={inputCls} type="number" value={target} onChange={e => setTarget(e.target.value)} /></Field>
      <Field label="简介"><textarea className={areaCls} value={desc} onChange={e => setDesc(e.target.value)} placeholder="一句话概括这部作品" /></Field>
    </div>
  </Modal>
}
