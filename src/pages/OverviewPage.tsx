import { useEffect, useState, type ElementType } from 'react'
import {
  AlertTriangle, BookOpen, BrainCircuit, Check, ChevronRight,
  Feather, FileClock, FileText, PenLine, Sparkles, WandSparkles,
} from 'lucide-react'
import { workspaceApi, type Workspace } from '../workspaceApi'
import type { Page } from '../lib/constants'
import { fmt } from '../lib/constants'
import { Button, PageHeader, PanelTitle, Scroll } from '../components/ui'
import { ActivityCalendar, type ActivityData } from '../components/ActivityCalendar'
import { UsagePanel, type UsageData } from '../components/UsagePanel'
import { useEntityList } from '../hooks/useEntityList'
import { weekWords } from '../lib/stats'

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

// 60s 时间窗缓存：概览页每次挂载都重拉两组统计，切页往返时纯属浪费。
// 按作品 id 缓存；数据写回时（保存章节）下次进入窗口外自然刷新。
type CacheEntry<T> = { at: number; data: T }
const STATS_CACHE_TTL = 60_000
const _activityCache = new Map<string, CacheEntry<ActivityData>>()
const _usageCache = new Map<string, CacheEntry<UsageData>>()

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = cache.get(key)
  return hit && Date.now() - hit.at < STATS_CACHE_TTL ? hit.data : null
}


