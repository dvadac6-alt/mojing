import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 仅在生产构建注入 CSP <meta>（#安全加固）。开发模式不加：
 * Vite 的 React Refresh 依赖内联 preamble 脚本与 HMR websocket，
 * 会被严格 CSP 拦掉；dev 只监听 127.0.0.1，风险可接受。
 * connect-src 放行 127.0.0.1 任意端口：后端端口在 8765+ 动态递增。
 */
function cspMeta(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
    "font-src 'self' data:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
  ].join('; ')
  return {
    name: 'inject-csp-meta',
    apply: 'build',
    transformIndexHtml: html => html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
    ),
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), cspMeta()],
  build: {
    rollupOptions: {
      output: {
        // react 生态单列一个 chunk：业务代码改动时用户不必重新下载框架。
        // （Vite 8 / rolldown 只支持函数形式的 manualChunks。）
        manualChunks(id: string) {
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react'
        },
      },
    },
  },
  server: {
    // Keep in sync with the port the backend's CORS allow-list trusts and that
    // electron/dev.cjs waits on (dev:ui also pins 5175). Single source of truth.
    port: 5175,
  },
})
