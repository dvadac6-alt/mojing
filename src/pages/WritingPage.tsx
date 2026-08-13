import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot, BrainCircuit, Check, ChevronLeft, ChevronRight, Database, Feather, GripVertical,
  History, PanelRightClose, Plus, Save, ShieldCheck, Sparkles, Square,
  Trash2, WandSparkles,
} from 'lucide-react'
import {
  streamAI, workspaceApi,
  type ChapterSummary, type ChapterVersion, type Workspace,
} from '../workspaceApi'
import type { Page } from '../lib/constants'
import { fmt } from '../lib/constants'
import { Button, EmptyState, Field, Modal, SearchBox } from '../components/ui'
import { ModelSelect } from '../components/ModelSelect'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { useConnectingTimer } from '../hooks/useConnectingTimer'

const SIG_SEP = '\u0000'

type DraftPage = { start: number; end: number; text: string }

// Reusable measurement probe (#5). paginateByHeight binary-searches every page
// boundary, calling this O(P·log N) times per re-pagination — for a 50k-char
// chapter that's hundreds of calls. The old version created+appended+removed a
// fresh <textarea> each call; reusing one element and only restyling when the
// source's font metrics actually change cuts that to a value-set + scrollHeight
// read, which is what makes paging a long chapter feel instant instead of janky.
let _measureProbe: HTMLTextAreaElement | null = null
let _measureStyleKey = ''

function measureTextHeight(source: HTMLTextAreaElement, text: string, width: number): number {
  const sourceStyle = window.getComputedStyle(source)
  // Anything that changes how text wraps/flows must invalidate the cached style.
  const styleKey = `${width}|${sourceStyle.font}|${sourceStyle.lineHeight}|${sourceStyle.padding}|${sourceStyle.letterSpacing}|${sourceStyle.wordBreak}|${sourceStyle.whiteSpace}|${sourceStyle.textAlign}`
  if (!_measureProbe) {
    _measureProbe = document.createElement('textarea')
    _measureProbe.rows = 1
    Object.assign(_measureProbe.style, {
      position: 'fixed', left: '-10000px', top: '0', height: '0px', minHeight: '0',
      border: '0', boxSizing: 'border-box', overflow: 'hidden', visibility: 'hidden',
    })
    document.body.appendChild(_measureProbe)
  }
  if (_measureStyleKey !== styleKey) {
    const s = _measureProbe.style
    s.width = `${width}px`
    s.padding = sourceStyle.padding
    s.font = sourceStyle.font
    s.lineHeight = sourceStyle.lineHeight
    s.letterSpacing = sourceStyle.letterSpacing
    s.textAlign = sourceStyle.textAlign
    s.whiteSpace = sourceStyle.whiteSpace
    s.wordBreak = sourceStyle.wordBreak
    _measureStyleKey = styleKey
  }
  _measureProbe.value = text
  return _measureProbe.scrollHeight
}

function paginateByHeight(content: string, source: HTMLTextAreaElement, firstHeight: number, pageHeight: number): DraftPage[] {
  if (!content) return [{ start: 0, end: 0, text: '' }]

  const pages: DraftPage[] = []
  const width = source.clientWidth
  let start = 0
  let pageNumber = 0

  while (start < content.length) {
    const availableHeight = pageNumber === 0 ? firstHeight : pageHeight
    let low = start + 1
    let high = content.length
    let end = low

    // Find the furthest character that still fits the visible text area.
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      if (measureTextHeight(source, content.slice(start, middle), width) <= availableHeight + 1) {
        end = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }

    // Prefer ending at a nearby paragraph or line boundary without leaving
    // a large unused area at the bottom of the page.
    const fittedLength = end - start
    const minNaturalBreak = start + Math.floor(fittedLength * 0.8)
    const paragraphBreak = content.lastIndexOf('\n\n', end)
    if (paragraphBreak >= minNaturalBreak && paragraphBreak + 2 <= end) end = paragraphBreak + 2
    else {
      const lineBreak = content.lastIndexOf('\n', end)
      if (lineBreak >= minNaturalBreak && lineBreak + 1 <= end) end = lineBreak + 1
    }

    pages.push({ start, end, text: content.slice(start, end) })
    start = end
    pageNumber += 1
  }

  return pages
}

