import { useEffect } from 'react'
import type { ElementType, ReactNode } from 'react'
import { ChevronRight, Plus, Search, X } from 'lucide-react'

export function PageHeader({ eyebrow, title, desc, actions }: { eyebrow?: string; title: string; desc?: string; actions?: ReactNode }) {
  return <div className="page-header"><div>{eyebrow && <label>{eyebrow}</label>}<h1>{title}</h1>{desc && <p>{desc}</p>}</div>{actions && <aside>{actions}</aside>}</div>
}

export const Button = ({ children, kind = 'secondary', onClick, disabled }: { children: ReactNode; kind?: string; onClick?: () => void; disabled?: boolean }) =>
  <button className={'btn ' + kind} onClick={onClick} disabled={disabled}>{children}</button>

export function Scroll({ children }: { children: ReactNode }) {
  return <div className="scroll-page">{children}</div>
}

export function SearchBox({ text, value, onChange }: { text: string; value?: string; onChange?: (v: string) => void }) {
  return <div className="search-box"><Search size={14} /><input placeholder={text} value={value} onChange={e => onChange?.(e.target.value)} /></div>
}

export function PanelTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <header className="panel-title"><h2>{title}</h2>{action && <button onClick={onAction}>{action}<ChevronRight size={13} /></button>}</header>
}

export function PaneHead({ eyebrow, title, onAdd }: { eyebrow: string; title: string; onAdd?: () => void }) {
  return <div className="pane-title"><div><label>{eyebrow}</label><strong>{title}</strong></div><button onClick={onAdd} aria-label={`新建${title}`}><Plus size={15} /></button></div>
}

export function Detail({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return <section className={'detail ' + (wide ? 'wide' : '')}><h2>{title}</h2>{children}</section>
}

export function LinkRecord({ icon: Icon, title, note }: { icon: ElementType; title: string; note: string }) {
  return <div className="link-record"><Icon size={15} /><span><strong>{title}</strong><small>{note}</small></span><ChevronRight size={14} /></div>
}

export function EmptyState({ icon: Icon, title, desc, action }: { icon: ElementType; title: string; desc: string; action?: ReactNode }) {
  return <div className="empty-state"><span><Icon size={22} /></span><h3>{title}</h3><p>{desc}</p>{action}</div>
}

export function Modal({ eyebrow, title, icon, onClose, children, footer, wide }: { eyebrow: string; title: string; icon: ElementType; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const Icon = icon
  // Esc 关闭弹窗（键盘可达性）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="form-modal" onMouseDown={onClose}><div className={'form-dialog' + (wide ? ' wide' : '')} onMouseDown={e => e.stopPropagation()}>
    <div className="form-head"><span className="form-icon"><Icon size={18} /></span><div><label>{eyebrow}</label><h2>{title}</h2></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></div>
    {children}
    {footer}
  </div></div>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="form-field"><span>{label}</span>{children}</label>
}

/** 表单弹窗统一底栏：说明文案 / 附加按钮 / 错误 / 取消 / 提交。
 *  各页面表单此前复制粘贴同一骨架 ×8，按钮与错误位的排布从此单点维护。 */
export function FormFooter({ error, busy, onClose, onSubmit, submitLabel = '保存', busyLabel = '保存中…', note, extra, submitDisabled }: {
  error?: string; busy?: boolean; onClose: () => void; onSubmit: () => void
  submitLabel?: string; busyLabel?: string; note?: ReactNode; extra?: ReactNode; submitDisabled?: boolean
}) {
  return <div className="form-actions">
    {note && <span className="muted">{note}</span>}
    {extra}
    {error && <span className="form-error">{error}</span>}
    <Button onClick={onClose}>取消</Button>
    <Button kind="primary" onClick={onSubmit} disabled={busy || submitDisabled}>{busy ? busyLabel : submitLabel}</Button>
  </div>
}

/** Empty-state wrapper used by master/detail pages when a section has no data. */
export function EmptyStateWrap({ icon, title, desc, action }: { icon: ElementType; title: string; desc: string; action: () => void }) {
  return <div className="scroll-page"><div className="empty-state" style={{ marginTop: 60 }}><span>{(() => { const I = icon; return <I size={22} /> })()}</span><h3>{title}</h3><p>{desc}</p><Button kind="primary" onClick={action}><Plus size={14} />立即创建</Button></div></div>
}
