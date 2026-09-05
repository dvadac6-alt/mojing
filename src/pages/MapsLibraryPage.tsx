import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Brush, Check, ChevronRight, Eraser, Grid3x3, ImagePlus, Map as MapIcon, MapPin, Maximize2,
  MousePointer2, Move, Palette, Pencil, Plus, Sparkles, Trash2, Undo2, X,
} from 'lucide-react'
import type { Doodle, LibraryDoc, Location, StoryMap, Terrain, Workspace } from '../workspaceApi'
import { workspaceApi } from '../workspaceApi'
import { areaCls, inputCls, selectCls } from '../lib/constants'
import { Button, Field, FormFooter, Modal, PageHeader } from '../components/ui'
import { confirmDialog } from '../components/Confirm'
import { toast } from '../components/Toast'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { useEntityList } from '../hooks/useEntityList'
import { layoutMarkers } from '../lib/mapLayout'


const TYPE_COLOR: Record<string, string> = {
  '城市': '#415254', '区域': '#55768a', '街区': '#74806b', '建筑': '#9a6853',
  '渡口': '#6d5360', '地域': '#3b5840', '关隘': '#a67538',
}

/** Default terrain palette offered when naming a brand-new color. */
const PALETTE = ['#6da06d', '#4a7ba6', '#8a5f9e', '#c9a34e', '#a67538', '#7c8a99', '#b86f6f', '#5d8a7a']
const BRUSH_WIDTHS = [4, 7, 12]
const WIDTH_LABELS = ['细', '中', '粗']
/** Grid-cell size in percent for the grid-fill brush — 2% = a 50×50 grid.
 *  A 2×2 brush covers 4%×4%, 3×4 covers 6%×8%. */
const CELL = 2

function drawStroke(ctx: CanvasRenderingContext2D, s: Doodle, w: number, h: number) {
  ctx.save()
  if (s.eraser) ctx.globalCompositeOperation = 'destination-out'
  if (s.shape === 'rect') {
    // Grid-fill brush: each point is [x1%, y1%, x2%, y2%] — a filled rectangle.
    ctx.fillStyle = s.color
    for (const p of s.points) {
      if (p.length < 4) continue
      ctx.fillRect((p[0] / 100) * w, (p[1] / 100) * h, ((p[2] - p[0]) / 100) * w, ((p[3] - p[1]) / 100) * h)
    }
  } else {
    if (s.points.length < 2) { ctx.restore(); return }
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo((s.points[0][0] / 100) * w, (s.points[0][1] / 100) * h)
    for (let i = 1; i < s.points.length; i++) ctx.lineTo((s.points[i][0] / 100) * w, (s.points[i][1] / 100) * h)
    ctx.stroke()
  }
  ctx.restore()
}

