import type { ElementType } from 'react'
import type { ThreadPriority, ThreadStatus } from '../workspaceApi'

/** The set of top-level pages the app routes between. */
export type Page =
  | 'projects' | 'overview' | 'writing' | 'outline'
  | 'characters' | 'locations' | 'world' | 'threads'
  | 'maps' | 'library' | 'settings' | 'timeline'

export type Nav = { id: Page; label: string; icon: ElementType; count?: number }

export const THREAD_STATUSES: { id: ThreadStatus; label: string; tone: string }[] = [
  { id: 'planted', label: '已埋下', tone: 'amber' },
  { id: 'hinted', label: '已暗示', tone: 'orange' },
  { id: 'developing', label: '发展中', tone: 'blue' },
  { id: 'resolved', label: '已收束', tone: 'green' },
]

export const THREAD_PRIORITY_LABEL: Record<ThreadPriority, string> = {
  major: '主线', minor: '支线', detail: '细节',
}

export const CATEGORY_TONES: Record<string, string> = {
  世界规则: 'blue', 势力分布: 'sage', 历史背景: 'clay', 法宝物品: 'plum',
}

export const COVER_TONES = ['ink', 'blue', 'clay', 'sage'] as const

export const COLORS = [
  '#334f68', '#9d6b62', '#6c7250', '#6d5360',
  '#526d6a', '#77634c', '#7a817c', '#84604a',
]

/** Format a number with Chinese grouping (e.g. 12,345). */
export const fmt = (n: number) => n.toLocaleString('zh-CN')

// F2 角色登场追踪：空窗提醒阈值（章），可调，持久化在 localStorage。
export const PRESENCE_GAP_DEFAULT = 10
export const readPresenceGap = (): number => {
  const saved = Number(localStorage.getItem('mojing.presenceGap'))
  return Number.isFinite(saved) && saved >= 1 ? Math.floor(saved) : PRESENCE_GAP_DEFAULT
}
export const writePresenceGap = (gap: number) =>
  localStorage.setItem('mojing.presenceGap', String(gap))

// 编辑器设置（设置页与写作页共用，localStorage 持久化）。
export const EDITOR_FONT_STEPS = [14, 15, 17] as const
export const readEditorFont = (): number => {
  const saved = Number(localStorage.getItem('mojing.editorFont'))
  return (EDITOR_FONT_STEPS as readonly number[]).includes(saved) ? saved : 15
}
export const writeEditorFont = (size: number) =>
  localStorage.setItem('mojing.editorFont', String(size))

// 自动保存防抖间隔（毫秒）。写作页每次防抖都重新读取——设置页改完立即生效。
export const AUTOSAVE_MS_STEPS = [1000, 2000, 5000] as const
export const readAutosaveMs = (): number => {
  const saved = Number(localStorage.getItem('mojing.autosaveMs'))
  return (AUTOSAVE_MS_STEPS as readonly number[]).includes(saved) ? saved : 1000
}
export const writeAutosaveMs = (ms: number) =>
  localStorage.setItem('mojing.autosaveMs', String(ms))

// F4 专注模式：默认本次字数目标。
export const FOCUS_GOAL_DEFAULT = 1000
export const readFocusGoal = (): number => {
  const saved = Number(localStorage.getItem('mojing.focusGoal'))
  return Number.isFinite(saved) && saved >= 100 ? Math.floor(saved) : FOCUS_GOAL_DEFAULT
}
export const writeFocusGoal = (goal: number) =>
  localStorage.setItem('mojing.focusGoal', String(goal))

// Shared CSS class tokens so every form stays visually consistent without
// re-declaring the strings across pages.
export const inputCls = 'form-input'
export const areaCls = 'form-textarea'
export const selectCls = 'form-select'
