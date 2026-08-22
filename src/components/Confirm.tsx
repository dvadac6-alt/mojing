import { useSyncExternalStore } from 'react'
import { AlertTriangle, HelpCircle } from 'lucide-react'
import { Button, Modal } from './ui'

export type ConfirmOptions = {
  title: string
  message: string
  /** Renders the confirm button in danger red (destructive actions). */
  danger?: boolean
  confirmLabel?: string
}

type PendingConfirm = ConfirmOptions & { resolve: (ok: boolean) => void }

// ---------------------------------------------------------------------------
// Promise-based confirm dialog:  const ok = await confirmDialog({...})
// Replaces every native window.confirm() (which looks alien inside the shell).
// ---------------------------------------------------------------------------
let pending: PendingConfirm | null = null
const listeners = new Set<() => void>()

function emit() { for (const fn of listeners) fn() }
function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    pending = { ...options, resolve }
    emit()
  })
}

function settle(ok: boolean) {
  pending?.resolve(ok)
  pending = null
  emit()
}

export function ConfirmHost() {
  const current = useSyncExternalStore(subscribe, () => pending, () => pending)
  if (!current) return null
  return (
    <Modal
      eyebrow="请确认"
      title={current.title}
      icon={current.danger ? AlertTriangle : HelpCircle}
      onClose={() => settle(false)}
      footer={
        <div className="form-actions">
          <Button onClick={() => settle(false)}>取消</Button>
          <Button kind={current.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
            {current.confirmLabel ?? (current.danger ? '删除' : '确定')}
          </Button>
        </div>
      }
    >
      <div className="form-body confirm-body">{current.message}</div>
    </Modal>
  )
}
