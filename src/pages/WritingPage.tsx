import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  BookOpen, Bot, BrainCircuit, Check, ChevronLeft, ChevronRight, Database, Dices, Feather,
  GripVertical, History, Maximize2, Minimize2, MessagesSquare, PanelRightClose, Plus,
  Save, ScrollText, ShieldCheck, Sparkles, Square, Trash2, WandSparkles, X,
} from 'lucide-react'
import {
  runAIStream, workspaceApi,
  type ChapterSummary, type ChapterVersion, type LintIssue, type Workspace,
} from '../workspaceApi'
import type { Page } from '../lib/constants'
import {
  EDITOR_FONT_STEPS, fmt, readAutosaveMs, readEditorFont, readFocusGoal, writeEditorFont, writeFocusGoal,
} from '../lib/constants'
import { confirmDialog } from '../components/Confirm'
import { toast } from '../components/Toast'
import { indentParagraphs } from '../lib/textFormat'
import { Button, EmptyState, Field, Modal, SearchBox } from '../components/ui'
import { ModelSelect } from '../components/ModelSelect'
import { TemplateChips, TemplateManagerModal, usePromptTemplates } from '../components/PromptTemplates'
import { useEntityList } from '../hooks/useEntityList'
import { useConnectingTimer, useTotalTimer } from '../hooks/useConnectingTimer'

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
  const [tab, selectTab] = useState<'quick' | 'agent' | 'dialogue' | 'ref'>('quick')
  const [activeId, setActiveId] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draft, setDraft] = useState('')
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [savedAt, setSavedAt] = useState('')
  const [versionsOpen, setVersionsOpen] = useState(false)
  // ── F1 章节摘要链：摘要编辑/生成弹窗 ──
  const [summaryOpen, setSummaryOpen] = useState(false)
  // ── F3 发布前自检：报告弹窗 + 点击条目跳转编辑器定位 ──
  const [lintOpen, setLintOpen] = useState(false)
  const [lintJump, setLintJump] = useState<{ start: number; end: number } | null>(null)
  // ── F4 专注模式：隐藏章节栏/辅助面板/工具栏，只留纸张 + 本次字数目标 HUD ──
  const [focusOpen, setFocusOpen] = useState(false)
  // ── F9 命名生成器弹窗 ──
  const [nameToolOpen, setNameToolOpen] = useState(false)
  const focusStartWords = useRef(0)
  const focusGoalHit = useRef(false)
  const [focusGoal, setFocusGoal] = useState(() => readFocusGoal())
  const changeFocusGoal = (goal: number) => {
    const value = Math.max(100, Math.floor(goal) || 1000)
    setFocusGoal(value)
    focusGoalHit.current = false
    writeFocusGoal(value)
  }
  const enterFocus = () => {
    focusStartWords.current = draft.replace(/\s/g, '').length
    focusGoalHit.current = false
    setFocusOpen(true)
  }
  const exitFocus = () => setFocusOpen(false)
  // ESC 退出专注（弹窗打开时不抢，Modal 自身的 ESC 优先）。
  useEffect(() => {
    if (!focusOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !versionsOpen && !summaryOpen && !lintOpen) exitFocus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusOpen, versionsOpen, summaryOpen, lintOpen])
  const focusSessionWords = Math.max(0, draft.replace(/\s/g, '').length - focusStartWords.current)
  useEffect(() => {
    if (focusOpen && !focusGoalHit.current && focusGoal > 0 && focusSessionWords >= focusGoal) {
      focusGoalHit.current = true
      toast.success(`专注目标达成：本次已写 ${focusSessionWords} 字`)
    }
  }, [focusOpen, focusSessionWords, focusGoal])
  const [chapterQuery, setChapterQuery] = useState('')
  const [editorFont, setEditorFont] = useState<number>(() => readEditorFont())
  const changeEditorFont = (size: number) => {
    setEditorFont(size)
    writeEditorFont(size)
  }
  // ── 续写方向选择器（编辑器底部）：AI 出 3 个方向 + 自定义 ──
  const [directions, setDirections] = useState<{ title: string; desc: string }[]>([])
  const [dirLoading, setDirLoading] = useState(false)
  const [direction, setDirection] = useState('')          // 当前生效的方向（title：desc）
  const [customOpen, setCustomOpen] = useState(false)
  const [customText, setCustomText] = useState('')
  const fetchDirections = async () => {
    if (!activeChapter || dirLoading) return
    setDirLoading(true)
    try {
      const res = await workspaceApi.aiDirections(workspace.novel.id, activeChapter.id)
      setDirections(res.directions)
    } catch { /* 保留已有/空列表 */ } finally { setDirLoading(false) }
  }
  const pickDirection = (value: string) => setDirection(cur => cur === value ? '' : value)
  const [loadingContent, setLoadingContent] = useState(false)
  const [pageIndex, setPageIndex] = useState(0)
  const [pagination, setPagination] = useState<{ content: string; pages: DraftPage[] }>({
    content: '',
    pages: [{ start: 0, end: 0, text: '' }],
  })
  // 已落盘内容的镜像（title/content 分开存）：脏检查只需两个 === 比较。
  // 旧实现每次渲染拼接整章全文构造签名字符串，长章节下每键一次 O(N) 分配。
  const savedSignature = useRef({ title: '', content: '' })
  // Guards loadContent against out-of-order responses: switching chapters fast
  // can let chapter A's slow response land after B's — without the guard it
  // would overwrite B's editor content AND savedSignature, after which
  // auto-save would write A's text into B's chapter (real data corruption).
  const contentReqId = useRef(0)
  const paperRef = useRef<HTMLElement>(null)
  const manuscriptRef = useRef<HTMLTextAreaElement>(null)
  const headingMeasureRef = useRef<HTMLDivElement>(null)

  // ---- 右键 AI 补写（直接写入原文 + 背景层绿/红着色）----
  type Highlight = { start: number; end: number; type: 'add' | 'del' }
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; insertPos: number; selStart: number; selEnd: number } | null>(null)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [aiPhase, setAiPhase] = useState<'idle' | 'connecting' | 'streaming'>('idle')
  const [aiError, setAiError] = useState('')
  const aiAbort = useRef<AbortController | null>(null)
  // InlineAIStatus 的 memo props：稳定引用，500ms 计时只重渲染状态条本身。
  const stopInlineAI = useCallback(() => aiAbort.current?.abort(), [])
  const dismissAiError = useCallback(() => setAiError(''), [])

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
      await runAIStream('/ai/generate', {
        novel_id: workspace.novel.id, chapter_id: activeChapter?.id, instruction,
        mode: 'continue', target_words: hasSelection ? Math.max(contextBefore.length, 200) : 300,
        context: { characters: true, locations: false, settings: true, threads: true, recent_chapters: 1, recap: true },
      }, {
        signal: controller.signal,
        onChunk: delta => {
          const insertAt = aiEnd
          setDraft(d => d.slice(0, insertAt) + delta + d.slice(insertAt))
          aiEnd += delta.length
          setHighlights([{ start: writeStart, end: aiEnd, type: 'add' }])
          setAiPhase('streaming')
        },
      })
      setAiPhase('idle')
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setHighlights([])
        // runAIStream surfaces the real upstream reason (429 / 401 / timeout);
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
      // 当前章节不在新作品里（切换作品）：先把旧章节未落盘的改动补存，
      // 否则自动保存的 1s 防抖窗口内的输入会随切换丢失。
      if (activeId && (draftTitle !== savedSignature.current.title || draft !== savedSignature.current.content)) void persistChapter()
      const preferred = chapters.find(c => c.status === 'writing') ?? chapters[chapters.length - 1]
      setActiveId(preferred.id)
      setDraftTitle(preferred.title)
      setDraft('')
      savedSignature.current = { title: preferred.title, content: '' }
      void loadContent(preferred.id, preferred.title)
    }
  }, [workspace])

  const loadContent = useCallback(async (chapterId: string, fallbackTitle: string) => {
    const reqId = ++contentReqId.current
    setPageIndex(0)
    setLoadingContent(true)
    try {
      const full = await workspaceApi.getChapter(chapterId)
      if (reqId !== contentReqId.current) return // a newer load superseded this one
      setDraft(full.content)
      setDraftTitle(full.title)
      savedSignature.current = { title: full.title, content: full.content }
      setSaveState('saved')
    } catch {
      if (reqId !== contentReqId.current) return
      setDraft('')
      savedSignature.current = { title: fallbackTitle, content: '' }
      setSaveState('error')
    } finally {
      if (reqId === contentReqId.current) setLoadingContent(false)
    }
  }, [])

  const activeChapter = workspace.chapters.find(c => c.id === activeId)
  // Stable accept handler for the memoized AI panels — the inline arrow it
  // replaced re-created on every keystroke/stream chunk and defeated their memo,
  // re-rendering the whole assistant sidebar on each token.
  // 采纳即排版：AI 输出的段落是顶格的，插入时统一补上两个全角空格的段首缩进。
  const acceptText = useCallback(
    (text: string) => setDraft(d => d.replace(/\s*$/, '') + '\n\n' + indentParagraphs(text)),
    [],
  )
  // 脏检查：两个 ===（长度短路）替代旧的整章全文签名拼接。
  const dirty = draftTitle !== savedSignature.current.title || draft !== savedSignature.current.content
  const pages = pagination.content === draft
    ? pagination.pages
    : [{ start: 0, end: draft.length, text: draft }]
  const currentPageIndex = Math.min(pageIndex, pages.length - 1)
  const currentPage = pages[currentPageIndex]

  // F3 自检跳转：把章节全局 offset 换算到对应页并选中片段（一页约等于可视区高度，
  // 选中即可见）。仅响应 lintJump/页码变化——draft 变化不重放，否则打字时会被抢光标。
  const jumpToOffset = useCallback((offset: number, length: number) => {
    const page = pages.find(p => offset >= p.start && offset < p.end) ?? pages[pages.length - 1]
    setPageIndex(Math.max(0, pages.indexOf(page)))
    setLintJump({ start: offset - page.start, end: offset - page.start + length })
  }, [pages])
  useEffect(() => {
    if (!lintJump || loadingContent) return
    const ta = manuscriptRef.current
    if (!ta) return
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(Math.min(lintJump.start, ta.value.length), Math.min(lintJump.end, ta.value.length))
  }, [lintJump, currentPageIndex, loadingContent])

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
  }, [draft, activeId, assistant, editorFont])

  // 广播保存状态给 StatusBar（跨组件解耦：无需把 saveState 提升到 App）。
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('mojing:save-state', { detail: saveState }))
  }, [saveState])

  // 切换章节时清空方向选择（方向建议绑定具体章节的结尾语境）。
  useEffect(() => {
    setDirections([]); setDirection(''); setCustomOpen(false); setCustomText('')
  }, [activeId])

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
        savedSignature.current = { title: updated.title, content: updated.content }
      }
      setSaveState('saved')
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
      return updated
    } catch {
      setSaveState('error')
      // Surfacable failure with a one-click retry (auto-save fails silently
      // otherwise — the user would only notice on app close).
      toast.error('自动保存失败', { label: '重试', onAction: () => { void persistChapter() } })
      return null
    }
  }, [activeId, draftTitle, draft, patchWorkspace])

  // Ctrl/Cmd+S 手动保存（拦截浏览器默认"保存网页"）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void persistChapter()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [persistChapter])

  useEffect(() => {
    if (!activeChapter || !dirty) return
    setSaveState('saving')
    // 防抖间隔可调（设置页 → 编辑器 → 自动保存间隔）；每次防抖重读，改完即生效。
    const timer = window.setTimeout(() => { void persistChapter() }, readAutosaveMs())
    return () => window.clearTimeout(timer)
    // 依赖 draft/draftTitle（而非聚合的 dirty 布尔）：防抖窗口要在每次编辑时重置。
  }, [dirty, draftTitle, draft, activeChapter?.id])

  // 切页/关窗兜底：自动保存是 1s 防抖，卸载（切页）或窗口关闭前若有未落盘
  // 的改动立即补一次保存——否则最后一次输入会丢，对写作软件不可接受。
  // 值镜像进 ref，因为兜底回调执行时组件已在卸载过程中。
  const pendingStateRef = useRef({ id: '', title: '', content: '' })
  pendingStateRef.current = { id: activeId, title: draftTitle, content: draft }
  const flushPendingSave = useCallback((keepalive: boolean) => {
    const { id, title, content } = pendingStateRef.current
    if (!id || (title === savedSignature.current.title && content === savedSignature.current.content)) return
    void workspaceApi.updateChapter(id, {
      title: title.trim() || '未命名章节',
      content,
      status: content.trim() ? 'writing' : 'draft',
      // keepalive 让浏览器在页面卸载后仍完成这次发送（beforeunload 场景）
    }, keepalive ? { keepalive: true } : undefined).catch(() => { /* 兜底路径无法再提示 */ })
  }, [])
  useEffect(() => {
    const onBeforeUnload = () => flushPendingSave(true)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      flushPendingSave(false)
    }
  }, [flushPendingSave])

  const selectChapter = async (chapter: ChapterSummary) => {
    if (chapter.id === activeId) return
    if (activeId && dirty) await persistChapter()
    setActiveId(chapter.id); setDraftTitle(chapter.title); setDraft('')
    setPageIndex(0)
    savedSignature.current = { title: chapter.title, content: '' }
    setSaveState('saved')
    void loadContent(chapter.id, chapter.title)
  }
  const createChapter = async () => {
    if (activeId && dirty) await persistChapter()
    try {
      const created = await workspaceApi.createChapter(workspace.novel.id, `未命名章节 ${workspace.chapters.length + 1}`)
      patchWorkspace(c => c ? { ...c, novel: { ...c.novel, chapter_count: c.novel.chapter_count + 1 }, chapters: [...c.chapters, created] } : c)
      setActiveId(created.id); setDraftTitle(created.title); setDraft(created.content); setPageIndex(0)
      savedSignature.current = { title: created.title, content: created.content }
      setSaveState('saved')
    } catch (e) {
      setSaveState('error')
      toast.error(e instanceof Error ? e.message : '新建章节失败')
    }
  }
  const deleteChapter = async () => {
    if (!activeChapter) return
    const ok = await confirmDialog({ title: '删除章节', message: `删除「${activeChapter.title}」后无法恢复（历史版本会一并删除）。`, danger: true, confirmLabel: '删除章节' })
    if (!ok) return
    try {
      await workspaceApi.deleteChapter(activeChapter.id)
      patchWorkspace(c => c ? { ...c, chapters: c.chapters.filter(x => x.id !== activeChapter.id), novel: { ...c.novel, chapter_count: Math.max(0, c.novel.chapter_count - 1) } } : c)
      setActiveId('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除章节失败')
    }
  }

  if (!activeChapter) return <div className="writing-state"><EmptyState icon={Feather} title="还没有章节" desc="创建第一章，开始你的故事。" action={<Button kind="primary" onClick={createChapter}><Plus size={15} />新建章节</Button>} /></div>

  const paragraphs = draft.trim() ? draft.split(/\n\s*\n/).length : 0
  const readingMinutes = Math.max(1, Math.ceil(activeChapter.word_count / 450))
  const query = chapterQuery.trim()
  const visibleChapters = query
    ? workspace.chapters.filter(c => c.title.includes(query))
    : workspace.chapters

  /** 渲染背景着色层：把当前页文本按 highlight 区间分成段，AI 新增绿色、删除红色。
   *  highlights 的 offset 是相对于 draft 全文的，这里映射到当前页的局部 offset。
   *  NOTE: kept as a plain function (not useMemo) on purpose — it sits after the
   *  !activeChapter early return, so a hook here would break the rules-of-hooks
   *  invariant ("rendered more hooks than previous render") when a chapter is
   *  added/removed. The cost is trivial: highlights empty → returns the page
   *  text immediately. */
  const renderBackdrop = () => {
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
  }

  return <div className={'writing-page' + (focusOpen ? ' focus' : '')}>
    <aside className="chapters-pane"><div className="pane-title"><div><label>{workspace.novel.title}</label><strong>章节目录</strong></div><button onClick={createChapter}><Plus size={16} /></button></div><SearchBox text="搜索章节" value={chapterQuery} onChange={setChapterQuery} />
      <div className="chapter-list">{visibleChapters.map(chapter => <button className={chapter.id === activeId ? 'active' : ''} key={chapter.id} onClick={() => void selectChapter(chapter)}><GripVertical size={13} /><b>{String(chapter.order).padStart(2, '0')}</b><span><strong>{chapter.title}</strong><small>{fmt(chapter.word_count)} 字</small></span>{chapter.status === 'completed' && <Check size={12} />}</button>)}{query && visibleChapters.length === 0 && <p className="chapter-search-empty">没有匹配「{query}」的章节</p>}</div>
      <button className="new-chapter" onClick={createChapter}><Plus size={14} />新建章节</button>
    </aside>
    <section className="editor">
      {focusOpen && <div className="focus-hud" aria-label="专注模式状态">
        <div className="focus-goal"><span>本次 <b>{focusSessionWords}</b> / {focusGoal} 字</span><i style={{ width: Math.min(100, (focusSessionWords / focusGoal) * 100) + '%' }} /></div>
        <button onClick={() => changeFocusGoal(focusGoal + 500)} onContextMenu={e => { e.preventDefault(); changeFocusGoal(Math.max(100, focusGoal - 500)) }} title="左键 +500 / 右键 -500">目标 {focusGoal} 字</button>
        <button onClick={exitFocus}><Minimize2 size={14} />退出专注<kbd>Esc</kbd></button>
      </div>}
      <div className="editor-toolbar">
      <button onClick={deleteChapter} title="删除当前章节" aria-label="删除当前章节"><Trash2 size={15} /></button><button onClick={() => setVersionsOpen(true)} title="版本历史" aria-label="版本历史"><History size={15} /></button><button onClick={() => setSummaryOpen(true)} title="章节摘要" aria-label="章节摘要"><ScrollText size={15} /></button><button onClick={() => setLintOpen(true)} title="发布自检" aria-label="发布自检"><ShieldCheck size={15} /></button><i />
      <span>第 {String(activeChapter.order).padStart(2, '0')} 章 <ChevronRight size={12} /> <strong>{draftTitle || '未命名章节'}</strong></span><b />
      <div className="font-steps" role="group" aria-label="正文字号">
        {EDITOR_FONT_STEPS.map(size => (
          <button key={size} className={editorFont === size ? 'active' : ''} onClick={() => changeEditorFont(size)}
            title={`正文字号 ${size}px`}>{size === 14 ? 'A⁻' : size === 15 ? 'A' : 'A⁺'}</button>
        ))}
      </div>
      <em className={saveState}><Check size={12} />{loadingContent ? '正在加载…' : saveState === 'saving' ? '正在保存…' : saveState === 'error' ? '保存失败' : `已保存 ${savedAt}`}</em>
      <button onClick={() => void persistChapter()}><Save size={14} />保存<kbd>⌘S</kbd></button>
      <button onClick={() => onGoto('threads')} title="伏笔看板" aria-label="伏笔看板"><BrainCircuit size={14} /></button>
      <button onClick={() => setNameToolOpen(true)} title="起名工具（本地词库，不消耗 token）" aria-label="起名工具"><Dices size={15} /></button>
      <button onClick={enterFocus} title="专注模式（隐藏侧栏与面板，只留正文）" aria-label="专注模式"><Maximize2 size={14} /></button>
      <button className={'assist-toggle ' + (assistant ? 'active' : '')} onClick={onAssistant}><WandSparkles size={14} />辅助中心</button>
    </div>
       <div className="paper-wrap"><article ref={paperRef} className="paper editable-paper" style={{ '--ms-font': `${editorFont}px` } as React.CSSProperties}>
         {currentPageIndex === 0 && <div className="page-heading"><label>第 {activeChapter.order} 章</label><input className="chapter-title-input" value={draftTitle} onChange={e => setDraftTitle(e.target.value)} aria-label="章节标题" /><div className="ornament"><i /><Feather size={14} /><i /></div></div>}
         <div className="manuscript-stage">
           {/* 背景着色层：与 textarea 同步，渲染 AI 新增（绿）/删除（红）标记 */}
           <div className="manuscript-backdrop" aria-hidden="true">{renderBackdrop()}</div>
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
        <InlineAIStatus phase={aiPhase} error={aiError} onStop={stopInlineAI} onDismiss={dismissAiError} />
      )}
       <nav className="page-navigation" aria-label="章节分页">
         <button onClick={() => setPageIndex(index => Math.max(0, index - 1))} disabled={currentPageIndex === 0}><ChevronLeft size={14} />上一页</button>
         <span>第 <b>{currentPageIndex + 1}</b> / {pages.length} 页</span>
         <button onClick={() => setPageIndex(index => Math.min(pages.length - 1, index + 1))} disabled={currentPageIndex >= pages.length - 1}>下一页<ChevronRight size={14} /></button>
       </nav>
       <footer className="editor-status"><span>本章 {draft.replace(/\s/g, '').length.toLocaleString()} 字</span><span>全文 {fmt(workspace.novel.total_words)} 字</span><b /><span>段落 {paragraphs}</span><span>预计阅读 {readingMinutes} 分钟</span><span><button className="btn ghost" onClick={() => onGoto('threads')}>伏笔看板</button></span></footer>
       <div className="direction-bar">
         <label>续写方向</label>
         {directions.length === 0 && !dirLoading && (
           <button className="dir-fetch" onClick={() => void fetchDirections()}><Sparkles size={12} />AI 方向建议</button>
         )}
         {dirLoading && <span className="dir-loading">正在生成 3 个方向…</span>}
         {directions.map((d, i) => {
           const value = `${d.title}：${d.desc}`
           return (
             <button key={i} className={'dir-chip' + (direction === value ? ' active' : '')}
               title={d.desc} onClick={() => pickDirection(value)}>
               <b>{i + 1}</b>{d.title}
             </button>
           )
         })}
         {directions.length > 0 && (
           <button className={'dir-chip custom' + (direction === `自定义：${customText}` && customText ? ' active' : '')}
             onClick={() => setCustomOpen(o => !o)}>自定义</button>
         )}
         {customOpen && (
           <span className="dir-custom">
             <input value={customText} onChange={e => setCustomText(e.target.value)}
               placeholder="输入你想要的方向，如：让主角识破谎言但不动声色"
               onKeyDown={e => { if (e.key === 'Enter' && customText.trim()) { setDirection(`自定义：${customText.trim()}`); setCustomOpen(false) } }} autoFocus />
             <button className="dir-ok" disabled={!customText.trim()}
               onClick={() => { setDirection(`自定义：${customText.trim()}`); setCustomOpen(false) }}>确定</button>
           </span>
         )}
         {direction && <span className="dir-current" title={direction}>已选 · {direction.split('：')[0]}</span>}
         {direction && <button className="dir-clear" title="清除方向" onClick={() => setDirection('')}><X size={12} /></button>}
       </div>
    </section>
    {assistant && <aside className="assistant"><div className="assistant-title"><span><Sparkles size={14} /></span><strong>辅助中心</strong><button onClick={onAssistant}><PanelRightClose size={15} /></button></div><div className="assistant-tabs"><button className={tab === 'quick' ? 'active' : ''} onClick={() => selectTab('quick')}>快捷生成</button><button className={tab === 'agent' ? 'active' : ''} onClick={() => selectTab('agent')}>Agent</button><button className={tab === 'dialogue' ? 'active' : ''} onClick={() => selectTab('dialogue')}>对话</button><button className={tab === 'ref' ? 'active' : ''} onClick={() => selectTab('ref')}>参考</button></div>{tab === 'quick' ? <QuickAI workspace={workspace} chapter={activeChapter} direction={direction} onAccept={acceptText} /> : tab === 'agent' ? <AgentPanel workspace={workspace} onAccept={acceptText} /> : tab === 'dialogue' ? <DialoguePanel workspace={workspace} onAccept={acceptText} /> : <ReferencePanel />}</aside>}
    {versionsOpen && <VersionHistory chapter={activeChapter} onClose={() => setVersionsOpen(false)} onRolled={async () => { setVersionsOpen(false); await reload(); void loadContent(activeChapter.id, activeChapter.title) }} />}
    {summaryOpen && <ChapterSummaryDialog novelId={workspace.novel.id} chapterId={activeChapter.id} order={activeChapter.order} title={draftTitle || activeChapter.title} onClose={() => setSummaryOpen(false)} />}
    {lintOpen && <LintDialog novelId={workspace.novel.id} chapter={activeChapter} onJump={jumpToOffset} onClose={() => setLintOpen(false)} />}
    {nameToolOpen && <NameToolDialog onClose={() => setNameToolOpen(false)} />}
  </div>
}

