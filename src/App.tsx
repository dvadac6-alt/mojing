import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BookHeart, BrainCircuit, CalendarClock, CloudOff, Database, GitBranch, Map, MapPin, PenLine, Users, Globe2 } from 'lucide-react'
import { useWorkspace } from './hooks/useWorkspace'
import { useTheme } from './hooks/useTheme'
import { workspaceApi, type Novel } from './workspaceApi'
import type { Nav, Page } from './lib/constants'
import { CommandPalette, Sidebar, StatusBar, TitleBar } from './components/shell'
import { Button } from './components/ui'
import { ToastHost } from './components/Toast'
import { ConfirmHost } from './components/Confirm'
import { IdeaInbox } from './components/IdeaInbox'
import { OverviewPage } from './pages/OverviewPage'
import { WritingPage } from './pages/WritingPage'
// 路由级代码分割：概览/写作是高频入口保持同步加载，其余页面按需加载，
// 首屏 bundle 不再包含设置页与地图页（最重的两块）。
const ProjectsPage = lazy(() => import('./pages/ProjectsPage').then(m => ({ default: m.ProjectsPage })))
const OutlinePage = lazy(() => import('./pages/OutlinePage').then(m => ({ default: m.OutlinePage })))
const CharactersPage = lazy(() => import('./pages/CharactersPage').then(m => ({ default: m.CharactersPage })))
const LocationsPage = lazy(() => import('./pages/LocationsPage').then(m => ({ default: m.LocationsPage })))
const WorldPage = lazy(() => import('./pages/WorldPage').then(m => ({ default: m.WorldPage })))
const ThreadsPage = lazy(() => import('./pages/ThreadsPage').then(m => ({ default: m.ThreadsPage })))
const TimelinePage = lazy(() => import('./pages/TimelinePage').then(m => ({ default: m.TimelinePage })))
const MapsPage = lazy(() => import('./pages/MapsLibraryPage').then(m => ({ default: m.MapsPage })))
const LibraryPage = lazy(() => import('./pages/MapsLibraryPage').then(m => ({ default: m.LibraryPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })))

export default function App() {
  const { workspace, loadError, reload, patchWorkspace, switchNovel, retry } = useWorkspace()
  const { theme, toggleTheme } = useTheme()
  const [page, setPage] = useState<Page>('overview')
  const [collapsed, setCollapsed] = useState(false)
  const [assistant, setAssistant] = useState(true)
  const [command, setCommand] = useState(false)
  const [inboxOpen, setInboxOpen] = useState(false) // F5 灵感收集箱
  // All novels for the sidebar book-switcher dropdown (the workspace only
  // carries the currently-open one, so the list is fetched separately and
  // refreshed whenever the active book changes). ProjectsPage reuses this
  // single source instead of fetching its own copy.
  const [novels, setNovels] = useState<Novel[]>([])
  const refreshNovels = useCallback(() => workspaceApi.listNovels().then(setNovels).catch(() => {}), [])
  useEffect(() => { void refreshNovels() }, [refreshNovels])

  // Ctrl/Cmd+K 打开命令面板（与标题栏搜索按钮一致）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommand(open => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (loadError || !workspace) return (
    <div className="desktop">
      <TitleBar onCommand={() => setCommand(true)} theme={theme} onToggleTheme={toggleTheme} />
      <div className="app-body">
        <main className="stage">
          <div className="writing-state">
            {loadError ? (
              <>
                <span><AlertTriangle size={24} /></span>
                <h2>本地写作服务未连接</h2>
                <p>{loadError}</p>
                <Button kind="primary" onClick={retry}>重新连接</Button>
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
      <ToastHost />
      <ConfirmHost />
    </div>
  )

  const novel = workspace.novel
  const { counts } = workspace
  const creationNav: Nav[] = [
    { id: 'overview', label: '作品概览', icon: BookHeart },
    { id: 'writing', label: '写作', icon: PenLine },
    { id: 'outline', label: '大纲', icon: GitBranch },
  ]
  const dataNav: Nav[] = [
    { id: 'characters', label: '角色', icon: Users, count: counts.characters },
    { id: 'locations', label: '地点', icon: MapPin, count: counts.locations },
    { id: 'world', label: '世界观', icon: Globe2, count: counts.world_settings },
    { id: 'threads', label: '伏笔', icon: BrainCircuit, count: counts.plot_threads },
    { id: 'timeline', label: '时间线', icon: CalendarClock },
    { id: 'maps', label: '地图', icon: Map },
  ]

  const goto = (next: Page) => setPage(next)
  // Opening a book swaps the workspace (handled in the hook) and lands on that
  // book's overview dashboard; also refresh the switcher list afterwards.
  const openNovel = async (id: string) => { await switchNovel(id); setPage('overview'); refreshNovels() }

  return (
    <div className="desktop">
      <TitleBar onCommand={() => setCommand(true)} novel={novel} theme={theme} onToggleTheme={toggleTheme} />
      <div className="app-body">
        <Sidebar page={page} collapsed={collapsed} onPage={setPage} onCollapse={() => setCollapsed(!collapsed)}
          novel={novel} novels={novels} onSwitchNovel={openNovel} onManageBooks={() => setPage('projects')}
          dataNav={dataNav} creationNav={creationNav} unresolvedMajor={counts.unresolved_major} onInbox={() => setInboxOpen(true)} />
        <main className="stage">
          <Suspense fallback={<div className="page-loading-fallback">加载中…</div>}>
            {page === 'projects' && <ProjectsPage onOpen={openNovel} currentId={novel.id} novels={novels} reloadNovels={refreshNovels} />}
            {page === 'overview' && <OverviewPage workspace={workspace} onWrite={() => setPage('writing')} onGoto={goto} />}
            {page === 'writing' && <WritingPage workspace={workspace} patchWorkspace={patchWorkspace} reload={reload} assistant={assistant} onAssistant={() => setAssistant(!assistant)} onGoto={goto} />}
            {page === 'outline' && <OutlinePage workspace={workspace} reload={reload} />}
            {page === 'characters' && <CharactersPage workspace={workspace} reload={reload} />}
            {page === 'locations' && <LocationsPage workspace={workspace} reload={reload} />}
            {page === 'world' && <WorldPage workspace={workspace} reload={reload} />}
            {page === 'threads' && <ThreadsPage workspace={workspace} reload={reload} />}
            {page === 'timeline' && <TimelinePage workspace={workspace} />}
            {page === 'maps' && <MapsPage workspace={workspace} />}
            {page === 'library' && <LibraryPage />}
            {page === 'settings' && <SettingsPage workspace={workspace} reload={reload} />}
          </Suspense>
        </main>
      </div>
      <StatusBar unresolved={counts.unresolved_threads} novel={novel} />
      {command && <CommandPalette onClose={() => setCommand(false)} onPage={(next) => { setPage(next); setCommand(false) }} />}
      {inboxOpen && <IdeaInbox novelId={novel.id} novelTitle={novel.title} onClose={() => setInboxOpen(false)} onGoto={goto} />}
      <ToastHost />
      <ConfirmHost />
    </div>
  )
}
