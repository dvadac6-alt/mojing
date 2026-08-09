import { useEffect, useState } from 'react'
import {
  BrainCircuit, ChevronRight, CloudOff, Focus, GitBranch,
  PenLine, Trash2, Users, X,
} from 'lucide-react'
import { workspaceApi, type Character, type Workspace } from '../workspaceApi'
import { COLORS } from '../lib/constants'
import { Button, Detail, EmptyStateWrap, Field, LinkRecord, Modal, PaneHead, SearchBox } from '../components/ui'
import { areaCls, inputCls } from '../lib/constants'
import { useAsyncAction } from '../hooks/useAsyncAction'

const relationEdges: { from: string; to: string; label: string; tone: string }[] = [
  { from: '沈砚', to: '苏晚照', label: '互相试探', tone: 'complex' },
  { from: '沈砚', to: '陆停云', label: '师生', tone: 'ally' },
  { from: '沈砚', to: '谢无归', label: '敌对', tone: 'enemy' },
]
const NODE_POS: Record<string, { x: number; y: number }> = {
  沈砚: { x: 50, y: 52 }, 苏晚照: { x: 74, y: 22 }, 陆停云: { x: 26, y: 24 }, 谢无归: { x: 74, y: 66 },
}

export function CharactersPage({ workspace, reload }: { workspace: Workspace; reload: () => Promise<void> }) {
  const people = workspace.characters
  const [selectedId, setSelectedId] = useState(people[0]?.id ?? '')
  const [editing, setEditing] = useState<Character | null>(null)
  const [creating, setCreating] = useState(false)
  const [relationPreview, setRelationPreview] = useState(false)
  useEffect(() => { if (!people.find(p => p.id === selectedId)) setSelectedId(people[0]?.id ?? '') }, [people])
  const person = people.find(p => p.id === selectedId) ?? people[0]

  if (people.length === 0) return <EmptyStateWrap icon={Users} title="还没有角色" desc="创建第一个角色，让 AI 续写时记住他们的性格与背景。" action={() => setCreating(true)} />

  return <><div className="master-detail"><aside className="entity-pane"><PaneHead eyebrow="人物资料" title="角色" onAdd={() => setCreating(true)} /><SearchBox text="搜索角色" /><div className="chips"><button className="active">全部 {people.length}</button></div>{people.map(p => <button key={p.id} className={'person-item ' + (p.id === selectedId ? 'active' : '')} onClick={() => setSelectedId(p.id)}><b style={{ background: p.color }}>{p.name.slice(0, 1)}</b><span><strong>{p.name}</strong><small>{p.role || p.aliases}</small></span><ChevronRight size={14} /></button>)}</aside>
    {person && <section className="entity-detail"><div className="person-hero"><b style={{ background: person.color }}>{person.name.slice(0, 1)}</b><div><label>角色 · {person.aliases ? person.aliases : '已登场'}</label><h1>{person.name}</h1><p>{person.role}</p></div><Button onClick={() => setRelationPreview(true)}><GitBranch size={14} />关系图预览</Button><Button kind="danger" onClick={async () => { if (confirm(`删除角色「${person.name}」？`)) { await workspaceApi.deleteCharacter(person.id); await reload() } }}><Trash2 size={14} />删除</Button><Button kind="primary" onClick={() => setEditing(person)}><PenLine size={14} />编辑资料</Button></div>
      <div className="detail-grid">
        <Detail title="人物简介" wide><p className="lead">{person.description || '暂无简介。'}</p></Detail>
        <Detail title="性格关键词"><div className="tag-list">{(person.personality || '未设定').split(/[·、\s,，]+/, 6).filter(Boolean).map(t => <span key={t}>{t}</span>)}</div></Detail>
        <Detail title="能力与弱点"><p>{person.abilities || '未设定'}</p></Detail>
        <Detail title="背景故事" wide><p>{person.background || '未设定'}</p></Detail>
        <Detail title="外貌描述"><p>{person.appearance || '未设定'}</p></Detail>
        <Detail title="关联伏笔"><LinkRecord icon={BrainCircuit} title={`${workspace.plot_threads.filter(t => t.related_characters.includes(person.id)).length} 条`} note="可在伏笔看板查看" /></Detail>
      </div></section>}</div>
  {creating && <CharacterForm novelId={workspace.novel.id} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await reload() }} />}
  {editing && <CharacterForm novelId={workspace.novel.id} initial={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload() }} />}
  {relationPreview && <CharacterRelationPreview people={people} onClose={() => setRelationPreview(false)} />}
  </>
}

