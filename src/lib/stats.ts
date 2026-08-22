/** Sum the activity series into the current week's per-day word counts (Mon→Sun).
 * 纯函数，供概览页使用与 node:test 覆盖。 */
export function weekWords(series: { date: string; words: number }[], today = new Date()): number[] {
  // Monday as the first day of the week.
  const mondayOffset = (today.getDay() + 6) % 7
  const monday = new Date(today)
  monday.setDate(today.getDate() - mondayOffset)
  const byDate = new Map(series.map(d => [d.date, d.words]))
  const out = [0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    if (d > today) break
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    out[i] = byDate.get(iso) ?? 0
  }
  return out
}
