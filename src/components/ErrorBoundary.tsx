import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * Top-level safety net (#4): a render throw anywhere in the tree unmounts the
 * whole app to a white screen — confusing even though in-progress content is
 * already in the SQLite DB. This boundary shows a recoverable error card with a
 * reload button instead, so the user never thinks the app silently died.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface in the devtools console for diagnosis; the user-facing card hides
    // the raw stack.
    console.error('[墨境] render error:', error, info.componentStack)
  }

  reload = () => {
    this.setState({ error: null })
    location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="err-boundary">
        <span className="err-icon"><AlertTriangle size={26} /></span>
        <h2>页面渲染出错</h2>
        <p>你的创作内容已保存在本地，不会丢失。重新加载通常可以恢复。</p>
        {this.state.error.message && <code>{this.state.error.message}</code>}
        <button className="btn primary" onClick={this.reload}><RefreshCw size={15} />重新加载</button>
      </div>
    )
  }
}
