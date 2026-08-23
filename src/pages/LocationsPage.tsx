import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, MapPin, PenLine, Trash2 } from 'lucide-react'
import { workspaceApi, type Location as Loc, type StoryMap, type Workspace } from '../workspaceApi'
import { Button, Detail, EmptyStateWrap, Field, FormFooter, Modal, PaneHead, SearchBox } from '../components/ui'
import { areaCls, inputCls, selectCls } from '../lib/constants'
import { confirmDialog } from '../components/Confirm'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { useEntityList } from '../hooks/useEntityList'

// Module-level on purpose: defining Tree inside LocationsPage made it a *new
// component type* on every render, so React unmounted and rebuilt the whole
// tree (losing DOM state like focus) instead of diffing it. Props in, no closure.
function Tree({ nodes, depth, childrenOf, collapsed, selectedId, onSelect, onToggle }: {
  nodes: Loc[]
  depth: number
  childrenOf: (id: string | null) => Loc[]
  collapsed: Set<string>
  selectedId: string
  onSelect: (id: string) => void
  onToggle: (id: string) => void
}) {
  return <>{nodes.map(node => {
    const hasKids = childrenOf(node.id).length > 0
    const isCollapsed = collapsed.has(node.id)
    return <div key={node.id}>
      <div className="tree-row" style={{ paddingLeft: 8 + depth * 16 }}>
        {/* Arrow toggles expand/collapse; the row itself selects the location. */}
        <button className={'tree-arrow' + (isCollapsed ? ' collapsed' : '')}
          style={{ visibility: hasKids ? 'visible' : 'hidden' }}
          aria-label={isCollapsed ? '展开' : '收缩'}
          onClick={e => { e.stopPropagation(); onToggle(node.id) }}>
          <ChevronDown size={12} />
        </button>
        <button className={node.id === selectedId ? 'active' : ''} onClick={() => onSelect(node.id)}>
          <MapPin size={13} /><span><strong>{node.name}</strong><small>{node.type}</small></span>
        </button>
      </div>
      {hasKids && !isCollapsed && <section><Tree nodes={childrenOf(node.id)} depth={depth + 1} childrenOf={childrenOf} collapsed={collapsed} selectedId={selectedId} onSelect={onSelect} onToggle={onToggle} /></section>}
    </div>
  })}</>
}

