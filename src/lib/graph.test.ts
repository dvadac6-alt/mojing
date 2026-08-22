import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildEdges } from './graph.ts'
import type { Character, GraphEdge, PlotThread } from '../workspaceApi.ts'

const thread = (id: string, related_threads: string[] = [], related_characters: string[] = []): PlotThread => ({
  id, novel_id: 'n1', title: `t-${id}`, description: '', status: 'planted', priority: 'minor',
  planted_chapter_id: null, resolved_chapter_id: null, related_characters, related_threads,
  related_locations: [], notes: '', created_at: '', updated_at: '',
})
const char = (id: string): Character => ({
  id, novel_id: 'n1', name: `c-${id}`, aliases: '', role: '', color: '', description: '',
  personality: '', background: '', appearance: '', abilities: '', relationships: {},
  first_appearance_chapter_id: null, created_at: '', updated_at: '',
})
const edge = (id: string, from: string, to: string): GraphEdge => ({
  id, novel_id: 'n1', kind: 'threads', from_id: from, to_id: to, label: '', created_at: '',
})

test('threads: related_threads 生成 auto 边，悬挂引用被忽略', () => {
  const data = {
    plot_threads: [thread('a', ['b', 'ghost']), thread('b'), thread('c')],
    characters: [],
    graph_edges: [] as GraphEdge[],
  }
  const edges = buildEdges('threads', data)
  assert.equal(edges.length, 1)
  assert.deepEqual(edges[0], { key: 'a:a-b', from: 'a', to: 'b', kind: 'auto' })
})

test('characters: 共享至少一条伏笔的两个角色连边', () => {
  const data = {
    plot_threads: [thread('t1', [], ['c1', 'c2']), thread('t2', [], ['c1']), thread('t3', [], ['c3'])],
    characters: [char('c1'), char('c2'), char('c3')],
    graph_edges: [] as GraphEdge[],
  }
  const edges = buildEdges('characters', data)
  assert.equal(edges.length, 1)
  assert.equal(edges[0].from, 'c1')
  assert.equal(edges[0].to, 'c2')
  assert.equal(edges[0].label, '共同伏笔')
})

test('manual 边按 kind 过滤并保留 id', () => {
  const data = {
    plot_threads: [],
    characters: [],
    graph_edges: [edge('e1', 'x', 'y')],
  }
  const edges = buildEdges('threads', data)
  assert.equal(edges.length, 1)
  const manual = edges[0]
  assert.equal(manual.kind, 'manual')
  if (manual.kind === 'manual') assert.equal(manual.id, 'e1')
  // 其它 kind 的图不显示这条边
  assert.equal(buildEdges('characters', data).length, 0)
})

test('chapters kind 只返回 manual 边（无自动推导）', () => {
  const data = {
    plot_threads: [thread('a', ['b']), thread('b')],
    characters: [],
    graph_edges: [],
  }
  assert.equal(buildEdges('chapters', data).length, 0)
})
