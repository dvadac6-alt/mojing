import { useCallback, useEffect, useState } from 'react'
import { PenLine, Plus, Settings2, Trash2 } from 'lucide-react'
import { workspaceApi, type PromptTemplate } from '../workspaceApi'
import { toast } from './Toast'
import { Button, Field, FormFooter, Modal } from './ui'
import { areaCls, inputCls } from '../lib/constants'

/** F6 模板缓存：模块级（跨页共享），QuickAI 每次挂载只取一次。 */
let _templates: PromptTemplate[] | null = null
let _promise: Promise<PromptTemplate[]> | null = null

export function usePromptTemplates(): { templates: PromptTemplate[]; reload: () => Promise<void> } {
  const [templates, setTemplates] = useState<PromptTemplate[]>(_templates ?? [])

  const reload = useCallback(async () => {
    try {
      const promise = _promise ?? workspaceApi.listPromptTemplates()
      _promise = promise
      const list = await promise
      _templates = list
      _promise = null
      setTemplates(list)
    } catch {
      _promise = null // 失败允许重试；列表保持为空即可（非关键功能）
    }
  }, [])

  useEffect(() => {
    if (_templates) { setTemplates(_templates); return }
    void reload()
  }, [reload])

  return { templates, reload }
}

export function invalidatePromptTemplates() {
  _templates = null
}

/** QuickAI 里的模板条：点击应用（填入写作要求），管理按钮开弹窗。 */
export function TemplateChips({ templates, onApply, onManage }: {
  templates: PromptTemplate[]; onApply: (content: string) => void; onManage: () => void
}) {
  if (templates.length === 0) {
    return <div className="tpl-row">
      <label>模板</label>
      <button className="tpl-chip" onClick={onManage}><Plus size={11} />创建指令模板</button>
    </div>
  }
  return <div className="tpl-row">
    <label>模板</label>
    <div className="tpl-list">
      {templates.map(t => (
        <button key={t.id} className="tpl-chip" title={t.content} onClick={() => onApply(t.content)}>{t.name}</button>
      ))}
    </div>
    <button className="tpl-chip manage" onClick={onManage} aria-label="管理模板"><Settings2 size={11} /></button>
  </div>
}

/** 模板管理弹窗：列表 + 编辑/删除 + 新建。 */
export function TemplateManagerModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [editing, setEditing] = useState<PromptTemplate | 'new' | null>(null)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    workspaceApi.listPromptTemplates().then(setTemplates).catch(() => { /* 空列表即可 */ })
  }, [])
  useEffect(() => { load() }, [load])

  const openForm = (tpl: PromptTemplate | 'new') => {
    setEditing(tpl)
    setName(tpl === 'new' ? '' : tpl.name)
    setContent(tpl === 'new' ? '' : tpl.content)
    setError('')
  }

  const submit = async () => {
    if (!name.trim() || !content.trim()) { setError('名称与内容都不能为空'); return }
    setBusy(true)
    try {
      if (editing === 'new') await workspaceApi.createPromptTemplate(name.trim(), content.trim())
      else if (editing) await workspaceApi.updatePromptTemplate(editing.id, { name: name.trim(), content: content.trim() })
      invalidatePromptTemplates()
      onChanged()
      load()
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally { setBusy(false) }
  }

  const remove = async (tpl: PromptTemplate) => {
    try {
      await workspaceApi.deletePromptTemplate(tpl.id)
      invalidatePromptTemplates()
      onChanged()
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  return <Modal eyebrow="AI 指令模板" title="自定义 Prompt 模板" icon={PenLine} onClose={onClose}
    footer={<div className="form-actions">
      <span className="muted">模板全局共享，点击即填入"写作要求"</span>
      <Button onClick={onClose}>关闭</Button>
      {editing === null && <Button kind="primary" onClick={() => openForm('new')}><Plus size={14} />新建模板</Button>}
    </div>}>
    <div className="form-body" style={{ maxHeight: 420, overflow: 'auto' }}>
      {editing !== null ? (
        <>
          <Field label="模板名称"><input className={inputCls} value={name} maxLength={60} onChange={e => setName(e.target.value)} autoFocus placeholder="如：环境描写" /></Field>
          <Field label="指令内容（作为「写作要求」发送给 AI）">
            <textarea className={areaCls} style={{ minHeight: 110 }} value={content} maxLength={2000}
              onChange={e => setContent(e.target.value)} placeholder="如：为当前场景补充克制的环境描写，突出声音与气味，不要推进情节。" />
          </Field>
          <FormFooter error={error} busy={busy} onClose={() => setEditing(null)} onSubmit={() => void submit()}
            submitLabel="保存模板" note={`${content.length} / 2000`} />
        </>
      ) : templates.length === 0 ? (
        <p style={{ color: 'var(--text-3)', fontSize: 12, padding: '14px 0', textAlign: 'center' }}>
          还没有模板——把常用的 AI 指令存成模板，生成时一键套用。
        </p>
      ) : templates.map(tpl => (
        <div key={tpl.id} className="tpl-manage-row">
          <div><strong>{tpl.name}</strong><p>{tpl.content}</p></div>
          <div className="idea-actions">
            <button title="编辑" aria-label="编辑" onClick={() => openForm(tpl)}><PenLine size={13} /></button>
            <button title="删除" aria-label="删除" onClick={() => void remove(tpl)}><Trash2 size={13} /></button>
          </div>
        </div>
      ))}
    </div>
  </Modal>
}