export function WritingPage({ workspace, patchWorkspace, reload, assistant, onAssistant, onGoto }:
  { workspace: Workspace; patchWorkspace: (u: (w: Workspace) => Workspace) => void; reload: () => Promise<void>; assistant: boolean; onAssistant: () => void; onGoto: (p: Page) => void }) {
  const [tab, selectTab] = useState<'quick' | 'agent' | 'ref'>('quick')
  const [activeId, setActiveId] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draft, setDraft] = useState('')
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [savedAt, setSavedAt] = useState('')
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [loadingContent, setLoadingContent] = useState(false)
  const [pageIndex, setPageIndex] = useState(0)
  const [pagination, setPagination] = useState<{ content: string; pages: DraftPage[] }>({
    content: '',
    pages: [{ start: 0, end: 0, text: '' }],
  })
  const savedSignature = useRef('')
  const paperRef = useRef<HTMLElement>(null)
  const manuscriptRef = useRef<HTMLTextAreaElement>(null)
  const headingMeasureRef = useRef<HTMLDivElement>(null)

  // ---- 右键 AI 补写（直接写入原文 + 背景层绿/红着色）----
  type Highlight = { start: number; end: number; type: 'add' | 'del' }
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; insertPos: number; selStart: number; selEnd: number } | null>(null)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [aiPhase, setAiPhase] = useState<'idle' | 'connecting' | 'streaming'>('idle')
  const [aiError, setAiError] = useState('')
  const aiElapsed = useConnectingTimer(aiPhase)
  const aiAbort = useRef<AbortController | null>(null)

  const onContextMenu = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    const ta = e.currentTarget
    setCtxMenu({ x: e.clientX, y: e.clientY, insertPos: ta.selectionStart, selStart: ta.selectionStart, selEnd: ta.selectionEnd })
  }

  const startInlineGenerate = async (insertPos: number, selStart: number, selEnd: number) => {
    setCtxMenu(null)
    const hasSelection = selEnd > selStart
    // 取光标前最多 600 字（或选中文字本身）作为续写上下文。
    const contextBefore = hasSelection ? draft.slice(selStart, selEnd) : draft.slice(Math.max(0, insertPos - 600), insertPos)
    const instruction = hasSelection
      ? `请改写以下文字，保持情节但优化表达，约 ${Math.max(contextBefore.length, 200)} 字。只输出改写后的正文，不要解释。\n\n--- 原文 ---\n${contextBefore}`
      : (contextBefore.trim()
        ? `请从以下内容的结尾处自然续写，保持文风与语气一致，约 300 字。只输出续写正文，不要解释。\n\n--- 前文 ---\n${contextBefore}`
        : '请从章节开头自然开始续写，约 300 字。只输出正文。')
    setAiPhase('connecting')
    setAiError('')
    setHighlights([])
    const controller = new AbortController()
    aiAbort.current = controller
    // 写入的起始 offset（用于 highlight 区间追踪）。
    const writeStart = hasSelection ? selStart : insertPos
    // 如果是改写，先删掉选中的原文（一次性），之后只追加 AI 内容。
    if (hasSelection) {
      setDraft(d => d.slice(0, selStart) + d.slice(selEnd))
    }
    // aiEnd 追踪 AI 内容在 draft 中的当前末尾位置。
    // 每个 chunk 只追加 delta（新增的字），绝不重写已有内容——否则会指数级重复。
    let aiEnd = writeStart
    try {
      for await (const piece of streamAI('/ai/generate', {
        novel_id: workspace.novel.id, chapter_id: activeChapter?.id, instruction,
        mode: 'continue', target_words: hasSelection ? Math.max(contextBefore.length, 200) : 300,
        context: { characters: true, locations: false, settings: true, threads: true, recent_chapters: 1 },
      }, controller.signal)) {
        const delta = piece.text
        const insertAt = aiEnd
        setDraft(d => d.slice(0, insertAt) + delta + d.slice(insertAt))
        aiEnd += delta.length
        setHighlights([{ start: writeStart, end: aiEnd, type: 'add' }])
        setAiPhase('streaming')
      }
      setAiPhase('idle')
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setHighlights([])
        // streamAI now surfaces the real upstream reason (429 / 401 / timeout);
        // show it instead of failing silently so the user knows *why*.
        setAiError((e as Error).message || 'AI 生成失败')
      }
      setAiPhase('idle')
    } finally { aiAbort.current = null }
  }

  // Close the context menu on any outside click.
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true) }
  }, [ctxMenu])

  // The workspace only carries chapter summaries now; fetch the full body of
  // the active chapter on demand (the rest of the list stays light).
  useEffect(() => {
    const chapters = workspace.chapters
    if (!chapters.length) return
    if (!activeId || !chapters.find(c => c.id === activeId)) {
      const preferred = chapters.find(c => c.status === 'writing') ?? chapters[chapters.length - 1]
      setActiveId(preferred.id)
      setDraftTitle(preferred.title)
      setDraft('')
      savedSignature.current = `${preferred.title}${SIG_SEP}`
      void loadContent(preferred.id, preferred.title)
    }
  }, [workspace])

  const loadContent = useCallback(async (chapterId: string, fallbackTitle: string) => {
    setPageIndex(0)
    setLoadingContent(true)
    try {
      const full = await workspaceApi.getChapter(chapterId)
      setDraft(full.content)
      setDraftTitle(full.title)
      savedSignature.current = `${full.title}${SIG_SEP}${full.content}`
      setSaveState('saved')
    } catch {
      setDraft('')
      savedSignature.current = `${fallbackTitle}${SIG_SEP}`
      setSaveState('error')
    } finally {
      setLoadingContent(false)
    }
  }, [])

  const activeChapter = workspace.chapters.find(c => c.id === activeId)
  const currentSignature = `${draftTitle}${SIG_SEP}${draft}`
  const pages = pagination.content === draft
    ? pagination.pages
    : [{ start: 0, end: draft.length, text: draft }]
  const currentPageIndex = Math.min(pageIndex, pages.length - 1)
  const currentPage = pages[currentPageIndex]

  // Debounced pagination: re-measure 300ms after draft stops changing, so rapid
  // typing / streaming AI output doesn't trigger the height-binary-search on
  // every keystroke (which janks the editor).
  useEffect(() => {
    const paper = paperRef.current
    const manuscript = manuscriptRef.current
    const heading = headingMeasureRef.current
    if (!paper || !manuscript || !heading || !manuscript.clientWidth) return
    const timer = setTimeout(() => {
      const paperStyle = window.getComputedStyle(paper)
      const verticalBorder = parseFloat(paperStyle.borderTopWidth) + parseFloat(paperStyle.borderBottomWidth)
      const verticalPadding = parseFloat(paperStyle.paddingTop) + parseFloat(paperStyle.paddingBottom)
      const pageHeight = Math.max(1, paper.clientHeight - verticalBorder - verticalPadding)
      const firstPageHeight = Math.max(1, pageHeight - heading.getBoundingClientRect().height)
      const measuredPages = paginateByHeight(draft, manuscript, firstPageHeight, pageHeight)
      setPagination({ content: draft, pages: measuredPages })
      setPageIndex(index => Math.min(index, measuredPages.length - 1))
    }, 300)
    const refresh = () => {
      const currentPaper = paperRef.current
      const currentManuscript = manuscriptRef.current
      const currentHeading = headingMeasureRef.current
      if (!currentPaper || !currentManuscript || !currentHeading || !currentManuscript.clientWidth) return
      const currentStyle = window.getComputedStyle(currentPaper)
      const borders = parseFloat(currentStyle.borderTopWidth) + parseFloat(currentStyle.borderBottomWidth)
      const padding = parseFloat(currentStyle.paddingTop) + parseFloat(currentStyle.paddingBottom)
      const height = Math.max(1, currentPaper.clientHeight - borders - padding)
      const firstHeight = Math.max(1, height - currentHeading.getBoundingClientRect().height)
      const nextPages = paginateByHeight(draft, currentManuscript, firstHeight, height)
      setPagination({ content: draft, pages: nextPages })
      setPageIndex(index => Math.min(index, nextPages.length - 1))
    }
    window.addEventListener('resize', refresh)
    return () => { clearTimeout(timer); window.removeEventListener('resize', refresh) }
  }, [draft, activeId, assistant])

  const persistChapter = useCallback(async (chapterId = activeId, title = draftTitle, content = draft) => {
    if (!chapterId) return null
    const normalizedTitle = title.trim() || '未命名章节'
    setSaveState('saving')
    try {
      const updated = await workspaceApi.updateChapter(chapterId, {
        title: normalizedTitle, content,
        status: content.trim() ? 'writing' : 'draft',
      })
      patchWorkspace(current => current ? {
        ...current,
        novel: {
          ...current.novel,
          total_words: current.chapters.reduce((sum, c) => sum + (c.id === updated.id ? updated.word_count : c.word_count), 0),
        },
        // updateChapter returns a full Chapter; the workspace list stores
        // summaries, but the response is structurally compatible (content is
        // simply an extra field the list ignores).
        chapters: current.chapters.map(c => (c.id === updated.id ? updated : c) as typeof c),
      } : current)
      if (chapterId === activeId) {
        setDraftTitle(updated.title)
        savedSignature.current = `${updated.title}${SIG_SEP}${updated.content}`
      }
      setSaveState('saved')
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
      return updated
    } catch {
      setSaveState('error')
      return null
    }
  }, [activeId, draftTitle, draft, activeChapter?.id, patchWorkspace])

  useEffect(() => {
    if (!activeChapter || currentSignature === savedSignature.current) return
    setSaveState('saving')
    const timer = window.setTimeout(() => { void persistChapter() }, 1000)
    return () => window.clearTimeout(timer)
  }, [currentSignature, activeChapter?.id])

  // Ctrl/Cmd+S → manual save. Writers reflexively hit this; intercepting the
  // browser's "save webpage" dialog and showing "已保存" turns anxiety into
  // confirmation. Auto-save still runs regardless.
  useEffect(() => {
    const onSave = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        if (activeId) void persistChapter()
      }
    }
    window.addEventListener('keydown', onSave)
    return () => window.removeEventListener('keydown', onSave)
  }, [persistChapter, activeId])

  const selectChapter = async (chapter: ChapterSummary) => {
    if (chapter.id === activeId) return
    if (activeId && currentSignature !== savedSignature.current) await persistChapter()
    setActiveId(chapter.id); setDraftTitle(chapter.title); setDraft('')
    setPageIndex(0)
    savedSignature.current = `${chapter.title}${SIG_SEP}`
    setSaveState('saved')
    void loadContent(chapter.id, chapter.title)
  }
  const createChapter = async () => {
    if (activeId && currentSignature !== savedSignature.current) await persistChapter()
    try {
      const created = await workspaceApi.createChapter(workspace.novel.id, `未命名章节 ${workspace.chapters.length + 1}`)
      patchWorkspace(c => c ? { ...c, novel: { ...c.novel, chapter_count: c.novel.chapter_count + 1 }, chapters: [...c.chapters, created] } : c)
      setActiveId(created.id); setDraftTitle(created.title); setDraft(created.content); setPageIndex(0)
      savedSignature.current = `${created.title}${SIG_SEP}${created.content}`
      setSaveState('saved')
    } catch { setSaveState('error') }
  }
  const deleteChapter = async () => {
    if (!activeChapter || !confirm(`删除「${activeChapter.title}」？此操作不可撤销。`)) return
    try {
      await workspaceApi.deleteChapter(activeChapter.id)
      patchWorkspace(c => c ? { ...c, chapters: c.chapters.filter(x => x.id !== activeChapter.id), novel: { ...c.novel, chapter_count: Math.max(0, c.novel.chapter_count - 1) } } : c)
      setActiveId('')
    } catch { setSaveState('error') }
  }

  if (!activeChapter) return <div className="writing-state"><EmptyState icon={Feather} title="还没有章节" desc="创建第一章，开始你的故事。" action={<Button kind="primary" onClick={createChapter}><Plus size={15} />新建章节</Button>} /></div>

  const paragraphs = draft.trim() ? draft.split(/\n\s*\n/).length : 0
  const readingMinutes = Math.max(1, Math.ceil(activeChapter.word_count / 450))

  /** 渲染背景着色层：把当前页文本按 highlight 区间分成段，AI 新增绿色、删除红色。
   *  highlights 的 offset 是相对于 draft 全文的，这里映射到当前页的局部 offset。
   *  Memoized so plain typing (no highlights, same page) doesn't re-slice the
   *  text on every keystroke — only page changes or AI highlights recompute it. */
  const renderBackdrop = useMemo<React.ReactNode>(() => {
    const pageStart = currentPage.start
    const pageEnd = currentPage.end
    const text = currentPage.text
    if (!highlights.length) return text
    // 求每个 highlight 与当前页 [pageStart, pageEnd) 的交集，转为页内 offset。
    type Span = { s: number; e: number; type: 'add' | 'del' }
    const spans: Span[] = []
    for (const h of highlights) {
      const s = Math.max(h.start, pageStart) - pageStart
      const e = Math.min(h.end, pageEnd) - pageStart
      if (s < e) spans.push({ s, e, type: h.type })
    }
    if (!spans.length) return text
    spans.sort((a, b) => a.s - b.s)
    // 按区间切分文本，渲染 colored spans。
    const out: React.ReactNode[] = []
    let cursor = 0
    for (let i = 0; i < spans.length; i++) {
      const sp = spans[i]
      if (sp.s > cursor) out.push(<span key={`t${i}`}>{text.slice(cursor, sp.s)}</span>)
      out.push(<span key={`h${i}`} className={'ai-' + sp.type}>{text.slice(sp.s, sp.e)}</span>)
      cursor = sp.e
    }
    if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>)
    return out
  }, [currentPage, highlights])

  return <div className="writing-page">
    <aside className="chapters-pane"><div className="pane-title"><div><label>{workspace.novel.title}</label><strong>章节目录</strong></div><button onClick={createChapter}><Plus size={16} /></button></div><SearchBox text="搜索章节或正文" />
      <div className="chapter-list">{workspace.chapters.map(chapter => <button className={chapter.id === activeId ? 'active' : ''} key={chapter.id} onClick={() => void selectChapter(chapter)}><GripVertical size={13} /><b>{String(chapter.order).padStart(2, '0')}</b><span><strong>{chapter.title}</strong><small>{fmt(chapter.word_count)} 字</small></span>{chapter.status === 'completed' && <Check size={12} />}</button>)}</div>
      <button className="new-chapter" onClick={createChapter}><Plus size={14} />新建章节</button>
    </aside>
    <section className="editor"><div className="editor-toolbar">
      <button onClick={deleteChapter} title="删除当前章节"><Trash2 size={15} /></button><button onClick={() => setVersionsOpen(true)} title="版本历史"><History size={15} /></button><i />
      <span>第 {String(activeChapter.order).padStart(2, '0')} 章 <ChevronRight size={12} /> <strong>{draftTitle || '未命名章节'}</strong></span><b />
      <em className={saveState}><Check size={12} />{loadingContent ? '正在加载…' : saveState === 'saving' ? '正在保存…' : saveState === 'error' ? '保存失败' : `已保存 ${savedAt}`}</em>
      <button onClick={() => void persistChapter()}><Save size={14} />保存<kbd>⌘S</kbd></button>
      <button onClick={() => onGoto('threads')} title="伏笔看板"><BrainCircuit size={14} /></button>
      <button className={'assist-toggle ' + (assistant ? 'active' : '')} onClick={onAssistant}><WandSparkles size={14} />辅助中心</button>
    </div>
       <div className="paper-wrap"><article ref={paperRef} className="paper editable-paper">
         {currentPageIndex === 0 && <div className="page-heading"><label>第 {activeChapter.order} 章</label><input className="chapter-title-input" value={draftTitle} onChange={e => setDraftTitle(e.target.value)} aria-label="章节标题" /><div className="ornament"><i /><Feather size={14} /><i /></div></div>}
         <div className="manuscript-stage">
           {/* 背景着色层：与 textarea 同步，渲染 AI 新增（绿）/删除（红）标记 */}
           <div className="manuscript-backdrop" aria-hidden="true">{renderBackdrop}</div>
           <textarea ref={manuscriptRef} className="manuscript-textarea" value={currentPage.text} onChange={e => { setHighlights([]); setDraft(current => current.slice(0, currentPage.start) + e.target.value + current.slice(currentPage.end)) }} onContextMenu={onContextMenu} aria-label={`章节正文第 ${currentPageIndex + 1} 页`} placeholder={loadingContent ? '正在读取本章内容…' : '从这里开始写作……（右键空白处可 AI 补写）'} spellCheck={false} disabled={loadingContent} />
         </div>
         <div ref={headingMeasureRef} className="page-heading page-heading-measure" aria-hidden="true"><label>第 {activeChapter.order} 章</label><input className="chapter-title-input" value={draftTitle} readOnly tabIndex={-1} /><div className="ornament"><i /><Feather size={14} /><i /></div></div>
       </article></div>
       {ctxMenu && (
         <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={e => e.stopPropagation()}>
           <button onClick={() => void startInlineGenerate(ctxMenu.insertPos, ctxMenu.selStart, ctxMenu.selEnd)}>
             <Sparkles size={13} />{ctxMenu.selEnd > ctxMenu.selStart ? 'AI 改写选中' : 'AI 补写此处'}
           </button>
         </div>
       )}
      {(aiPhase !== 'idle' || aiError) && (
        <div className={'ai-inline-status' + (aiError ? ' error' : '')}>
          <Sparkles size={13} />
          {aiError
            ? <>AI 生成失败：{aiError}<button onClick={() => setAiError('')}>×</button></>
            : aiPhase === 'connecting'
              ? <>正在连接模型… 已等待 {aiElapsed} 秒<button onClick={() => aiAbort.current?.abort()}><Square size={11} />停止</button></>
              : <>AI 生成中（绿色为新增）<button onClick={() => aiAbort.current?.abort()}><Square size={11} />停止</button></>}
        </div>
      )}
       <nav className="page-navigation" aria-label="章节分页">
         <button onClick={() => setPageIndex(index => Math.max(0, index - 1))} disabled={currentPageIndex === 0}><ChevronLeft size={14} />上一页</button>
         <span>第 <b>{currentPageIndex + 1}</b> / {pages.length} 页</span>
         <button onClick={() => setPageIndex(index => Math.min(pages.length - 1, index + 1))} disabled={currentPageIndex >= pages.length - 1}>下一页<ChevronRight size={14} /></button>
       </nav>
       <footer className="editor-status"><span>本章 {draft.replace(/\s/g, '').length.toLocaleString()} 字</span><span>全文 {fmt(workspace.novel.total_words)} 字</span><b /><span>段落 {paragraphs}</span><span>预计阅读 {readingMinutes} 分钟</span><span><button className="btn ghost" onClick={() => onGoto('threads')}>伏笔看板</button></span></footer>
    </section>
    {assistant && <aside className="assistant"><div className="assistant-title"><span><Sparkles size={14} /></span><strong>辅助中心</strong><button onClick={onAssistant}><PanelRightClose size={15} /></button></div><div className="assistant-tabs"><button className={tab === 'quick' ? 'active' : ''} onClick={() => selectTab('quick')}>快捷生成</button><button className={tab === 'agent' ? 'active' : ''} onClick={() => selectTab('agent')}>Agent</button><button className={tab === 'ref' ? 'active' : ''} onClick={() => selectTab('ref')}>参考</button></div>{tab === 'quick' ? <QuickAI workspace={workspace} chapter={activeChapter} onAccept={text => setDraft(d => d.replace(/\s*$/, '') + '\n\n' + text)} /> : tab === 'agent' ? <AgentPanel workspace={workspace} onAccept={text => setDraft(d => d.replace(/\s*$/, '') + '\n\n' + text)} /> : <ReferencePanel />}</aside>}
    {versionsOpen && <VersionHistory chapter={activeChapter} onClose={() => setVersionsOpen(false)} onRolled={async () => { setVersionsOpen(false); await reload(); void loadContent(activeChapter.id, activeChapter.title) }} />}
  </div>
}

