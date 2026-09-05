import { EditorHistory } from './editorHistory.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'

test('打字快照可逐步撤销回初始内容', () => {
  const h = new EditorHistory()
  h.reset('一')
  h.push('一句')
  h.push('一句话')
  assert.equal(h.canUndo, true)
  assert.equal(h.undo()?.content, '一句')
  assert.equal(h.undo()?.content, '一')
  assert.equal(h.canUndo, false)
  assert.equal(h.undo(), null)
})

test('撤销后可重做，新输入会截断重做分支', () => {
  const h = new EditorHistory()
  h.reset('甲')
  h.push('甲乙')
  h.push('甲乙丙')
  h.undo()
  assert.equal(h.canRedo, true)
  assert.equal(h.redo()?.content, '甲乙丙')
  h.undo(); h.undo()
  h.push('甲丁')
  assert.equal(h.canRedo, false)
  assert.equal(h.redo(), null)
  assert.equal(h.undo()?.content, '甲')
})

test('相同内容的重复 push 被合并（幂等）', () => {
  const h = new EditorHistory()
  h.reset('相同')
  h.push('相同', 1)
  h.push('相同', 2)
  h.undo()
  assert.equal(h.canUndo, false) // 只有一帧，不可再撤
})

test('快照数超过上限时丢弃最旧的', () => {
  const h = new EditorHistory()
  h.reset('0')
  for (let i = 1; i <= 120; i++) h.push('v' + i)
  let last = ''
  let steps = 0
  for (let s = h.undo(); s; s = h.undo()) { last = s.content; steps++ }
  assert.equal(steps, 99) // 100 帧上限 → 可撤 99 步
  assert.equal(last, 'v21') // 最早的 '0' 与 v1..v20 已被挤出
})

test('caret 缺省为内容长度，撤销恢复到记录的光标位', () => {
  const h = new EditorHistory()
  h.reset('hello')          // 缺省 caret = 5
  h.push('hello world', 5)  // 显式记录光标在 5
  const undone = h.undo()
  assert.equal(undone?.content, 'hello')
  assert.equal(undone?.caret, 5)
})
