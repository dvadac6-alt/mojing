import { useEffect, useState } from 'react'
import { ChevronDown, MapPin, PenLine, Trash2 } from 'lucide-react'
import { workspaceApi, type Location as Loc, type StoryMap, type Workspace } from '../workspaceApi'
import { Button, Detail, EmptyStateWrap, Field, Modal, PaneHead, SearchBox } from '../components/ui'
import { areaCls, inputCls, selectCls } from '../lib/constants'
import { useAsyncAction } from '../hooks/useAsyncAction'

export function LocationsPage({ workspace, reload }: { workspace: Workspace; reload: () => Promise<void> }) {
  const locs = workspace.locations
  const [selectedId, setSelectedId] = useState(locs[0]?.id ?? '')
  const [editing, setEditing] = useState<Loc | null>(null)
  const [creating, setCreating] = useState(false)
  // Nodes the user has collapsed. Empty set = everything expanded (the default),
  // so the tree looks exactly like before until an arrow is clicked.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  useEffect(() => { if (!locs.find(l => l.id === selectedId)) setSelectedId(locs[0]?.id ?? '') }, [locs])
  const current = locs.find(l => l.id === selectedId) ?? locs[0]
  const childrenOf = (id: string | null) => locs.filter(l => l.parent_location_id === id)

  const toggleCollapse = (id: string) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const Tree = ({ nodes, depth }: { nodes: Loc[]; depth: number }) => <>{nodes.map(node => {
    const hasKids = childrenOf(node.id).length > 0
    const isCollapsed = collapsed.has(node.id)
    return <div key={node.id}>
      <div className="tree-row" style={{ paddingLeft: 8 + depth * 16 }}>
        {/* Arrow toggles expand/collapse; the row itself selects the location. */}
        <button className={'tree-arrow' + (isCollapsed ? ' collapsed' : '')}
          style={{ visibility: hasKids ? 'visible' : 'hidden' }}
          aria-label={isCollapsed ? '展开' : '收缩'}
          onClick={e => { e.stopPropagation(); toggleCollapse(node.id) }}>
          <ChevronDown size={12} />
        </button>
        <button className={node.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(node.id)}>
          <MapPin size={13} /><span><strong>{node.name}</strong><small>{node.type}</small></span>
        </button>
      </div>
      {hasKids && !isCollapsed && <section><Tree nodes={childrenOf(node.id)} depth={depth + 1} /></section>}
    </div>
  })}</>

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
  const [mapId, setMapId] = useState(initial?.map_id ?? '')
  const [maps, setMaps] = useState<StoryMap[]>([])
  const [description, setDescription] = useState(initial?.description ?? '')
  const { busy, error, run } = useAsyncAction()
  useEffect(() => { workspaceApi.listMaps(novelId).then(setMaps).catch(() => {}) }, [novelId])
  const submit = () => run(async () => {
    const data = { name: name.trim() || '未命名地点', type, description, parent_location_id: parent || null, map_id: mapId || null }
    if (initial) await workspaceApi.updateLocation(initial.id, data); else await workspaceApi.createLocation(novelId, data)
    onSaved()
  })
  return <Modal eyebrow={initial ? '编辑地点' : '新建地点'} title={name || '新地点'} icon={MapPin} onClose={onClose}
    footer={<div className="form-actions">{error && <span className="form-error">{error}</span>}<Button onClick={onClose}>取消</Button><Button kind="primary" onClick={submit} disabled={busy}>{busy ? '保存中…' : '保存'}</Button></div>}>
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
