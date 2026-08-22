import assert from 'node:assert/strict'
import { test } from 'node:test'
import { weekWords } from './stats.ts'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

test('本周（周一起）各日字数按星期对齐', () => {
  // 2026-08-19 是周三：周一 08-17 … 周三 08-19（今日），周四及以后不计
  const today = new Date(2026, 7, 19)
  const mon = new Date(2026, 7, 17)
  const series: { date: string; words: number }[] = []
  for (let i = 0; i < 3; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i)
    series.push({ date: iso(d), words: (i + 1) * 100 })
  }
  const out = weekWords(series, today)
  assert.deepEqual(out, [100, 200, 300, 0, 0, 0, 0])
})

test('今日之后的日子不计入', () => {
  const today = new Date(2026, 7, 17) // 周一
  const tue = new Date(2026, 7, 18)
  const out = weekWords([{ date: iso(tue), words: 999 }], today)
  assert.deepEqual(out, [0, 0, 0, 0, 0, 0, 0])
})

test('周日结束的完整周', () => {
  const today = new Date(2026, 7, 23) // 周日
  const mon = new Date(2026, 7, 17)
  const series = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i)
    return { date: iso(d), words: 10 }
  })
  const out = weekWords(series, today)
  assert.deepEqual(out, [10, 10, 10, 10, 10, 10, 10])
})
