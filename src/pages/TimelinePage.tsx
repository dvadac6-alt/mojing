import { useState } from 'react'
import { CalendarClock, PenLine, Plus, Trash2 } from 'lucide-react'
import { workspaceApi, type TimelineEvent, type Workspace } from '../workspaceApi'
import { confirmDialog } from '../components/Confirm'
import { toast } from '../components/Toast'
import {
  Button, EmptyStateWrap, Field, FormFooter, Modal, PageHeader, Scroll,
} from '../components/ui'
import { areaCls, inputCls, selectCls } from '../lib/constants'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { useEntityList } from '../hooks/useEntityList'

/** F8 时间线/大事记：按章节分组的大事轴。计划中（未挂章）事件置顶，
 *  story_time 是自由文本（"第三年春"），排序一律按章节。 */
export function TimelinePage({ workspace }: { workspace: Workspace }) {
  const novelId = workspace.novel.id
  const { items: events, loading, refresh } = useEntityList('timeline-events', novelId, workspaceApi.listTimelineEvents)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<TimelineEvent | null>(null)

  const planned = events.filter(e => !e.chapter_id)
  const chapterGroups = [...workspace.chapters]
    .sort((a, b) => a.order - b.order)
    .map(c => ({ chapter: c, events: events.filter(e => e.chapter_id === c.id) }))
    .filter(g => g.events.length > 0)

  const remove = async (event: TimelineEvent) => {
    const ok = await confirmDialog({ title: '删除事件', message: `删除大事「${event.title}」？`, danger: true, confirmLabel: '删除' })
    if (!ok) return
    try {
      await workspaceApi.deleteTimelineEvent(event.id)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  if (loading) return <div className="page-loading-fallback">加载中…</div>
  if (events.length === 0) return <><EmptyStateWrap icon={CalendarClock} title="还没有大事记"
    desc="把关键事件挂到章节上（或先记为计划中），长篇的时间线就有了锚点。" action={() => setCreating(true)} />
    {creating && <EventForm novelId={novelId} chapters={workspace.chapters} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await refresh() }} />}</>

  return <Scroll>
    <PageHeader eyebrow="时间线" title="大事记" desc={`《${workspace.novel.title}》的关键事件，按章节先后排列；AI 续写时可在上下文勾选「时间线」注入。`}
      actions={<Button kind="primary" onClick={() => setCreating(true)}><Plus size={15} />记一件大事</Button>} />
    <div className="timeline">
      {planned.length > 0 && <TimelineGroup label="计划中（未挂章）" planned>
        {planned.map(e => <TimelineCard key={e.id} event={e} chapterLabel="" onEdit={() => setEditing(e)} onDelete={() => void remove(e)} />)}
      </TimelineGroup>}
      {chapterGroups.map(({ chapter, events: groupEvents }) => (
        <TimelineGroup key={chapter.id} label={`第 ${chapter.order} 章《${chapter.title}》`}>
          {groupEvents.map(e => <TimelineCard key={e.id} event={e} chapterLabel={`第${chapter.order}章`} onEdit={() => setEditing(e)} onDelete={() => void remove(e)} />)}
        </TimelineGroup>
      ))}
    </div>
    {creating && <EventForm novelId={novelId} chapters={workspace.chapters} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await refresh() }} />}
    {editing && <EventForm novelId={novelId} chapters={workspace.chapters} initial={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }} />}
  </Scroll>
}

function TimelineGroup({ label, planned, children }: { label: string; planned?: boolean; children: React.ReactNode }) {
  return <section className={'timeline-group' + (planned ? ' planned' : '')}>
    <header><i /><strong>{label}</strong></header>
    <div className="timeline-items">{children}</div>
  </section>
}

function TimelineCard({ event, chapterLabel, onEdit, onDelete }: {
  event: TimelineEvent; chapterLabel: string; onEdit: () => void; onDelete: () => void
}) {
  return <div className="timeline-card">
    <div className="timeline-dot" aria-hidden="true" />
    <div className="timeline-card-body">
      <header>
        {event.story_time && <b className="timeline-when">{event.story_time}</b>}
        <strong>{event.title}</strong>
        {chapterLabel && <small>{chapterLabel}</small>}
      </header>
      {event.description && <p>{event.description}</p>}
    </div>
    <div className="idea-actions">
      <button title="编辑" aria-label="编辑事件" onClick={onEdit}><PenLine size={13} /></button>
      <button title="删除" aria-label="删除事件" onClick={onDelete}><Trash2 size={13} /></button>
    </div>
  </div>
}

function EventForm({ novelId, chapters, initial, onClose, onSaved }: {
  novelId: string; chapters: Workspace['chapters']; initial?: TimelineEvent
  onClose: () => void; onSaved: () => Promise<void>
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [storyTime, setStoryTime] = useState(initial?.story_time ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [chapterId, setChapterId] = useState(initial?.chapter_id ?? '')
  const { busy, error, run } = useAsyncAction()
  const submit = () => run(async () => {
    const data = {
      title: title.trim() || '未命名事件', story_time: storyTime.trim(), description,
      // "" = 计划中；后端把空串视作解除锚点。
      chapter_id: chapterId || null,
    }
    if (initial) await workspaceApi.updateTimelineEvent(initial.id, { ...data, chapter_id: chapterId || '' })
    else await workspaceApi.createTimelineEvent(novelId, data)
    await onSaved()
  })
  return <Modal eyebrow={initial ? '编辑大事' : '记一件大事'} title={title || '新事件'} icon={CalendarClock} onClose={onClose}
    footer={<FormFooter error={error} busy={busy} onClose={onClose} onSubmit={submit}
      note="故事内时间随意写（如“第三年春”），排序按章节" />}>
    <div className="form-body">
      <div className="form-row">
        <Field label="事件标题"><input className={inputCls} value={title} maxLength={200} onChange={e => setTitle(e.target.value)} autoFocus placeholder="如：旧案重启" /></Field>
        <Field label="故事内时间（可选）"><input className={inputCls} value={storyTime} maxLength={60} onChange={e => setStoryTime(e.target.value)} placeholder="如：第三年春" /></Field>
      </div>
      <Field label="挂靠章节">
        <select className={selectCls} value={chapterId} onChange={e => setChapterId(e.target.value)}>
          <option value="">计划中（未挂章）</option>
          {[...chapters].sort((a, b) => a.order - b.order).map(c => (
            <option key={c.id} value={c.id}>第 {c.order} 章 · {c.title}</option>
          ))}
        </select>
      </Field>
      <Field label="事件说明（可选）"><textarea className={areaCls} value={description} onChange={e => setDescription(e.target.value)} placeholder="这件事发生了什么、牵涉到谁。" /></Field>
    </div>
  </Modal>
}
