import { useCallback, useEffect, useState } from 'react'
import { workspaceApi, type Workspace } from '../workspaceApi'

/** Owns the active workspace: loads it on mount, exposes reload/patch/switch,
 * and tracks a load-error string the shell renders when the backend is down. */
export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(async () => {
    setLoadError('')
    try {
      const data = await workspaceApi.load()
      setWorkspace(data)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '无法连接本地服务')
    }
  }, [])

  useEffect(() => { void reload() }, [reload, reloadKey])

  const patchWorkspace = useCallback((updater: (w: Workspace) => Workspace) => {
    setWorkspace(current => (current ? updater(current) : current))
  }, [])

  const switchNovel = useCallback(async (id: string) => {
    try {
      const data = await workspaceApi.getNovel(id)
      setWorkspace(data)
    } catch { /* keep current */ }
  }, [])

  const retry = useCallback(() => setReloadKey(k => k + 1), [])

  return { workspace, loadError, reload, patchWorkspace, switchNovel, retry }
}
