import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const STORAGE_KEY = 'mojing.theme'

function readInitialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  // 未选择过则跟随系统偏好
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// 模块级单例状态 + 订阅：App/标题栏/设置页各挂一个 useTheme() 实例，
// 任何一处切换，其余实例同步重渲染（此前各持独立 state 会图标错位）。
let _theme: Theme = readInitialTheme()
const _listeners = new Set<(t: Theme) => void>()

function _applyTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme)
  const root = document.documentElement
  root.dataset.theme = theme
  root.classList.add('theme-anim')
  window.setTimeout(() => root.classList.remove('theme-anim'), 350)
}

/** 昼夜主题：读取（localStorage > 系统偏好）→ 写到 <html data-theme>，
 * 切换时短暂挂 theme-anim 类让背景/文字色平滑过渡。 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(_theme)

  useEffect(() => {
    const sync = (next: Theme) => setTheme(next)
    _listeners.add(sync)
    return () => { _listeners.delete(sync) }
  }, [])

  const toggleTheme = useCallback(() => {
    _theme = _theme === 'dark' ? 'light' : 'dark'
    _applyTheme(_theme)
    _listeners.forEach(fn => fn(_theme))
  }, [])

  return { theme, toggleTheme }
}
