import { useCallback, useEffect, useState } from 'react'
import { ArrowRightLeft, BookPlus, BrainCircuit, Check, Lightbulb, Trash2, Undo2, Users } from 'lucide-react'
import { workspaceApi, type Idea } from '../workspaceApi'
import type { Page } from '../lib/constants'
import { confirmDialog } from './Confirm'
import { toast } from './Toast'
import { Button, Modal } from './ui'
import { clearEntityCache } from '../hooks/useEntityList'

/** F5 灵感收集箱：随手记碎片想法，之后一键转化为角色/伏笔/章节。
 *  转化成功后清实体缓存，各页面下次进入即拉到新实体。 */
export function IdeaInbox({ novelId, novelTitle, onClose, onGoto }: {
  novelId: string; novelTitle: string; onClose: () => void; onGoto: (p: Page) => void
}) {
  const [ideas, setIdeas] = useState<Idea[] | null>(null)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [global, setGlobal] = useState(false) // 记到当前作品还是全局
  const [filter, setFilter] = useState<'inbox' | 'converted' | 'discarded'>('inbox')
  const [busyId, setBusyId] = useState(0)

  const load = useCallback(() => {
    workspaceApi.listIdeas(novelId)
      .then(setIdeas)
      .catch(e => setError(e instanceof Error ? e.message : '读取灵感失败'))
  }, [novelId])
  useEffect(() => { load() }, [load])

  const add = async () => {
    const content = text.trim()
    if (!content) return
    try {
      await workspaceApi.createIdea(content, global ? null : novelId)
      setText('')
      setFilter('inbox')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存灵感失败')
    }
  }

  const convert = async (idea: Idea, kind: 'character' | 'thread' | 'chapter') => {
    setBusyId(idea.id)
    try {
      await workspaceApi.convertIdea(idea.id, kind, novelId)
      clearEntityCache(novelId)
      toast.success(`已转化为${kind === 'character' ? '角色' : kind === 'thread' ? '伏笔' : '章节'}（标题取内容前缀，可再编辑）`)
      setFilter('converted')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '转化失败')
    } finally { setBusyId(0) }
  }

  const setStatus = async (idea: Idea, status: 'inbox' | 'discarded') => {
    setBusyId(idea.id)
    try {
      await workspaceApi.updateIdea(idea.id, { status })
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败')
    } finally { setBusyId(0) }
  }

  const remove = async (idea: Idea) => {
    const ok = await confirmDialog({ title: '删除灵感', message: '删除后无法恢复。', danger: true, confirmLabel: '删除' })
    if (!ok) return
    setBusyId(idea.id)
    try {
      await workspaceApi.deleteIdea(idea.id)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    } finally { setBusyId(0) }
  }

  const visible = (ideas ?? []).filter(i => i.status === filter)
  const counts = {
    inbox: (ideas ?? []).filter(i => i.status === 'inbox').length,
    converted: (ideas ?? []).filter(i => i.status === 'converted').length,
    discarded: (ideas ?? []).filter(i => i.status === 'discarded').length,
  }

  return <Modal eyebrow="灵感收集箱" title={`《${novelTitle}》与全局灵感`} icon={Lightbulb} onClose={onClose}
    footer={<div className="form-actions">
      <span className="muted">灵感只存在本地；转化后可在对应页面继续编辑</span>
      <Button kind="primary" onClick={onClose}>关闭</Button>
    </div>}>
    <div className="form-body" style={{ maxHeight: 460, overflow: 'auto' }}>
      <div className="idea-compose">
        <textarea value={text} maxLength={2000} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void add() } }}
          placeholder="记一条灵感：桥段、人物点子、待查资料……（Ctrl+Enter 保存）" aria-label="新灵感" />
        <div>
          <label className="idea-scope">
            <input type="checkbox" checked={global} onChange={e => setGlobal(e.target.checked)} />
            存为全局灵感（不属于当前作品）
          </label>
          <Button kind="primary" onClick={() => void add()} disabled={!text.trim()}>记下</Button>
        </div>
      </div>
      <div className="chips">
        {(['inbox', 'converted', 'discarded'] as const).map(f => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {{ inbox: '待处理', converted: '已转化', discarded: '已丢弃' }[f]} {counts[f]}
          </button>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
      {ideas === null && !error && <p style={{ color: '#999', fontSize: 11 }}>读取灵感…</p>}
      {ideas !== null && visible.length === 0 && filter === 'inbox' &&
        <p className="idea-empty">还没有待处理的灵感——写作间隙冒出来的点子，先丢进来再说。</p>}
      {visible.map(idea => <div key={idea.id} className="idea-row">
        <div className="idea-content">
          <p>{idea.content}</p>
          <small>
            {new Date(idea.created_at).toLocaleDateString('zh-CN')}
            {idea.novel_id === null ? ' · 全局' : ''}
            {idea.status === 'converted' && ` · 已转为${idea.converted_kind === 'character' ? '角色' : idea.converted_kind === 'thread' ? '伏笔' : '章节'}`}
          </small>
        </div>
        {idea.status === 'inbox' && <div className="idea-actions">
          <button title="转为角色" aria-label="转为角色" disabled={busyId === idea.id} onClick={() => void convert(idea, 'character')}><Users size={13} /></button>
          <button title="转为伏笔" aria-label="转为伏笔" disabled={busyId === idea.id} onClick={() => void convert(idea, 'thread')}><BrainCircuit size={13} /></button>
          <button title="转为新章节" aria-label="转为新章节" disabled={busyId === idea.id} onClick={() => void convert(idea, 'chapter')}><BookPlus size={13} /></button>
          <button title="丢弃" aria-label="丢弃" disabled={busyId === idea.id} onClick={() => void setStatus(idea, 'discarded')}><Trash2 size={13} /></button>
        </div>}
        {idea.status === 'converted' && <div className="idea-actions">
          <button title="前往查看" aria-label="前往查看" onClick={() => {
            onClose()
            onGoto(idea.converted_kind === 'character' ? 'characters' : idea.converted_kind === 'thread' ? 'threads' : 'writing')
          }}><ArrowRightLeft size={13} /></button>
        </div>}
        {idea.status === 'discarded' && <div className="idea-actions">
          <button title="恢复" aria-label="恢复" disabled={busyId === idea.id} onClick={() => void setStatus(idea, 'inbox')}><Undo2 size={13} /></button>
          <button title="彻底删除" aria-label="彻底删除" disabled={busyId === idea.id} onClick={() => void remove(idea)}><Trash2 size={13} /></button>
        </div>}
      </div>)}
      {ideas !== null && visible.length === 0 && filter !== 'inbox' &&
        <p className="idea-empty"><Check size={12} style={{ verticalAlign: -2 }} /> 这里还没有内容。</p>}
    </div>
  </Modal>
}
