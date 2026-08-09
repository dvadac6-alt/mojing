import { useState } from 'react'

/** Tiny helper for forms/async actions: tracks a busy flag + an error string,
 * and exposes `run(fn)` that sets them and re-throws nothing. */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : '操作失败') } finally { setBusy(false) }
  }
  return { busy, error, run, setError }
}
