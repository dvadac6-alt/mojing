export type GraphNode = { id: string; title: string; sub?: string; tone?: string }
export type GraphEdge = { from: string; to: string }
export type GraphLegendItem = { label: string; tone: string }

/**
 * Ring-layout relation graph (no chart deps): nodes sit evenly on a circle
 * (percentage coords), edges are SVG lines in a 0..100 viewBox. Used by the
 * outline page for the plot-thread and character mind maps.
 */
export function GraphCanvas({ nodes, edges, legend, empty, linkingMode, onPickNode }: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  legend?: GraphLegendItem[]
  empty?: string
  linkingMode?: boolean
  onPickNode?: (id: string) => void
}) {
  if (nodes.length === 0) {
    return <div className={'graph-canvas' + (linkingMode ? ' linking' : '')}><div className="graph-empty">{empty ?? '暂无节点'}</div></div>
  }
  const positioned = nodes.map((n, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI - Math.PI / 2
    return { ...n, x: 50 + 36 * Math.cos(angle), y: 50 + 36 * Math.sin(angle) }
  })
  const posOf = (id: string) => positioned.find(n => n.id === id)
  return (
    <div className={'graph-canvas' + (linkingMode ? ' linking' : '')}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {edges.map((e, i) => {
          const a = posOf(e.from)
          const b = posOf(e.to)
          if (!a || !b) return null
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        })}
      </svg>
      {positioned.map(n => (
        <div className={'graph-node' + (n.tone ? ' ' + n.tone : '') + (linkingMode ? ' linkable' : '')} key={n.id}
          data-node-id={n.id}
          style={{ left: n.x + '%', top: n.y + '%' }}
          title={n.title}
          onClick={() => { if (linkingMode) onPickNode?.(n.id) }}>
          <strong>{n.title}</strong>
          {n.sub && <small>{n.sub}</small>}
        </div>
      ))}
      {legend && legend.length > 0 && (
        <div className="graph-legend">{legend.map(l => <span key={l.label} className={l.tone}>{l.label}</span>)}</div>
      )}
    </div>
  )
}
