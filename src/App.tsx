import { useCallback, useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'
import {
  workspaceApi, streamAI, type Chapter, type ChapterVersion, type Workspace, type Novel, type Character,
  type Location as Loc, type WorldSetting, type PlotThread, type ThreadStatus, type ThreadPriority,
  type AIConfig,
} from './workspaceApi'
import {
  AlertTriangle, Archive, BookHeart, BookMarked, BookOpen, Bot, BrainCircuit,
  Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, CloudOff,
  Command, Database, Download, Feather, FileClock, FilePlus2, FileText, Focus, GitBranch,
  Globe2, GripVertical, HardDrive, Import, LibraryBig, Map, MapPin, Maximize2, Minimize2,
  MoreHorizontal, Move, PanelLeftClose, PanelRightClose, PenLine, Plus, Redo2,
  Save, Search, Settings, ShieldCheck, Sparkles, Square, Tag, Trash2, Undo2,
  Upload, Users, WandSparkles, X, History, MousePointer2,
} from 'lucide-react'

type Page = 'projects' | 'overview' | 'writing' | 'outline' | 'characters' |
  'locations' | 'world' | 'threads' | 'maps' | 'library' | 'settings'

type Nav = { id: Page; label: string; icon: ElementType; count?: number }

const THREAD_STATUSES: { id: ThreadStatus; label: string; tone: string }[] = [
  { id: 'planted', label: '已埋下', tone: 'amber' },
  { id: 'hinted', label: '已暗示', tone: 'orange' },
  { id: 'developing', label: '发展中', tone: 'blue' },
  { id: 'resolved', label: '已收束', tone: 'green' },
]
const THREAD_PRIORITY_LABEL: Record<ThreadPriority, string> = { major: '主线', minor: '支线', detail: '细节' }
const CATEGORY_TONES: Record<string, string> = {
  世界规则: 'blue', 势力分布: 'sage', 历史背景: 'clay', 法宝物品: 'plum',
}
const COVER_TONES = ['ink', 'blue', 'clay', 'sage'] as const
const COLORS = ['#334f68', '#9d6b62', '#6c7250', '#6d5360', '#526d6a', '#77634c', '#7a817c', '#84604a']

const fmt = (n: number) => n.toLocaleString('zh-CN')

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [page, setPage] = useState<Page>('overview')
  const [collapsed, setCollapsed] = useState(false)
  const [assistant, setAssistant] = useState(true)
  const [command, setCommand] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(async () => {
    setLoadError('')
    try {
      const data = await workspaceApi.load()
      setWorkspace(data)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '无法连接本地服务')
    }
  }, [])

  useEffect(() => { void reload() }, [reload, reloadKey])

  const patchWorkspace = useCallback((updater: (w: Workspace) => Workspace) => {
    setWorkspace(current => (current ? updater(current) : current))
  }, [])

  const switchNovel = async (id: string) => {
    try {
      const data = await workspaceApi.getNovel(id)
      setWorkspace(data)
      setPage('overview')
    } catch { /* keep current */ }
  }

  if (loadError || !workspace) return (
    <div className="desktop">
      <TitleBar onCommand={() => setCommand(true)} />
      <div className="app-body">
        <main className="stage">
          <div className="writing-state">
            {loadError ? (
              <>
                <span><AlertTriangle size={24} /></span>
                <h2>本地写作服务未连接</h2>
                <p>{loadError}</p>
                <Button kind="primary" onClick={() => setReloadKey(k => k + 1)}>重新连接</Button>
                <small>请使用 npm run dev 或 npm run desktop 启动完整应用。</small>
              </>
            ) : (
              <>
                <span><Database size={24} /></span>
                <h2>正在打开本地作品</h2>
                <p>连接 SQLite 数据库并读取最近章节…</p>
              </>
            )}
          </div>
        </main>
      </div>
      <footer className="statusbar"><span><CloudOff size={12} /> 本地模式</span><b /><span>Mojing 0.3.0</span></footer>
    </div>
  )

  const novel = workspace.novel
  const unresolvedMajor = workspace.plot_threads.filter(t => t.status !== 'resolved' && t.priority === 'major').length
  const creationNav: Nav[] = [
    { id: 'overview', label: '作品概览', icon: BookHeart },
    { id: 'writing', label: '写作', icon: PenLine },
    { id: 'outline', label: '大纲', icon: GitBranch },
  ]
  const dataNav: Nav[] = [
    { id: 'characters', label: '角色', icon: Users, count: workspace.characters.length },
    { id: 'locations', label: '地点', icon: MapPin, count: workspace.locations.length },
    { id: 'world', label: '世界观', icon: Globe2, count: workspace.world_settings.length },
    { id: 'threads', label: '伏笔', icon: BrainCircuit, count: workspace.plot_threads.length },
    { id: 'maps', label: '地图', icon: Map },
  ]

  return (
    <div className="desktop">
      <TitleBar onCommand={() => setCommand(true)} novel={novel} />
      <div className="app-body">
        <Sidebar page={page} collapsed={collapsed} onPage={setPage} onCollapse={() => setCollapsed(!collapsed)}
          novel={novel} dataNav={dataNav} creationNav={creationNav} unresolvedMajor={unresolvedMajor} />
        <main className="stage">
          {page === 'projects' && <ProjectsPage onOpen={switchNovel} currentId={novel.id} />}
          {page === 'overview' && <OverviewPage workspace={workspace} onWrite={() => setPage('writing')} onGoto={setPage} />}
          {page === 'writing' && <WritingPage workspace={workspace} patchWorkspace={patchWorkspace} reload={reload} assistant={assistant} onAssistant={() => setAssistant(!assistant)} onGoto={setPage} />}
          {page === 'outline' && <OutlinePage workspace={workspace} />}
          {page === 'characters' && <CharactersPage workspace={workspace} reload={reload} />}
          {page === 'locations' && <LocationsPage workspace={workspace} reload={reload} />}
          {page === 'world' && <WorldPage workspace={workspace} reload={reload} />}
          {page === 'threads' && <ThreadsPage workspace={workspace} reload={reload} />}
          {page === 'maps' && <MapsPage />}
          {page === 'library' && <LibraryPage />}
          {page === 'settings' && <SettingsPage workspace={workspace} reload={reload} />}
        </main>
      </div>
      <StatusBar unresolved={workspace.plot_threads.filter(t => t.status !== 'resolved').length} novel={novel} />
      {command && <CommandPalette onClose={() => setCommand(false)} onPage={(next) => { setPage(next); setCommand(false) }} />}
    </div>
  )
}

// ---------------------------------------------------------------- shell
function TitleBar({ onCommand, novel }: { onCommand: () => void; novel?: Novel }) {
  return <header className="titlebar">
    <span className="brand-icon"><Feather size={15} /></span><strong className="brand-name">墨境</strong>
    <nav className="native-menu"><button>文件</button><button>编辑</button><button>视图</button><button>帮助</button></nav>
    <button className="title-search" onClick={onCommand}><Search size={13} /><span>搜索作品、章节或命令</span><kbd>Ctrl K</kbd></button>
    <span className="title-context"><i />《{novel?.title ?? '未命名作品'}》</span>
    <div className="window-actions"><button><Minimize2 size={13} /></button><button><Square size={11} /></button><button className="close"><X size={14} /></button></div>
  </header>
}

