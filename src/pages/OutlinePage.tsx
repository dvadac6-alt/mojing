import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, FileText, GitBranch, GripVertical, Link2, MoreHorizontal, Plus } from 'lucide-react'
import type { Character, GraphEdge, PlotThread, Workspace } from '../workspaceApi'
import { workspaceApi } from '../workspaceApi'
import { Button, Field, Modal, PageHeader, Scroll } from '../components/ui'
import { MindMap } from '../components/MindMap'
import { GraphCanvas } from '../components/GraphCanvas'
import { EdgeOverlay } from '../components/EdgeOverlay'

type GraphKind = 'chapters' | 'threads' | 'characters'

const THREAD_STATUS_LABEL: Record<string, string> = { planted: '已埋设', hinted: '已暗示', developing: '发展中', resolved: '已收束' }
const THREAD_PRIORITY_LABEL: Record<string, string> = { major: '主线', minor: '支线', detail: '细节' }

/** Auto-derived (read-only) + manual (stored) edges merged for EdgeOverlay. */
function buildEdges(kind: GraphKind, workspace: Workspace) {
  const auto: { key: string; from: string; to: string; label?: string; kind: 'auto' }[] = []
  if (kind === 'threads') {
    const ids = new Set(workspace.plot_threads.map(t => t.id))
    for (const t of workspace.plot_threads) {
      for (const rid of t.related_threads ?? []) {
        if (ids.has(rid)) auto.push({ key: `a:${t.id}-${rid}`, from: t.id, to: rid, kind: 'auto' })
      }
    }
  } else if (kind === 'characters') {
    const byChar = new Map<string, Set<string>>()
    for (const t of workspace.plot_threads) {
      for (const cid of t.related_characters ?? []) {
        const s = byChar.get(cid) ?? new Set<string>(); s.add(t.id); byChar.set(cid, s)
      }
    }
    const cs = workspace.characters
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = byChar.get(cs[i].id), b = byChar.get(cs[j].id)
      if (a && b && [...a].some(t => b.has(t))) auto.push({ key: `a:${cs[i].id}-${cs[j].id}`, from: cs[i].id, to: cs[j].id, label: '共同伏笔', kind: 'auto' })
    }
  }
  const manual = workspace.graph_edges
    .filter(e => e.kind === kind)
    .map(e => ({ key: `m:${e.id}`, id: e.id, from: e.from_id, to: e.to_id, label: e.label, kind: 'manual' as const }))
  return [...auto, ...manual]
}

/** Plot-thread mind map: threads as ring nodes, edges from related_threads. */
function ThreadGraph({ threads, linkingMode, onPickNode }: { threads: PlotThread[]; linkingMode?: boolean; onPickNode?: (id: string) => void }) {
  const nodes = threads.map(t => ({
    id: t.id, title: t.title,
    sub: `${THREAD_PRIORITY_LABEL[t.priority] ?? t.priority} · ${THREAD_STATUS_LABEL[t.status] ?? t.status}`, tone: t.status,
  }))
  const ids = new Set(threads.map(t => t.id))
  const edges = threads.flatMap(t => (t.related_threads ?? []).filter(id => ids.has(id)).map(id => ({ from: t.id, to: id })))
  return <GraphCanvas nodes={nodes} edges={edges} empty="还没有伏笔，去伏笔看板创建后这里会展示关系网。"
    legend={Object.entries(THREAD_STATUS_LABEL).map(([tone, label]) => ({ label, tone }))}
    linkingMode={linkingMode} onPickNode={onPickNode} />
}

/** Character mind map: characters as ring nodes; an edge when two characters
 *  share at least one plot thread. */
