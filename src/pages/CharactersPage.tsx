import { useCallback, useEffect, useState } from 'react'
import {
  BrainCircuit, ChevronRight, CloudOff, GitBranch, MapPin,
  PenLine, RefreshCw, Trash2, Users, X,
} from 'lucide-react'
import { workspaceApi, type Character, type CharacterPresence, type PlotThread, type Workspace } from '../workspaceApi'
import { COLORS, readPresenceGap, writePresenceGap } from '../lib/constants'
import { confirmDialog } from '../components/Confirm'
import { Button, Detail, EmptyStateWrap, Field, FormFooter, LinkRecord, Modal, PaneHead, SearchBox } from '../components/ui'
import { areaCls, inputCls } from '../lib/constants'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { useEntityList } from '../hooks/useEntityList'

export function CharactersPage({ workspace, reload }: { workspace: Workspace; reload: () => Promise<void> }) {
  const novelId = workspace.novel.id
  // #2 懒加载：实体按需拉取 + 跨页共享缓存；变更直接 patch（接口返回新实体），
  // 不再整包 reload workspace。新增/删除会改变侧栏计数，补一次轻量 reload。
  const { items: people, loading, patch: patchCharacters } = useEntityList('characters', novelId, workspaceApi.listCharacters)
  const { items: threads } = useEntityList('plot-threads', novelId, workspaceApi.listThreads)
  // F2 登场追踪：进入页面拉一次；章节保存由写作页触发，切回本页时重取即可。
  const [presence, setPresence] = useState<CharacterPresence[]>([])
  const [gapLimit, setGapLimit] = useState(readPresenceGap)
  const [rescanning, setRescanning] = useState(false)
  const refreshPresence = useCallback(() => workspaceApi.characterPresence(novelId)
    .then(d => setPresence(d.characters)).catch(() => { /* 登场数据非关键，静默 */ }), [novelId])
  useEffect(() => { void refreshPresence() }, [refreshPresence])
  const changeGapLimit = (value: number) => {
    const gap = Math.max(1, Math.floor(value) || 1)
    setGapLimit(gap)
    writePresenceGap(gap)
  }
  const rescan = async () => {
    setRescanning(true)
    try {
      await workspaceApi.rescanPresence(novelId)
      await refreshPresence()
    } catch { /* rescan 失败保留旧数据 */ } finally { setRescanning(false) }
  }
  const [selectedId, setSelectedId] = useState(people[0]?.id ?? '')
  const [editing, setEditing] = useState<Character | null>(null)
  const [creating, setCreating] = useState(false)
  const [relationPreview, setRelationPreview] = useState(false)
  const [query, setQuery] = useState('')
  useEffect(() => { if (!people.find(p => p.id === selectedId)) setSelectedId(people[0]?.id ?? '') }, [people])
  const person = people.find(p => p.id === selectedId) ?? people[0]
  const personPresence = presence.find(p => p.character_id === person?.id)
  const q = query.trim()
  const visible = q ? people.filter(p => p.name.includes(q) || (p.aliases ?? '').includes(q) || (p.role ?? '').includes(q)) : people

  const upsert = (saved: Character, affectsCount: boolean) => {
    patchCharacters(prev =>
      prev.some(c => c.id === saved.id) ? prev.map(c => (c.id === saved.id ? saved : c)) : [...prev, saved])
    if (affectsCount) void reload()
    // 新建/改名会触发后端全量重扫，刷新登场数据。
    void refreshPresence()
  }

  if (loading) return <div className="page-loading-fallback">加载中…</div>
  if (people.length === 0) return <><EmptyStateWrap icon={Users} title="还没有角色" desc="创建第一个角色，让 AI 续写时记住他们的性格与背景。" action={() => setCreating(true)} />{creating && <CharacterForm novelId={novelId} onClose={() => setCreating(false)} onSaved={saved => { setCreating(false); upsert(saved, true) }} />}</>

  return <><div className="master-detail"><aside className="entity-pane"><PaneHead eyebrow="人物资料" title="角色" onAdd={() => setCreating(true)} /><SearchBox text="搜索角色" value={query} onChange={setQuery} /><div className="chips"><button className="active">全部 {visible.length}</button><button title="空窗提醒阈值：角色超过 N 章未登场时标记" onClick={() => changeGapLimit(gapLimit + 1)} onContextMenu={e => { e.preventDefault(); changeGapLimit(gapLimit - 1) }}>空窗 ≥{gapLimit}章</button></div>{visible.map(p => {
    const info = presence.find(x => x.character_id === p.id)
    const absent = info && info.gap !== null && info.gap >= gapLimit
    return <button key={p.id} className={'person-item ' + (p.id === selectedId ? 'active' : '')} onClick={() => setSelectedId(p.id)}><b style={{ background: p.color }}>{p.name.slice(0, 1)}</b><span><strong>{p.name}</strong><small>{info && info.gap !== null ? `第${info.last_chapter}章登场 · 空窗${info.gap}章` : p.role || p.aliases}</small>{absent && <em className="presence-warn">久未登场</em>}</span><ChevronRight size={14} /></button>
  })}
    {q && visible.length === 0 && <p style={{ padding: '14px 16px', color: 'var(--text-3)', fontSize: 11 }}>没有匹配「{q}」的角色</p>}</aside>
    {person && <section className="entity-detail"><div className="person-hero"><b style={{ background: person.color }}>{person.name.slice(0, 1)}</b><div><label>角色 · {person.aliases ? person.aliases : '已登场'}</label><h1>{person.name}</h1><p>{person.role}</p></div><Button onClick={() => setRelationPreview(true)}><GitBranch size={14} />关系图预览</Button><Button kind="danger" onClick={async () => { const ok = await confirmDialog({ title: '删除角色', message: `删除角色「${person.name}」？关联伏笔中的引用将被移除。`, danger: true }); if (ok) { await workspaceApi.deleteCharacter(person.id); patchCharacters(prev => prev.filter(p => p.id !== person.id)); void reload(); void refreshPresence() } }}><Trash2 size={14} />删除</Button><Button kind="primary" onClick={() => setEditing(person)}><PenLine size={14} />编辑资料</Button></div>
      <div className="detail-grid">
        <Detail title="人物简介" wide><p className="lead">{person.description || '暂无简介。'}</p></Detail>
        <Detail title="性格关键词"><div className="tag-list">{(person.personality || '未设定').split(/[·、\s,，]+/, 6).filter(Boolean).map(t => <span key={t}>{t}</span>)}</div></Detail>
        <Detail title="登场记录"><div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {personPresence && personPresence.chapter_count > 0
            ? <>
              <p><MapPin size={13} style={{ verticalAlign: -2, marginRight: 4 }} />首登场 第{personPresence.first_chapter}章 · 最近 第{personPresence.last_chapter}章</p>
              <p>登场 {personPresence.chapter_count} 章 · 提及 {personPresence.hits} 次 · 空窗 <b className={personPresence.gap !== null && personPresence.gap >= gapLimit ? 'presence-warn' : ''}>{personPresence.gap ?? '—'}</b> 章</p>
            </>
            : <p>{personPresence ? '尚未在正文中登场（按角色名与别名扫描）。' : '登场数据加载中…'}</p>}
          <Button onClick={() => void rescan()} disabled={rescanning}><RefreshCw size={13} />{rescanning ? '重扫中…' : '重扫登场记录'}</Button>
        </div></Detail>
        <Detail title="能力与弱点"><p>{person.abilities || '未设定'}</p></Detail>
        <Detail title="背景故事" wide><p>{person.background || '未设定'}</p></Detail>
        <Detail title="外貌描述"><p>{person.appearance || '未设定'}</p></Detail>
        <Detail title="关联伏笔"><LinkRecord icon={BrainCircuit} title={`${threads.filter(t => t.related_characters.includes(person.id)).length} 条`} note="可在伏笔看板查看" /></Detail>
      </div></section>}</div>
  {creating && <CharacterForm novelId={novelId} onClose={() => setCreating(false)} onSaved={saved => { setCreating(false); upsert(saved, true) }} />}
  {editing && <CharacterForm novelId={novelId} initial={editing} onClose={() => setEditing(null)} onSaved={saved => { setEditing(null); upsert(saved, false) }} />}
  {relationPreview && <CharacterRelationPreview people={people} threads={threads} onClose={() => setRelationPreview(false)} />}
  </>
}

