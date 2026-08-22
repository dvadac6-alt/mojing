import type { Character, GraphEdge, PlotThread } from '../workspaceApi'

export type GraphKind = 'chapters' | 'threads' | 'characters'

/** Auto-derived (read-only) + manual (stored) edges merged for EdgeOverlay.
 * 抽出为纯函数（无 JSX/无副作用导入），供大纲页使用与 node:test 覆盖。 */
export function buildEdges(kind: GraphKind, data: { plot_threads: PlotThread[]; characters: Character[]; graph_edges: GraphEdge[] }) {
  const auto: { key: string; from: string; to: string; label?: string; kind: 'auto' }[] = []
  if (kind === 'threads') {
    const ids = new Set(data.plot_threads.map(t => t.id))
    for (const t of data.plot_threads) {
      for (const rid of t.related_threads ?? []) {
        if (ids.has(rid)) auto.push({ key: `a:${t.id}-${rid}`, from: t.id, to: rid, kind: 'auto' })
      }
    }
  } else if (kind === 'characters') {
    const byChar = new Map<string, Set<string>>()
    for (const t of data.plot_threads) {
      for (const cid of t.related_characters ?? []) {
        const s = byChar.get(cid) ?? new Set<string>(); s.add(t.id); byChar.set(cid, s)
      }
    }
    const cs = data.characters
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = byChar.get(cs[i].id), b = byChar.get(cs[j].id)
      if (a && b && [...a].some(t => b.has(t))) auto.push({ key: `a:${cs[i].id}-${cs[j].id}`, from: cs[i].id, to: cs[j].id, label: '共同伏笔', kind: 'auto' })
    }
  }
  const manual = data.graph_edges
    .filter(e => e.kind === kind)
    .map(e => ({ key: `m:${e.id}`, id: e.id, from: e.from_id, to: e.to_id, label: e.label, kind: 'manual' as const }))
  return [...auto, ...manual]
}
