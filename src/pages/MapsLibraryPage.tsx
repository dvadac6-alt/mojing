import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Brush, Check, ChevronRight, Eraser, Map as MapIcon, MapPin, Maximize2,
  MousePointer2, Move, Palette, Pencil, Plus, Sparkles, Trash2, Undo2, X,
} from 'lucide-react'
import type { Doodle, Location, StoryMap, Terrain, Workspace } from '../workspaceApi'
import { workspaceApi } from '../workspaceApi'
import { Button, PageHeader } from '../components/ui'

/** A marker placed on the map canvas, auto-derived from locations. */
type MarkerDef = { id: string; name: string; type: string; x: number; y: number; level: number }

/** Spread locations across the map canvas in concentric rings grouped by
 * hierarchy level (city → district → building), so related places cluster. */
function layoutMarkers(locations: Location[]): MarkerDef[] {
  const tops = locations.filter(l => !l.parent_location_id || !locations.some(p => p.id === l.parent_location_id))
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

/** Default terrain palette offered when naming a brand-new color. */
const PALETTE = ['#6da06d', '#4a7ba6', '#8a5f9e', '#c9a34e', '#a67538', '#7c8a99', '#b86f6f', '#5d8a7a']
const BRUSH_WIDTHS = [4, 7, 12]
const WIDTH_LABELS = ['细', '中', '粗']

function drawStroke(ctx: CanvasRenderingContext2D, s: Doodle, w: number, h: number) {
  if (s.points.length < 2) return
  ctx.save()
  if (s.eraser) ctx.globalCompositeOperation = 'destination-out'
  ctx.strokeStyle = s.color
  ctx.lineWidth = s.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo((s.points[0][0] / 100) * w, (s.points[0][1] / 100) * h)
  for (let i = 1; i < s.points.length; i++) ctx.lineTo((s.points[i][0] / 100) * w, (s.points[i][1] / 100) * h)
  ctx.stroke()
  ctx.restore()
}

export function MapsPage({ workspace }: { workspace: Workspace }) {
  const novelId = workspace.novel.id
  const allLocations = workspace.locations
  const [selected, setSelected] = useState<Location | null>(null)

  // --- multi-map (realms) ---
  const [maps, setMaps] = useState<StoryMap[]>([])
  const [currentMapId, setCurrentMapId] = useState<string | null>(null)
  const [terrains, setTerrains] = useState<Terrain[]>([])
  const [newMapOpen, setNewMapOpen] = useState(false)
  const [newMapName, setNewMapName] = useState('')
  // id of the map awaiting delete confirmation ('' = none).
  const [confirmDeleteMap, setConfirmDeleteMap] = useState<string | null>(null)

  // --- editing / doodling ---
  const [editMode, setEditMode] = useState(false)
  const [tool, setTool] = useState<'select' | 'brush' | 'eraser'>('select')
  const [brushColor, setBrushColor] = useState(PALETTE[0])
  const [brushWidth, setBrushWidth] = useState(6)
  const [terrainOpen, setTerrainOpen] = useState(true)
  const [doodles, setDoodles] = useState<Doodle[]>([])
  const [confirmClear, setConfirmClear] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [newTerrain, setNewTerrain] = useState<{ color: string; name: string } | null>(null)
  // User-dragged marker positions (percent), overriding the auto-layout.
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({})

  const mapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ id: string } | null>(null)
  const strokeRef = useRef<Doodle | null>(null)
  const saveTimer = useRef<number | null>(null)
  const doodlesRef = useRef<Doodle[]>([])
  useEffect(() => { doodlesRef.current = doodles }, [doodles])

  const currentMap = maps.find(m => m.id === currentMapId) ?? null
  // Locations on this map (legacy rows without a map belong everywhere).
  const mapLocations = allLocations.filter(l => !currentMap || l.map_id === currentMapId || l.map_id === null)
  const baseMarkers = layoutMarkers(mapLocations)
  const markers = baseMarkers.map(m => ({ ...m, ...(overrides[m.id] ?? {}) }))

  // Load the map list once per novel.
  useEffect(() => {
    let alive = true
    workspaceApi.listMaps(novelId).then(list => {
      if (!alive) return
      setMaps(list)
      setCurrentMapId(prev => (list.some(m => m.id === prev) ? prev : (list[0]?.id ?? null)))
    }).catch(() => {})
    return () => { alive = false }
  }, [novelId])

  // Switching map → load its doodles + terrains.
  useEffect(() => {
    if (!currentMapId) { setDoodles([]); setTerrains([]); return }
    const map = maps.find(m => m.id === currentMapId)
    setDoodles(map?.doodles ?? [])
    workspaceApi.listTerrains(currentMapId).then(setTerrains).catch(() => {})
  }, [currentMapId, maps])

  // --- canvas rendering ---
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = mapRef.current
    if (!canvas || !wrap) return
    const dpr = window.devicePixelRatio || 1
    const w = wrap.clientWidth
    const h = wrap.clientHeight
    if (!w || !h) return
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    // Saved strokes first, then the in-progress stroke on top so it stays
    // visible while dragging (and erasing with destination-out hits it last).
    doodlesRef.current.forEach(s => drawStroke(ctx, s, w, h))
    if (strokeRef.current) drawStroke(ctx, strokeRef.current, w, h)
  }, [])

  // Redraw whenever the saved stroke list or the active map changes; this also
  // clears stale doodles when switching maps (the effect runs after the doodles
  // state has been updated for the new map).
  useEffect(() => {
    redraw()
    window.addEventListener('resize', redraw)
    return () => window.removeEventListener('resize', redraw)
  }, [redraw, currentMapId, doodles])

  // --- doodle interaction (brush / eraser) ---
  const onCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (tool === 'select' || !canvasRef.current || !mapRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const rect = canvasRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    strokeRef.current = {
      color: tool === 'eraser' ? '#000' : brushColor,
      width: tool === 'eraser' ? brushWidth * 2.5 : brushWidth,
      eraser: tool === 'eraser',
      points: [[x, y]],
    }
  }, [tool, brushColor, brushWidth])

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const stroke = strokeRef.current
      const canvas = canvasRef.current
      const wrap = mapRef.current
      if (!stroke || !canvas || !wrap) return
      const rect = canvas.getBoundingClientRect()
      const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
      const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100))
      stroke.points.push([x, y])
      redraw()
    }
    const up = () => {
      const stroke = strokeRef.current
      strokeRef.current = null
      if (!stroke || stroke.points.length < 2) return
      const next = [...doodlesRef.current, stroke]
      setDoodles(next)
      // Debounced persist of the full stroke list.
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        if (currentMapId) workspaceApi.updateMap(currentMapId, { doodles: next }).catch(() => {})
      }, 400)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [redraw, currentMapId])

  // --- marker drag (edit mode) ---
  const onMarkerMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    if (!editMode) return
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { id }
  }, [editMode])

  const onMapMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current || !mapRef.current) return
    const rect = mapRef.current.getBoundingClientRect()
    const x = Math.max(2, Math.min(98, ((e.clientX - rect.left) / rect.width) * 100))
    const y = Math.max(2, Math.min(98, ((e.clientY - rect.top) / rect.height) * 100))
    setOverrides(prev => ({ ...prev, [dragRef.current!.id]: { x, y } }))
  }, [])

  const onMapMouseUp = useCallback(() => { dragRef.current = null }, [])

  // --- map actions ---
  const createMap = async () => {
    const name = newMapName.trim()
    if (!name) return
    const created = await workspaceApi.createMap(novelId, { name })
    setMaps(prev => [...prev, created])
    setCurrentMapId(created.id)
    setNewMapOpen(false)
    setNewMapName('')
  }

  const removeMap = async (id: string) => {
    await workspaceApi.deleteMap(id)
    setMaps(prev => {
      const rest = prev.filter(m => m.id !== id)
      if (currentMapId === id) setCurrentMapId(rest[0]?.id ?? null)
      return rest
    })
    setConfirmDeleteMap(null)
  }

  // --- doodle actions ---
  const persistDoodles = (next: Doodle[]) => {
    if (!currentMapId) return
    workspaceApi.updateMap(currentMapId, { doodles: next }).catch(() => {})
  }

  const undo = () => setDoodles(prev => {
    if (!prev.length) return prev
    const next = prev.slice(0, -1)
    persistDoodles(next)
    return next
  })

  const clearDoodles = () => {
    setDoodles([])
    persistDoodles([])
    setConfirmClear(false)
  }

  const saveTerrainRename = async () => {
    if (!renaming) return
    const name = renaming.name.trim()
    if (!name) { setRenaming(null); return }
    const updated = await workspaceApi.updateTerrain(renaming.id, { name })
    setTerrains(prev => prev.map(t => (t.id === updated.id ? updated : t)))
    setRenaming(null)
  }

  const addTerrain = async () => {
    if (!newTerrain || !currentMapId) return
    const name = newTerrain.name.trim() || '地形'
    const created = await workspaceApi.createTerrain(currentMapId, { name, color: newTerrain.color })
    setTerrains(prev => [...prev, created])
    setBrushColor(created.color)
    setNewTerrain(null)
  }

  const pickBrushColor = (t: Terrain) => {
    setBrushColor(t.color)
    setTool('brush')
    setEditMode(false)
  }

  const toolIsPaint = tool === 'brush' || tool === 'eraser'

  return <div className="maps-page">
    <aside className="entity-pane">
      {/* multi-map switcher */}
      <div className="map-switcher">
        <div className="map-switcher-head">
          <div><label>地图 / 界域</label><strong>多地图</strong></div>
          <button title="新建地图" onClick={() => { setNewMapOpen(v => !v); setNewMapName('') }}><Plus size={14} /></button>
        </div>
        {maps.map(m => (
          <div key={m.id} className={'map-item' + (m.id === currentMapId ? ' active' : '')}>
            <button className="map-item-name" onClick={() => { setCurrentMapId(m.id); setSelected(null) }}>{m.name}</button>
            {confirmDeleteMap === m.id
              ? <button className="map-item-del confirm" onClick={() => removeMap(m.id)}>确认?</button>
              : <button className="map-item-del" title="删除地图" onClick={() => setConfirmDeleteMap(m.id)}><X size={11} /></button>}
          </div>
        ))}
        {newMapOpen && (
          <div className="map-new">
            <input autoFocus placeholder="地图名，如：灵界" value={newMapName}
              onChange={e => setNewMapName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void createMap() }} />
            <button onClick={() => void createMap()}><Check size={12} />确定</button>
            <button onClick={() => setNewMapOpen(false)}>取消</button>
          </div>
        )}
        {maps.length === 0 && !newMapOpen && (
          <div className="map-switcher-empty">还没有地图。点 + 新建一张（如「凡界」「灵界」）。</div>
        )}
      </div>
      {/* locations on the current map */}
      <div className="pane-title"><div><label>空间可视化</label><strong>{currentMap ? `${currentMap.name} · 地点` : '地图'}</strong></div></div>
      <div className="map-loc-list">
        {mapLocations.map(loc => (
          <button key={loc.id} className={'map-list-item' + (selected?.id === loc.id ? ' active' : '')}
            onClick={() => setSelected(loc)}>
            <span style={{ color: TYPE_COLOR[loc.type] || '#666' }}><MapPin size={15} /></span>
            <div><strong>{loc.name}</strong><small>{loc.type || '地点'} · {mapLocations.filter(l => l.parent_location_id === loc.id).length} 下级</small></div>
            <ChevronRight size={13} />
          </button>
        ))}
        {mapLocations.length === 0 && (
          <div style={{ padding: 20, color: '#999', fontSize: 11 }}>
            {currentMap ? '本地图还没有地点，可在地点模块新建并选择所属地图。' : '先去地点模块创建地点。'}
          </div>
        )}
      </div>
    </aside>
    <section className="map-main">
      <div className="map-head">
        <div><label>空间关系图</label><strong>{workspace.novel.title} · {currentMap?.name ?? '未选择地图'} · {mapLocations.length} 个地点</strong></div>
        {editMode && <span className="edit-hint"><Pencil size={12} />拖拽标记调整位置</span>}
        <Button kind={terrainOpen ? 'primary' : 'secondary'} onClick={() => setTerrainOpen(v => !v)}>
          <Palette size={13} />地形
        </Button>
        <Button><Maximize2 size={13} />适应画布</Button>
      </div>
      <div className="map-body">
        <div className="canvas-wrap">
          <div className="floating-tools">
            <button className={!editMode && tool === 'select' ? 'active' : ''}
              onClick={() => { setEditMode(false); setTool('select') }}><MousePointer2 size={14} />选择</button>
            <button className={editMode ? 'active' : ''}
              onClick={() => { setEditMode(true); setTool('select') }}><Move size={14} />编辑拖拽</button>
            <button className={tool === 'brush' ? 'active' : ''}
              onClick={() => { setEditMode(false); setTool('brush') }}><Brush size={14} />画笔</button>
            <button className={tool === 'eraser' ? 'active' : ''}
              onClick={() => { setEditMode(false); setTool('eraser') }}><Eraser size={14} />橡皮</button>
            <i />
            {WIDTH_LABELS.map((label, i) => (
              <button key={label} className={brushWidth === BRUSH_WIDTHS[i] ? 'active' : ''}
                onClick={() => setBrushWidth(BRUSH_WIDTHS[i])}>{label}</button>
            ))}
            <i />
            <button title="撤销上一笔" disabled={!doodles.length} onClick={undo}><Undo2 size={14} /></button>
            {confirmClear
              ? <button className="danger" onClick={clearDoodles}>确认清空?</button>
              : <button title="清空全部涂鸦" disabled={!doodles.length} onClick={() => setConfirmClear(true)}><Trash2 size={14} /></button>}
          </div>
          {/* terrain palette (named colors) */}
          {currentMap && terrainOpen && (
            <div className="terrain-panel">
              <div className="terrain-panel-head">地形画板<small>{terrains.length} 种</small></div>
              {terrains.map(t => (
                <div key={t.id} className="terrain-row">
                  <button className={'terrain-swatch' + (brushColor === t.color && tool === 'brush' ? ' active' : '')}
                    style={{ background: t.color }} title="用此颜色作画"
                    onClick={() => pickBrushColor(t)} />
                  {renaming?.id === t.id
                    ? <input className="terrain-name-input" autoFocus value={renaming.name}
                      onChange={e => setRenaming({ ...renaming, name: e.target.value })}
                      onBlur={() => void saveTerrainRename()}
                      onKeyDown={e => { if (e.key === 'Enter') void saveTerrainRename() }} />
                    : <button className="terrain-name" title="点击重命名" onClick={() => setRenaming({ id: t.id, name: t.name })}>{t.name}</button>}
                  <button className="terrain-del" title="删除" onClick={async () => {
                    await workspaceApi.deleteTerrain(t.id)
                    setTerrains(prev => prev.filter(x => x.id !== t.id))
                  }}><X size={11} /></button>
                </div>
              ))}
              {newTerrain
                ? (
                  <div className="terrain-row new">
                    <input type="color" value={newTerrain.color}
                      onChange={e => setNewTerrain({ ...newTerrain, color: e.target.value })} />
                    <input className="terrain-name-input" autoFocus placeholder="地形名，如：草地"
                      value={newTerrain.name}
                      onChange={e => setNewTerrain({ ...newTerrain, name: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') void addTerrain() }} />
                    <button onClick={() => void addTerrain()}><Check size={12} /></button>
                    <button onClick={() => setNewTerrain(null)}><X size={11} /></button>
                  </div>
                )
                : (
                  <button className="terrain-add" onClick={() => setNewTerrain({ color: PALETTE[terrains.length % PALETTE.length], name: '' })}>
                    <Plus size={12} />命名新地形
                  </button>
                )}
            </div>
          )}
          {/* map canvas: doodle layer under markers */}
          <div className={'visual-map' + (editMode ? ' editing' : '')} ref={mapRef}
            onMouseMove={onMapMouseMove} onMouseUp={onMapMouseUp} onMouseLeave={onMapMouseUp}>
            <canvas ref={canvasRef}
              className={'map-canvas' + (toolIsPaint ? ' painting' : '')}
              onMouseDown={onCanvasMouseDown}
              onDoubleClick={() => { if (toolIsPaint) setTool('select') }} />
            {markers.map(m => (
              <span key={m.id} className={'marker' + (m.level === 0 ? ' top' : m.level === 2 ? ' leaf' : '') + (selected?.id === m.id ? ' active' : '') + (editMode ? ' draggable' : '') + (toolIsPaint ? ' passive' : '')}
                style={{ left: m.x + '%', top: m.y + '%', '--mc': TYPE_COLOR[m.type] || '#666' } as React.CSSProperties}
                onMouseDown={e => onMarkerMouseDown(e, m.id)}
                onClick={() => !editMode && !toolIsPaint && setSelected(mapLocations.find(l => l.id === m.id) ?? null)}
                title={m.name}>
                <i><MapPin size={m.level === 0 ? 16 : 12} fill="currentColor" /></i>
                <strong>{m.name}</strong>
              </span>
            ))}
            {!currentMap && <div className="map-empty"><MapIcon size={32} /><p>先在左侧新建一张地图</p></div>}
            {currentMap && markers.length === 0 && !toolIsPaint && <div className="map-empty"><MapIcon size={32} /><p>暂无地点标记，可以先用画笔涂地形</p></div>}
          </div>
        </div>
      </div>
      {/* selected location detail */}
      {selected && (
        <div className="map-detail">
          <div className="map-detail-head">
            <span style={{ background: TYPE_COLOR[selected.type] || '#666' }}><MapPin size={18} /></span>
            <div><label>{selected.type || '地点'}</label><h3>{selected.name}</h3></div>
            <button className="icon-button" onClick={() => setSelected(null)}>×</button>
          </div>
          <p>{selected.description || '暂无描述'}</p>
          {selected.parent_location_id && <small>上级：{mapLocations.find(l => l.id === selected.parent_location_id)?.name ?? '—'}</small>}
          <div className="map-detail-kids">
            {mapLocations.filter(l => l.parent_location_id === selected.id).map(k => (
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