export function LocationsPage({ workspace, reload }: { workspace: Workspace; reload: () => Promise<void> }) {
  const novelId = workspace.novel.id
  // #2 懒加载：地点按需拉取 + 缓存；变更 patch（接口返回新实体），
  // 新增/删除影响侧栏计数 → 补一次轻量 workspace reload。
  const { items: locs, loading, patch: patchLocations } = useEntityList('locations', novelId, workspaceApi.listLocations)
  const [selectedId, setSelectedId] = useState(locs[0]?.id ?? '')
  const [editing, setEditing] = useState<Loc | null>(null)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  // Nodes the user has collapsed. Empty set = everything expanded (the default),
  // so the tree looks exactly like before until an arrow is clicked.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  useEffect(() => { if (!locs.find(l => l.id === selectedId)) setSelectedId(locs[0]?.id ?? '') }, [locs])
  const current = locs.find(l => l.id === selectedId) ?? locs[0]
  // Parent→children index: the tree calls childrenOf() for every rendered node,
  // so a Map lookup (O(1)) replaces an O(N) filter per node — matters once a
  // novel has hundreds of locations.
  const kidsByParent = useMemo(() => {
    const m = new Map<string, Loc[]>()
    for (const l of locs) {
      if (!l.parent_location_id) continue
      const arr = m.get(l.parent_location_id)
      if (arr) arr.push(l); else m.set(l.parent_location_id, [l])
    }
    return m
  }, [locs])
  const childrenOf = useCallback(
    (id: string | null) => (id ? (kidsByParent.get(id) ?? []) : locs.filter(l => !l.parent_location_id)),
    [kidsByParent, locs],
  )

  const toggleCollapse = (id: string) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const upsert = (saved: Loc, affectsCount: boolean) => {
    patchLocations(prev =>
      prev.some(l => l.id === saved.id) ? prev.map(l => (l.id === saved.id ? saved : l)) : [...prev, saved])
    if (affectsCount) void reload()
  }

  if (loading) return <div className="page-loading-fallback">加载中…</div>
  if (locs.length === 0) return <><EmptyStateWrap icon={MapPin} title="还没有地点" desc="建立地点层级，让故事的空间更有层次。" action={() => setCreating(true)} />{creating && <LocationForm novelId={novelId} locations={locs} onClose={() => setCreating(false)} onSaved={saved => { setCreating(false); upsert(saved, true) }} />}</>

  // 搜索时展示扁平的匹配列表（层级树不便展示跨层级命中），清空后回到树。
  const q = query.trim()
  const matches = q ? locs.filter(l => l.name.includes(q) || (l.type ?? '').includes(q)) : null

  return <><div className="master-detail">
    <aside className="entity-pane"><PaneHead eyebrow="空间资料" title="地点" onAdd={() => setCreating(true)} /><SearchBox text="搜索地点" value={query} onChange={setQuery} /><div className="tree">
      {matches
        ? <>{matches.map(l => <div className="tree-row" key={l.id} style={{ paddingLeft: 8 }}><span style={{ width: 12 }} /><button className={l.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(l.id)}><MapPin size={13} /><span><strong>{l.name}</strong><small>{l.type}</small></span></button></div>)}
          {matches.length === 0 && <p style={{ padding: '12px 8px', color: 'var(--text-3)', fontSize: 11 }}>没有匹配「{q}」的地点</p>}</>
        : <Tree nodes={childrenOf(null)} depth={0} childrenOf={childrenOf} collapsed={collapsed} selectedId={selectedId} onSelect={setSelectedId} onToggle={toggleCollapse} />}
    </div></aside>
    {current && <section className="entity-detail"><div className="location-hero"><span><MapPin size={28} /></span><div><label>{current.type || '地点'} · 主要舞台</label><h1>{current.name}</h1><p>{current.description || '暂无描述'}</p></div><Button kind="danger" onClick={async () => { const ok = await confirmDialog({ title: '删除地点', message: `删除地点「${current.name}」？其下级地点会被保留并上浮一级。`, danger: true }); if (ok) { await workspaceApi.deleteLocation(current.id); patchLocations(prev => prev.filter(l => l.id !== current.id)); void reload() } }}><Trash2 size={14} />删除</Button><Button kind="primary" onClick={() => setEditing(current)}><PenLine size={14} />编辑地点</Button></div>
      <div className="detail-grid"><Detail title="地点描述" wide><p className="lead">{current.description || '暂无描述'}</p></Detail><Detail title="下级地点"><div className="number-pair"><span><b>{childrenOf(current.id).length}</b>直接下级</span><span><b>{locs.length}</b>全部地点</span></div></Detail><Detail title="所属层级"><p>{current.parent_location_id ? locs.find(l => l.id === current.parent_location_id)?.name ?? '顶级' : '顶级地点'}</p></Detail></div>
    </section>}
  </div>
  {creating && <LocationForm novelId={novelId} locations={locs} onClose={() => setCreating(false)} onSaved={saved => { setCreating(false); upsert(saved, true) }} />}
  {editing && <LocationForm novelId={novelId} locations={locs} initial={editing} onClose={() => setEditing(null)} onSaved={saved => { setEditing(null); upsert(saved, false) }} />}
  </>
}

function LocationForm({ novelId, locations, initial, onClose, onSaved }: { novelId: string; locations: Loc[]; initial?: Loc; onClose: () => void; onSaved: (saved: Loc) => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState(initial?.type ?? '')
  const [parent, setParent] = useState(initial?.parent_location_id ?? '')
  const [mapId, setMapId] = useState(initial?.map_id ?? '')
  const [maps, setMaps] = useState<StoryMap[]>([])
  const [description, setDescription] = useState(initial?.description ?? '')
  const { busy, error, run } = useAsyncAction()
  useEffect(() => { workspaceApi.listMaps(novelId).then(setMaps).catch(() => {}) }, [novelId])
  const submit = () => run(async () => {
    const data = { name: name.trim() || '未命名地点', type, description, parent_location_id: parent || null, map_id: mapId || null }
    if (initial) { const saved = await workspaceApi.updateLocation(initial.id, data); onSaved(saved) }
    else { const saved = await workspaceApi.createLocation(novelId, data); onSaved(saved) }
  })
  return <Modal eyebrow={initial ? '编辑地点' : '新建地点'} title={name || '新地点'} icon={MapPin} onClose={onClose}
    footer={<FormFooter error={error} busy={busy} onClose={onClose} onSubmit={submit} />}>
    <div className="form-body">
      <div className="form-row"><Field label="名称"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} autoFocus /></Field><Field label="类型"><input className={inputCls} value={type} onChange={e => setType(e.target.value)} placeholder="城市 / 建筑 / 区域" /></Field></div>
      <div className="form-row">
        <Field label="上级地点"><select className={selectCls} value={parent} onChange={e => setParent(e.target.value)}><option value="">（顶级地点）</option>{locations.filter(l => l.id !== initial?.id).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        <Field label="所属地图"><select className={selectCls} value={mapId} onChange={e => setMapId(e.target.value)}><option value="">（未归属）</option>{maps.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
      </div>
      <Field label="描述"><textarea className={areaCls} value={description} onChange={e => setDescription(e.target.value)} /></Field>
    </div>
  </Modal>
}
