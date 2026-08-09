import { ChevronDown, FileText, GripVertical, MoreHorizontal, Plus } from 'lucide-react'
import type { Workspace } from '../workspaceApi'
import { Button, PageHeader, Scroll } from '../components/ui'

export function OutlinePage({ workspace }: { workspace: Workspace }) {
  const rows = workspace.chapters.map(c => [
    c.title,
    c.word_count > 0 ? `${c.word_count} 字` : '（空白章节）',
    c.status === 'completed' ? '已完成' : c.status === 'writing' ? '写作中' : '草稿',
    'chapter',
  ] as [string, string, string, string])
  return <Scroll><PageHeader eyebrow="结构规划" title="大纲" desc="按卷、章和场景组织故事结构。章节来自当前作品。" actions={<><Button>思维导图</Button><Button kind="primary"><Plus size={15} />添加节点</Button></>} />
    <div className="outline-summary"><span><strong>1</strong>卷</span><span><strong>{workspace.chapters.length}</strong>章节</span><span><strong>0</strong>场景</span><div><p>整体规划 <b>{Math.min(100, Math.round((workspace.novel.total_words / workspace.novel.target_words) * 100))}%</b></p><i><em /></i></div></div>
    <section className="outline-table"><header><span>结构与标题</span><span>情节摘要</span><span>状态</span></header>{rows.map((r, i) => <div className={r[3]} key={workspace.chapters[i].id}><span><GripVertical size={13} /><ChevronDown size={13} /><FileText size={14} /><strong>{String(i + 1).padStart(2, '0')} {r[0]}</strong></span><p>{r[1]}</p><em>{r[2]}</em><button><MoreHorizontal size={15} /></button></div>)}</section>
  </Scroll>
}
