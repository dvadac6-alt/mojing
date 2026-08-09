import { useState } from 'react'
import { GitBranch, Pencil, Trash2 } from 'lucide-react'
import { workspaceApi, type Workspace } from '../workspaceApi'
import { Button, Modal } from './ui'

/** Which tree node is selected / being renamed. */
type NodeRef = { kind: 'chapter'; id: string } | { kind: 'scene'; id: string }
const keyOf = (n: NodeRef) => `${n.kind}:${n.id}`

const STATUS_TEXT: Record<string, string> = { draft: '草稿', writing: '写作中', completed: '已完成' }

/** Inline rename input; Enter/blur saves, Escape cancels. */
function EditInput({ value, onChange, onSave, onCancel }: { value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void }) {
  return <input autoFocus className="mm-edit" value={value}
    onChange={e => onChange(e.target.value)}
    onKeyDown={e => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel() }}
    onBlur={onSave} />
}

/**
 * Horizontal tree mind map of the outline: root = the novel, branches =
 * chapters, leaves = scenes under each chapter. Click a node to select it
 * (rename / delete actions appear); edits go through the normal APIs and the
 * workspace reloads afterwards.
 */
export function MindMap({ workspace, reload, linkingMode, onPickNode }: { workspace: Workspace; reload: () => void; linkingMode?: boolean; onPickNode?: (id: string) => void }) {
  const { novel, chapters, scenes } = workspace
  const [selected, setSelected] = useState<NodeRef | null>(null)
  const [editing, setEditing] = useState<NodeRef | null>(null)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState<NodeRef | null>(null)

  const scenesOf = (chapterId: string) => scenes.filter(s => s.chapter_id === chapterId).sort((a, b) => a.order - b.order)
  const chapterTitle = (id: string) => chapters.find(c => c.id === id)?.title ?? '章节'
  const sceneTitle = (id: string) => scenes.find(s => s.id === id)?.title ?? '场景'

  const startRename = (node: NodeRef) => {
    setSelected(node)
    setEditing(node)
    setDraft(node.kind === 'chapter' ? chapterTitle(node.id) : sceneTitle(node.id))
  }

  const saveRename = async () => {
    if (!editing) return
    const title = draft.trim()
    const node = editing
    setEditing(null)
    if (!title) return
    try {
      if (node.kind === 'chapter') await workspaceApi.updateChapter(node.id, { title })
      else await workspaceApi.renameScene(node.id, title)
      reload()
    } catch { /* keep the old title on failure */ }
  }

  const remove = async (node: NodeRef) => {
    try {
      if (node.kind === 'chapter') await workspaceApi.deleteChapter(node.id)
      else await workspaceApi.deleteScene(node.id)
      setSelected(null)
      setConfirming(null)
      reload()
    } catch { /* ignore */ }
  }

  return (
    <div className={'mind-map' + (linkingMode ? ' linking' : '')}>
      <div className="mm-root" data-node-id={'novel:' + novel.id}><GitBranch size={15} /><strong>{novel.title}</strong></div>
      <div className="mm-branches">
        {chapters.map(ch => {
          const chKey = keyOf({ kind: 'chapter', id: ch.id })
          const isSel = selected && keyOf(selected) === chKey
          return (
            <div className="mm-branch" key={ch.id}>
              <div className={'mm-node mm-chapter' + (isSel ? ' selected' : '') + (linkingMode ? ' linkable' : '')}
                data-node-id={ch.id}
                onClick={() => { if (linkingMode) onPickNode?.(ch.id); else { setSelected({ kind: 'chapter', id: ch.id }); setEditing(null) } }}>
                {editing && keyOf(editing) === chKey
                  ? <EditInput value={draft} onChange={setDraft} onSave={saveRename} onCancel={() => setEditing(null)} />
                  : <>
                    <b>{String(ch.order).padStart(2, '0')}</b>
                    <strong>{ch.title}</strong>
                    <em className={'st ' + ch.status}>{STATUS_TEXT[ch.status] ?? ch.status}</em>
                    <small>{ch.word_count > 0 ? `${ch.word_count} 字` : '空白'}</small>
                    {isSel && <span className="mm-actions">
                      <button aria-label="重命名" onClick={e => { e.stopPropagation(); startRename({ kind: 'chapter', id: ch.id }) }}><Pencil size={12} /></button>
                      <button aria-label="删除" onClick={e => { e.stopPropagation(); setConfirming({ kind: 'chapter', id: ch.id }) }}><Trash2 size={12} /></button>
                    </span>}
                  </>}
              </div>
              {(() => {
                const chScenes = scenesOf(ch.id)
                if (chScenes.length === 0) return null
                return <div className="mm-scenes">{chScenes.map(sc => {
                  const scKey = keyOf({ kind: 'scene', id: sc.id })
                  const isScSel = selected && keyOf(selected) === scKey
                  return (
                    <div className={'mm-node mm-scene' + (isScSel ? ' selected' : '') + (linkingMode ? ' linkable' : '')}
                      data-node-id={sc.id} key={sc.id}
                      onClick={() => { if (linkingMode) onPickNode?.(sc.id); else { setSelected({ kind: 'scene', id: sc.id }); setEditing(null) } }}>
                      {editing && keyOf(editing) === scKey
                        ? <EditInput value={draft} onChange={setDraft} onSave={saveRename} onCancel={() => setEditing(null)} />
                        : <>
                          <strong>{sc.title}</strong>
                          {isScSel && <span className="mm-actions">
                            <button aria-label="重命名" onClick={e => { e.stopPropagation(); startRename({ kind: 'scene', id: sc.id }) }}><Pencil size={12} /></button>
                            <button aria-label="删除" onClick={e => { e.stopPropagation(); setConfirming({ kind: 'scene', id: sc.id }) }}><Trash2 size={12} /></button>
                          </span>}
                        </>}
                    </div>
                  )
                })}</div>
              })()}
            </div>
          )
        })}
        {chapters.length === 0 && <div className="mm-empty">还没有章节，点击右上角「添加节点」创建第一个章节。</div>}
      </div>
      {confirming && (() => {
        const label = confirming.kind === 'chapter' ? chapterTitle(confirming.id) : sceneTitle(confirming.id)
        return <Modal eyebrow="思维导图" title="删除节点" icon={Trash2} onClose={() => setConfirming(null)}
          footer={<div className="form-actions"><span className="muted">{confirming.kind === 'chapter' ? '其下场景会一并删除。' : '删除后不可恢复。'}</span><Button onClick={() => setConfirming(null)}>取消</Button><Button kind="danger" onClick={() => remove(confirming)}>删除</Button></div>}>
          <div className="form-body"><p className="mm-confirm-text">确定删除{confirming.kind === 'chapter' ? '章节' : '场景'}「{label}」？</p></div>
        </Modal>
      })()}
    </div>
  )
}
