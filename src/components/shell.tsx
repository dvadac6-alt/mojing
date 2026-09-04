import { useEffect, useRef, useState } from 'react'
import type { ElementType } from 'react'
import {
  BookOpen, Check, ChevronDown, ChevronRight, CloudOff, Command,
  HardDrive, LibraryBig, Lightbulb, Minimize2, Moon, PanelLeftClose, PenLine,
  Plus, Search, Settings, Square, Sun, BrainCircuit, Users, Globe2, X,
} from 'lucide-react'
import type { Nav, Page } from '../lib/constants'
import type { Novel } from '../workspaceApi'
import { fmt } from '../lib/constants'

export function TitleBar({ onCommand, novel, theme, onToggleTheme }: { onCommand: () => void; novel?: Novel; theme: 'light' | 'dark'; onToggleTheme: () => void }) {
  const desktop = window.mojingDesktop
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    // Initial sync once, then event push from the main process — no more
    // windowIsMaximized IPC on every resize tick.
    void desktop?.windowIsMaximized?.().then(setMaximized)
    const unsub = desktop?.onMaximizeChanged?.(setMaximized)
    return () => { unsub?.() }
  }, [])
  return <header className="titlebar">
    <span className="seal-mark" aria-hidden="true">墨</span><strong className="brand-name">墨境</strong>
    <button className="title-search" onClick={onCommand}><Search size={13} /><span>搜索作品、章节或命令</span><kbd>Ctrl K</kbd></button>
    <span className="title-context"><i />《{novel?.title ?? '未命名作品'}》</span>
    <button className="theme-toggle" onClick={onToggleTheme} title={theme === 'dark' ? '切换到白天模式' : '切换到夜间模式'} aria-label="切换昼夜主题">
      {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
    </button>
    <div className="window-actions">
      <button title="最小化" onClick={() => desktop?.windowMinimize?.()}><Minimize2 size={13} /></button>
      <button title={maximized ? '还原' : '最大化'} onClick={() => desktop?.windowToggleMaximize?.()}>
        {maximized ? <Minimize2 size={11} style={{ transform: 'rotate(180deg)' }} /> : <Square size={11} />}
      </button>
      <button title="关闭" className="close" onClick={() => desktop?.windowClose?.()}><X size={14} /></button>
    </div>
  </header>
}

export function Sidebar({ page, collapsed, onPage, onCollapse, novel, novels, onSwitchNovel, onManageBooks, dataNav, creationNav, unresolvedMajor, onInbox }:
  { page: Page; collapsed: boolean; onPage: (p: Page) => void; onCollapse: () => void; novel: Novel; novels: Novel[]; onSwitchNovel: (id: string) => void; onManageBooks: () => void; dataNav: Nav[]; creationNav: Nav[]; unresolvedMajor: number; onInbox: () => void }) {
  const items = (list: Nav[]) => list.map(({ id, label, icon: Icon, count }) =>
    <button key={id} title={collapsed ? label : ''} className={'nav-item ' + (page === id ? 'active' : '')} onClick={() => onPage(id)}>
      <Icon size={17} />{!collapsed && <><span>{label}</span>{count !== undefined && count > 0 && <small>{count}</small>}</>}
    </button>)
  return <aside className={'sidebar ' + (collapsed ? 'collapsed' : '')}>
    <BookSwitcher novel={novel} novels={novels} collapsed={collapsed} onSwitch={onSwitchNovel} onManageBooks={onManageBooks} />
    <div className="nav-scroll">{!collapsed && <label>创作</label>}{items(creationNav)}{!collapsed && <label className="spaced">资料</label>}{items(dataNav)}{!collapsed && unresolvedMajor > 0 && <em className="nav-warn">{unresolvedMajor} 条主线待收束</em>}</div>
    <div className="sidebar-foot">
      <button className="nav-item" onClick={onInbox} title="灵感收集箱"><Lightbulb size={17} />{!collapsed && <span>灵感箱</span>}</button>
      <button className={'nav-item ' + (page === 'library' ? 'active' : '')} onClick={() => onPage('library')}><LibraryBig size={17} />{!collapsed && <span>参考资料库</span>}</button>
      <button className={'nav-item ' + (page === 'settings' ? 'active' : '')} onClick={() => onPage('settings')}><Settings size={17} />{!collapsed && <span>设置</span>}</button>
      <button className="nav-item" onClick={onCollapse}>{collapsed ? <ChevronRight size={17} /> : <PanelLeftClose size={17} />}{!collapsed && <span>收起侧栏</span>}</button>
    </div>
  </aside>
}