function CharacterForm({ novelId, initial, onClose, onSaved }: { novelId: string; initial?: Character; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [aliases, setAliases] = useState(initial?.aliases ?? '')
  const [role, setRole] = useState(initial?.role ?? '')
  const [color, setColor] = useState(initial?.color ?? COLORS[Math.floor((initial?.name.length ?? 0)) % COLORS.length])
  const [description, setDescription] = useState(initial?.description ?? '')
  const [personality, setPersonality] = useState(initial?.personality ?? '')
  const [background, setBackground] = useState(initial?.background ?? '')
  const [appearance, setAppearance] = useState(initial?.appearance ?? '')
  const [abilities, setAbilities] = useState(initial?.abilities ?? '')
  const { busy, error, run } = useAsyncAction()
  const submit = () => run(async () => {
    const data = { name: name.trim() || '未命名角色', aliases, role, color, description, personality, background, appearance, abilities }
    if (initial) await workspaceApi.updateCharacter(initial.id, data); else await workspaceApi.createCharacter(novelId, data)
    onSaved()
  })
  return <Modal eyebrow={initial ? '编辑角色' : '新建角色'} title={name || '新角色'} icon={Users} onClose={onClose} wide
    footer={<div className="form-actions"><span className="muted">AI 续写时会注入角色信息</span>{error && <span className="form-error">{error}</span>}<Button onClick={onClose}>取消</Button><Button kind="primary" onClick={submit} disabled={busy}>{busy ? '保存中…' : '保存'}</Button></div>}>
    <div className="form-body">
      <div className="form-row">
        <Field label="姓名"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} autoFocus /></Field>
        <Field label="别名 / 称号"><input className={inputCls} value={aliases} onChange={e => setAliases(e.target.value)} /></Field>
      </div>
      <div className="form-row">
        <Field label="身份定位"><input className={inputCls} value={role} onChange={e => setRole(e.target.value)} placeholder="主角 / 配角 / 对手" /></Field>
        <Field label="代表色"><div style={{ display: 'flex', gap: 6 }}>{COLORS.map(c => <button key={c} onClick={() => setColor(c)} style={{ width: 24, height: 24, borderRadius: 6, background: c, border: color === c ? '2px solid #333' : '2px solid transparent' }} />)}</div></Field>
      </div>
      <Field label="人物简介"><textarea className={areaCls} value={description} onChange={e => setDescription(e.target.value)} /></Field>
      <Field label="性格关键词（用顿号分隔）"><input className={inputCls} value={personality} onChange={e => setPersonality(e.target.value)} placeholder="克制 · 敏锐 · 执拗" /></Field>
      <Field label="背景故事"><textarea className={areaCls} value={background} onChange={e => setBackground(e.target.value)} /></Field>
      <div className="form-row"><Field label="外貌描述"><textarea className={areaCls} value={appearance} onChange={e => setAppearance(e.target.value)} /></Field><Field label="能力与弱点"><textarea className={areaCls} value={abilities} onChange={e => setAbilities(e.target.value)} /></Field></div>
    </div>
  </Modal>
}

function CharacterRelationPreview({ people, onClose }: { people: Character[]; onClose: () => void }) {
  const nodes = people.map((p, i) => ({ ...p, pos: NODE_POS[p.name] ?? { x: 20 + (i % 4) * 20, y: 80 - Math.floor(i / 4) * 25 } }))
  const focus = people[0]
  return <div className="relation-modal" onMouseDown={onClose}><section className="relation-dialog" onMouseDown={e => e.stopPropagation()}>
    <header className="relation-dialog-head"><div className="relation-title-icon"><GitBranch size={20} /></div><div><label>角色资料 · 全局视图</label><h2>人物关系图预览</h2><p>自动按关系簇分组展示。</p></div><div className="relation-summary"><span><b>{people.length}</b>角色</span><span><b>{relationEdges.length}</b>关系</span></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
    <div className="relation-toolbar"><div className="relation-legend"><span className="family">亲缘</span><span className="ally">同盟</span><span className="complex">复杂</span><span className="enemy">敌对</span></div><div><button><Focus size={14} />适应画布</button></div></div>
    <div className="relation-scroll"><section className="relation-group main"><header><div><label>关系图 01</label><h3>{focus ? `${focus.name} · 关系网` : '角色关系网'}</h3></div><p><b>{nodes.length}</b> 位角色 · <b>{relationEdges.length}</b> 条关系</p></header>
      <div className="relation-canvas">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{relationEdges.map((edge, index) => { const a = NODE_POS[edge.from]; const b = NODE_POS[edge.to]; if (!a || !b) return null; return <g className={edge.tone} key={index}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} /></g> })}</svg>
        {nodes.map(person => <div className={'relation-node ' + (person.name === (focus?.name) ? 'focus' : '')} key={person.id} style={{ left: person.pos.x + '%', top: person.pos.y + '%' }}><b style={{ background: person.color }}>{person.name.slice(0, 1)}</b><span><strong>{person.name}</strong><small>{person.role || person.aliases}</small></span></div>)}
      </div></section></div>
    <footer className="relation-dialog-foot"><span><CloudOff size={13} />关系数据仅保存在本地作品中</span><Button onClick={onClose}>关闭预览</Button></footer>
  </section></div>
}