function Sidebar({ page, collapsed, onPage, onCollapse, novel, dataNav, creationNav, unresolvedMajor }:
  { page: Page; collapsed: boolean; onPage: (p: Page) => void; onCollapse: () => void; novel: Novel; dataNav: Nav[]; creationNav: Nav[]; unresolvedMajor: number }) {
  const items = (list: Nav[]) => list.map(({ id, label, icon: Icon, count }) =>
    <button key={id} title={collapsed ? label : ''} className={'nav-item ' + (page === id ? 'active' : '')} onClick={() => onPage(id)}>
      <Icon size={17} />{!collapsed && <><span>{label}</span>{count !== undefined && count > 0 && <small>{count}</small>}</>}
    </button>)
  return <aside className={'sidebar ' + (collapsed ? 'collapsed' : '')}>
    <button className="book-switch" onClick={() => onPage('projects')}><b>{novel.title.slice(0, 1)}</b>{!collapsed && <><span><strong>{novel.title}</strong><small>{novel.genre || '未分类'} · {novel.status === 'completed' ? '已完结' : '连载中'}</small></span><ChevronDown size={14} /></>}</button>
    <div className="nav-scroll">{!collapsed && <label>创作</label>}{items(creationNav)}{!collapsed && <label className="spaced">资料</label>}{items(dataNav)}{!collapsed && unresolvedMajor > 0 && <em className="nav-warn">{unresolvedMajor} 条主线待收束</em>}</div>
    <div className="sidebar-foot">
      <button className={'nav-item ' + (page === 'library' ? 'active' : '')} onClick={() => onPage('library')}><LibraryBig size={17} />{!collapsed && <span>参考资料库</span>}</button>
      <button className={'nav-item ' + (page === 'settings' ? 'active' : '')} onClick={() => onPage('settings')}><Settings size={17} />{!collapsed && <span>设置</span>}</button>
      <button className="nav-item" onClick={onCollapse}>{collapsed ? <ChevronRight size={17} /> : <PanelLeftClose size={17} />}{!collapsed && <span>收起侧栏</span>}</button>
    </div>
  </aside>
}

function StatusBar({ unresolved, novel }: { unresolved: number; novel: Novel }) {
  return <footer className="statusbar">
    <span><i><Check size={10} /></i> SQLite 本地数据库</span>
    <span><HardDrive size={12} /> 自动保存已启用</span>
    <b />
    <span><CloudOff size={12} /> 本地模式</span>
    <span><BrainCircuit size={12} /> {unresolved} 条伏笔待收束</span>
    <span>{fmt(novel.total_words)} 字</span>
    <span>Mojing 0.3.0</span>
  </footer>
}

// ---------------------------------------------------------------- shared primitives
function PageHeader({ eyebrow, title, desc, actions }: { eyebrow?: string; title: string; desc?: string; actions?: ReactNode }) {
  return <div className="page-header"><div>{eyebrow && <label>{eyebrow}</label>}<h1>{title}</h1>{desc && <p>{desc}</p>}</div>{actions && <aside>{actions}</aside>}</div>
}
const Button = ({ children, kind = 'secondary', onClick, disabled }: { children: ReactNode; kind?: string; onClick?: () => void; disabled?: boolean }) =>
  <button className={'btn ' + kind} onClick={onClick} disabled={disabled}>{children}</button>

function Scroll({ children }: { children: ReactNode }) { return <div className="scroll-page">{children}</div> }
function SearchBox({ text, value, onChange }: { text: string; value?: string; onChange?: (v: string) => void }) {
  return <div className="search-box"><Search size={14} /><input placeholder={text} value={value} onChange={e => onChange?.(e.target.value)} /></div>
}
function PanelTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <header className="panel-title"><h2>{title}</h2>{action && <button onClick={onAction}>{action}<ChevronRight size={13} /></button>}</header>
}
function PaneHead({ eyebrow, title, onAdd }: { eyebrow: string; title: string; onAdd?: () => void }) {
  return <div className="pane-title"><div><label>{eyebrow}</label><strong>{title}</strong></div><button onClick={onAdd}><Plus size={15} /></button></div>
}
function Detail({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return <section className={'detail ' + (wide ? 'wide' : '')}><h2>{title}</h2>{children}</section>
}
function LinkRecord({ icon: Icon, title, note }: { icon: ElementType; title: string; note: string }) {
  return <div className="link-record"><Icon size={15} /><span><strong>{title}</strong><small>{note}</small></span><ChevronRight size={14} /></div>
}
function EmptyState({ icon: Icon, title, desc, action }: { icon: ElementType; title: string; desc: string; action?: ReactNode }) {
  return <div className="empty-state"><span><Icon size={22} /></span><h3>{title}</h3><p>{desc}</p>{action}</div>
}
function Modal({ eyebrow, title, icon, onClose, children, footer, wide }: { eyebrow: string; title: string; icon: ElementType; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const Icon = icon
  return <div className="form-modal" onMouseDown={onClose}><div className={'form-dialog' + (wide ? ' wide' : '')} onMouseDown={e => e.stopPropagation()}>
    <div className="form-head"><span className="form-icon"><Icon size={18} /></span><div><label>{eyebrow}</label><h2>{title}</h2></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></div>
    {children}
    {footer}
  </div></div>
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="form-field"><span>{label}</span>{children}</label>
}
const inputCls = 'form-input'
const areaCls = 'form-textarea'
const selectCls = 'form-select'

function useAsyncAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : '操作失败') } finally { setBusy(false) }
  }
  return { busy, error, run, setError }
}