function CharacterForm({ novelId, initial, onClose, onSaved }: { novelId: string; initial?: Character; onClose: () => void; onSaved: (saved: Character) => void }) {
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
    if (initial) { const saved = await workspaceApi.updateCharacter(initial.id, data); onSaved(saved) }
    else { const saved = await workspaceApi.createCharacter(novelId, data); onSaved(saved) }
  })
  return <Modal eyebrow={initial ? '编辑角色' : '新建角色'} title={name || '新角色'} icon={Users} onClose={onClose} wide
    footer={<FormFooter error={error} busy={busy} onClose={onClose} onSubmit={submit} note="AI 续写时会注入角色信息" />}>
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

/** 关系图预览：用真实数据构图——两个角色共同出现在至少一条伏笔中就连一条边
 *  （与大纲页角色关系图同一条规则），节点沿圆环排布。没有伏笔数据时如实提示。 */
function CharacterRelationPreview({ people, threads, onClose }: { people: Character[]; threads: PlotThread[]; onClose: () => void }) {
  const threadsByChar = new Map<string, Set<string>>()
  for (const t of threads) for (const cid of t.related_characters ?? []) {
    const s = threadsByChar.get(cid) ?? new Set<string>(); s.add(t.title); threadsByChar.set(cid, s)
  }
  const nodes = people.map((p, i) => {
    const angle = (i / Math.max(1, people.length)) * 2 * Math.PI - Math.PI / 2
    return { ...p, x: 50 + 36 * Math.cos(angle), y: 50 + 36 * Math.sin(angle) }
  })
  const posById = new Map(nodes.map(n => [n.id, n]))
  const edges: { from: string; to: string }[] = []
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    const a = threadsByChar.get(people[i].id), b = threadsByChar.get(people[j].id)
    if (a && b && [...a].some(t => b.has(t))) edges.push({ from: people[i].id, to: people[j].id })
  }
  return <div className="relation-modal" onMouseDown={onClose}><section className="relation-dialog" onMouseDown={e => e.stopPropagation()}>
    <header className="relation-dialog-head"><div className="relation-title-icon"><GitBranch size={20} /></div><div><label>角色资料 · 全局视图</label><h2>人物关系图预览</h2><p>按共同伏笔自动连线。</p></div><div className="relation-summary"><span><b>{people.length}</b>角色</span><span><b>{edges.length}</b>关系</span></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
    <div className="relation-toolbar"><div className="relation-legend"><span className="complex">共同伏笔</span></div></div>
    <div className="relation-scroll"><section className="relation-group main"><header><div><label>关系图 01</label><h3>角色关系网</h3></div><p><b>{nodes.length}</b> 位角色 · <b>{edges.length}</b> 条关系（依据伏笔的关联角色推导）</p></header>
      <div className="relation-canvas">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{edges.map((edge, index) => { const a = posById.get(edge.from); const b = posById.get(edge.to); if (!a || !b) return null; return <g className="complex" key={index}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} /></g> })}</svg>
        {nodes.map(person => <div className="relation-node" key={person.id} style={{ left: person.x + '%', top: person.y + '%' }}><b style={{ background: person.color }}>{person.name.slice(0, 1)}</b><span><strong>{person.name}</strong><small>{person.role || person.aliases}</small></span></div>)}
        {edges.length === 0 && <div className="map-empty" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 12 }}>在伏笔看板为伏笔勾选「关联角色」后，这里会显示角色之间的关系。</div>}
      </div></section></div>
    <footer className="relation-dialog-foot"><span><CloudOff size={13} />关系数据仅保存在本地作品中</span><Button onClick={onClose}>关闭预览</Button></footer>
  </section></div>
}
