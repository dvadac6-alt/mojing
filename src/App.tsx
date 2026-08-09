import { useEffect, useState } from 'react'
import { AlertTriangle, BookHeart, BrainCircuit, CloudOff, Database, GitBranch, Map, MapPin, PenLine, Users, Globe2 } from 'lucide-react'
import { useWorkspace } from './hooks/useWorkspace'
import { workspaceApi, type Novel } from './workspaceApi'
import type { Nav, Page } from './lib/constants'
import { CommandPalette, Sidebar, StatusBar, TitleBar } from './components/shell'
import { Button } from './components/ui'
import { ProjectsPage } from './pages/ProjectsPage'
import { OverviewPage } from './pages/OverviewPage'
import { WritingPage } from './pages/WritingPage'
import { OutlinePage } from './pages/OutlinePage'
import { CharactersPage } from './pages/CharactersPage'
import { LocationsPage } from './pages/LocationsPage'
import { WorldPage } from './pages/WorldPage'
import { ThreadsPage } from './pages/ThreadsPage'
import { MapsPage, LibraryPage } from './pages/MapsLibraryPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  const { workspace, loadError, reload, patchWorkspace, switchNovel, retry } = useWorkspace()
  const [page, setPage] = useState<Page>('overview')
  const [collapsed, setCollapsed] = useState(false)
  const [assistant, setAssistant] = useState(true)
  const [command, setCommand] = useState(false)
  // All novels for the sidebar book-switcher dropdown (the workspace only
  // carries the currently-open one, so the list is fetched separately and
  // refreshed whenever the active book changes).
  const [novels, setNovels] = useState<Novel[]>([])
  const refreshNovels = () => { void workspaceApi.listNovels().then(setNovels).catch(() => {}) }
  useEffect(refreshNovels, [])

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

  const goto = (next: Page) => setPage(next)
  // Opening a book swaps the workspace (handled in the hook) and lands on that
  // book's overview dashboard; also refresh the switcher list afterwards.
  const openNovel = async (id: string) => { await switchNovel(id); setPage('overview'); refreshNovels() }

  return (
    <div className="desktop">
      <TitleBar onCommand={() => setCommand(true)} novel={novel} />
      <div className="app-body">
        <Sidebar page={page} collapsed={collapsed} onPage={setPage} onCollapse={() => setCollapsed(!collapsed)}
          novel={novel} novels={novels} onSwitchNovel={openNovel} onManageBooks={() => setPage('projects')}
          dataNav={dataNav} creationNav={creationNav} unresolvedMajor={unresolvedMajor} />
        <main className="stage">
          {page === 'projects' && <ProjectsPage onOpen={openNovel} currentId={novel.id} />}
          {page === 'overview' && <OverviewPage workspace={workspace} onWrite={() => setPage('writing')} onGoto={goto} />}
          {page === 'writing' && <WritingPage workspace={workspace} patchWorkspace={patchWorkspace} reload={reload} assistant={assistant} onAssistant={() => setAssistant(!assistant)} onGoto={goto} />}
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
