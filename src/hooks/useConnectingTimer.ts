import { useEffect, useState } from 'react'

/** Tracks how many seconds the AI call has spent waiting for its first token.
 *
 * The real failure mode users hit isn't a crash — it's a 20-30s first-token
 * latency that *looks* indistinguishable from a hung connection. Showing a
 * live "已等待 Ns" turns a static "please wait" into observable progress, so
 * the user can tell "still thinking" from "definitely stuck".
 *
 * Resets to 0 the moment phase leaves 'connecting'. */
export function useConnectingTimer(phase: 'idle' | 'connecting' | 'streaming' | string): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (phase !== 'connecting') {
      setElapsed(0)
      return
    }
    setElapsed(0)
    const startedAt = Date.now()
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      500,
    )
    return () => window.clearInterval(id)
  }, [phase])
  return elapsed
}

/** Total elapsed seconds while `active` is true (covers the whole generation:
 * first-token wait + streaming). Used to render "生成中 · N 字 · Ms". */
export function useTotalTimer(active: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!active) {
      setElapsed(0)
      return
    }
    setElapsed(0)
    const startedAt = Date.now()
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      500,
    )
    return () => window.clearInterval(id)
  }, [active])
  return elapsed
}
