import { useState } from 'react'
import {
  Check, ChevronRight, Map as MapIcon, MapPin, Maximize2, MousePointer2,
  Move, Plus, Sparkles,
} from 'lucide-react'
import type { Location, Workspace } from '../workspaceApi'
import { Button, PageHeader } from '../components/ui'

/** A marker placed on the map canvas, auto-derived from locations. */
type MarkerDef = { id: string; name: string; type: string; x: number; y: number; level: number }

/** Spread locations across the map canvas in concentric rings grouped by
 * hierarchy level (city → district → building), so related places cluster. */
function layoutMarkers(locations: Location[]): MarkerDef[] {
  const tops = locations.filter(l => !l.parent_location_id)
  const childrenOf = (id: string) => locations.filter(l => l.parent_location_id === id)
  const out: MarkerDef[] = []
  tops.forEach((top, i) => {
    const angle = (i / Math.max(1, tops.length)) * 2 * Math.PI - Math.PI / 2
    const x = 50 + 30 * Math.cos(angle)
    const y = 50 + 30 * Math.sin(angle)
    out.push({ id: top.id, name: top.name, type: top.type, x, y, level: 0 })
    const kids = childrenOf(top.id)
    kids.forEach((k, j) => {
      const ka = (j / Math.max(1, kids.length)) * 2 * Math.PI
      out.push({ id: k.id, name: k.name, type: k.type, x: x + 14 * Math.cos(ka), y: y + 14 * Math.sin(ka), level: 1 })
      // grandchildren
      const gk = childrenOf(k.id)
      gk.forEach((g, gi) => {
        const ga = (gi / Math.max(1, gk.length)) * 2 * Math.PI
        out.push({ id: g.id, name: g.name, type: g.type, x: x + 14 * Math.cos(ka) + 7 * Math.cos(ga), y: y + 14 * Math.sin(ka) + 7 * Math.sin(ga), level: 2 })
      })
    })
  })
  return out
}

const TYPE_COLOR: Record<string, string> = {
  '城市': '#415254', '区域': '#55768a', '街区': '#74806b', '建筑': '#9a6853',
  '渡口': '#6d5360', '地域': '#3b5840', '关隘': '#a67538',
}

export function MapsPage({ workspace }: { workspace: Workspace }) {
  const locations = workspace.locations
  const [selected, setSelected] = useState<Location | null>(null)
  const markers = layoutMarkers(locations)

  return <div className="maps-page">
    <aside className="entity-pane">
      <div className="pane-title"><div><label>空间可视化</label><strong>地图</strong></div></div>
      <div className="map-loc-list">
        {locations.map(loc => (
          <button key={loc.id} className={'map-list-item' + (selected?.id === loc.id ? ' active' : '')}
            onClick={() => setSelected(loc)}>
            <span style={{ color: TYPE_COLOR[loc.type] || '#666' }}><MapPin size={15} /></span>
            <div><strong>{loc.name}</strong><small>{loc.type || '地点'} · {locations.filter(l => l.parent_location_id === loc.id).length} 下级</small></div>
            <ChevronRight size={13} />
          </button>
        ))}
        {locations.length === 0 && <div style={{ padding: 20, color: '#999', fontSize: 11 }}>还没有地点数据，先去地点模块创建。</div>}
      </div>
    </aside>
    <section className="map-main">
      <div className="map-head">
        <div><label>空间关系图</label><strong>{workspace.novel.title} · {locations.length} 个地点</strong></div>
        <Button><Maximize2 size={13} />适应画布</Button>
      </div>
      <div className="map-body">
        <div className="canvas-wrap">
          <div className="floating-tools">
            <button className="active"><MousePointer2 size={14} />选择</button>
            <button><MapPin size={14} />标记</button>
            <button><Move size={14} />路线</button>
            <i />
            <button><Maximize2 size={14} /></button>
          </div>
          {/* 地图画布：标记自动按层级环形布局 */}
          <div className="visual-map">
            {markers.map(m => (
              <span key={m.id} className={'marker' + (m.level === 0 ? ' top' : m.level === 2 ? ' leaf' : '') + (selected?.id === m.id ? ' active' : '')}
                style={{ left: m.x + '%', top: m.y + '%', '--mc': TYPE_COLOR[m.type] || '#666' } as React.CSSProperties}
                onClick={() => setSelected(locations.find(l => l.id === m.id) ?? null)}
                title={m.name}>
                <i><MapPin size={m.level === 0 ? 16 : 12} fill="currentColor" /></i>
                <strong>{m.name}</strong>
              </span>
            ))}
            {markers.length === 0 && <div className="map-empty"><MapIcon size={32} /><p>暂无地点数据</p></div>}
          </div>
        </div>
      </div>
      {/* 选中地点的详情面板 */}
      {selected && (
        <div className="map-detail">
          <div className="map-detail-head">
            <span style={{ background: TYPE_COLOR[selected.type] || '#666' }}><MapPin size={18} /></span>
            <div><label>{selected.type || '地点'}</label><h3>{selected.name}</h3></div>
            <button className="icon-button" onClick={() => setSelected(null)}>×</button>
          </div>
          <p>{selected.description || '暂无描述'}</p>
          {selected.parent_location_id && <small>上级：{locations.find(l => l.id === selected.parent_location_id)?.name ?? '—'}</small>}
          <div className="map-detail-kids">
            {locations.filter(l => l.parent_location_id === selected.id).map(k => (
              <button key={k.id} onClick={() => setSelected(k)}><MapPin size={11} />{k.name}</button>
            ))}
          </div>
        </div>
      )}
    </section>
  </div>
}

export function LibraryPage() {
  return <div className="library-page"><PageHeader eyebrow="本地知识库" title="参考资料库" desc="这些内容可以作为 AI 生成时的可选参考。" actions={<Button kind="primary"><Plus size={14} />添加资料</Button>} />
    <div className="library-empty"><Sparkles size={28} /><h3>资料库即将上线</h3><p>支持导入 TXT 资料、书籍笔记，作为 AI 续写的参考素材。</p></div>
  </div>
}