/** The book picker at the top of the sidebar. Clicking the chevron opens a
 * dropdown listing all novels (current one highlighted); picking one switches
 * the active workspace. The list shows up to ~3 rows at a time and scrolls
 * when there are more. */
function BookSwitcher({ novel, novels, collapsed, onSwitch, onManageBooks }: { novel: Novel; novels: Novel[]; collapsed: boolean; onSwitch: (id: string) => void; onManageBooks: () => void }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape so the menu never gets stranded open.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const pick = (id: string) => { setOpen(false); if (id !== novel.id) onSwitch(id) }

  return <div className="book-switch-wrap" ref={wrapRef}>
    <button className={'book-switch' + (open ? ' open' : '')} onClick={() => setOpen(o => !o)} title={collapsed ? novel.title : ''}>
      <b>{novel.title.slice(0, 2)}</b>
      {!collapsed && <>
        <span><strong>{novel.title}</strong><small>{novel.genre || '未分类'} · {novel.status === 'completed' ? '已完结' : '连载中'}</small></span>
        <i className={'switch-chev' + (open ? ' flipped' : '')}><ChevronDown size={14} /></i>
      </>}
    </button>
    {open && !collapsed && (
      <div className="book-menu" role="menu">
        <label>切换作品</label>
        <div className="book-menu-list">
          {novels.length === 0 && <p className="book-menu-empty">还没有其他作品</p>}
          {novels.map(n => (
            <button key={n.id} className={'book-menu-item' + (n.id === novel.id ? ' active' : '')} onClick={() => pick(n.id)}>
              <b>{n.title.slice(0, 1)}</b>
              <span><strong>{n.title}</strong><small>{fmt(n.total_words)} 字 · {n.chapter_count} 章</small></span>
              {n.id === novel.id && <i className="cur"><Check size={13} /></i>}
            </button>
          ))}
        </div>
        <button className="book-menu-manage" onClick={() => { setOpen(false); onManageBooks() }}>
          <BookOpen size={13} />管理全部作品
        </button>
      </div>
    )}
  </div>
}

export function StatusBar({ unresolved, novel }: { unresolved: number; novel: Novel }) {
  // 动态保存状态：WritingPage 通过 mojing:save-state 事件广播（解耦，不经 props）。
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error' | null>(null)
  useEffect(() => {
    const onSave = (e: Event) => setSaveState((e as CustomEvent).detail ?? null)
    window.addEventListener('mojing:save-state', onSave)
    return () => window.removeEventListener('mojing:save-state', onSave)
  }, [])
  const saveLabel = saveState === 'saving' ? '正在自动保存…'
    : saveState === 'error' ? '自动保存失败'
    : '自动保存已启用'
  return <footer className="statusbar">
    <span><i><Check size={10} /></i> SQLite 本地数据库</span>
    <span className={saveState === 'error' ? 'sb-error' : undefined}><HardDrive size={12} /> {saveLabel}</span>
    <b />
    <span><CloudOff size={12} /> 本地模式</span>
    <span><BrainCircuit size={12} /> {unresolved} 条伏笔待收束</span>
    <span>{fmt(novel.total_words)} 字</span>
    <span>Mojing 0.3.0</span>
  </footer>
}

export function CommandPalette({ onClose, onPage }: { onClose: () => void; onPage: (p: Page) => void }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const items: [ElementType, string, Page][] = [
    [PenLine, '继续写作', 'writing'], [Plus, '新建章节', 'writing'],
    [BrainCircuit, '打开伏笔看板', 'threads'], [Users, '角色资料', 'characters'],
    [Globe2, '世界观设定', 'world'], [LibraryBig, '参考资料库', 'library'],
    [Settings, '打开设置', 'settings'],
  ]
  const visible = q ? items.filter(([, text]) => text.toLowerCase().includes(q)) : items
  return <div className="modal" onMouseDown={onClose}><div className="command" onMouseDown={e => e.stopPropagation()}><header><Search size={18} /><input autoFocus placeholder="搜索页面、作品或命令…" value={query} onChange={e => setQuery(e.target.value)} /><kbd>Esc</kbd></header><label>建议操作</label>{visible.map(([Icon, text, p]) => <button key={text} onClick={() => onPage(p)}><span><Icon size={15} /></span><strong>{text}</strong><ChevronRight size={14} /></button>)}{visible.length === 0 && <p className="command-empty">没有匹配的命令</p>}<footer><Command size={12} /> 命令面板 <span>输入关键词过滤 · 点击执行</span></footer></div></div>
}