function QuickAI({ workspace, chapter, onAccept }: { workspace: Workspace; chapter: ChapterSummary; onAccept: (text: string) => void }) {
  const [instruction, setInstruction] = useState('让马车里的人交代城北线索，但不要揭示他的真实身份。气氛保持克制、紧张。')
  const [mode, setMode] = useState<'continue' | 'polish' | 'expand'>('continue')
  const [target, setTarget] = useState('800')
  const [modelId, setModelId] = useState<number | null>(null)
  const [ctx, setCtx] = useState({ characters: true, locations: false, settings: true, threads: true, recent_chapters: 2 })
  const [output, setOutput] = useState('')
  const [model, setModel] = useState('')
  // 'connecting' = waiting for the first token (cold start can take ~10-20s on
  // real providers); 'streaming' = tokens are flowing.
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'streaming'>('idle')
  const [error, setError] = useState('')
  const elapsed = useConnectingTimer(phase)
  const abortRef = useRef<AbortController | null>(null)

  const generate = async () => {
    setOutput(''); setError(''); setPhase('connecting')
    const controller = new AbortController()
    abortRef.current = controller
    let received = ''
    let failed = false
    try {
      const gen = streamAI('/ai/generate', {
        novel_id: workspace.novel.id, chapter_id: chapter.id, instruction, mode,
        target_words: Number(target) || 800, config_id: modelId, context: ctx,
      }, controller.signal)
      for await (const piece of gen) { received += piece.text; setOutput(received); setModel(piece.model); setPhase('streaming') }
    } catch (e) {
      // An abort is the user choosing to stop, not a failure to surface.
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        failed = true
        setError(e instanceof Error ? e.message : '生成失败')
      }
    } finally {
      setPhase('idle'); abortRef.current = null
      // Stream ended with zero content and no error: surface it explicitly
      // instead of leaving the user staring at an empty panel (slow providers
      // can time out upstream and close the connection).
      if (!received.trim() && !failed) setError('模型未返回内容（连接可能中断），请重试。')
    }
  }
  const stop = () => { abortRef.current?.abort() }
  const accept = () => { if (output.trim()) { onAccept(output.trim()); setOutput('') } }
  const selectCls = 'form-select'

  // Ctrl/Cmd+Enter → generate (the button already shows a ⌘↵ hint; wire it up
  // for real so the keyboard shortcut the UI promises actually works).
  const phaseRef = useRef(phase); phaseRef.current = phase
  const generateRef = useRef(generate); generateRef.current = generate
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && phaseRef.current === 'idle') {
        e.preventDefault()
        void generateRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return <div className="assist-body">
    <div className="assist-intro"><span><WandSparkles size={18} /></span><div><strong>接下来想怎么写？</strong><p>结合当前章节和作品资料生成草稿。</p></div></div>
    <label>写作要求</label>
    <div className="prompt"><textarea value={instruction} onChange={e => setInstruction(e.target.value)} /><footer><span>{instruction.length} / 500</span></footer></div>
    <ModelSelect value={modelId} onChange={setModelId} />
    <div className="two-fields">
      <Field label="生成方式"><select className={selectCls} value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="continue">续写正文</option><option value="polish">润色正文</option><option value="expand">扩写场景</option></select></Field>
      <Field label="目标长度"><select className={selectCls} value={target} onChange={e => setTarget(e.target.value)}><option value="400">约 400 字</option><option value="800">约 800 字</option><option value="1200">约 1200 字</option></select></Field>
    </div>
    <div className="context-box"><p><Database size={13} /><strong>本次上下文</strong></p>
      <div>{(['characters', 'locations', 'settings', 'threads'] as const).map(k => <button key={k} className={ctx[k] ? 'active' : ''} onClick={() => setCtx(c => ({ ...c, [k]: !c[k] }))}>{({ characters: '角色', locations: '地点', settings: '世界观', threads: '伏笔' })[k]}</button>)}</div>
    </div>
    <div className="ai-generate-row">
      <button className="generate" onClick={generate} disabled={phase !== 'idle'}><Sparkles size={15} />{phase === 'connecting' ? '正在连接模型…' : phase === 'streaming' ? '正在生成…' : '生成可审阅草稿'}<kbd>⌘ ↵</kbd></button>
      {phase !== 'idle' && <button className="generate stop" onClick={stop}><Square size={14} />停止</button>}
    </div>
    {phase === 'connecting' && <div className="ai-connecting">模型正在推理… 已等待 {elapsed} 秒（首次输出通常 20~40 秒，若超过 90 秒会自动重试一次）</div>}
    {(output || error) && <div className="ai-meta"><Sparkles size={12} />模型 <b>{model || 'mock'}</b>{phase !== 'idle' && <span>· 生成中</span>}</div>}
    {error && <div className="form-error">{error}</div>}
    {output && <div className={'ai-output' + (phase === 'streaming' ? ' streaming' : '')}>{output}</div>}
    {output && phase === 'idle' && <div className="ai-actions"><Button onClick={() => setOutput('')}>丢弃</Button><Button kind="primary" onClick={accept}><Check size={14} />采纳并插入</Button></div>}
    <small className="safe-note"><ShieldCheck size={13} />不会自动写入正文，确认后才会应用。</small>
  </div>
}