export function MapsPage({ workspace }: { workspace: Workspace }) {
  const novelId = workspace.novel.id
  // #2 懒加载：地点按需拉取 + 缓存（地图页的标记来自地点数据）。
  const { items: allLocations } = useEntityList('locations', novelId, workspaceApi.listLocations)
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
  const [tool, setTool] = useState<'select' | 'brush' | 'eraser' | 'grid'>('select')
  const [brushColor, setBrushColor] = useState(PALETTE[0])
  // Grid-fill brush size in cells (w × h). 2×2 default = a chunky terrain tile.
  const [gridW, setGridW] = useState(2)
  const [gridH, setGridH] = useState(2)
  const [brushWidth, setBrushWidth] = useState(6)
  const [terrainOpen, setTerrainOpen] = useState(true)
  const [doodles, setDoodles] = useState<Doodle[]>([])
  const [confirmClear, setConfirmClear] = useState(false)
  // Object URL of the current map's uploaded background image (empty = default
  // parchment background). Fetched as a blob because the endpoint requires auth.
  const [bgUrl, setBgUrl] = useState('')
  // Inline rename of a used color ("未命名" → typed name). null = not editing.
  const [namingColor, setNamingColor] = useState<{ color: string; name: string } | null>(null)
  // Color awaiting delete confirmation — clicking × flips the row into a red
  // "确认删除" bar; the second click removes the paint (all strokes of that
  // color) AND the terrain name, so the color leaves the panel entirely.
  const [confirmingColor, setConfirmingColor] = useState<string | null>(null)
  // User-dragged marker positions (percent), overriding the auto-layout.
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({})

  const mapRef = useRef<HTMLDivElement>(null)
  const bgFileRef = useRef<HTMLInputElement>(null)
  // Two stacked canvases (#4): the base layer holds all committed strokes
  // (repainted only when doodles change), the live layer holds just the stroke
  // currently being dragged (repainted every mousemove). Dragging is O(1)/frame
  // instead of O(N) — matters once a map has dozens of strokes.
  const baseCanvasRef = useRef<HTMLCanvasElement>(null)
  const liveCanvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ id: string } | null>(null)
  const strokeRef = useRef<Doodle | null>(null)
  // Grid-fill brush: tracks which grid cells the current drag has already
  // painted, so dragging back over the same cell doesn't push duplicate rects.
  const gridSeenRef = useRef<Set<string>>(new Set())
  const doodlesRef = useRef<Doodle[]>([])
  useEffect(() => { doodlesRef.current = doodles }, [doodles])

  const currentMap = maps.find(m => m.id === currentMapId) ?? null
  // Locations on this map (legacy rows without a map belong everywhere).
  // Memoized: without it this filter produced a fresh array every render,
  // which invalidated every memo below — so dragging a marker (one
  // setOverrides per mousemove) re-ran the filter + full ring layout + index
  // rebuild every frame. With locations in the hundreds that visibly janks.
  const mapLocations = useMemo(
    () => allLocations.filter(l => !currentMap || l.map_id === currentMapId || l.map_id === null),
    [allLocations, currentMap, currentMapId],
  )
  // Parent→children index built once per render so "下级数量" and the detail
  // panel's child list are O(1) lookups instead of re-filtering every node.
  const kidsByParent = useMemo(() => {
    const m = new Map<string, Location[]>()
    for (const l of mapLocations) {
      if (!l.parent_location_id) continue
      const arr = m.get(l.parent_location_id)
      if (arr) arr.push(l); else m.set(l.parent_location_id, [l])
    }
    return m
  }, [mapLocations])
  // The terrain panel lists only colors actually painted on this map (scanned
  // from strokes), each shown with its name if any. terrainByColor looks up the
  // name; usedColors drives the row list — so the panel reflects what's on the
  // canvas, not a hand-maintained list.
  const usedColors = useMemo(() => {
    const s = new Set<string>()
    for (const d of doodles) if (d.color && !d.eraser) s.add(d.color.toLowerCase())
    return [...s]
  }, [doodles])
  const terrainByColor = useMemo(() => {
    const m = new Map<string, Terrain>()
    for (const t of terrains) m.set(t.color.toLowerCase(), t)
    return m
  }, [terrains])
  const baseMarkers = useMemo(() => layoutMarkers(mapLocations), [mapLocations])
  const markers = useMemo(
    () => baseMarkers.map(m => ({ ...m, ...(overrides[m.id] ?? {}) })),
    [baseMarkers, overrides],
  )

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

  // Switching map → load its strokes + terrains (strokes live in their own
  // table now, one row per pen-up, so loading is independent of the map blob).
  // `alive` guards out-of-order responses: switching maps fast can let map A's
  // slow response land after B's — without the guard it would paint A's
  // strokes onto B's canvas and later undo/clear would hit the wrong mapId.
  useEffect(() => {
    if (!currentMapId) { setDoodles([]); setTerrains([]); return }
    let alive = true
    workspaceApi.listStrokes(currentMapId)
      .then(strokes => {
        if (!alive) return
        setDoodles(strokes.map(s => ({
          color: s.color, width: s.width, eraser: s.eraser, shape: s.shape, points: s.points,
        })))
      })
      .catch(() => { if (alive) setDoodles([]) })
    workspaceApi.listTerrains(currentMapId)
      .then(list => { if (alive) setTerrains(list) })
      .catch(() => {})
    return () => { alive = false }
  }, [currentMapId])

  // Load the background image (if any) for the active map. Auth requires a blob
  // fetch → object URL; revoke the previous URL to avoid leaking blob memory.
  useEffect(() => {
    let cancelled = false
    let createdUrl = ''
    if (currentMapId && currentMap?.background_image) {
      workspaceApi.getMapBackground(currentMapId)
        .then(blob => {
          if (cancelled) return
          createdUrl = URL.createObjectURL(blob)
          setBgUrl(createdUrl)
        })
        .catch(() => setBgUrl(''))
    } else {
      setBgUrl('')
    }
    return () => { cancelled = true; if (createdUrl) URL.revokeObjectURL(createdUrl) }
  }, [currentMapId, currentMap?.background_image])

  const uploadBackground = async (file: File) => {
    if (!currentMapId) return
    try {
      const updated = await workspaceApi.uploadMapBackground(currentMapId, file, file.type || 'image/png')
      setMaps(prev => prev.map(m => (m.id === updated.id ? updated : m)))
    } catch (e) { toast.error('底图上传失败：' + (e instanceof Error ? e.message : '')) }
  }
  const removeBackground = async () => {
    if (!currentMapId) return
    try {
      const updated = await workspaceApi.deleteMapBackground(currentMapId)
      setMaps(prev => prev.map(m => (m.id === updated.id ? updated : m)))
    } catch (e) { toast.error(e instanceof Error ? e.message : '清除底图失败') }
  }

  // --- canvas rendering (two layers) ---
  // sizeCanvas keeps a canvas's backing store in sync with its CSS box + DPR.
  const sizeCanvas = (canvas: HTMLCanvasElement, w: number, h: number) => {
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  // Base layer = every committed stroke. Repainted only when doodles change.
  const redrawBase = useCallback(() => {
    const canvas = baseCanvasRef.current
    const wrap = mapRef.current
    if (!canvas || !wrap) return
    const w = wrap.clientWidth, h = wrap.clientHeight
    if (!w || !h) return
    sizeCanvas(canvas, w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    doodlesRef.current.forEach(s => drawStroke(ctx, s, w, h))
  }, [])

  // Live layer = the stroke currently being dragged. Repainted every move;
  // cleared (nothing drawn) once the stroke is committed to the base layer.
  const redrawLive = useCallback(() => {
    const canvas = liveCanvasRef.current
    const wrap = mapRef.current
    if (!canvas || !wrap) return
    const w = wrap.clientWidth, h = wrap.clientHeight
    if (!w || !h) return
    sizeCanvas(canvas, w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    if (strokeRef.current) drawStroke(ctx, strokeRef.current, w, h)
  }, [])

  const redrawAll = useCallback(() => { redrawBase(); redrawLive() }, [redrawBase, redrawLive])

  // Base repaints when the committed stroke list or the active map changes
  // (also clears stale doodles when switching maps). Resize hits both layers.
  useEffect(() => {
    redrawAll()
    window.addEventListener('resize', redrawAll)
    return () => window.removeEventListener('resize', redrawAll)
  }, [redrawAll, currentMapId, doodles])

  // 涂画类操作必须挂在一张地图上（笔画保存在地图名下）。无地图时引导新建，
  // 而不是静默丢弃涂鸦——那是这套画板最反直觉的历史行为：画完一笔、松手即消失。
  const needMap = () => {
    if (currentMapId) return false
    toast.error('请先新建一张地图：涂鸦与地形命名都保存在地图上')
    setNewMapOpen(true)
    setNewMapName('')
    return true
  }

  // --- doodle interaction (brush / eraser / grid-fill) ---
  // Grid-fill: snap the cursor to a CELL-sized grid and push a [x1,y1,x2,y2]
  // rect per cell the drag touches (de-duped). A 2×2 brush paints 4%×4% tiles.
  const fillCell = useCallback((x: number, y: number) => {
    const stroke = strokeRef.current
    if (!stroke) return
    const cx = Math.floor(x / CELL)
    const cy = Math.floor(y / CELL)
    const key = `${cx},${cy}`
    if (gridSeenRef.current.has(key)) return
    gridSeenRef.current.add(key)
    stroke.points.push([cx * CELL, cy * CELL, (cx + gridW) * CELL, (cy + gridH) * CELL])
  }, [gridW, gridH])

  const onCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (tool === 'select' || !currentMapId || !baseCanvasRef.current || !mapRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const rect = baseCanvasRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    if (tool === 'grid') {
      gridSeenRef.current = new Set()
      strokeRef.current = { color: brushColor, width: 0, shape: 'rect', points: [] }
      fillCell(x, y)
      redrawLive()
    } else {
      strokeRef.current = {
        color: tool === 'eraser' ? '#000' : brushColor,
        width: tool === 'eraser' ? brushWidth * 2.5 : brushWidth,
        eraser: tool === 'eraser',
        points: [[x, y]],
      }
    }
  }, [tool, currentMapId, brushColor, brushWidth, fillCell, redrawLive])

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const stroke = strokeRef.current
      const canvas = baseCanvasRef.current
      const wrap = mapRef.current
      if (!stroke || !canvas || !wrap) return
      const rect = canvas.getBoundingClientRect()
      const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
      const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100))
      if (stroke.shape === 'rect') fillCell(x, y)
      else stroke.points.push([x, y])
      // Only the thin live layer repaints per frame — the base layer (all
      // committed strokes) is untouched, so cost is independent of stroke count.
      redrawLive()
    }
    const up = () => {
      const stroke = strokeRef.current
      strokeRef.current = null
      if (!stroke || !currentMapId) return
      // path needs ≥2 points; a rect grid stroke needs ≥1 filled cell.
      const enough = stroke.shape === 'rect' ? stroke.points.length >= 1 : stroke.points.length >= 2
      if (!enough) return
      // Incremental: append just this one stroke to the server (O(1) per pen-up,
      // instead of rewriting the whole doodle blob). Committing to doodles
      // triggers the base-layer repaint; the live layer clears alongside it.
      setDoodles(prev => [...prev, stroke])
      workspaceApi.createStroke(currentMapId, {
        color: stroke.color, width: stroke.width, eraser: !!stroke.eraser,
        shape: stroke.shape === 'rect' ? 'rect' : 'path',
        points: stroke.points,
      }).catch(() => {})
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [redrawLive, fillCell, currentMapId])

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
    try {
      const created = await workspaceApi.createMap(novelId, { name })
      setMaps(prev => [...prev, created])
      setCurrentMapId(created.id)
      setNewMapOpen(false)
      setNewMapName('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '新建地图失败')
    }
  }

  const removeMap = async (id: string) => {
    try {
      await workspaceApi.deleteMap(id)
      setMaps(prev => {
        const rest = prev.filter(m => m.id !== id)
        if (currentMapId === id) setCurrentMapId(rest[0]?.id ?? null)
        return rest
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除地图失败')
    } finally {
      // 失败也要退出确认态，否则红色的"确认?"按钮会永远卡住。
      setConfirmDeleteMap(null)
    }
  }

  // --- doodle actions (incremental: each op hits a dedicated endpoint) ---
  const undo = () => {
    if (!currentMapId) { needMap(); return }
    if (!doodles.length) return
    setDoodles(prev => (prev.length ? prev.slice(0, -1) : prev))
    workspaceApi.undoLastStroke(currentMapId).catch(() => {})
  }

  const clearDoodles = () => {
    if (!currentMapId) { needMap(); return }
    setDoodles([])
    workspaceApi.clearStrokes(currentMapId).catch(() => {})
    setConfirmClear(false)
  }

  // Name a used color (upsert): if the color already has a terrain row, update
  // its name; otherwise create one. Either way the panel re-renders from
  // usedColors + terrainByColor, so the name shows up next to the swatch.
  const saveName = async () => {
    if (!namingColor || !currentMapId) return
    const name = namingColor.name.trim()
    if (!name) { setNamingColor(null); return }
    const existing = terrains.find(t => t.color.toLowerCase() === namingColor.color.toLowerCase())
    if (existing) {
      const updated = await workspaceApi.updateTerrain(existing.id, { name })
      setTerrains(prev => prev.map(t => (t.id === updated.id ? updated : t)))
    } else {
      const created = await workspaceApi.createTerrain(currentMapId, { name, color: namingColor.color })
      setTerrains(prev => [...prev, created])
    }
    setNamingColor(null)
  }

  // Remove a color from the map: delete every stroke of that color (the paint
  // disappears from the canvas) plus its terrain name. Because the panel lists
  // only colors still present in strokes, the row leaves the panel too.
  const removeColor = async (color: string) => {
    if (!currentMapId) return
    await workspaceApi.deleteStrokesByColor(currentMapId, color)
    setDoodles(prev => prev.filter(d => d.color.toLowerCase() !== color.toLowerCase()))
    const t = terrains.find(x => x.color.toLowerCase() === color.toLowerCase())
    if (t) {
      await workspaceApi.deleteTerrain(t.id)
      setTerrains(prev => prev.filter(x => x.id !== t.id))
    }
    setConfirmingColor(null)
  }

  const toolIsPaint = tool === 'brush' || tool === 'eraser' || tool === 'grid'

  return <div className="maps-page">
    <aside className="entity-pane">
      {/* multi-map switcher */}
      <div className="map-switcher">
        <div className="map-switcher-head">
          <div><label>地图 / 界域</label><strong>多地图</strong></div>
          <button title="新建地图" aria-label="新建地图" onClick={() => { setNewMapOpen(v => !v); setNewMapName('') }}><Plus size={14} /></button>
        </div>
        {maps.map(m => (
          <div key={m.id} className={'map-item' + (m.id === currentMapId ? ' active' : '')}>
            <button className="map-item-name" onClick={() => { setCurrentMapId(m.id); setSelected(null) }}>{m.name}</button>
            {confirmDeleteMap === m.id
              ? <button className="map-item-del confirm" onClick={() => removeMap(m.id)}>确认?</button>
              : <button className="map-item-del" title="删除地图" aria-label="删除地图" onClick={() => setConfirmDeleteMap(m.id)}><X size={11} /></button>}
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
            <div><strong>{loc.name}</strong><small>{loc.type || '地点'} · {(kidsByParent.get(loc.id) ?? []).length} 下级</small></div>
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
        {currentMap && <Button onClick={() => bgFileRef.current?.click()}>
          <ImagePlus size={13} />{currentMap.background_image ? '更换底图' : '上传底图'}
        </Button>}
        {currentMap?.background_image && <Button onClick={() => void removeBackground()}>清除底图</Button>}
        <Button><Maximize2 size={13} />适应画布</Button>
        <input ref={bgFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) void uploadBackground(f); e.target.value = '' }} />
      </div>
      <div className="map-body">
        <div className="canvas-wrap">
          <div className="floating-tools">
            <button className={!editMode && tool === 'select' ? 'active' : ''}
              onClick={() => { setEditMode(false); setTool('select') }}><MousePointer2 size={14} />选择</button>
            <button className={editMode ? 'active' : ''}
              onClick={() => { setEditMode(true); setTool('select') }}><Move size={14} />编辑拖拽</button>
            <button className={tool === 'brush' ? 'active' : ''}
              onClick={() => { if (needMap()) return; setEditMode(false); setTool('brush') }}><Brush size={14} />画笔</button>
            <button className={tool === 'grid' ? 'active' : ''}
              onClick={() => { if (needMap()) return; setEditMode(false); setTool('grid') }}><Grid3x3 size={14} />方格</button>
            <button className={tool === 'eraser' ? 'active' : ''}
              onClick={() => { if (needMap()) return; setEditMode(false); setTool('eraser') }}><Eraser size={14} />橡皮</button>
            <i />
            {/* 自定义颜色：画笔/方格时直接调色，不必先命名地形 */}
            {(tool === 'brush' || tool === 'grid') && (
              <label className="color-picker" title="自定义颜色">
                <span className="cp-swatch" style={{ background: brushColor }} />
                <input type="color" value={brushColor} onChange={e => setBrushColor(e.target.value)} />
              </label>
            )}
            <i />
            {tool === 'grid'
              ? (
                <label className="grid-size" title="方格尺寸（宽 × 高，单位格）">
                  <Grid3x3 size={13} />
                  <input type="number" min={1} max={20} value={gridW}
                    onChange={e => setGridW(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />×
                  <input type="number" min={1} max={20} value={gridH}
                    onChange={e => setGridH(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
                </label>
              )
              : WIDTH_LABELS.map((label, i) => (
                <button key={label} className={brushWidth === BRUSH_WIDTHS[i] ? 'active' : ''}
                  onClick={() => setBrushWidth(BRUSH_WIDTHS[i])}>{label}</button>
              ))}
            <i />
            <button title="撤销上一笔" aria-label="撤销上一笔" disabled={!doodles.length} onClick={undo}><Undo2 size={14} /></button>
            {confirmClear
              ? <button className="danger" onClick={clearDoodles}>确认清空?</button>
              : <button title="清空全部涂鸦" aria-label="清空全部涂鸦" disabled={!doodles.length} onClick={() => setConfirmClear(true)}><Trash2 size={14} /></button>}
          </div>
          {/* terrain palette — auto-scanned from paint on this map.
              Each row = one used color: swatch (click to paint) + name (click
              to rename / "未命名" if none) + × (delete paint + name). */}
          {currentMap && terrainOpen && (
            <div className="terrain-panel">
              {usedColors.length === 0 && (
                <div className="terrain-empty">用画笔或方格涂鸦后，用过的颜色会显示在这里，可逐一命名。</div>
              )}
              {usedColors.map(c => {
                const t = terrainByColor.get(c)
                return (
                  <div key={c} className="terrain-row">
                    {confirmingColor === c
                      ? (
                        <div className="terrain-confirm">
                          <button className="terrain-confirm-del" onClick={() => void removeColor(c)}>
                            确认删除{t ? `「${t.name}」` : '该颜色'}（含涂鸦）
                          </button>
                          <button className="terrain-cancel" title="取消" onClick={() => setConfirmingColor(null)}>取消</button>
                        </div>
                      )
                      : (
                        <>
                          <button className={'terrain-swatch' + (brushColor.toLowerCase() === c && (tool === 'brush' || tool === 'grid') ? ' active' : '')}
                            style={{ background: c }} title="用此颜色作画"
                            onClick={() => { setBrushColor(c); setTool('brush'); setEditMode(false) }} />
                          {namingColor?.color === c
                            ? <input className="terrain-name-input" autoFocus value={namingColor.name}
                                placeholder="输入名称，如：草地"
                                onChange={e => setNamingColor({ color: c, name: e.target.value })}
                                onBlur={() => void saveName()}
                                onKeyDown={e => { if (e.key === 'Enter') void saveName(); if (e.key === 'Escape') setNamingColor(null) }} />
                            : <button className={'terrain-name' + (t ? '' : ' unnamed')} title={t ? '点击重命名' : '点击命名'}
                                onClick={() => setNamingColor({ color: c, name: t?.name ?? '' })}>
                                {t ? t.name : <>未命名 <small>{c}</small></>}
                              </button>}
                          <button className="terrain-del" title="删除颜色与涂鸦" aria-label="删除颜色与涂鸦" onClick={() => setConfirmingColor(c)}><X size={11} /></button>
                        </>
                      )}
                  </div>
                )
              })}
            </div>
          )}
          {/* map canvas: doodle layer under markers */}
          <div className={'visual-map' + (editMode ? ' editing' : '')} ref={mapRef}
            style={bgUrl ? { backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
            onMouseMove={onMapMouseMove} onMouseUp={onMapMouseUp} onMouseLeave={onMapMouseUp}>
            {/* Two stacked canvases: base = committed strokes, live = the stroke
                being dragged. Mouse events hit the base layer; the live layer
                sits above it with pointer-events:none. */}
            <canvas ref={baseCanvasRef}
              className={'map-canvas base' + (toolIsPaint ? ' painting' : '')}
              onMouseDown={onCanvasMouseDown}
              onDoubleClick={() => { if (toolIsPaint) setTool('select') }} />
            <canvas ref={liveCanvasRef} className="map-canvas live" aria-hidden="true" />
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
            {!currentMap && markers.length === 0 && <div className="map-empty"><MapIcon size={32} /><p>先在左侧新建一张地图</p></div>}
            {/* 有地点但还没建图：地点按层级临时布局展示，用底部横幅引导建图，
                不再用居中大字盖在标记上。 */}
            {!currentMap && markers.length > 0 && (
              <div className="map-banner">
                <span>地点已按层级临时布局；新建地图后可涂画地形、命名图例并保存涂鸦</span>
                <button onClick={() => { setNewMapOpen(true); setNewMapName('') }}><Plus size={12} />新建地图</button>
              </div>
            )}
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
            <button className="icon-button" aria-label="关闭详情" onClick={() => setSelected(null)}>×</button>
          </div>
          <p>{selected.description || '暂无描述'}</p>
          {selected.parent_location_id && <small>上级：{mapLocations.find(l => l.id === selected.parent_location_id)?.name ?? '—'}</small>}
          <div className="map-detail-kids">
            {(kidsByParent.get(selected.id) ?? []).map(k => (
              <button key={k.id} onClick={() => setSelected(k)}><MapPin size={11} />{k.name}</button>
            ))}
          </div>
        </div>
      )}
    </section>
  </div>
}

// ============================ 资料库（RAG 场景②） ============================
const LIB_CATEGORIES = ['写作技法', '世界观素材', '历史资料', '氛围描写', '其他']

export function LibraryPage() {
  const [docs, setDocs] = useState<LibraryDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [ragEnabled, setRagEnabled] = useState<boolean | null>(null)
  // 检索测试
  const [testQuery, setTestQuery] = useState('')
  const [testResults, setTestResults] = useState<{ title: string; source_type: string; text: string; score: number }[] | null>(null)
  const [testing, setTesting] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      // 并行拉取：资料列表与 RAG 状态互不依赖。
      const [docList, status] = await Promise.all([workspaceApi.listLibraryDocs(), workspaceApi.ragStatus()])
      setDocs(docList)
      setRagEnabled(status.enabled)
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const selected = docs.find(d => d.id === selectedId) ?? null
  const remove = async (doc: LibraryDoc) => {
    const ok = await confirmDialog({ title: '删除资料', message: `删除「${doc.name}」及其全部索引块？`, danger: true })
    if (ok) { await workspaceApi.deleteLibraryDoc(doc.id); if (selectedId === doc.id) setSelectedId(null); await load() }
  }
  const runTest = async () => {
    if (!testQuery.trim()) return
    setTesting(true); setTestResults(null)
    try {
      const res = await workspaceApi.ragTestSearch(testQuery.trim(), null, ['library'])
      setTestResults(res.results)
    } finally { setTesting(false) }
  }

  return <div className="library-page library-page-live">
    <PageHeader eyebrow="本地知识库" title="参考资料库"
      desc="导入的资料会被切块并向量化，AI 续写时自动检索相关片段作为参考（写作页辅助中心「资料」开关）。"
      actions={<Button kind="primary" onClick={() => setImportOpen(true)}><Plus size={14} />导入资料</Button>} />
    {ragEnabled === false && <div className="rag-warn-banner">未启用语义检索：到 设置 → AI 模型 → 「RAG 模型 API」分区填入 Embedding 服务后，资料库才能被检索注入。</div>}
    <div className="library-body">
      <aside className="library-list">
        {loading && <p className="lib-muted">读取资料…</p>}
        {!loading && docs.length === 0 && <div className="lib-empty"><Sparkles size={24} /><p>还没有资料。点右上「导入资料」加入 TXT 或粘贴笔记。</p></div>}
        {docs.map(d => (
          <button key={d.id} className={'lib-item' + (d.id === selectedId ? ' active' : '')} onClick={() => setSelectedId(d.id)}>
            <span className="lib-item-main"><strong>{d.name}</strong><small>{d.category} · {d.chunks} 块 · {d.size_chars.toLocaleString('zh-CN')} 字</small></span>
            <span className="icon-button" role="button" aria-label="删除" onClick={e => { e.stopPropagation(); void remove(d) }}><Trash2 size={14} /></span>
          </button>
        ))}
      </aside>
      <section className="library-detail">
        {selected ? (
          <>
            <header>
              <div><label>{selected.category}</label><h2>{selected.name}</h2><small>{selected.chunks} 个索引块 · {selected.size_chars.toLocaleString('zh-CN')} 字 · 导入于 {new Date(selected.created_at).toLocaleDateString('zh-CN')}</small></div>
              <Button kind="danger" onClick={() => void remove(selected)}><Trash2 size={13} />删除</Button>
            </header>
            <p className="lib-muted">资料按块索引，生成时整块注入。上方列表点选其他资料可切换查看。</p>
          </>
        ) : (
          <div className="lib-empty big"><Sparkles size={28} /><p>{docs.length ? '选择左侧资料查看详情' : '导入第一批资料，让 AI 写作时有据可依'}</p></div>
        )}
        <div className="lib-test">
          <label>检索测试（只搜资料库）</label>
          <div className="lib-test-row">
            <input value={testQuery} onChange={e => setTestQuery(e.target.value)} placeholder="输入一句话，看能命中哪些资料块…" onKeyDown={e => { if (e.key === 'Enter') void runTest() }} />
            <Button onClick={() => void runTest()} disabled={testing || !testQuery.trim() || ragEnabled === false}>{testing ? '检索中…' : '测试'}</Button>
          </div>
          {testResults && (testResults.length === 0
            ? <p className="lib-muted">没有命中（资料库里可能还没有相关内容）</p>
            : testResults.map((r, i) => (
              <div className="lib-hit" key={i}>
                <header><b>{r.title}</b><span>{r.score}</span></header>
                <p>{r.text.slice(0, 160)}…</p>
              </div>
            )))}
        </div>
      </section>
    </div>
    {importOpen && <ImportDocModal onClose={() => setImportOpen(false)} onSaved={async () => { setImportOpen(false); await load() }} />}
  </div>
}

function ImportDocModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('写作技法')
  const [content, setContent] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const { busy, error, run } = useAsyncAction()
  const pickFile = (file: File | undefined) => {
    if (!file) return
    setName(n => n.trim() || file.name.replace(/\.txt$/i, ''))
    const reader = new FileReader()
    reader.onload = () => setContent(String(reader.result ?? ''))
    reader.readAsText(file, 'utf-8')
  }
  const submit = () => run(async () => {
    await workspaceApi.importLibraryDoc({ name: name.trim() || '未命名资料', content, category })
    onSaved()
  })
  return <Modal eyebrow="资料库" title="导入参考资料" icon={Plus} onClose={onClose}
    footer={<FormFooter error={error} busy={busy} onClose={onClose} onSubmit={submit}
      submitLabel="导入" busyLabel="导入中（切块+向量化）…" submitDisabled={!content.trim()} />}>
    <div className="form-body">
      <Field label="资料名称"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="如：江南城镇建筑资料" /></Field>
      <Field label="分类"><select className={selectCls} value={category} onChange={e => setCategory(e.target.value)}>{LIB_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
      <Field label="选择 TXT 文件（≤2MB）"><input ref={fileRef} type="file" accept=".txt,text/plain" onChange={e => pickFile(e.target.files?.[0])} /></Field>
      <Field label="或直接粘贴内容"><textarea className={areaCls} rows={8} value={content} onChange={e => setContent(e.target.value)} placeholder="也可以把笔记直接粘贴到这里" /></Field>
      <small className="lib-muted">导入后自动切块并向量化；未启用 Embedding 时仅切块，待配置后点设置里的「重建索引」。</small>
    </div>
  </Modal>
}