// ---------------------------------------------------------------- Projects
function ProjectsPage({ onOpen, currentId }: { onOpen: (id: string) => void; currentId: string }) {
  const [novels, setNovels] = useState<Novel[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState('')

  const load = async () => {
    setLoading(true)
    try { setNovels(await workspaceApi.listNovels()) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const remove = async (id: string) => {
    if (!confirm('删除作品将级联删除所有章节与资料，确定继续？')) return
    setBusyId(id)
    try { await workspaceApi.deleteNovel(id); await load() } catch { /* ignore */ } finally { setBusyId('') }
  }
  const filtered = novels.filter(n => n.title.includes(query) || n.genre.includes(query))

  return <Scroll>
    <PageHeader eyebrow="本地作品" title="我的作品" desc="所有原稿都保存在这台电脑的 SQLite 数据库中。"
      actions={<><Button><Import size={15} />导入 TXT</Button><Button kind="primary" onClick={() => setCreating(true)}><Plus size={15} />新建作品</Button></>} />
    <div className="project-toolbar"><SearchBox text="搜索作品…" value={query} onChange={setQuery} /><div className="segments"><button className="active">最近编辑</button><button>全部作品</button><button>已完结</button></div></div>
    <div className="project-grid">
      <button className="new-project" onClick={() => setCreating(true)}><span><FilePlus2 size={23} /></span><strong>创建一部新小说</strong><small>从一个名字和想法开始</small></button>
      {loading && novels.length === 0 && <p style={{ color: '#999', fontSize: 11 }}>正在读取本地作品…</p>}
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
    footer={<div className="form-actions"><span className="muted">作品信息保存在本地数据库</span>{error && <span className="form-error">{error}</span>}<Button onClick={onClose}>取消</Button><Button kind="primary" onClick={submit} disabled={busy}>{busy ? '保存中…' : (initial ? '保存修改' : '创建并进入')}</Button></div>}>
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

// ---------------------------------------------------------------- Overview
function OverviewPage({ workspace, onWrite, onGoto }: { workspace: Workspace; onWrite: () => void; onGoto: (p: Page) => void }) {
  const { novel, chapters, plot_threads } = workspace
  const unresolved = plot_threads.filter(t => t.status !== 'resolved')
  const unresolvedMajor = unresolved.filter(t => t.priority === 'major')
  const emptyChapters = chapters.filter(c => !c.content.trim())
  const progress = novel.target_words > 0 ? Math.min(100, Math.round((novel.total_words / novel.target_words) * 100)) : 0
  const recent = [...chapters].slice(-6).reverse()
  return <Scroll>
    <PageHeader eyebrow="作品概览" title={novel.title} desc={novel.description || '暂无简介'}
      actions={<><Button onClick={() => onGoto('projects')}>作品设置</Button><button className="btn primary" onClick={onWrite}><PenLine size={15} />继续写作</button></>} />
    <div className="metrics">
      <Metric icon={FileText} label="总字数" value={fmt(novel.total_words)} note={`目标 ${fmt(novel.target_words)} 字`} tone="ink" />
      <Metric icon={BookOpen} label="章节" value={String(novel.chapter_count)} note={`已完成 ${chapters.filter(c => c.status === 'completed').length} 章`} tone="sage" />
      <Metric icon={BrainCircuit} label="未收束伏笔" value={String(unresolved.length)} note={`其中 ${unresolvedMajor.length} 条主线`} tone="amber" />
      <Metric icon={Feather} label="目标进度" value={`${progress}%`} note={novel.genre || '连载中'} tone="clay" />
    </div>
    <div className="overview-grid">
      <section className="panel progress-panel"><PanelTitle title="创作进度" action="查看统计" /><div className="goal"><strong>{fmt(novel.total_words)}</strong><span>/ {fmt(novel.target_words)} 字</span></div><div className="big-progress"><i style={{ width: progress + '%' }} /></div><div className="week-bars">{[48, 76, 42, 88, 66, 92, 58].map((h, i) => <span key={i}><i style={{ height: h + '%' }} /><small>{'一二三四五六日'[i]}</small></span>)}</div></section>
      <section className="panel"><PanelTitle title="需要留意" action="打开伏笔看板" onAction={() => onGoto('threads')} /><div className="attention">
        {unresolvedMajor.length > 0 && <Attention icon={AlertTriangle} title={`「${unresolvedMajor[0].title}」等 ${unresolvedMajor.length} 条主线伏笔待收束`} note="建议在近期章节推进主线" urgent />}
        <Attention icon={BrainCircuit} title={`${unresolved.length} 个伏笔尚未收束`} note={`支线 ${unresolved.filter(t => t.priority === 'minor').length} · 细节 ${unresolved.filter(t => t.priority === 'detail').length}`} />
        {emptyChapters.length > 0 && <Attention icon={FileClock} title={`第 ${emptyChapters[0].order} 章还是空白`} note="点击继续写作开始本章" />}
        {unresolved.length === 0 && <Attention icon={Check} title="所有伏笔均已收束" note="节奏良好，可埋设新的线索" />}
      </div></section>
      <section className="panel recent"><PanelTitle title="最近章节" action="全部章节" onAction={onWrite} />{recent.map(c => <div key={c.id} onClick={onWrite} style={{ cursor: 'pointer' }}><b>{String(c.order).padStart(2, '0')}</b><strong>{c.title}</strong><span>{fmt(c.word_count)} 字</span><small>{c.status === 'completed' ? '已完成' : '写作中'}</small><ChevronRight size={15} /></div>)}</section>
      <section className="panel agent-promo"><span><WandSparkles size={22} /></span><div><label>创作助手</label><h3>让 AI 帮你续写下一章</h3><p>结合大纲、角色和未收束伏笔生成可审阅草稿。</p></div><Button kind="dark" onClick={onWrite}><Sparkles size={15} />开始创作</Button></section>
    </div>
  </Scroll>
}

function Metric({ icon: Icon, label, value, note, tone }: { icon: ElementType; label: string; value: string; note: string; tone: string }) {
  return <article className={'metric ' + tone}><span><Icon size={19} /></span><div><label>{label}</label><strong>{value}</strong><small>{note}</small></div></article>
}
function Attention({ icon: Icon, title, note, urgent }: { icon: ElementType; title: string; note: string; urgent?: boolean }) {
  return <div className={urgent ? 'urgent' : ''}><Icon size={17} /><p><strong>{title}</strong><small>{note}</small></p><ChevronRight size={15} /></div>
}

// ---------------------------------------------------------------- Writing
function WritingPage({ workspace, patchWorkspace, reload, assistant, onAssistant, onGoto }:
  { workspace: Workspace; patchWorkspace: (u: (w: Workspace) => Workspace) => void; reload: () => Promise<void>; assistant: boolean; onAssistant: () => void; onGoto: (p: Page) => void }) {
  const [tab, selectTab] = useState<'quick' | 'agent' | 'ref'>('quick')
  const [activeId, setActiveId] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draft, setDraft] = useState('')
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [savedAt, setSavedAt] = useState('')
  const [versionsOpen, setVersionsOpen] = useState(false)
  const savedSignature = useRef('')
  const paperWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const chapters = workspace.chapters
    if (!chapters.length) return
    if (!activeId || !chapters.find(c => c.id === activeId)) {
      const preferred = chapters.find(c => c.status === 'writing') ?? chapters[chapters.length - 1]
      setActiveId(preferred.id)
      setDraftTitle(preferred.title)
      setDraft(preferred.content)
      savedSignature.current = `${preferred.title} ${preferred.content}`
    }
  }, [workspace])

  const activeChapter = workspace.chapters.find(c => c.id === activeId)
  const currentSignature = `${draftTitle} ${draft}`

  useEffect(() => { paperWrapRef.current?.scrollTo({ top: 0 }) }, [activeId])

  const persistChapter = useCallback(async (chapterId = activeId, title = draftTitle, content = draft) => {
    if (!chapterId) return null
    const normalizedTitle = title.trim() || '未命名章节'
    setSaveState('saving')
    try {
      const updated = await workspaceApi.updateChapter(chapterId, {
        title: normalizedTitle, content,
        status: content.trim() ? 'writing' : 'draft',
      })
      patchWorkspace(current => current ? {
        ...current,
        novel: {
          ...current.novel,
          total_words: current.chapters.reduce((sum, c) => sum + (c.id === updated.id ? updated.word_count : c.word_count), 0),
        },
        chapters: current.chapters.map(c => c.id === updated.id ? updated : c),
      } : current)
      if (chapterId === activeId) {
        setDraftTitle(updated.title)
        savedSignature.current = `${updated.title} ${updated.content}`
      }
      setSaveState('saved')
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
      return updated
    } catch {
      setSaveState('error')
      return null
    }
  }, [activeId, draftTitle, draft, activeChapter?.id, patchWorkspace])

  useEffect(() => {
    if (!activeChapter || currentSignature === savedSignature.current) return
    setSaveState('saving')
    const timer = window.setTimeout(() => { void persistChapter() }, 1000)
    return () => window.clearTimeout(timer)
  }, [currentSignature, activeChapter?.id])

  const selectChapter = async (chapter: Chapter) => {
    if (chapter.id === activeId) return
    if (activeId && currentSignature !== savedSignature.current) await persistChapter()
    setActiveId(chapter.id); setDraftTitle(chapter.title); setDraft(chapter.content)
    savedSignature.current = `${chapter.title} ${chapter.content}`
    setSaveState('saved')
  }
  const createChapter = async () => {
    if (activeId && currentSignature !== savedSignature.current) await persistChapter()
    try {
      const created = await workspaceApi.createChapter(workspace.novel.id, `未命名章节 ${workspace.chapters.length + 1}`)
      patchWorkspace(c => c ? { ...c, novel: { ...c.novel, chapter_count: c.novel.chapter_count + 1 }, chapters: [...c.chapters, created] } : c)
      setActiveId(created.id); setDraftTitle(created.title); setDraft(created.content)
      savedSignature.current = `${created.title} ${created.content}`
      setSaveState('saved')
    } catch { setSaveState('error') }
  }
  const deleteChapter = async () => {
    if (!activeChapter || !confirm(`删除「${activeChapter.title}」？此操作不可撤销。`)) return
    try {
      await workspaceApi.deleteChapter(activeChapter.id)
      patchWorkspace(c => c ? { ...c, chapters: c.chapters.filter(x => x.id !== activeChapter.id), novel: { ...c.novel, chapter_count: Math.max(0, c.novel.chapter_count - 1) } } : c)
      setActiveId('')
    } catch { setSaveState('error') }
  }

  if (!activeChapter) return <div className="writing-state"><EmptyState icon={FileText} title="还没有章节" desc="创建第一章，开始你的故事。" action={<Button kind="primary" onClick={createChapter}><Plus size={15} />新建章节</Button>} /></div>

  const paragraphs = draft.trim() ? draft.split(/\n\s*\n/).length : 0
  const readingMinutes = Math.max(1, Math.ceil(activeChapter.word_count / 450))
  return <div className="writing-page">
    <aside className="chapters-pane"><div className="pane-title"><div><label>{workspace.novel.title}</label><strong>章节目录</strong></div><button onClick={createChapter}><Plus size={16} /></button></div><SearchBox text="搜索章节或正文" />
      <div className="chapter-list">{workspace.chapters.map(chapter => <button className={chapter.id === activeId ? 'active' : ''} key={chapter.id} onClick={() => void selectChapter(chapter)}><GripVertical size={13} /><b>{String(chapter.order).padStart(2, '0')}</b><span><strong>{chapter.title}</strong><small>{fmt(chapter.word_count)} 字</small></span>{chapter.status === 'completed' && <Check size={12} />}</button>)}</div>
      <button className="new-chapter" onClick={createChapter}><Plus size={14} />新建章节</button>
    </aside>
    <section className="editor"><div className="editor-toolbar">
      <button onClick={deleteChapter} title="删除当前章节"><Trash2 size={15} /></button><button onClick={() => setVersionsOpen(true)} title="版本历史"><History size={15} /></button><i />
      <span>第 {String(activeChapter.order).padStart(2, '0')} 章 <ChevronRight size={12} /> <strong>{draftTitle || '未命名章节'}</strong></span><b />
      <em className={saveState}><Check size={12} />{saveState === 'saving' ? '正在保存…' : saveState === 'error' ? '保存失败' : `已保存 ${savedAt}`}</em>
      <button onClick={() => void persistChapter()}><Save size={14} />保存</button>
      <button onClick={() => onGoto('threads')} title="伏笔看板"><BrainCircuit size={14} /></button>
      <button className={'assist-toggle ' + (assistant ? 'active' : '')} onClick={onAssistant}><WandSparkles size={14} />辅助中心</button>
    </div>
      <div className="paper-wrap" ref={paperWrapRef}><article className="paper editable-paper"><label>第 {activeChapter.order} 章</label><input className="chapter-title-input" value={draftTitle} onChange={e => setDraftTitle(e.target.value)} aria-label="章节标题" /><div className="ornament"><i /><Feather size={14} /><i /></div><textarea className="manuscript-textarea" value={draft} onChange={e => setDraft(e.target.value)} aria-label="章节正文" placeholder="从这里开始写作……" spellCheck={false} /></article></div>
      <footer className="editor-status"><span>本章 {draft.replace(/\s/g, '').length.toLocaleString()} 字</span><span>全文 {fmt(workspace.novel.total_words)} 字</span><b /><span>段落 {paragraphs}</span><span>预计阅读 {readingMinutes} 分钟</span><span><button className="btn ghost" onClick={() => onGoto('threads')}>伏笔看板</button></span></footer>
    </section>
    {assistant && <aside className="assistant"><div className="assistant-title"><span><Sparkles size={14} /></span><strong>辅助中心</strong><button onClick={onAssistant}><PanelRightClose size={15} /></button></div><div className="assistant-tabs"><button className={tab === 'quick' ? 'active' : ''} onClick={() => selectTab('quick')}>快捷生成</button><button className={tab === 'agent' ? 'active' : ''} onClick={() => selectTab('agent')}>Agent</button><button className={tab === 'ref' ? 'active' : ''} onClick={() => selectTab('ref')}>参考</button></div>{tab === 'quick' ? <QuickAI workspace={workspace} chapter={activeChapter} onAccept={text => setDraft(d => d.replace(/\s*$/, '') + '\n\n' + text)} /> : tab === 'agent' ? <AgentPanel workspace={workspace} onAccept={text => setDraft(d => d.replace(/\s*$/, '') + '\n\n' + text)} /> : <ReferencePanel />}</aside>}
    {versionsOpen && <VersionHistory chapter={activeChapter} onClose={() => setVersionsOpen(false)} onRolled={() => { setVersionsOpen(false); void reload() }} />}
  </div>
}

function QuickAI({ workspace, chapter, onAccept }: { workspace: Workspace; chapter: Chapter; onAccept: (text: string) => void }) {
  const [instruction, setInstruction] = useState('让马车里的人交代城北线索，但不要揭示他的真实身份。气氛保持克制、紧张。')
  const [mode, setMode] = useState<'continue' | 'polish' | 'expand'>('continue')
  const [target, setTarget] = useState('800')
  const [ctx, setCtx] = useState({ characters: true, locations: false, settings: true, threads: true, recent_chapters: 2 })
  const [output, setOutput] = useState('')
  const [model, setModel] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')

  const generate = async () => {
    setOutput(''); setError(''); setStreaming(true)
    try {
      const gen = streamAI('/ai/generate', {
        novel_id: workspace.novel.id, chapter_id: chapter.id, instruction, mode,
        target_words: Number(target) || 800, context: ctx,
      })
      for await (const piece of gen) { setOutput(o => o + piece.text); setModel(piece.model) }
    } catch (e) { setError(e instanceof Error ? e.message : '生成失败') } finally { setStreaming(false) }
  }
  const accept = () => { if (output.trim()) { onAccept(output.trim()); setOutput('') } }

  return <div className="assist-body">
    <div className="assist-intro"><span><WandSparkles size={18} /></span><div><strong>接下来想怎么写？</strong><p>结合当前章节和作品资料生成草稿。</p></div></div>
    <label>写作要求</label>
    <div className="prompt"><textarea value={instruction} onChange={e => setInstruction(e.target.value)} /><footer><span>{instruction.length} / 500</span></footer></div>
    <div className="two-fields">
      <Field label="生成方式"><select className={selectCls} value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="continue">续写正文</option><option value="polish">润色正文</option><option value="expand">扩写场景</option></select></Field>
      <Field label="目标长度"><select className={selectCls} value={target} onChange={e => setTarget(e.target.value)}><option value="400">约 400 字</option><option value="800">约 800 字</option><option value="1200">约 1200 字</option></select></Field>
    </div>
    <div className="context-box"><p><Database size={13} /><strong>本次上下文</strong></p>
      <div>{(['characters', 'locations', 'settings', 'threads'] as const).map(k => <button key={k} className={ctx[k] ? 'active' : ''} onClick={() => setCtx(c => ({ ...c, [k]: !c[k] }))}>{({ characters: '角色', locations: '地点', settings: '世界观', threads: '伏笔' })[k]}</button>)}</div>
    </div>
    <button className="generate" onClick={generate} disabled={streaming}><Sparkles size={15} />{streaming ? '正在生成…' : '生成可审阅草稿'}<kbd>⌘ ↵</kbd></button>
    {(output || error) && <div className="ai-meta"><Sparkles size={12} />模型 <b>{model || 'mock'}</b>{streaming && <span>· 生成中</span>}</div>}
    {error && <div className="form-error">{error}</div>}
    {output && <div className={'ai-output' + (streaming ? ' streaming' : '')}>{output}</div>}
    {output && !streaming && <div className="ai-actions"><Button onClick={() => setOutput('')}>丢弃</Button><Button kind="primary" onClick={accept}><Check size={14} />采纳并插入</Button></div>}
    <small className="safe-note"><ShieldCheck size={13} />不会自动写入正文，确认后才会应用。</small>
  </div>
}

function AgentPanel({ workspace, onAccept }: { workspace: Workspace; onAccept: (t: string) => void }) {
  const [goal, setGoal] = useState('完成本章后半段，推进玉佩伏笔，但不要揭晓幕后人物。')
  const [output, setOutput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const run = async () => {
    setOutput(''); setStreaming(true)
    try { for await (const p of streamAI('/ai/generate', { novel_id: workspace.novel.id, instruction: goal, mode: 'continue', target_words: 800 })) setOutput(o => o + p.text) } finally { setStreaming(false) }
  }
  return <div className="assist-body agent-body">
    <span className="agent-orb"><Bot size={27} /></span>
    <h3>写作 Agent</h3>
    <p>给出目标，Agent 会收集资料、生成草稿并自检。</p>
    <label>任务目标</label>
    <textarea className="agent-goal" value={goal} onChange={e => setGoal(e.target.value)} />
    <div className="plan-preview">{['收集作品上下文', '生成章节草稿', '目标符合度自检'].map((x, i) => <div key={x}><b>{i + 1}</b><span><strong>{x}</strong><small>{i === 0 ? '近期章节、人物、伏笔' : i === 1 ? '等待作者审阅' : '检查连续性问题'}</small></span></div>)}</div>
    <button className="generate" onClick={run} disabled={streaming}><Bot size={15} />{streaming ? '运行中…' : '运行写作 Agent'}</button>
    {output && <><div className={'ai-output' + (streaming ? ' streaming' : '')}>{output}</div>{!streaming && <div className="ai-actions"><Button onClick={() => setOutput('')}>丢弃</Button><Button kind="primary" onClick={() => { onAccept(output.trim()); setOutput('') }}><Check size={14} />采纳</Button></div>}</>}
  </div>
}

function ReferencePanel() {
  return <div className="assist-body"><SearchBox text="搜索书籍、章节和资料…" />{[['书籍资料', '《雨夜叙事的空间感》', '雨声既是环境，也是隔断人物交流的屏障。'], ['其他章节', '第 01 章 · 雨夜来客', '他第一次看见那辆没有灯笼的马车。']].map(r => <article className="ref-card" key={r[1]}><label>{r[0]}</label><strong>{r[1]}</strong><p>{r[2]}</p><button><Plus size={12} />加入本次参考</button></article>)}</div>
}

function VersionHistory({ chapter, onClose, onRolled }: { chapter: Chapter; onClose: () => void; onRolled: () => void }) {
  const [versions, setVersions] = useState<ChapterVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  useEffect(() => { void workspaceApi.listVersions(chapter.id).then(v => { setVersions(v); setLoading(false) }) }, [chapter.id])
  const roll = async (id: string) => {
    if (!confirm('回滚后当前内容会另存为一个新版本，确定继续？')) return
    setBusy(id); try { await workspaceApi.rollback(chapter.id, id); onRolled() } finally { setBusy('') }
  }
  return <Modal eyebrow="版本历史" title={`第 ${chapter.order} 章 · ${chapter.title}`} icon={History} onClose={onClose}
    footer={<div className="form-actions"><span className="muted">每次保存有改动时会自动创建版本快照</span><Button onClick={onClose}>关闭</Button></div>}>
    <div className="form-body" style={{ maxHeight: 360, overflow: 'auto' }}>
      {loading && <p style={{ color: '#999', fontSize: 11 }}>读取版本…</p>}
      {!loading && versions.length === 0 && <EmptyState icon={History} title="还没有历史版本" desc="编辑并保存本章后会自动生成快照。" />}
      {versions.map(v => <div className="version-row" key={v.id}><b>v{v.version_number}</b><strong>{fmt(v.word_count)} 字 · {new Date(v.created_at).toLocaleString('zh-CN')}</strong><span className={'tag ' + v.label}>{v.label === 'rollback' ? '回滚前' : '自动'}</span><Button onClick={() => roll(v.id)} disabled={busy === v.id}>{busy === v.id ? '回滚中…' : '回滚到此版本'}</Button></div>)}
    </div>
  </Modal>
}

// ---------------------------------------------------------------- Outline (chapter-driven preview)
function OutlinePage({ workspace }: { workspace: Workspace }) {
  const rows = workspace.chapters.map(c => [c.title, c.content.slice(0, 60).replace(/\n/g, ' ') || '（空白章节）', c.status === 'completed' ? '已完成' : c.status === 'writing' ? '写作中' : '草稿', 'chapter'] as [string, string, string, string])
  return <Scroll><PageHeader eyebrow="结构规划" title="大纲" desc="按卷、章和场景组织故事结构。章节来自当前作品。" actions={<><Button>思维导图</Button><Button kind="primary"><Plus size={15} />添加节点</Button></>} />
    <div className="outline-summary"><span><strong>1</strong>卷</span><span><strong>{workspace.chapters.length}</strong>章节</span><span><strong>0</strong>场景</span><div><p>整体规划 <b>{Math.min(100, Math.round((workspace.novel.total_words / workspace.novel.target_words) * 100))}%</b></p><i><em /></i></div></div>
    <section className="outline-table"><header><span>结构与标题</span><span>情节摘要</span><span>状态</span></header>{rows.map((r, i) => <div className={r[3]} key={workspace.chapters[i].id}><span><GripVertical size={13} /><ChevronDown size={13} /><FileText size={14} /><strong>{String(i + 1).padStart(2, '0')} {r[0]}</strong></span><p>{r[1]}</p><em>{r[2]}</em><button><MoreHorizontal size={15} /></button></div>)}</section>
  </Scroll>
}

// ---------------------------------------------------------------- Characters
function CharactersPage({ workspace, reload }: { workspace: Workspace; reload: () => Promise<void> }) {
  const people = workspace.characters
  const [selectedId, setSelectedId] = useState(people[0]?.id ?? '')
  const [editing, setEditing] = useState<Character | null>(null)
  const [creating, setCreating] = useState(false)
  const [relationPreview, setRelationPreview] = useState(false)
  useEffect(() => { if (!people.find(p => p.id === selectedId)) setSelectedId(people[0]?.id ?? '') }, [people])
  const person = people.find(p => p.id === selectedId) ?? people[0]

  if (people.length === 0) return <EmptyStateWrap icon={Users} title="还没有角色" desc="创建第一个角色，让 AI 续写时记住他们的性格与背景。" action={() => setCreating(true)} />

  return <><div className="master-detail"><aside className="entity-pane"><PaneHead eyebrow="人物资料" title="角色" onAdd={() => setCreating(true)} /><SearchBox text="搜索角色" /><div className="chips"><button className="active">全部 {people.length}</button></div>{people.map(p => <button key={p.id} className={'person-item ' + (p.id === selectedId ? 'active' : '')} onClick={() => setSelectedId(p.id)}><b style={{ background: p.color }}>{p.name.slice(0, 1)}</b><span><strong>{p.name}</strong><small>{p.role || p.aliases}</small></span><ChevronRight size={14} /></button>)}</aside>
    {person && <section className="entity-detail"><div className="person-hero"><b style={{ background: person.color }}>{person.name.slice(0, 1)}</b><div><label>角色 · {person.aliases ? person.aliases : '已登场'}</label><h1>{person.name}</h1><p>{person.role}</p></div><Button onClick={() => setRelationPreview(true)}><GitBranch size={14} />关系图预览</Button><Button kind="danger" onClick={async () => { if (confirm(`删除角色「${person.name}」？`)) { await workspaceApi.deleteCharacter(person.id); await reload() } }}><Trash2 size={14} />删除</Button><Button kind="primary" onClick={() => setEditing(person)}><PenLine size={14} />编辑资料</Button></div>
      <div className="detail-grid">
        <Detail title="人物简介" wide><p className="lead">{person.description || '暂无简介。'}</p></Detail>
        <Detail title="性格关键词"><div className="tag-list">{(person.personality || '未设定').split(/[·、\s,，]+/, 6).filter(Boolean).map(t => <span key={t}>{t}</span>)}</div></Detail>
        <Detail title="能力与弱点"><p>{person.abilities || '未设定'}</p></Detail>
        <Detail title="背景故事" wide><p>{person.background || '未设定'}</p></Detail>
        <Detail title="外貌描述"><p>{person.appearance || '未设定'}</p></Detail>
        <Detail title="关联伏笔"><LinkRecord icon={BrainCircuit} title={`${workspace.plot_threads.filter(t => t.related_characters.includes(person.id)).length} 条`} note="可在伏笔看板查看" /></Detail>
      </div></section>}</div>
  {creating && <CharacterForm novelId={workspace.novel.id} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await reload() }} />}
  {editing && <CharacterForm novelId={workspace.novel.id} initial={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload() }} />}
  {relationPreview && <CharacterRelationPreview people={people} onClose={() => setRelationPreview(false)} />}
  </>
}