function AgentPanel({ workspace, onAccept }: { workspace: Workspace; onAccept: (t: string) => void }) {
  const [goal, setGoal] = useState('完成本章后半段，推进玉佩伏笔，但不要揭晓幕后人物。')
  const [modelId, setModelId] = useState<number | null>(null)
  const [output, setOutput] = useState('')
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'streaming'>('idle')
  const elapsed = useConnectingTimer(phase)
  const abortRef = useRef<AbortController | null>(null)
  const run = async () => {
    setOutput(''); setPhase('connecting')
    const controller = new AbortController()
    abortRef.current = controller
    let received = ''
    let failed = false
    try {
      for await (const p of streamAI('/ai/generate', { novel_id: workspace.novel.id, instruction: goal, mode: 'continue', target_words: 800, config_id: modelId }, controller.signal)) { received += p.text; setOutput(received); setPhase('streaming') }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) { failed = true; setOutput(e instanceof Error ? e.message : '生成失败') }
    } finally {
      setPhase('idle'); abortRef.current = null
      if (!received.trim() && !failed) setOutput('模型未返回内容（连接可能中断），请重试。')
    }
  }
  const stop = () => { abortRef.current?.abort() }
  return <div className="assist-body agent-body">
    <span className="agent-orb"><Bot size={27} /></span>
    <h3>写作 Agent</h3>
    <p>给出目标，Agent 会收集资料、生成草稿并自检。</p>
    <label>任务目标</label>
    <textarea className="agent-goal" value={goal} onChange={e => setGoal(e.target.value)} />
    <ModelSelect value={modelId} onChange={setModelId} />
    <div className="plan-preview">{['收集作品上下文', '生成章节草稿', '目标符合度自检'].map((x, i) => <div key={x}><b>{i + 1}</b><span><strong>{x}</strong><small>{i === 0 ? '近期章节、人物、伏笔' : i === 1 ? '等待作者审阅' : '检查连续性问题'}</small></span></div>)}</div>
    <div className="ai-generate-row">
      <button className="generate" onClick={run} disabled={phase !== 'idle'}><Bot size={15} />{phase === 'connecting' ? '正在连接模型…' : phase === 'streaming' ? '运行中…' : '运行写作 Agent'}</button>
      {phase !== 'idle' && <button className="generate stop" onClick={stop}><Square size={14} />停止</button>}
    </div>
    {phase === 'connecting' && <div className="ai-connecting">模型正在推理… 已等待 {elapsed} 秒（首次输出通常 20~40 秒，若超过 90 秒会自动重试一次）</div>}
    {output && <><div className={'ai-output' + (phase === 'streaming' ? ' streaming' : '')}>{output}</div>{phase === 'idle' && <div className="ai-actions"><Button onClick={() => setOutput('')}>丢弃</Button><Button kind="primary" onClick={() => { onAccept(output.trim()); setOutput('') }}><Check size={14} />采纳</Button></div>}</>}
  </div>
}