export function OverviewPage({ workspace, onWrite, onGoto }: { workspace: Workspace; onWrite: () => void; onGoto: (p: Page) => void }) {
  const { novel, chapters } = workspace
  // #2 懒加载：伏笔按需拉取（"需要留意"面板需要未收束明细）。
  const { items: plot_threads } = useEntityList('plot-threads', novel.id, workspaceApi.listThreads)
  const unresolved = plot_threads.filter(t => t.status !== 'resolved')
  const unresolvedMajor = unresolved.filter(t => t.priority === 'major')
  const emptyChapters = chapters.filter(c => c.word_count === 0)
  const progress = novel.target_words > 0 ? Math.min(100, Math.round((novel.total_words / novel.target_words) * 100)) : 0
  const recent = [...chapters].slice(-6).reverse()

  const [activity, setActivity] = useState<ActivityData | null>(() => readCache(_activityCache, novel.id))
  const [actLoading, setActLoading] = useState(() => readCache(_activityCache, novel.id) === null)
  useEffect(() => {
    let cancelled = false
    const cached = readCache(_activityCache, novel.id)
    if (cached) { setActivity(cached); setActLoading(false); return }
    setActLoading(true)
    workspaceApi.activity(novel.id, 119)
      .then(d => { if (!cancelled) { setActivity(d); _activityCache.set(novel.id, { at: Date.now(), data: d }) } })
      .catch(() => { /* heatmap is non-critical; leave empty */ })
      .finally(() => { if (!cancelled) setActLoading(false) })
    return () => { cancelled = true }
  }, [novel.id])

  const [usage, setUsage] = useState<UsageData | null>(() => readCache(_usageCache, novel.id))
  const [usageLoading, setUsageLoading] = useState(() => readCache(_usageCache, novel.id) === null)
  useEffect(() => {
    let cancelled = false
    const cached = readCache(_usageCache, novel.id)
    if (cached) { setUsage(cached); setUsageLoading(false); return }
    setUsageLoading(true)
    workspaceApi.aiUsage(novel.id, 30)
      .then(d => { if (!cancelled) { setUsage(d); _usageCache.set(novel.id, { at: Date.now(), data: d }) } })
      .catch(() => { /* usage is non-critical; leave empty */ })
      .finally(() => { if (!cancelled) setUsageLoading(false) })
    return () => { cancelled = true }
  }, [novel.id])

  const thisWeek = activity ? weekWords(activity.series) : [0, 0, 0, 0, 0, 0, 0]
  const weekMax = Math.max(1, ...thisWeek)
  const weekTotal = thisWeek.reduce((a, b) => a + b, 0)

  return <Scroll>
    <PageHeader eyebrow="作品概览" title={novel.title} desc={novel.description || '暂无简介'}
      actions={<><Button onClick={() => onGoto('projects')}>作品设置</Button><button className="btn primary" onClick={onWrite}><PenLine size={15} />继续写作</button></>} />
    <div className="metrics">
      <Metric icon={FileText} label="总字数" value={fmt(novel.total_words)} note={`目标 ${fmt(novel.target_words)} 字`} tone="ink" />
      <Metric icon={BookOpen} label="章节" value={String(novel.chapter_count)} note={`已完成 ${chapters.filter(c => c.status === 'completed').length} 章`} tone="sage" />
      <Metric icon={BrainCircuit} label="未收束伏笔" value={String(unresolved.length)} note={`其中 ${unresolvedMajor.length} 条主线`} tone="amber" />
      <Metric icon={Feather} label="目标进度" value={`${progress}%`} note={novel.genre || '连载中'} tone="clay" />
    </div>
    <div className="overview-grid overview-grid-activity">
      {/* 创作进度 + 热力图 + token 用量统计并排放在第一行 */}
      <section className="panel progress-panel">
        <PanelTitle title="创作进度" action="查看统计" />
        <div className="goal"><strong>{fmt(novel.total_words)}</strong><span>/ {fmt(novel.target_words)} 字</span></div>
        <div className="big-progress"><i style={{ width: progress + '%' }} /></div>
        <div className="week-bars">
          {/* 仅显示当前周，星期一至星期日 */}
          <WeekRow words={thisWeek} peak={weekMax} />
        </div>
        <footer className="week-summary">本周写作 <b>{fmt(weekTotal)}</b> 字</footer>
      </section>
      <section className="panel activity-panel">
        <ActivityCalendar data={activity} loading={actLoading} />
      </section>
      <section className="panel usage-card">
        <UsagePanel data={usage} loading={usageLoading} days={30} />
      </section>
      {/* 需要留意 + 最近章节 并排放在第二行 */}
      <section className="panel attention-panel"><PanelTitle title="需要留意" action="打开伏笔看板" onAction={() => onGoto('threads')} /><div className="attention">
        {unresolvedMajor.length > 0 && <Attention icon={AlertTriangle} title={`「${unresolvedMajor[0].title}」等 ${unresolvedMajor.length} 条主线伏笔待收束`} note="建议在近期章节推进主线" urgent />}
        <Attention icon={BrainCircuit} title={`${unresolved.length} 个伏笔尚未收束`} note={`支线 ${unresolved.filter(t => t.priority === 'minor').length} · 细节 ${unresolved.filter(t => t.priority === 'detail').length}`} />
        {emptyChapters.length > 0 && <Attention icon={FileClock} title={`第 ${emptyChapters[0].order} 章还是空白`} note="点击继续写作开始本章" />}
        {unresolved.length === 0 && <Attention icon={Check} title="所有伏笔均已收束" note="节奏良好，可埋设新的线索" />}
      </div></section>
      <section className="panel recent"><PanelTitle title="最近章节" action="全部章节" onAction={onWrite} />{recent.length === 0
        ? <div className="panel-empty actionable" onClick={onWrite}>还没有章节，点击前往写作页创建第一章 →</div>
        : recent.map(c => <div key={c.id} onClick={onWrite} style={{ cursor: 'pointer' }}><b>{String(c.order).padStart(2, '0')}</b><strong>{c.title}</strong><span>{fmt(c.word_count)} 字</span><small>{c.status === 'completed' ? '已完成' : '写作中'}</small><ChevronRight size={15} /></div>)}</section>
      <section className="panel agent-promo"><span><WandSparkles size={22} /></span><div><label>创作助手</label><h3>让 AI 帮你续写下一章</h3><p>结合大纲、角色和未收束伏笔生成可审阅草稿。</p></div><Button kind="dark" onClick={onWrite}><Sparkles size={15} />开始创作</Button></section>
    </div>
  </Scroll>
}

const WEEK_BAR_MAX = 32 // tallest bar (px) inside a week row

/** One week row of the progress chart: bars above the weekday labels. */
function WeekRow({ words, peak }: { words: number[]; peak: number }) {
  return <div className="week-row">
    {words.map((w, i) => {
      // Bar height tracks this day's words relative to the week's peak.
      const height = w > 0 ? Math.max(3, Math.round((w / peak) * WEEK_BAR_MAX)) : 0
      return <span key={i}>
        <span className="week-bar-area" aria-hidden="true">
          <i style={{ height }} className={w > 0 ? 'has-words' : ''} />
        </span>
        <small>{WEEKDAY_LABELS[i]}</small>
      </span>
    })}
  </div>
}

function Metric({ icon: Icon, label, value, note, tone }: { icon: ElementType; label: string; value: string; note: string; tone: string }) {
  return <article className={'metric ' + tone}><span><Icon size={19} /></span><div><label>{label}</label><strong>{value}</strong><small>{note}</small></div></article>
}

function Attention({ icon: Icon, title, note, urgent }: { icon: ElementType; title: string; note: string; urgent?: boolean }) {
  return <div className={urgent ? 'urgent' : ''}><Icon size={17} /><p><strong>{title}</strong><small>{note}</small></p><ChevronRight size={15} /></div>
}