function CharacterForm({ novelId, initial, onClose, onSaved }: { novelId: string; initial?: Character; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [aliases, setAliases] = useState(initial?.aliases ?? '')
  const [role, setRole] = useState(initial?.role ?? '')
  const [color, setColor] = useState(initial?.color ?? COLORS[Math.floor((initial?.name.length ?? 0)) % COLORS.length])
  const [description, setDescription] = useState(initial?.description ?? '')
  const [personality, setPersonality] = useState(initial?.personality ?? '')
  const [background, setBackground] = useState(initial?.background ?? '')
  const [appearance, setAppearance] = useState(initial?.appearance ?? '')
  const [abilities, setAbilities] = useState(initial?.abilities ?? '')
  const { busy, error, run } = useAsyncAction()
  const submit = () => run(async () => {
    const data = { name: name.trim() || '未命名角色', aliases, role, color, description, personality, background, appearance, abilities }
    if (initial) await workspaceApi.updateCharacter(initial.id, data); else await workspaceApi.createCharacter(novelId, data)
    onSaved()
  })
  return <Modal eyebrow={initial ? '编辑角色' : '新建角色'} title={name || '新角色'} icon={Users} onClose={onClose} wide
    footer={<div className="form-actions"><span className="muted">AI 续写时会注入角色信息</span>{error && <span className="form-error">{error}</span>}<Button onClick={onClose}>取消</Button><Button kind="primary" onClick={submit} disabled={busy}>{busy ? '保存中…' : '保存'}</Button></div>}>
    <div className="form-body">
      <div className="form-row">
        <Field label="姓名"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} autoFocus /></Field>
        <Field label="别名 / 称号"><input className={inputCls} value={aliases} onChange={e => setAliases(e.target.value)} /></Field>
      </div>
      <div className="form-row">
        <Field label="身份定位"><input className={inputCls} value={role} onChange={e => setRole(e.target.value)} placeholder="主角 / 配角 / 对手" /></Field>
        <Field label="代表色"><div style={{ display: 'flex', gap: 6 }}>{COLORS.map(c => <button key={c} onClick={() => setColor(c)} style={{ width: 24, height: 24, borderRadius: 6, background: c, border: color === c ? '2px solid #333' : '2px solid transparent' }} />)}</div></Field>
      </div>
      <Field label="人物简介"><textarea className={areaCls} value={description} onChange={e => setDescription(e.target.value)} /></Field>
      <Field label="性格关键词（用顿号分隔）"><input className={inputCls} value={personality} onChange={e => setPersonality(e.target.value)} placeholder="克制 · 敏锐 · 执拗" /></Field>
      <Field label="背景故事"><textarea className={areaCls} value={background} onChange={e => setBackground(e.target.value)} /></Field>
      <div className="form-row"><Field label="外貌描述"><textarea className={areaCls} value={appearance} onChange={e => setAppearance(e.target.value)} /></Field><Field label="能力与弱点"><textarea className={areaCls} value={abilities} onChange={e => setAbilities(e.target.value)} /></Field></div>
    </div>
  </Modal>
}