function ReferencePanel() {
  return <div className="assist-body"><SearchBox text="搜索书籍、章节和资料…" /></div>
}

function VersionHistory({ chapter, onClose, onRolled }: { chapter: ChapterSummary; onClose: () => void; onRolled: () => Promise<void> }) {
  const [versions, setVersions] = useState<ChapterVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  useEffect(() => { void workspaceApi.listVersions(chapter.id).then(v => { setVersions(v); setLoading(false) }) }, [chapter.id])
  const roll = async (id: string) => {
    if (!confirm('回滚后当前内容会另存为一个新版本，确定继续？')) return
    setBusy(id); try { await workspaceApi.rollback(chapter.id, id); await onRolled() } finally { setBusy('') }
  }
  return <Modal eyebrow="版本历史" title={`第 ${chapter.order} 章 · ${chapter.title}`} icon={History} onClose={onClose}
    footer={<div className="form-actions"><span className="muted">每次保存有改动时会自动创建版本快照</span><Button onClick={onClose}>关闭</Button></div>}>
    <div className="form-body" style={{ maxHeight: 360, overflow: 'auto' }}>
      {loading && <p style={{ color: '#999', fontSize: 11 }}>读取版本…</p>}
      {!loading && versions.length === 0 && <EmptyState icon={History} title="还没有历史版本" desc="编辑并保存本章后会自动生成快照。" />}
      {versions.map(v => <div className="version-row" key={v.id}><b>v{v.version_number}</b><strong>{fmt(v.word_count)} 字 · {new Date(v.created_at).toLocaleString('zh-CN')}</strong><span className={'tag ' + v.label}>{v.label === 'rollback' ? '回滚前' : '自动'}</span><Button onClick={() => roll(v.id)} disabled={busy === v.id}>{busy === v.id ? '回滚中…' : '回滚到此版本'}</Button></div>)}
    </div>
  </Modal>
}