function CharacterGraph({ characters, threads, linkingMode, onPickNode }: { characters: Character[]; threads: PlotThread[]; linkingMode?: boolean; onPickNode?: (id: string) => void }) {
  const nodes = characters.map(c => ({ id: c.id, title: c.name, sub: c.role || c.aliases || '角色' }))
  const threadsByChar = new Map<string, Set<string>>()
  for (const t of threads) for (const cid of t.related_characters ?? []) {
    const set = threadsByChar.get(cid) ?? new Set<string>(); set.add(t.id); threadsByChar.set(cid, set)
  }
  const edges: { from: string; to: string }[] = []
  for (let i = 0; i < characters.length; i++) for (let j = i + 1; j < characters.length; j++) {
    const a = threadsByChar.get(characters[i].id), b = threadsByChar.get(characters[j].id)
    if (a && b && [...a].some(t => b.has(t))) edges.push({ from: characters[i].id, to: characters[j].id })
  }
  return <GraphCanvas nodes={nodes} edges={edges} empty="还没有角色，去角色页创建后这里会展示关系网。"
    legend={[{ label: '共同伏笔', tone: 'shared' }]}
    linkingMode={linkingMode} onPickNode={onPickNode} />
}

export function OutlinePage({ workspace, reload }: { workspace: Workspace; reload: () => void }) {
  const rows = workspace.chapters.map(c => [
    c.title,
    c.word_count > 0 ? `${c.word_count} 字` : '（空白章节）',
    c.status === 'completed' ? '已完成' : c.status === 'writing' ? '写作中' : '草稿',
    'chapter',
  ] as [string, string, string, string])

  const [view, setView] = useState<'list' | 'mind'>('list')
  const [graph, setGraph] = useState<GraphKind>('chapters')
  const [adding, setAdding] = useState(false)
  const [nodeType, setNodeType] = useState<'chapter' | 'scene'>('chapter')
  const [title, setTitle] = useState('')
  const [chapterId, setChapterId] = useState('')
  const [busy, setBusy] = useState(false)

  // Manual-link state machine: off → pick from → pick to → create.
  const [linking, setLinking] = useState(false)
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const renderEdges = useMemo(() => buildEdges(graph, workspace), [graph, workspace])

  // Exit linking whenever leaving the mind-map view or switching graphs.
  useEffect(() => { setLinking(false); setLinkFrom(null); setSelectedEdge(null) }, [view, graph])
  // ESC cancels linking / selection.
  useEffect(() => {
    if (!linking && !selectedEdge) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (linkFrom) setLinkFrom(null); else if (selectedEdge) setSelectedEdge(null); else setLinking(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [linking, linkFrom, selectedEdge])

  const pickNode = (id: string) => {
    if (!linking) return
    if (!linkFrom) { setLinkFrom(id); return }
    if (id === linkFrom) { setLinkFrom(null); return }
    // Skip if an edge already exists either way.
    const exists = renderEdges.some(e => (e.from === linkFrom && e.to === id) || (e.from === id && e.to === linkFrom))
    if (!exists) void workspaceApi.createGraphEdge(workspace.novel.id, graph, linkFrom, id).then(reload)
    setLinkFrom(null)
  }

  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      if (nodeType === 'chapter') await workspaceApi.createChapter(workspace.novel.id, title.trim())
      else { if (!chapterId) return; await workspaceApi.createScene(workspace.novel.id, chapterId, title.trim()) }
      setAdding(false); setTitle(''); reload()
    } finally { setBusy(false) }
  }

  const linkHint = !linking ? '' : linkFrom ? '点击第二个节点完成连线（点同一节点或按 Esc 取消）' : '点击第一个节点开始连线'

  return <Scroll><PageHeader eyebrow="结构规划" title="大纲" desc="按卷、章和场景组织故事结构。章节来自当前作品。" actions={<>
    <Button onClick={() => setView(v => v === 'mind' ? 'list' : 'mind')} kind={view === 'mind' ? 'primary' : 'secondary'}><GitBranch size={15} />思维导图</Button>
    <Button kind="primary" onClick={() => setAdding(true)}><Plus size={15} />添加节点</Button>
  </>} />
    <div className="outline-summary"><span><strong>1</strong>卷</span><span><strong>{workspace.chapters.length}</strong>章节</span><span><strong>{workspace.scenes.length}</strong>场景</span><div><p>整体规划 <b>{Math.min(100, Math.round((workspace.novel.total_words / workspace.novel.target_words) * 100))}%</b></p><i><em /></i></div></div>
    {view === 'mind'
      ? <>
        <div className="mindmap-switch">
          <div className="segments">
            <button className={graph === 'chapters' ? 'active' : ''} onClick={() => setGraph('chapters')}>章节</button>
            <button className={graph === 'threads' ? 'active' : ''} onClick={() => setGraph('threads')}>伏笔</button>
            <button className={graph === 'characters' ? 'active' : ''} onClick={() => setGraph('characters')}>角色</button>
          </div>
          <Button kind={linking ? 'primary' : 'secondary'} onClick={() => { setLinking(l => !l); setLinkFrom(null); setSelectedEdge(null) }}><Link2 size={14} />连线</Button>
          <span>{linkHint || (graph === 'chapters' ? '卷 → 章 → 场景结构' : graph === 'threads' ? '伏笔关联网' : '角色共享伏笔关系')}</span>
        </div>
        {linking && <div className="link-hint">{linkHint || '点击节点开始连线，双击连线可添加介绍文字'}</div>}
        <div className="graph-stage" ref={stageRef}>
          {graph === 'chapters' && <MindMap workspace={workspace} reload={reload} linkingMode={linking} onPickNode={pickNode} />}
          {graph === 'threads' && <section className="graph-panel"><ThreadGraph threads={workspace.plot_threads} linkingMode={linking} onPickNode={pickNode} /></section>}
          {graph === 'characters' && <section className="graph-panel"><CharacterGraph characters={workspace.characters} threads={workspace.plot_threads} linkingMode={linking} onPickNode={pickNode} /></section>}
          <EdgeOverlay containerRef={stageRef} edges={renderEdges} linkingFrom={linkFrom} selectedEdgeId={selectedEdge}
            onSelectEdge={setSelectedEdge}
            onEditLabel={(e, label) => void workspaceApi.setGraphEdgeLabel(e.id, label).then(reload)}
            onDeleteEdge={e => void workspaceApi.deleteGraphEdge(e.id).then(() => { setSelectedEdge(null); reload() })} />
        </div>
      </>
      : <section className="outline-table"><header><span>结构与标题</span><span>情节摘要</span><span>状态</span></header>{rows.map((r, i) => <div className={r[3]} key={workspace.chapters[i].id}><span><GripVertical size={13} /><ChevronDown size={13} /><FileText size={14} /><strong>{String(i + 1).padStart(2, '0')} {r[0]}</strong></span><p>{r[1]}</p><em>{r[2]}</em><button><MoreHorizontal size={15} /></button></div>)}</section>}
    {adding && <Modal eyebrow="大纲" title="添加节点" icon={GitBranch} onClose={() => setAdding(false)}
      footer={<div className="form-actions"><span className="muted">{nodeType === 'chapter' ? '新章节将追加到章节列表末尾' : '场景归属于所选章节'}</span><Button onClick={() => setAdding(false)}>取消</Button><Button kind="primary" onClick={submit} disabled={busy || !title.trim()}>{busy ? '添加中…' : '添加'}</Button></div>}>
      <div className="form-body">
        <Field label="节点类型">
          <div className="segments">
            <button className={nodeType === 'chapter' ? 'active' : ''} onClick={() => setNodeType('chapter')}>章节</button>
            <button className={nodeType === 'scene' ? 'active' : ''} disabled={workspace.chapters.length === 0}
              onClick={() => { setNodeType('scene'); if (!chapterId) setChapterId(workspace.chapters[0]?.id ?? '') }}>场景</button>
          </div>
        </Field>
        {nodeType === 'scene' && <Field label="所属章节">
          <select value={chapterId} onChange={e => setChapterId(e.target.value)}>
            {workspace.chapters.map(c => <option key={c.id} value={c.id}>{String(c.order).padStart(2, '0')} {c.title}</option>)}
          </select>
        </Field>}
        <Field label="标题"><input autoFocus value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder={nodeType === 'chapter' ? '如：雨夜来客' : '如：雨夜叩门'} /></Field>
      </div>
    </Modal>}
  </Scroll>
}