const relationEdges: { from: string; to: string; label: string; tone: string }[] = [
  { from: '沈砚', to: '苏晚照', label: '互相试探', tone: 'complex' },
  { from: '沈砚', to: '陆停云', label: '师生', tone: 'ally' },
  { from: '沈砚', to: '谢无归', label: '敌对', tone: 'enemy' },
]
const NODE_POS: Record<string, { x: number; y: number }> = {
  沈砚: { x: 50, y: 52 }, 苏晚照: { x: 74, y: 22 }, 陆停云: { x: 26, y: 24 }, 谢无归: { x: 74, y: 66 },
}

function CharacterRelationPreview({ people, onClose }: { people: Character[]; onClose: () => void }) {
  const nodes = people.map((p, i) => ({ ...p, pos: NODE_POS[p.name] ?? { x: 20 + (i % 4) * 20, y: 80 - Math.floor(i / 4) * 25 } }))
  const focus = people[0]
  return <div className="relation-modal" onMouseDown={onClose}><section className="relation-dialog" onMouseDown={e => e.stopPropagation()}>
    <header className="relation-dialog-head"><div className="relation-title-icon"><GitBranch size={20} /></div><div><label>角色资料 · 全局视图</label><h2>人物关系图预览</h2><p>自动按关系簇分组展示。</p></div><div className="relation-summary"><span><b>{people.length}</b>角色</span><span><b>{relationEdges.length}</b>关系</span></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
    <div className="relation-toolbar"><div className="relation-legend"><span className="family">亲缘</span><span className="ally">同盟</span><span className="complex">复杂</span><span className="enemy">敌对</span></div><div><button><Focus size={14} />适应画布</button></div></div>
    <div className="relation-scroll"><section className="relation-group main"><header><div><label>关系图 01</label><h3>{focus ? `${focus.name} · 关系网` : '角色关系网'}</h3></div><p><b>{nodes.length}</b> 位角色 · <b>{relationEdges.length}</b> 条关系</p></header>
      <div className="relation-canvas">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{relationEdges.map((edge, index) => { const a = NODE_POS[edge.from]; const b = NODE_POS[edge.to]; if (!a || !b) return null; return <g className={edge.tone} key={index}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} /></g> })}</svg>
        {nodes.map(person => <div className={'relation-node ' + (person.name === (focus?.name) ? 'focus' : '')} key={person.id} style={{ left: person.pos.x + '%', top: person.pos.y + '%' }}><b style={{ background: person.color }}>{person.name.slice(0, 1)}</b><span><strong>{person.name}</strong><small>{person.role || person.aliases}</small></span></div>)}
      </div></section></div>
    <footer className="relation-dialog-foot"><span><CloudOff size={13} />关系数据仅保存在本地作品中</span><Button onClick={onClose}>关闭预览</Button></footer>
  </section></div>
}

