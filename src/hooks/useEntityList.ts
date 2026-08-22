import { useCallback, useEffect, useState } from 'react'

/**
 * #2 workspace 懒加载的数据层：按 (novelId, kind) 键控的模块级实体缓存。
 *
 * - 页面首次需要某类实体时才请求（list 端点），切页往返与多页共享同一份缓存；
 * - 并发挂载只会发一次请求（promise 去重）；
 * - 变更方负责 patch 缓存（各 mutation 端点都返回新实体），跨页立即可见
 *   ——替代旧的"改一个角色 → 整包 workspace reload"模式。
 */
type CacheEntry<T> = { items: T[] | null; promise: Promise<T[]> | null }
const caches = new Map<string, CacheEntry<unknown>>()

/** 切换/删除作品或数据目录后清空缓存（不传参数 = 全清）。 */
export function clearEntityCache(novelId?: string) {
  if (novelId === undefined) {
    caches.clear()
    return
  }
  const prefix = `${novelId}/`
  for (const key of [...caches.keys()]) {
    if (key.startsWith(prefix)) caches.delete(key)
  }
}

export function useEntityList<T>(
  kind: string,
  novelId: string,
  fetcher: (novelId: string) => Promise<T[]>,
): { items: T[]; loading: boolean; error: string; refresh: () => Promise<void>; patch: (updater: (prev: T[]) => T[]) => void } {
  const key = `${novelId}/${kind}`
  const [items, setItems] = useState<T[] | null>(() => (caches.get(key)?.items as T[] | null) ?? null)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    const entry = caches.get(key) as CacheEntry<T> | undefined
    try {
      const promise = entry?.promise ?? fetcher(novelId)
      caches.set(key, { items: entry?.items ?? null, promise })
      const list = await promise
      caches.set(key, { items: list, promise: null })
      setItems(list)
      setError('')
    } catch (e) {
      caches.set(key, { items: (caches.get(key) as CacheEntry<T> | undefined)?.items ?? null, promise: null })
      setError(e instanceof Error ? e.message : '加载失败')
    }
  }, [key, fetcher, novelId])

  useEffect(() => {
    const entry = caches.get(key) as CacheEntry<T> | undefined
    if (entry?.promise || entry?.items) {
      if (entry.items) setItems(entry.items)
      return
    }
    void refresh()
  }, [key, refresh])

  const patch = useCallback((updater: (prev: T[]) => T[]) => {
    setItems(prev => {
      const next = updater(prev ?? [])
      caches.set(key, { items: next, promise: (caches.get(key) as CacheEntry<T> | undefined)?.promise ?? null })
      return next
    })
  }, [key])

  return { items: items ?? [], loading: items === null, error, refresh, patch }
}
