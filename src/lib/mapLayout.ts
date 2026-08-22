import type { Location } from '../workspaceApi'

/** A marker placed on the map canvas, auto-derived from locations. */
export type MarkerDef = { id: string; name: string; type: string; x: number; y: number; level: number }

/** Spread locations across the map canvas in concentric rings grouped by
 * hierarchy level (city → district → building), so related places cluster.
 * Builds a parent→children index once so lookup is O(1) per node (was O(N)).
 * 纯函数（type-only 导入），供地图页使用与 node:test 覆盖。 */
export function layoutMarkers(locations: Location[]): MarkerDef[] {
  const idSet = new Set(locations.map(l => l.id))
  const kidsByParent = new Map<string, Location[]>()
  for (const l of locations) {
    if (!l.parent_location_id) continue
    const arr = kidsByParent.get(l.parent_location_id)
    if (arr) arr.push(l); else kidsByParent.set(l.parent_location_id, [l])
  }
  const childrenOf = (id: string) => kidsByParent.get(id) ?? []
  // A top-level node has no parent, or its parent isn't in this map's set.
  const tops = locations.filter(l => !l.parent_location_id || !idSet.has(l.parent_location_id))
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
