import { useEffect, useRef, useState } from 'react'
import { Feather, FilePlus2, ImagePlus, Import, Pencil, Plus, ShieldCheck, Sparkles, Trash2, WandSparkles } from 'lucide-react'
import { runAIStream, workspaceApi, type Novel } from '../workspaceApi'
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
  const [editing, setEditing] = useState<Novel | null>(null)
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
          <NovelCover novel={n} tone={tone} />
          <div className="project-body">
            <div><em>{n.genre || '未分类'}</em>
              <span className="card-tools">
                <button title="作品设置（改名 / 简介 / 封面）" onClick={e => { e.stopPropagation(); setEditing(n) }}><Pencil size={15} /></button>
                <button title="删除作品" onClick={e => { e.stopPropagation(); void remove(n.id) }} disabled={busyId === n.id}><Trash2 size={15} /></button>
              </span>
            </div>
            <h2>{n.title}</h2>
            <p title={n.description || undefined}>{n.chapter_count} 章 · {fmt(n.total_words)} 字 · {n.author || '佚名'}</p>
            <div className="progress"><i style={{ width: progress + '%' }} /></div>
            <footer><span>创作进度</span><strong>{progress}%</strong></footer>
          </div>
        </article>
      })}
    </div>
    <section className="backup-banner"><span><ShieldCheck size={22} /></span><div><strong>本地数据安全</strong><p>所有数据保存在本地 SQLite，无需联网。建议定期导出备份。</p></div><Button kind="ghost">管理备份</Button></section>
    {creating && <NovelForm onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); onOpen(id) }} />}
    {editing && <NovelForm initial={editing} onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); void reloadNovels() }} />}
  </Scroll>
}

/** 卡片封面：已上传则取 blob 显示，否则回退到色调 + 书名首字占位。
 *  blob URL 在封面变化/卸载时回收，避免泄漏。 */
function NovelCover({ novel, tone }: { novel: Novel; tone: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!novel.cover_image) { setUrl(''); return }
    let created = ''
    let cancelled = false
    workspaceApi.getNovelCover(novel.id)
      .then(blob => { if (!cancelled) { created = URL.createObjectURL(blob); setUrl(created) } })
      .catch(() => { /* 404 或文件缺失 → 保持占位 */ })
    return () => { cancelled = true; if (created) URL.revokeObjectURL(created) }
  }, [novel.id, novel.cover_image])
  if (url) return <div className={'cover has-img ' + tone}><img src={url} alt={novel.title} /></div>
  return <div className={'cover ' + tone}><Feather size={25} /><span>{novel.title.slice(0, 2)}</span></div>
}

