import { useMemo } from 'react'

export type ActivityDay = { date: string; words: number }
export type ActivityData = {
  series: ActivityDay[]
  total_words_written: number
  active_days: number
  longest_streak: number
}

/**
 * Intensity bucket (0–4) for a day's word count. Tuned for fiction: a light
 * session is a few hundred 字, a heavy day is 2k+.
 */
function intensityLevel(words: number): number {
  if (words <= 0) return 0
  if (words < 200) return 1
  if (words < 800) return 2
  if (words < 2000) return 3
  return 4
}

const LEVEL_CLASS = ['lv0', 'lv1', 'lv2', 'lv3', 'lv4']

/**
 * GitHub-style heatmap, simplified: cells flow left-to-right, wrapping onto
 * the next row when the container is full. No weekday/month labels — the grid
 * is pure color blocks whose count and size adapt to the available width
 * (auto-fill + aspect-ratio keeps every cell square and the matrix tight).
 */
export function ActivityCalendar({ data, loading }: { data: ActivityData | null; loading: boolean }) {
  const cells = useMemo(() => data?.series ?? [], [data])

  if (loading) {
    return <div className="activity-calendar"><div className="activity-loading">读取创作记录…</div></div>
  }
  if (!data || cells.length === 0) {
    return <div className="activity-calendar"><div className="activity-loading">暂无创作记录</div></div>
  }

  return (
    <div className="activity-calendar">
      <header className="activity-head">
        <div>
          <strong>创作热力图</strong>
          <small>近 {data.series.length} 天 · 写作 {data.total_words_written.toLocaleString('zh-CN')} 字 · 活跃 {data.active_days} 天 · 最长连续 {data.longest_streak} 天</small>
        </div>
        <div className="activity-legend">
          <span>少</span>
          {LEVEL_CLASS.map(c => <i key={c} className={'ac-cell ' + c} />)}
          <span>多</span>
        </div>
      </header>
      <div className="ac-grid">
        {cells.map(day => (
          <div
            key={day.date}
            className={'ac-cell ' + LEVEL_CLASS[intensityLevel(day.words)]}
            title={`${day.date}：${day.words > 0 ? day.words + ' 字' : '未写作'}`}
          />
        ))}
      </div>
    </div>
  )
}
