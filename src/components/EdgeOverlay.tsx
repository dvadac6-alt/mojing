import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { GraphEdge } from '../workspaceApi'

/** One rendered edge. `kind` 'manual' = user-drawn (solid, editable);
 *  'auto' = derived from data (dashed, read-only, no id). */
type RenderEdge = {
  key: string
  id?: string                 // graph-edge id (manual only)
  from: string                // node data-node-id
  to: string                  // node data-node-id
  label?: string
  kind: 'manual' | 'auto'
}

/** Read live node center coordinates (px, relative to container) for every
 *  [data-node-id] inside `containerRef`. Re-measured on resize / scroll /
 *  data changes so flowing (tree) and absolute (ring) layouts both work. */
function useNodePositions(containerRef: React.RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({})
  const measure = () => {
    const container = containerRef.current
    if (!container) return
    const cr = container.getBoundingClientRect()
    const next: Record<string, { x: number; y: number }> = {}
    container.querySelectorAll<HTMLElement>('[data-node-id]').forEach(el => {
      const id = el.dataset.nodeId
      if (!id) return
      const r = el.getBoundingClientRect()
      next[id] = { x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height / 2 }
    })
    setPos(next)
  }
  useLayoutEffect(measure, [])
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.querySelectorAll('[data-node-id]').forEach(n => ro.observe(n))
    el.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    // Late re-measure after fonts/images settle.
    const t = setTimeout(measure, 120)
    return () => { ro.disconnect(); el.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); clearTimeout(t) }
  }, [containerRef])
  return pos
}

/**
 * Absolutely-positioned SVG layer drawing the edges over a mind-map container.
 * Manual edges are solid + interactive (click select, dblclick edit label,
 * × delete); auto edges are dashed + read-only. In linking mode every node
 * becomes clickable as a connection endpoint (handled by the host via
 * data-node-id click delegation).
 */
export function EdgeOverlay({
  containerRef, edges, linkingFrom,
  selectedEdgeId, onSelectEdge,
  onEditLabel, onDeleteEdge,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  edges: RenderEdge[]
  linkingFrom: string | null
  selectedEdgeId: string | null
  onSelectEdge: (id: string | null) => void
  onEditLabel: (edge: GraphEdge, label: string) => void
  onDeleteEdge: (edge: GraphEdge) => void
}) {
  const pos = useNodePositions(containerRef)
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const upd = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    upd()
    const ro = new ResizeObserver(upd); ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  const startEdit = (e: RenderEdge) => {
    if (e.kind !== 'manual' || !e.id) return
    setEditing({ id: e.id, value: e.label ?? '' })
    onSelectEdge(e.id)
  }
  const commitEdit = () => {
    if (!editing) return
    const edge = edges.find(e => e.id === editing.id)
    if (edge && edge.id) {
      const target: GraphEdge = { id: edge.id, novel_id: '', kind: 'chapters', from_id: edge.from, to_id: edge.to, label: edge.label ?? '', created_at: '' }
      onEditLabel(target, editing.value)
    }
    setEditing(null)
  }

  return (
    <svg className={'edge-overlay' + (linkingFrom ? ' linking' : '')} width={size.w} height={size.h}
      onMouseDown={e => { if (e.target === e.currentTarget) onSelectEdge(null) }}>
      {edges.map(e => {
        const a = pos[e.from], b = pos[e.to]
        if (!a || !b) return null
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        const isSel = e.id && selectedEdgeId === e.id
        const manual = e.kind === 'manual'
        return (
          <g key={e.key} className={'edge ' + e.kind + (isSel ? ' selected' : '')}
            onClick={ev => { ev.stopPropagation(); if (manual && e.id) onSelectEdge(e.id) }}
            onDoubleClick={ev => { ev.stopPropagation(); startEdit(e) }}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="edge-hit" />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="edge-line" />
            {/* Label / edit pill at the midpoint. */}
            {editing && editing.id === e.id ? (
              <foreignObject x={mx - 60} y={my - 11} width={120} height={22}>
                <input className="edge-edit" autoFocus value={editing.value}
                  onChange={ev => setEditing(ed => ed ? { ...ed, value: ev.target.value } : ed)}
                  onKeyDown={ev => { if (ev.key === 'Enter') commitEdit(); if (ev.key === 'Escape') setEditing(null) }}
                  onBlur={commitEdit}
                  onMouseDown={ev => ev.stopPropagation()} />
              </foreignObject>
            ) : (manual ? (
              <g className="edge-label-group" transform={`translate(${mx}, ${my})`}>
                {e.label && <rect className="edge-label-bg" x={-((e.label.length * 7) / 2 + 6)} y={-9}
                  width={e.label.length * 7 + 12} height={18} rx={9} />}
                {e.label && <text className="edge-label" textAnchor="middle" dominantBaseline="central">{e.label}</text>}
                {isSel && <g className="edge-del" transform="translate(0, -22)"
                  onClick={ev => { ev.stopPropagation(); if (e.id) onDeleteEdge({ id: e.id, novel_id: '', kind: 'chapters', from_id: e.from, to_id: e.to, label: e.label ?? '', created_at: '' }) }}>
                  <circle r={8} /><g className="edge-del-x"><X size={11} /></g>
                </g>}
              </g>
            ) : (e.label ? (
              <text className="edge-label auto" x={mx} y={my} textAnchor="middle" dominantBaseline="central">{e.label}</text>
            ) : null))}
          </g>
        )
      })}
    </svg>
  )
}