function NovelForm({ onClose, onSaved, initial }: { onClose: () => void; onSaved: (id: string) => void; initial?: Novel }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [genre, setGenre] = useState(initial?.genre ?? '')
  const [author, setAuthor] = useState(initial?.author ?? '')
  const [target, setTarget] = useState(String(initial?.target_words ?? 200000))
  const [desc, setDesc] = useState(initial?.description ?? '')
  // ── AI 帮写简介：书名/类型直接取表单当前值，提示词 + 流式生成直填简介框。──
  const [hints, setHints] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPhase, setAiPhase] = useState<'idle' | 'streaming'>('idle')
  const [aiError, setAiError] = useState('')
  const aiAbort = useRef<AbortController | null>(null)
  const genSynopsis = async () => {
    setAiError(''); setDesc(''); setAiPhase('streaming')
    const controller = new AbortController(); aiAbort.current = controller
    try {
      await runAIStream('/ai/synopsis', { title, genre, hints }, {
        signal: controller.signal,
        onChunk: text => setDesc(prev => prev + text),
      })
    } catch (e) {
      // 用户主动停止不算失败；清掉半截结果让简介框回到干净状态。
      if (e instanceof DOMException && e.name === 'AbortError') setDesc('')
      else setAiError(e instanceof Error ? e.message : '生成失败')
    } finally { setAiPhase('idle'); aiAbort.current = null }
  }
  // 封面：coverFile = 本次新选的文件（提交时上传）；coverRemoved = 要求清除现有封面。
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverRemoved, setCoverRemoved] = useState(false)
  const [fileUrl, setFileUrl] = useState('')
  const [savedUrl, setSavedUrl] = useState('')
  const { busy, error, run } = useAsyncAction()

  useEffect(() => {
    if (!coverFile) { setFileUrl(''); return }
    const url = URL.createObjectURL(coverFile)
    setFileUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [coverFile])
  // 已存封面的预览（编辑模式且未被清除时）。
  useEffect(() => {
    if (!initial?.cover_image || coverRemoved) { setSavedUrl(''); return }
    let created = ''
    let cancelled = false
    workspaceApi.getNovelCover(initial.id)
      .then(blob => { if (!cancelled) { created = URL.createObjectURL(blob); setSavedUrl(created) } })
      .catch(() => { /* 文件缺失 → 显示占位 */ })
    return () => { cancelled = true; if (created) URL.revokeObjectURL(created) }
  }, [initial, coverRemoved])

  const preview = fileUrl || savedUrl

  const submit = () => run(async () => {
    const data = { title: title.trim() || '未命名作品', genre, author, description: desc, target_words: Number(target) || 200000, status: 'writing' as const }
    const n = initial ? await workspaceApi.updateNovel(initial.id, data) : await workspaceApi.createNovel(data)
    // 封面走独立端点（按 novel id 落盘），新建模式也要等 id 生成后再传。
    if (coverFile) await workspaceApi.uploadNovelCover(n.id, coverFile, coverFile.type || 'image/png')
    else if (initial && coverRemoved) await workspaceApi.deleteNovelCover(n.id)
    onSaved(n.id)
  })
  return <Modal eyebrow={initial ? '编辑作品' : '新建作品'} title={initial ? '作品设置' : '创建一部新小说'} icon={FilePlus2} onClose={onClose}
    footer={<FormFooter error={error} busy={busy} onClose={onClose} onSubmit={submit} note="作品信息保存在本地数据库" submitLabel={initial ? '保存修改' : '创建并进入'} />}>
    <div className="form-body">
      <Field label="封面"><div className="cover-editor">
        {preview
          ? <div className="cover-shot"><img src={preview} alt="封面预览" /></div>
          : <div className="cover-shot empty"><ImagePlus size={18} /><span>未设置封面</span></div>}
        <div className="cover-ops">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={e => { const f = e.target.files?.[0]; if (f) { setCoverFile(f); setCoverRemoved(false) } e.target.value = '' }} />
          {(preview || initial?.cover_image) && <Button onClick={() => { setCoverFile(null); setCoverRemoved(true) }}><Trash2 size={14} />移除封面</Button>}
          <small className="lib-muted">支持 PNG / JPG / WebP / GIF，≤12MB；保存后生效。</small>
        </div>
      </div></Field>
      <Field label="书名"><input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="给这部小说起个名字" autoFocus /></Field>
      <div className="form-row">
        <Field label="流派"><input className={inputCls} value={genre} onChange={e => setGenre(e.target.value)} placeholder="悬疑 / 科幻 / 古言…" /></Field>
        <Field label="作者笔名"><input className={inputCls} value={author} onChange={e => setAuthor(e.target.value)} /></Field>
      </div>
      <Field label="目标字数"><input className={inputCls} type="number" value={target} onChange={e => setTarget(e.target.value)} /></Field>
      <Field label="简介">
        <textarea className={areaCls} value={desc} onChange={e => setDesc(e.target.value)} placeholder="一句话概括这部作品" />
        <div className="synopsis-toolbar">
          <button type="button" className={'ai-help-toggle' + (aiOpen ? ' on' : '')} onClick={() => setAiOpen(v => !v)}>
            <WandSparkles size={13} />{aiOpen ? '收起 AI 帮写' : 'AI 帮写'}
          </button>
        </div>
        {aiOpen && <div className="ai-synopsis-box">
          <p className="ai-synopsis-note">根据上方「书名」「流派」与下面的提示词生成，结果直接填入简介框，可继续修改。</p>
          <textarea className={areaCls} rows={2} value={hints} onChange={e => setHints(e.target.value)}
            placeholder="例如：克苏鲁风侦探故事，主角是失忆的法医，双时间线叙事，结局反转…" />
          <div className="ai-synopsis-actions">
            {aiPhase === 'idle'
              ? <Button kind="primary" onClick={genSynopsis} disabled={!hints.trim() && !title.trim()}><Sparkles size={13} />生成简介</Button>
              : <><span className="ai-synopsis-live">生成中 · 已 {desc.length} 字</span>
                  <Button onClick={() => aiAbort.current?.abort()}>停止</Button></>}
          </div>
          {aiError && <div className="form-error">{aiError}</div>}
        </div>}
      </Field>
    </div>
  </Modal>
}
