import { useSyncExternalStore } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

export type ToastAction = { label: string; onAction: () => void }
type ToastKind = 'success' | 'error' | 'info'
type ToastItem = { id: number; kind: ToastKind; message: string; action?: ToastAction }

// ---------------------------------------------------------------------------
// Module-level pub/sub so any code (components, hooks, plain functions) can
// fire a toast without prop drilling:  toast.error('保存失败', {action:{...}})
// ---------------------------------------------------------------------------
let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() { for (const fn of listeners) fn() }

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function push(kind: ToastKind, message: string, action?: ToastAction, ttl = 4200) {
  const id = nextId++
  items = [...items, { id, kind, message, action }]
  emit()
  window.setTimeout(() => dismiss(id), ttl)
  return id
}

function dismiss(id: number) {
  items = items.filter(t => t.id !== id)
  emit()
}

export const toast = {
  success: (msg: string, action?: ToastAction) => push('success', msg, action),
  error: (msg: string, action?: ToastAction) => push('error', msg, action, 6500),
  info: (msg: string, action?: ToastAction) => push('info', msg, action),
  dismiss,
}

// ---------------------------------------------------------------------------
// Host: mount once (in App). Renders the stacked toasts bottom-right.
// ---------------------------------------------------------------------------
const ICONS: Record<ToastKind, typeof Info> = { success: CheckCircle2, error: AlertTriangle, info: Info }

export function ToastHost() {
  const current = useSyncExternalStore(subscribe, () => items, () => items)
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {current.map(t => {
        const Icon = ICONS[t.kind]
        return (
          <div key={t.id} className={'toast toast-' + t.kind}>
            <Icon size={15} />
            <span>{t.message}</span>
            {t.action && (
              <button className="toast-action" onClick={() => { t.action!.onAction(); dismiss(t.id) }}>
                {t.action.label}
              </button>
            )}
            <button className="toast-close" aria-label="关闭" onClick={() => dismiss(t.id)}>
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
