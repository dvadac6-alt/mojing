import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReviewDiff } from './diff.ts'

test('纯新增：全部标绿，clean 包含新文本', () => {
  const { merged, marks, clean } = buildReviewDiff('旧城', '旧城的钟声')
  assert.equal(merged, '旧城的钟声')
  assert.deepEqual(marks, [{ start: 2, end: 5, type: 'add' }])
  assert.equal(clean, '旧城的钟声')
})

test('纯删除：原文保留在 merged 中标红，clean 去掉', () => {
  const { merged, marks, clean } = buildReviewDiff('旧城的钟声', '旧城')
  assert.equal(merged, '旧城的钟声')
  assert.deepEqual(marks, [{ start: 2, end: 5, type: 'del' }])
  assert.equal(clean, '旧城')
})

test('改写：未变部分无标记，增删并存', () => {
  const { merged, marks, clean } = buildReviewDiff('雨夜长街的旧案', '雨夜深巷的悬案')
  // 未变前缀"雨夜"与后缀"案"不产生标记
  assert.ok(!marks.some(m => m.start === 0))
  assert.ok(marks.some(m => m.type === 'del'))
  assert.ok(marks.some(m => m.type === 'add'))
  assert.ok(merged.startsWith('雨夜'))
  assert.ok(clean.includes('深巷') && !clean.includes('长街'))
})

test('相同文本：无标记', () => {
  const { merged, marks, clean } = buildReviewDiff('完全一样', '完全一样')
  assert.equal(merged, '完全一样')
  assert.deepEqual(marks, [])
  assert.equal(clean, '完全一样')
})

test('空原文 / 空改写', () => {
  assert.deepEqual(buildReviewDiff('', '新增').marks, [{ start: 0, end: 2, type: 'add' }])
  assert.deepEqual(buildReviewDiff('删除', '').marks, [{ start: 0, end: 2, type: 'del' }])
  assert.equal(buildReviewDiff('删除', '').clean, '')
})