/** AI 行内状态条。500ms 的等待计时在本组件内部跳动——放回 WritingPage 会让
 *  整页（含编辑器、章节列表）每半秒重渲染一次。 */
const InlineAIStatus = memo(function InlineAIStatus({ phase, error, onStop, onDismiss }: {
  phase: 'idle' | 'connecting' | 'streaming'; error: string; onStop: () => void; onDismiss: () => void
}) {
  const elapsed = useConnectingTimer(phase)
  return <div className={'ai-inline-status' + (error ? ' error' : '')}>
    <Sparkles size={13} />
    {error
      ? <>AI 生成失败：{error}<button onClick={onDismiss}>×</button></>
      : phase === 'connecting'
        ? <>正在连接模型… 已等待 {elapsed} 秒<button onClick={onStop}><Square size={11} />停止</button></>
        : <>AI 生成中（绿色为新增）<button onClick={onStop}><Square size={11} />停止</button></>}
  </div>
})

/** AI 面板的"正在推理"提示行：同样把计时隔离在这一行内。 */
const PanelConnectLine = memo(function PanelConnectLine() {
  const elapsed = useConnectingTimer('connecting')
  return <div className="ai-connecting">模型正在推理… 已等待 {elapsed} 秒（首次输出通常 20~40 秒，超过 90 秒可停止后重试）</div>
})

