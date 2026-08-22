import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const STORAGE_KEY = 'mojing.theme'

function readInitialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  // 未选择过则跟随系统偏好
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 昼夜主题：读取（localStorage > 系统偏好）→ 写到 <html data-theme>，
 * 切换时短暂挂 theme-anim 类让背景/文字色平滑过渡。 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.classList.add('theme-anim')
    const id = window.setTimeout(() => root.classList.remove('theme-anim'), 350)
    return () => window.clearTimeout(id)
  }, [theme])

  // Persist in an effect (not inside the setState updater): updater functions
  // must stay pure — StrictMode runs them twice, which would double-write.
  useEffect(() => { localStorage.setItem(STORAGE_KEY, theme) }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(current => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, toggleTheme }
}