// ---------------------------------------------------------------- Locations
function LocationsPage({ workspace, reload }: { workspace: Workspace; reload: () => Promise<void> }) {
  const locs = workspace.locations
  const [selectedId, setSelectedId] = useState(locs[0]?.id ?? '')
  const [editing, setEditing] = useState<Loc | null>(null)
  const [creating, setCreating] = useState(false)
  useEffect(() => { if (!locs.find(l => l.id === selectedId)) setSelectedId(locs[0]?.id ?? '') }, [locs])
  const current = locs.find(l => l.id === selectedId) ?? locs[0]
  const childrenOf = (id: string | null) => locs.filter(l => l.parent_location_id === id)

  const Tree = ({ nodes, depth }: { nodes: Loc[]; depth: number }) => <>{nodes.map(node => <div key={node.id}><button className={node.id === selectedId ? 'active' : ''} style={{ paddingLeft: 10 + depth * 16 }} onClick={() => setSelectedId(node.id)}><ChevronDown size={12} /><MapPin size={13} /><span><strong>{node.name}</strong><small>{node.type}</small></span></button>{childrenOf(node.id).length > 0 && <section><Tree nodes={childrenOf(node.id)} depth={depth + 1} /></section>}</div>)}</>

  if (locs.length === 0) return <EmptyStateWrap icon={MapPin} title="还没有地点" desc="建立地点层级，让故事的空间更有层次。" action={() => setCreating(true)} />

  return <><div className="master-detail">
    <aside className="entity-pane"><PaneHead eyebrow="空间资料" title="地点" onAdd={() => setCreating(true)} /><SearchBox text="搜索地点" /><div className="tree"><Tree nodes={childrenOf(null)} depth={0} /></div></aside>
    {current && <section className="entity-detail"><div className="location-hero"><span><MapPin size={28} /></span><div><label>{current.type || '地点'} · 主要舞台</label><h1>{current.name}</h1><p>{current.description || '暂无描述'}</p></div><Button kind="danger" onClick={async () => { if (confirm(`删除地点「${current.name}」？`)) { await workspaceApi.deleteLocation(current.id); await reload() } }}><Trash2 size={14} />删除</Button><Button kind="primary" onClick={() => setEditing(current)}><PenLine size={14} />编辑地点</Button></div>
      <div className="detail-grid"><Detail title="地点描述" wide><p className="lead">{current.description || '暂无描述'}</p></Detail><Detail title="下级地点"><div className="number-pair"><span><b>{childrenOf(current.id).length}</b>直接下级</span><span><b>{locs.length}</b>全部地点</span></div></Detail><Detail title="所属层级"><p>{current.parent_location_id ? locs.find(l => l.id === current.parent_location_id)?.name ?? '顶级' : '顶级地点'}</p></Detail></div>
    </section>}
  </div>
  {creating && <LocationForm novelId={workspace.novel.id} locations={locs} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await reload() }} />}
  {editing && <LocationForm novelId={workspace.novel.id} locations={locs} initial={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload() }} />}
  </>
}

