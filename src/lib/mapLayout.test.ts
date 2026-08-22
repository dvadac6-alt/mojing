import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layoutMarkers } from './mapLayout.ts'
import type { Location } from '../workspaceApi.ts'

const loc = (id: string, parent: string | null = null): Location => ({
  id, novel_id: 'n1', name: `l-${id}`, description: '', type: '城市',
  parent_location_id: parent, map_id: null, first_appearance_chapter_id: null,
  created_at: '', updated_at: '',
})

test('顶级地点均匀分布在主环上（level 0）', () => {
  const markers = layoutMarkers([loc('a'), loc('b'), loc('c'), loc('d')])
  assert.equal(markers.length, 4)
  assert.ok(markers.every(m => m.level === 0))
  // 主环节点距中心 (50,50) 约 30
  for (const m of markers) {
    const dist = Math.hypot(m.x - 50, m.y - 50)
    assert.ok(Math.abs(dist - 30) < 1e-6, `distance ${dist}`)
  }
})

test('子地点围绕父节点成二级环，孙地点为三级', () => {
  const markers = layoutMarkers([loc('a'), loc('b', 'a'), loc('c', 'b')])
  const byId = new Map(markers.map(m => [m.id, m]))
  assert.equal(byId.get('a')!.level, 0)
  assert.equal(byId.get('b')!.level, 1)
  assert.equal(byId.get('c')!.level, 2)
  // 子地点距父节点约 14
  const d = Math.hypot(byId.get('b')!.x - byId.get('a')!.x, byId.get('b')!.y - byId.get('a')!.y)
  assert.ok(Math.abs(d - 14) < 1e-6)
})

test('父节点不在集合内时视为顶级', () => {
  const markers = layoutMarkers([loc('a', 'ghost')])
  assert.equal(markers.length, 1)
  assert.equal(markers[0].level, 0)
})

test('空列表返回空数组', () => {
  assert.deepEqual(layoutMarkers([]), [])
})
