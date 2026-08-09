import { useMemo } from 'react'

export type UsageData = {
  series: { date: string; prompt: number; completion: number; total: number; calls: number }[]
  total_tokens: number
  total_calls: number
  by_model: { model: string; total_tokens: number; calls: number; prompt: number; completion: number }[]
}

const fmtNum = (n: number) => n.toLocaleString('zh-CN')

/**
 * A compact token-usage stat card for the overview row. Shows total tokens +
 * calls for the window, a daily sparkline (bar height = that day's tokens),
 * and a per-model breakdown. Token data only exists for real-model calls;
 * offline (mock) generations don't consume tokens and aren't counted.
 */
export function UsagePanel({ data, loading, days }: { data: UsageData | null; loading: boolean; days: number }) {
  const maxDay = useMemo(() => Math.max(1, ...(data?.series.map(s => s.total) ?? [0])), [data])

  if (loading) {
    return <div className="usage-panel"><div className="usage-loading">读取用量…</div></div>
  }
  if (!data || data.total_tokens === 0) {
    return <div className="usage-panel">
      <header className="usage-head"><strong>Token 用量</strong><small>近 {days} 天</small></header>
      <div className="usage-empty">
        <span>暂无用量记录</span>
        <small>使用真实 AI 模型续写后，这里会统计每次调用的 token 消耗。</small>
      </div>
    </div>
  }

  return (
    <div className="usage-panel">
      <header className="usage-head">
        <div>
          <strong>Token 用量</strong>
          <small>近 {days} 天 · {fmtNum(data.total_tokens)} tokens · {data.total_calls} 次调用</small>
        </div>
      </header>
      <div className="usage-spark">
        {data.series.map(s => {
          const h = s.total > 0 ? Math.max(6, Math.round((s.total / maxDay) * 100)) : 0
          return (
            <div key={s.date} className="usage-bar" title={`${s.date}：${fmtNum(s.total)} tokens · ${s.calls} 次`}>
              <i style={{ height: h + '%' }} className={s.total > 0 ? 'has' : ''} />
            </div>
          )
        })}
      </div>
      <div className="usage-models">
        {data.by_model.slice(0, 4).map(m => {
          const pct = data.total_tokens > 0 ? Math.round((m.total_tokens / data.total_tokens) * 100) : 0
          return (
            <div key={m.model} className="usage-model-row">
              <span className="um-name">{m.model}</span>
              <div className="um-bar"><i style={{ width: pct + '%' }} /></div>
              <span className="um-val">{fmtNum(m.total_tokens)}</span>
              <span className="um-calls">{m.calls}次</span>
            </div>
          )
        })}
      </div>
      <footer className="usage-foot">
        <span>输入 <b>{fmtNum(data.by_model.reduce((a, m) => a + m.prompt, 0))}</b></span>
        <span>输出 <b>{fmtNum(data.by_model.reduce((a, m) => a + m.completion, 0))}</b></span>
      </footer>
    </div>
  )
}
