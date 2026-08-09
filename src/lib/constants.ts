import type { ElementType } from 'react'
import type { ThreadPriority, ThreadStatus } from '../workspaceApi'

/** The set of top-level pages the app routes between. */
export type Page =
  | 'projects' | 'overview' | 'writing' | 'outline'
  | 'characters' | 'locations' | 'world' | 'threads'
  | 'maps' | 'library' | 'settings'

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

// Shared CSS class tokens so every form stays visually consistent without
// re-declaring the strings across pages.
export const inputCls = 'form-input'
export const areaCls = 'form-textarea'
export const selectCls = 'form-select'