// memo: the editor re-renders on every keystroke / streamed AI token; the
// panels' own state drives their updates, so skip them unless props change.
const QuickAI = memo(function QuickAI({ workspace, chapter, direction, onAccept }: { workspace: Workspace; chapter: ChapterSummary; direction: string; onAccept: (text: string) => void }) {
  const [instruction, setInstruction] = useState('让马车里的人交代城北线索，但不要揭示他的真实身份。气氛保持克制、紧张。')
  const [mode, setMode] = useState<'continue' | 'polish' | 'expand'>('continue')
  const [target, setTarget] = useState('800')
  const [modelId, setModelId] = useState<number | null>(null)
  const [ctx, setCtx] = useState({ characters: true, locations: false, settings: true, threads: true, recent_chapters: 2, prior_chapters: true, library: true, recap: true, timeline: false })
  // F6 自定义 Prompt 模板：点击填入写作要求；管理弹窗负责增删改。
  const { templates, reload: reloadTemplates } = usePromptTemplates()
  const [tplOpen, setTplOpen] = useState(false)
  const [output, setOutput] = useState('')
  const [model, setModel] = useState('')
  // 'connecting' = waiting for the first token (cold start can take ~10-20s on
  // real providers); 'streaming' = tokens are flowing.
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'streaming'>('idle')
  const [error, setError] = useState('')
  const total = useTotalTimer(phase !== 'idle')
  const abortRef = useRef<AbortController | null>(null)

  const generate = async () => {
    setOutput(''); setError(''); setPhase('connecting')
    const controller = new AbortController()
    abortRef.current = controller
    let received = ''
    let failed = false
    try {
      await runAIStream('/ai/generate', {
        novel_id: workspace.novel.id, chapter_id: chapter.id,
        // 底部方向栏选定的方向作为最高优先级指令前缀注入。
        instruction: direction ? `续写方向——${direction}\n${instruction}` : instruction,
        mode,
        target_words: Number(target) || 800, config_id: modelId, context: ctx,
      }, {
        signal: controller.signal,
        onChunk: (text, model) => {
          received += text
          setOutput(received)
          if (model) setModel(model)
          setPhase('streaming')
        },
      })
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

  // 「按简介创作第一章」冷启动：作品简介已由后端 prompt_builder 注入系统
  // 提示词，这里只需装填明确的开篇指令与生成参数；简介为空则先引导填写。
  const applyFirstChapter = () => {
    if (!workspace.novel.description?.trim()) {
      toast.error('请先在「作品设置」中填写作品简介，AI 才能据此开篇')
      return
    }
    setInstruction('请根据作品简介开始创作第一章：从故事开端切入，交代核心悬念，引出主角，并以一个钩子收尾。这是全书第一章，之前没有任何正文，不要提及「前文」或尚未登场的人物。')
    setMode('continue')
    setTarget('1200')
  }

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
    {direction && <div className="dir-hint" title={direction}><WandSparkles size={12} />已选续写方向：{direction.split('：')[0]}</div>}
    <div className="assist-intro"><span><WandSparkles size={18} /></span><div><strong>接下来想怎么写？</strong><p>结合当前章节和作品资料生成草稿。</p></div></div>
    <TemplateChips templates={templates} onApply={content => setInstruction(content)} onManage={() => setTplOpen(true)} />
    <div className="tpl-row">
      <button className="tpl-chip first-chapter" title="用作品简介生成第一章开篇草稿" onClick={applyFirstChapter}><BookOpen size={11} />按简介创作第一章</button>
    </div>
    <label>写作要求</label>
    <div className="prompt"><textarea value={instruction} maxLength={500} onChange={e => setInstruction(e.target.value)} /><footer><span>{instruction.length} / 500</span></footer></div>
    <ModelSelect value={modelId} onChange={setModelId} />
    <div className="two-fields">
      <Field label="生成方式"><select className={selectCls} value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="continue">续写正文</option><option value="polish">润色正文</option><option value="expand">扩写场景</option></select></Field>
      <Field label="目标长度"><select className={selectCls} value={target} onChange={e => setTarget(e.target.value)}><option value="400">约 400 字</option><option value="800">约 800 字</option><option value="1200">约 1200 字</option></select></Field>
    </div>
    <div className="context-box"><p><Database size={13} /><strong>本次上下文</strong></p>
      <div>{(['characters', 'locations', 'settings', 'threads', 'prior_chapters', 'library', 'recap', 'timeline'] as const).map(k => <button key={k} className={ctx[k] ? 'active' : ''} onClick={() => setCtx(c => ({ ...c, [k]: !c[k] }))}>{({ characters: '角色', locations: '地点', settings: '世界观', threads: '伏笔', prior_chapters: '前文', library: '资料', recap: '提要', timeline: '时间线' })[k]}</button>)}</div>
    </div>
    <div className="ai-generate-row">
      <button className="generate" onClick={generate} disabled={phase !== 'idle'}><Sparkles size={15} />{phase === 'connecting' ? '正在连接模型…' : phase === 'streaming' ? '正在生成…' : '生成可审阅草稿'}<kbd>⌘ ↵</kbd></button>
      {phase !== 'idle' && <button className="generate stop" onClick={stop}><Square size={14} />停止</button>}
    </div>
    {phase === 'connecting' && <PanelConnectLine />}
    {(output || error) && <div className="ai-meta"><Sparkles size={12} />模型 <b>{model || 'mock'}</b>{phase !== 'idle' && <span>· 生成中 {output.length} 字 · {total} 秒</span>}</div>}
    {error && <div className="form-error">{error}</div>}
    {output && <div className={'ai-output' + (phase === 'streaming' ? ' streaming' : '')}>{output}</div>}
    {output && phase === 'idle' && <div className="ai-actions"><Button onClick={() => setOutput('')}>丢弃</Button><Button kind="primary" onClick={accept}><Check size={14} />采纳并插入</Button></div>}
    <small className="safe-note"><ShieldCheck size={13} />不会自动写入正文，确认后才会应用。</small>
    {tplOpen && <TemplateManagerModal onClose={() => setTplOpen(false)} onChanged={reloadTemplates} />}
  </div>
})

const AgentPanel = memo(function AgentPanel({ workspace, onAccept }: { workspace: Workspace; onAccept: (t: string) => void }) {
  const [goal, setGoal] = useState('完成本章后半段，推进玉佩伏笔，但不要揭晓幕后人物。')
  const [modelId, setModelId] = useState<number | null>(null)
  const [output, setOutput] = useState('')
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'streaming'>('idle')
  const total = useTotalTimer(phase !== 'idle')
  const abortRef = useRef<AbortController | null>(null)
  const run = async () => {
    setOutput(''); setPhase('connecting')
    const controller = new AbortController()
    abortRef.current = controller
    let received = ''
    let failed = false
    try {
      await runAIStream('/ai/generate', { novel_id: workspace.novel.id, instruction: goal, mode: 'continue', target_words: 800, config_id: modelId }, {
        signal: controller.signal,
        onChunk: text => { received += text; setOutput(received); setPhase('streaming') },
      })
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
      <button className="generate" onClick={run} disabled={phase !== 'idle'}><Bot size={15} />{phase === 'connecting' ? '正在连接模型…' : phase === 'streaming' ? `运行中 ${output.length} 字 · ${total}s` : '运行写作 Agent'}</button>
      {phase !== 'idle' && <button className="generate stop" onClick={stop}><Square size={14} />停止</button>}
    </div>
    {phase === 'connecting' && <PanelConnectLine />}
    {output && <><div className={'ai-output' + (phase === 'streaming' ? ' streaming' : '')}>{output}</div>{phase === 'idle' && <div className="ai-actions"><Button onClick={() => setOutput('')}>丢弃</Button><Button kind="primary" onClick={() => { onAccept(output.trim()); setOutput('') }}><Check size={14} />采纳</Button></div>}</>}
  </div>
})

function ReferencePanel() {
  return <div className="assist-body"><SearchBox text="搜索书籍、章节和资料…" /></div>
}

function VersionHistory({ chapter, onClose, onRolled }: { chapter: ChapterSummary; onClose: () => void; onRolled: () => Promise<void> }) {  const [versions, setVersions] = useState<ChapterVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState('')
  useEffect(() => {
    let cancelled = false
    workspaceApi.listVersions(chapter.id)
      .then(v => { if (!cancelled) { setVersions(v); setLoading(false) } })
      .catch(e => { if (!cancelled) { setLoading(false); setLoadError(e instanceof Error ? e.message : '读取版本失败') } })
    return () => { cancelled = true }
  }, [chapter.id])
  const roll = async (id: string) => {
    const ok = await confirmDialog({ title: '回滚版本', message: '回滚后，当前内容会自动另存为一个新版本，不会丢失。', confirmLabel: '回滚' })
    if (!ok) return
    setBusy(id)
    try { await workspaceApi.rollback(chapter.id, id); await onRolled() }
    catch (e) { toast.error(e instanceof Error ? e.message : '回滚失败') }
    finally { setBusy('') }
  }
  return <Modal eyebrow="版本历史" title={`第 ${chapter.order} 章 · ${chapter.title}`} icon={History} onClose={onClose}
    footer={<div className="form-actions"><span className="muted">每次保存有改动时会自动创建版本快照</span><Button onClick={onClose}>关闭</Button></div>}>
    <div className="form-body" style={{ maxHeight: 360, overflow: 'auto' }}>
      {loading && <p style={{ color: '#999', fontSize: 11 }}>读取版本…</p>}
      {loadError && !loading && <p className="form-error">{loadError}</p>}
      {!loading && !loadError && versions.length === 0 && <EmptyState icon={History} title="还没有历史版本" desc="编辑并保存本章后会自动生成快照。" />}
      {versions.map(v => <div className="version-row" key={v.id}><b>v{v.version_number}</b><strong>{fmt(v.word_count)} 字 · {new Date(v.created_at).toLocaleString('zh-CN')}</strong><span className={'tag ' + v.label}>{v.label === 'rollback' ? '回滚前' : '自动'}</span><Button onClick={() => roll(v.id)} disabled={busy === v.id}>{busy === v.id ? '回滚中…' : '回滚到此版本'}</Button></div>)}
    </div>
  </Modal>
}

/** F1 章节摘要链：查看/手改/AI 生成当前章摘要，保存后作为前情提要的数据源。
 *  AI 生成走 /ai/summarize-chapter 流式接口，生成结果先进编辑框——用户可改
 *  再保存，避免未审阅的摘要直接落库。 */
function ChapterSummaryDialog({ novelId, chapterId, order, title, onClose }: {
  novelId: string; chapterId: string; order: number; title: string; onClose: () => void
}) {
  const [summary, setSummary] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [loading, setLoading] = useState(true)
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'streaming'>('idle')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    workspaceApi.getChapter(chapterId).then(full => {
      if (cancelled) return
      setSummary(full.summary ?? '')
      const summaryAt = full.summary_updated_at ? new Date(full.summary_updated_at) : null
      setSavedAt(summaryAt ? summaryAt.toLocaleString('zh-CN') : null)
      // 正文在摘要之后又改过 → 提示"摘要可能过期"。
      setStale(!!summaryAt && new Date(full.updated_at) > summaryAt)
    }).catch(() => { /* 读取失败时仍允许手写保存 */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [chapterId])

  const generate = async () => {
    setSummary(''); setError(''); setPhase('connecting')
    const controller = new AbortController()
    abortRef.current = controller
    let received = ''
    try {
      await runAIStream('/ai/summarize-chapter', {
        novel_id: novelId, chapter_id: chapterId, mode: 'summarize', target_words: 300,
      }, {
        signal: controller.signal,
        onChunk: text => { received += text; setSummary(received); setPhase('streaming') },
      })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : '生成失败')
    } finally {
      setPhase('idle'); abortRef.current = null
      if (!received.trim()) setError(cur => cur || '模型未返回内容，请重试。')
    }
  }

  const save = async () => {
    setBusy(true)
    try {
      const updated = await workspaceApi.updateChapter(chapterId, { summary })
      toast.success(updated.summary.trim() ? '章节摘要已保存' : '章节摘要已清空')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally { setBusy(false) }
  }

  return <Modal eyebrow="章节摘要" title={`第 ${order} 章 · ${title}`} icon={ScrollText} onClose={onClose}
    footer={<div className="form-actions">
      <span className="muted">{stale ? '正文在摘要之后有修改，摘要可能过期' : savedAt ? `摘要更新于 ${savedAt}` : '摘要会作为 AI 续写的前情提要数据源'}</span>
      {phase === 'idle'
        ? <Button onClick={() => void generate()}><Sparkles size={14} />AI 生成摘要</Button>
        : <Button onClick={() => abortRef.current?.abort()}><Square size={14} />停止</Button>}
      {error && <span className="form-error">{error}</span>}
      <Button onClick={onClose}>取消</Button>
      <Button kind="primary" onClick={() => void save()} disabled={busy || loading}>{busy ? '保存中…' : '保存摘要'}</Button>
    </div>}>
    <div className="form-body">
      <label className="form-field"><span>剧情摘要（可手写，建议 200–300 字）</span>
        <textarea className="form-textarea" style={{ minHeight: 160 }} value={summary}
          onChange={e => setSummary(e.target.value)} maxLength={1000}
          placeholder={phase !== 'idle' ? 'AI 正在生成…' : '概括本章的关键事件、出场角色与伏笔推进。留空保存即清除摘要。'} />
      </label>
      <footer style={{ display: 'flex', justifyContent: 'space-between', color: '#999', fontSize: 11 }}>
        <span>前情提要 = 更早章节的摘要串 + 最近章节结尾，续写时自动注入</span>
        <span>{summary.length} / 1000</span>
      </footer>
    </div>
  </Modal>
}

const LINT_TYPE_META: Record<LintIssue['type'], { label: string; tone: string }> = {
  sensitive: { label: '敏感词', tone: 'danger' },
  duplicate: { label: '疑似叠字', tone: 'warn' },
  punct: { label: '标点规范', tone: 'warn' },
}

/** F9 起名工具：本地词库随机组合（不消耗 token），点击复制。 */
const NAME_KINDS: { id: string; label: string }[] = [
  { id: 'person', label: '人名' }, { id: 'place', label: '地名' }, { id: 'sect', label: '门派' },
  { id: 'skill', label: '功法' }, { id: 'pill', label: '丹药' },
]

function NameToolDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState('person')
  const [names, setNames] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const fetchNames = useCallback(async (k: string) => {
    setLoading(true)
    try {
      setNames((await workspaceApi.generateNames(k, 12)).names)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '生成失败')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void fetchNames(kind) }, [kind, fetchNames])
  const copy = (name: string) => {
    navigator.clipboard?.writeText(name)
      .then(() => toast.success(`已复制「${name}」`))
      .catch(() => { /* 剪贴板被占用时静默 */ })
  }
  return <Modal eyebrow="起名工具" title="本地词库随机起名" icon={Dices} onClose={onClose}
    footer={<div className="form-actions">
      <span className="muted">纯本地词库组合，不消耗 token；可在数据目录 wordlists/names.json 补充词库</span>
      <Button onClick={() => void fetchNames(kind)} disabled={loading}>{loading ? '生成中…' : '换一批'}</Button>
      <Button kind="primary" onClick={onClose}>关闭</Button>
    </div>}>
    <div className="form-body">
      <div className="chips">
        {NAME_KINDS.map(k => <button key={k.id} className={kind === k.id ? 'active' : ''} onClick={() => setKind(k.id)}>{k.label}</button>)}
      </div>
      <div className="name-grid">
        {names.map(n => <button key={n} onClick={() => copy(n)} title="点击复制">{n}</button>)}
        {loading && names.length === 0 && <p style={{ color: '#999', fontSize: 11 }}>生成中…</p>}
      </div>
    </div>
  </Modal>
}

/** F10 多角色对话生成：勾选 2–4 个角色 + 一句场景，按各自性格生成对话场景。 */
const DialoguePanel = memo(function DialoguePanel({ workspace, onAccept }: { workspace: Workspace; onAccept: (t: string) => void }) {
  const { items: people } = useEntityList('characters', workspace.novel.id, workspaceApi.listCharacters)
  const [selected, setSelected] = useState<string[]>([])
  const [scene, setScene] = useState('')
  const [output, setOutput] = useState('')
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'streaming'>('idle')
  const [error, setError] = useState('')
  const [modelId, setModelId] = useState<number | null>(null)
  const total = useTotalTimer(phase !== 'idle')
  const abortRef = useRef<AbortController | null>(null)

  const toggle = (id: string) => setSelected(cur =>
    cur.includes(id) ? cur.filter(x => x !== id) : cur.length >= 4 ? cur : [...cur, id])

  const run = async () => {
    setOutput(''); setError(''); setPhase('connecting')
    const controller = new AbortController()
    abortRef.current = controller
    let received = ''
    let failed = false
    try {
      await runAIStream('/ai/dialogue', {
        novel_id: workspace.novel.id,
        character_ids: selected,
        scene,
        config_id: modelId,
        mode: 'dialogue',
      }, {
        signal: controller.signal,
        onChunk: text => { received += text; setOutput(received); setPhase('streaming') },
      })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) { failed = true; setError(e instanceof Error ? e.message : '生成失败') }
    } finally {
      setPhase('idle'); abortRef.current = null
      if (!received.trim() && !failed) setError('模型未返回内容（连接可能中断），请重试。')
    }
  }

  return <div className="assist-body">
    <div className="assist-intro"><span><MessagesSquare size={18} /></span><div><strong>让角色自己说话</strong><p>选 2–4 位角色，AI 按各自性格写一段对话。</p></div></div>
    <label>参与角色（{selected.length}/4）</label>
    <div className="dialogue-picks">
      {people.length === 0 && <p className="idea-empty">还没有角色——先去角色页创建。</p>}
      {people.map(p => (
        <button key={p.id} className={selected.includes(p.id) ? 'active' : ''} onClick={() => toggle(p.id)}>
          <b style={{ background: p.color }}>{p.name.slice(0, 1)}</b>{p.name}
        </button>
      ))}
    </div>
    <label>场景一句话</label>
    <div className="prompt"><textarea value={scene} maxLength={500} onChange={e => setScene(e.target.value)}
      placeholder="如：雨夜酒楼对坐，柳三变试探沈砚旧案的底。" /></div>
    <ModelSelect value={modelId} onChange={setModelId} />
    <div className="ai-generate-row">
      <button className="generate" onClick={run} disabled={phase !== 'idle' || selected.length < 2}>
        <MessagesSquare size={15} />{phase === 'connecting' ? '正在连接模型…' : phase === 'streaming' ? '生成中…' : '生成对话场景'}
      </button>
      {phase !== 'idle' && <button className="generate stop" onClick={() => abortRef.current?.abort()}><Square size={14} />停止</button>}
    </div>
    {phase === 'connecting' && <PanelConnectLine />}
    {(output || error) && <div className="ai-meta"><Sparkles size={12} />{phase !== 'idle' && <span>生成中 {output.length} 字 · {total} 秒</span>}</div>}
    {error && <div className="form-error">{error}</div>}
    {output && <div className={'ai-output' + (phase === 'streaming' ? ' streaming' : '')}>{output}</div>}
    {output && phase === 'idle' && <div className="ai-actions"><Button onClick={() => setOutput('')}>丢弃</Button><Button kind="primary" onClick={() => { onAccept(output.trim()); setOutput('') }}><Check size={14} />采纳并插入</Button></div>}
    <small className="safe-note"><ShieldCheck size={13} />对话按角色卡的性格与关系生成，采纳前可自行调整。</small>
  </div>
})

/** F3 发布前自检：本地检查报告（敏感词库由用户手动维护）+ 词库管理。
 *  点击条目跳到编辑器对应位置（LintDialog 只负责报 offset，定位换算在写作页）。 */
function LintDialog({ novelId, chapter, onJump, onClose }: {
  novelId: string; chapter: ChapterSummary; onJump: (offset: number, length: number) => void; onClose: () => void
}) {
  const [issues, setIssues] = useState<LintIssue[] | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [words, setWords] = useState<string[]>([])
  const [newWord, setNewWord] = useState('')
  const [wordBusy, setWordBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const run = useCallback(() => {
    setRunning(true); setError('')
    workspaceApi.lintChapter(novelId, chapter.id)
      .then(r => setIssues(r.issues))
      .catch(e => setError(e instanceof Error ? e.message : '自检失败'))
      .finally(() => setRunning(false))
  }, [novelId, chapter.id])
  useEffect(() => {
    run()
    workspaceApi.getSensitiveWords().then(d => setWords(d.words)).catch(() => { /* 词库非关键 */ })
  }, [run])

  const addWord = async () => {
    const w = newWord.trim()
    if (!w) return
    setWordBusy(true)
    try {
      const saved = await workspaceApi.saveSensitiveWords([...new Set([...words, w])])
      setWords(saved.words); setNewWord(''); run()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '添加失败')
    } finally { setWordBusy(false) }
  }
  const importFile = async (file: File) => {
    setWordBusy(true)
    try {
      const content = await file.text()
      const res = await workspaceApi.importSensitiveWords(content)
      toast.success(`导入完成：新增 ${res.added} 词（共 ${res.count} 词）`)
      setWords((await workspaceApi.getSensitiveWords()).words)
      run()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败')
    } finally { setWordBusy(false) }
  }
  const clearWords = async () => {
    const ok = await confirmDialog({ title: '清空敏感词库', message: '将删除全部自定义敏感词，自检将不再报告敏感词。', danger: true, confirmLabel: '清空' })
    if (!ok) return
    setWordBusy(true)
    try {
      const saved = await workspaceApi.saveSensitiveWords([])
      setWords(saved.words); run()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '清空失败')
    } finally { setWordBusy(false) }
  }

  const groups = (['sensitive', 'duplicate', 'punct'] as const)
    .map(type => ({ type, items: (issues ?? []).filter(i => i.type === type) }))
    .filter(g => g.items.length > 0)

  return <Modal eyebrow="发布自检" title={`第 ${chapter.order} 章 · ${chapter.title}`} icon={ShieldCheck} onClose={onClose}
    footer={<div className="form-actions">
      <span className="muted">纯本地检查，不上传正文；叠字与混用标点仅提示，请人工确认</span>
      {error && <span className="form-error">{error}</span>}
      <Button onClick={run} disabled={running}>{running ? '检查中…' : '重新检查'}</Button>
      <Button kind="primary" onClick={onClose}>关闭</Button>
    </div>}>
    <div className="form-body" style={{ maxHeight: 420, overflow: 'auto' }}>
      {running && issues === null && <p style={{ color: '#999', fontSize: 11 }}>正在检查本章…</p>}
      {issues !== null && groups.length === 0 && !error &&
        <EmptyState icon={ShieldCheck} title="未发现问题" desc="叠字、标点规范与自定义敏感词均通过。" />}
      {groups.map(g => <div key={g.type} className="lint-group">
        <header><b className={'lint-badge ' + LINT_TYPE_META[g.type].tone}>{LINT_TYPE_META[g.type].label}</b><span>{g.items.length} 处</span></header>
        {g.items.map((issue, i) => <button key={i} className="lint-issue" onClick={() => onJump(issue.offset, issue.word.length)}>
          <span>{issue.message}</span><small>第 {issue.offset + 1} 字</small>
        </button>)}
      </div>)}
      <div className="lint-wordlist">
        <header><b>自定义敏感词</b><span>{words.length} 词 · 仅存本地，不上传</span></header>
        <div className="lint-wordlist-row">
          <input value={newWord} onChange={e => setNewWord(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addWord() } }}
            placeholder="输入敏感词后回车添加" disabled={wordBusy} aria-label="添加敏感词" />
          <Button onClick={() => void addWord()} disabled={wordBusy || !newWord.trim()}>添加</Button>
          <Button onClick={() => fileRef.current?.click()} disabled={wordBusy}>导入 txt</Button>
          {words.length > 0 && <Button kind="danger" onClick={() => void clearWords()} disabled={wordBusy}>清空</Button>}
        </div>
        {words.length > 0 && <p className="lint-wordlist-preview">{words.slice(0, 50).join('、')}{words.length > 50 ? ` …（共 ${words.length} 词）` : ''}</p>}
        <input ref={fileRef} type="file" accept=".txt" style={{ display: 'none' }} aria-hidden="true"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f) }} />
      </div>
    </div>
  </Modal>
}