function LocationForm({ novelId, locations, initial, onClose, onSaved }: { novelId: string; locations: Loc[]; initial?: Loc; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState(initial?.type ?? '')
  const [parent, setParent] = useState(initial?.parent_location_id ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const { busy, error, run } = useAsyncAction()
  const submit = () => run(async () => {
    const data = { name: name.trim() || '未命名地点', type, description, parent_location_id: parent || null }
    if (initial) await workspaceApi.updateLocation(initial.id, data); else await workspaceApi.createLocation(novelId, data)
    onSaved()
  })
  return <Modal eyebrow={initial ? '编辑地点' : '新建地点'} title={name || '新地点'} icon={MapPin} onClose={onClose}
    footer={<div className="form-actions">{error && <span className="form-error">{error}</span>}<Button onClick={onClose}>取消</Button><Button kind="primary" onClick={submit} disabled={busy}>{busy ? '保存中…' : '保存'}</Button></div>}>
    <div className="form-body">
      <div className="form-row"><Field label="名称"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} autoFocus /></Field><Field label="类型"><input className={inputCls} value={type} onChange={e => setType(e.target.value)} placeholder="城市 / 建筑 / 区域" /></Field></div>
      <Field label="上级地点"><select className={selectCls} value={parent} onChange={e => setParent(e.target.value)}><option value="">（顶级地点）</option>{locations.filter(l => l.id !== initial?.id).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
      <Field label="描述"><textarea className={areaCls} value={description} onChange={e => setDescription(e.target.value)} /></Field>
    </div>
  </Modal>
}

// ---------------------------------------------------------------- World settings
function WorldPage({ workspace, reload }: { workspace: Workspace; reload: () => Promise<void> }) {
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

// ---------------------------------------------------------------- Plot threads (kanban)
function ThreadsPage({ workspace, reload }: { workspace: Workspace; reload: () => Promise<void> }) {
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

function ThreadForm({ novelId, chapters, characters, initial, onClose, onSaved, onDelete, onAdvance }: { novelId: string; chapters: Chapter[]; characters: Character[]; initial?: PlotThread; onClose: () => void; onSaved: () => void; onDelete?: () => void; onAdvance?: (t: PlotThread) => Promise<void> }) {
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

// ---------------------------------------------------------------- Maps / Library (visual previews)
function MapsPage() {
  return <div className="maps-page"><aside className="entity-pane"><PaneHead eyebrow="空间可视化" title="地图" />{[['临川城全图', '城市 · 8 个标记'], ['城北旧区', '区域 · 5 个标记'], ['沈家密道', '副本 · 4 个标记']].map((x, i) => <button className={'map-list-item ' + (i === 0 ? 'active' : '')} key={x[0]}><span><Map size={17} /></span><div><strong>{x[0]}</strong><small>{x[1]}</small></div><ChevronRight size={13} /></button>)}</aside><section className="map-main"><div className="map-head"><div><label>城市地图</label><strong>临川城全图</strong></div><span><Check size={12} />预览</span><Button>编辑地图信息</Button></div><div className="map-body"><div className="canvas-wrap"><div className="floating-tools"><button className="active"><MousePointer2 size={14} />选择</button><button><MapPin size={14} />标记</button><button><Move size={14} />路线</button><i /><button><Maximize2 size={14} /></button></div><div className="visual-map"><i className="map-river r1" /><i className="map-river r2" /><em className="district d1">城北</em><em className="district d2">长街</em><em className="district d3">水巷</em><Marker cls="p1" label="归雁客栈" /><Marker cls="p2" label="临川书院" /><Marker cls="p3" label="无名渡口" /><Marker cls="p4 active" label="沈家旧宅" /><Marker cls="p5" label="钟楼" /></div></div></div></section></div>
}
function Marker({ cls, label }: { cls: string; label: string }) { return <span className={'marker ' + cls}><i><MapPin size={12} fill="currentColor" /></i><strong>{label}</strong></span> }

function LibraryPage() {
  const items: [string, string, string, string, ElementType][] = [['《故事》', '罗伯特·麦基', '写作技法', '关于场景转折与价值变化的笔记', BookMarked], ['江南城镇建筑资料', '本地 TXT 导入', '世界观素材', '水巷、石桥、沿街建筑的结构参考', FileText], ['雨夜叙事的空间感', '个人笔记', '氛围描写', '雨声、灯光与视线受阻的写法整理', Archive]]
  return <div className="library-page"><aside><div className="library-brand"><LibraryBig size={20} /><span><strong>参考资料库</strong><small>预览模式</small></span></div><nav><button className="active"><LibraryBig size={15} />全部资料<i>38</i></button><button><BookMarked size={15} />书籍<i>12</i></button><button><FileText size={15} />文本摘录<i>18</i></button><button><Archive size={15} />个人笔记<i>8</i></button></nav><button className="import-card"><Upload size={17} /><span><strong>导入 TXT 资料</strong><small>单个文件不超过 2MB</small></span></button></aside><section><PageHeader eyebrow="本地知识库" title="全部资料" desc="这些内容可以作为 AI 生成时的可选参考。" actions={<Button kind="primary"><Plus size={14} />添加资料</Button>} /><div className="library-toolbar"><SearchBox text="搜索标题、作者、摘要或正文…" /><Button>最近更新<ChevronDown size={12} /></Button></div>{items.map(x => { const Icon = x[4]; return <article className="source-row" key={x[0]}><span><Icon size={18} /></span><div><h3>{x[0]} <em>{x[2]}</em></h3><p>{x[3]}</p><small>{x[1]} · 预览数据</small></div><Button kind="ghost"><Plus size={13} />加入 AI 参考</Button><button><MoreHorizontal size={15} /></button></article> })}</section></div>
}

// ---------------------------------------------------------------- Settings
function SettingsPage({ workspace, reload }: { workspace: Workspace; reload: () => Promise<void> }) {
  const sections: [ElementType, string][] = [[Settings, '通用'], [PenLine, '编辑器'], [Bot, 'AI 模型'], [Download, '导出'], [HardDrive, '数据与备份'], [CircleHelp, '关于']]
  const [active, setActive] = useState('AI 模型')
  return <div className="settings-page"><aside><div><label>应用偏好</label><strong>设置</strong></div><nav>{sections.map(([Icon, text], i) => { const I = Icon; return <button className={active === text ? 'active' : ''} key={text} onClick={() => setActive(text)}><I size={15} />{text}</button> })}</nav></aside>
    <section>
      {active === 'AI 模型' && <AISection onSaved={reload} />}
      {active === '导出' && <ExportSection workspace={workspace} />}
      {active === '通用' && <PageHeader title="通用设置" desc="这些设置只保存在当前 Windows 用户配置中。" />}
      {active === '编辑器' && <PageHeader title="编辑器设置" desc="字号、主题与自动保存间隔。" />}
      {active === '数据与备份' && <DataSection />}
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
      {meta?.offline_fallback && '已启用离线兜底：未配置可用密钥时，AI 面板仍可生成示例草稿。'} API Key 仅保存在本地数据库。
    </div>
    <div style={{ maxWidth: 720, margin: '0 auto' }} className="settings-config-list">
      {loading && <p style={{ color: '#999', fontSize: 11 }}>读取配置…</p>}
      {!loading && configs.length === 0 && <EmptyState icon={Bot} title="还没有配置模型" desc="添加一个 OpenAI 兼容模型以启用真实 AI 续写；在此之前将使用离线生成。" action={<Button kind="primary" onClick={() => setCreating(true)}><Plus size={14} />添加模型</Button>} />}
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
  const [apiKey, setApiKey] = useState(initial?.api_key ?? '')
  const [temperature, setTemperature] = useState(String(initial?.temperature ?? 0.85))
  const [maxTokens, setMaxTokens] = useState(String(initial?.max_tokens ?? 1200))
  const [isActive, setIsActive] = useState(initial?.is_active ?? false)
  const { busy, error, run } = useAsyncAction()
  const submit = () => run(async () => {
    const data = { name: name.trim() || '默认模型', provider, model, base_url: baseUrl, api_key: apiKey, temperature: Number(temperature) || 0.85, max_tokens: Number(maxTokens) || 1200, is_active: isActive }
    if (initial) await workspaceApi.updateAIConfig(initial.id, data); else await workspaceApi.createAIConfig(data)
    onSaved()
  })
  return <Modal eyebrow={initial ? '编辑模型' : '添加模型'} title={name || '新模型'} icon={Bot} onClose={onClose}
    footer={<div className="form-actions">{error && <span className="form-error">{error}</span>}<Button onClick={onClose}>取消</Button><Button kind="primary" onClick={submit} disabled={busy}>{busy ? '保存中…' : '保存'}</Button></div>}>
    <div className="form-body">
      <div className="form-row"><Field label="显示名称"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} autoFocus /></Field><Field label="Provider"><select className={selectCls} value={provider} onChange={e => setProvider(e.target.value)}><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="claude">Claude (兼容)</option></select></Field></div>
      <Field label="模型 ID"><input className={inputCls} value={model} onChange={e => setModel(e.target.value)} placeholder="gpt-4o-mini / deepseek-chat / …" /></Field>
      <Field label="Base URL（OpenAI 兼容）"><input className={inputCls} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" /></Field>
      <Field label="API Key"><input className={inputCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-…" /></Field>
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

function DataSection() {
  return <Scroll><PageHeader eyebrow="本地存储" title="数据与备份" desc="所有创作数据都保存在本地 SQLite，无需联网。" />
    <div style={{ maxWidth: 720, margin: '0 auto' }}><div className="setting-block"><header><h2>本地数据库</h2><p>当前数据库运行状态。</p></header><section><div className="database-card"><span><Database size={20} /></span><div><strong>mojing.db</strong><p>SQLite · 本地优先</p><small><Check size={11} />数据库健康 · 数据保存在本机</small></div><Button>打开数据目录</Button></div></section></div></div>
  </Scroll>
}
function AboutSection() {
  return <Scroll><PageHeader eyebrow="关于" title="墨境 Mojing" desc="本地优先的 AI 小说创作工作台。" />
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 12 }}>
      <div className="config-card"><span className="cfg-icon"><Feather size={18} /></span><div className="cfg-body"><strong>墨境 0.3.0</strong><small>Electron + FastAPI + React · SQLite 本地存储</small></div></div>
      <div className="config-card"><span className="cfg-icon"><BrainCircuit size={18} /></span><div className="cfg-body"><strong>核心功能</strong><small>多作品管理 · 章节版本 · 角色 / 地点 / 世界观 / 伏笔 · AI 续写（多模型）</small></div></div>
    </div>
  </Scroll>
}

// ---------------------------------------------------------------- helpers
function EmptyStateWrap({ icon, title, desc, action }: { icon: ElementType; title: string; desc: string; action: () => void }) {
  return <div className="scroll-page"><div className="empty-state" style={{ marginTop: 60 }}><span>{(() => { const I = icon; return <I size={22} /> })()}</span><h3>{title}</h3><p>{desc}</p><Button kind="primary" onClick={action}><Plus size={14} />立即创建</Button></div></div>
}

function CommandPalette({ onClose, onPage }: { onClose: () => void; onPage: (p: Page) => void }) {
  const items: [ElementType, string, Page][] = [[PenLine, '继续写作', 'writing'], [Plus, '新建章节', 'writing'], [BrainCircuit, '打开伏笔看板', 'threads'], [Users, '角色资料', 'characters'], [Globe2, '世界观设定', 'world'], [LibraryBig, '参考资料库', 'library'], [Settings, '打开设置', 'settings']]
  return <div className="modal" onMouseDown={onClose}><div className="command" onMouseDown={e => e.stopPropagation()}><header><Search size={18} /><input autoFocus placeholder="搜索页面、作品或命令…" /><kbd>Esc</kbd></header><label>建议操作</label>{items.map(([Icon, text, p]) => <button key={text} onClick={() => onPage(p)}><span><Icon size={15} /></span><strong>{text}</strong><ChevronRight size={14} /></button>)}<footer><Command size={12} /> 命令面板 <span>↑↓ 选择 · Enter 打开</span></footer></div></div>
}
