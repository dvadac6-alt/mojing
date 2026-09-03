const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
// Auto-update (#10): only meaningful in packaged builds; dev has no update channel.
// window-state (#6): persists window size/position across launches.
const isPackaged = app.isPackaged
const { autoUpdater } = isPackaged ? require('electron-updater') : { autoUpdater: null }
const windowStateKeeper = require('electron-window-state')

const BASE_PORT = 8765
const MAX_PORT_ATTEMPTS = 20
let mainWindow = null
let backendProcess = null
let backendPort = BASE_PORT
let backendToken = ''

// ---- health probe ----------------------------------------------------------
// Reads /api/health to (a) detect a ready backend and (b) confirm it is actually
// Mojing via the app fingerprint. The bearer token is NOT in the health response
// anymore (tightened #7): it is persisted by the backend in storage.json, which
// we read directly — mirroring app/database.py's _resolve_config_path().
function backendConfigPath() {
  if (!app.isPackaged) {
    // Source runs (python backend/main.py) store it beside the backend code.
    return path.join(__dirname, '..', 'backend', 'storage.json')
  }
  // Packaged: the backend gets MOJING_DATA_DIR = <userData>/data and anchors
  // the config at its parent — i.e. <userData>/storage.json.
  return path.join(app.getPath('userData'), 'storage.json')
}

function readStoredToken(retries = 20) {
  // The backend persists the token at startup; right after spawn the file may
  // not exist yet, so poll briefly instead of failing the whole boot.
  const file = backendConfigPath()
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
        if (data.auth_token) return resolve(data.auth_token)
      } catch { /* missing or not yet flushed */ }
      if (left <= 0) return reject(new Error(`No auth token in ${file}`))
      setTimeout(() => attempt(left - 1), 250)
    }
    attempt(retries)
  })
}

function probeBackend(port) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, response => {
      let body = ''
      response.on('data', chunk => { body += chunk })
      response.on('end', () => {
        if (response.statusCode !== 200) return resolve(null)
        try {
          const data = JSON.parse(body)
          if (data.app === 'mojing') {
            resolve(data)
          } else {
            // Healthy service, but not ours — don't silently reuse a stranger's port.
            resolve(null)
          }
        } catch {
          resolve(null)
        }
      })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(700, () => { req.destroy(); resolve(null) })
  })
}

async function isOurBackendReady(port) {
  const info = await probeBackend(port)
  if (!info) return false
  backendToken = await readStoredToken()
  return true
}

function waitForBackend(port, retries = 40) {
  return new Promise((resolve, reject) => {
    const check = () => {
      probeBackend(port).then(async info => {
        if (info) {
          try {
            backendToken = await readStoredToken()
            resolve()
          } catch (error) { reject(error) }
        } else {
          retry()
        }
      })
    }
    const retry = () => {
      if (retries-- <= 0) reject(new Error('Local backend failed to start'))
      else setTimeout(check, 350)
    }
    check()
  })
}

// Resolve the python interpreter/executable to spawn. Packaged builds ship a
// PyInstaller-frozen single-file exe in extraResources; dev uses the system
// python. (#3)
function backendCommand() {
  if (app.isPackaged) {
    const exeName = process.platform === 'win32' ? 'mojing-backend.exe' : 'mojing-backend'
    const exePath = path.join(process.resourcesPath, 'backend', exeName)
    return { cmd: exePath, args: [], cwd: undefined }
  }
  const backendDirectory = path.join(__dirname, '..', 'backend')
  return { cmd: 'python', args: ['main.py'], cwd: backendDirectory }
}

async function startBackend() {
  // Try the base port, then increment until we find a free slot or one we own.
  for (let port = BASE_PORT; port < BASE_PORT + MAX_PORT_ATTEMPTS; port++) {
    if (await isOurBackendReady(port)) {
      backendPort = port
      console.log(`[Mojing API] reusing existing local service on ${port}`)
      return
    }
    // Probe said nothing is there for us — claim this port by spawning.
    const started = await trySpawn(port)
    if (started) {
      backendPort = port
      return
    }
    // spawn/health failed: a different process owns this port, try the next one.
  }
  throw new Error(`No free port in range ${BASE_PORT}–${BASE_PORT + MAX_PORT_ATTEMPTS - 1}`)
}

async function trySpawn(port) {
  const { cmd, args, cwd } = backendCommand()
  const spawnEnv = { ...process.env }
  if (app.isPackaged) {
    // Redirect the DB to a writable per-user folder (install dir may be read-only).
    spawnEnv.MOJING_DATA_DIR = path.join(app.getPath('userData'), 'data')
  }
  return new Promise(resolve => {
    try {
      backendProcess = spawn(cmd, [...args, String(port)], {
        cwd: cwd || undefined,
        windowsHide: true,
        env: spawnEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      console.error('[Mojing API] spawn failed:', e)
      resolve(false)
      return
    }
    backendProcess.stdout.on('data', value => console.log(`[Mojing API] ${value}`.trimEnd()))
    backendProcess.stderr.on('data', value => console.error(`[Mojing API] ${value}`.trimEnd()))
    backendProcess.on('exit', code => console.log(`[Mojing API] exited with ${code}`))
    // Wait for *our* health on this port; if another process answered the
    // earlier probe it will fail the fingerprint check and we move on.
    waitForBackend(port, 30).then(() => resolve(true)).catch(() => {
      // 优化审查 6.3：健康检查失败必须终止本次拉起的子进程——否则换端口
      // 重试时旧的孤儿后端会一直堆积，占用端口和内存。
      const child = backendProcess
      if (child && child.exitCode === null) {
        try { child.kill() } catch { /* already dying */ }
        child.once('exit', () => resolve(false))
        // 兜底：进程拒绝退出时也不能永远卡住本次尝试。
        setTimeout(() => resolve(false), 2000)
      } else {
        resolve(false)
      }
    })
  })
}

// Sync IPC so the preload can answer getBackendUrl()/getAuthToken() immediately.
ipcMain.on('mojing:getBackendUrl', event => {
  event.returnValue = `http://127.0.0.1:${backendPort}/api`
})
ipcMain.on('mojing:getAuthToken', event => {
  event.returnValue = backendToken
})

// Window controls for the frameless titlebar (minimize / maximize-toggle / close).
ipcMain.on('window:minimize', () => { mainWindow?.minimize() })
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.on('window:close', () => { mainWindow?.close() })
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

// ---- auto-update (#10) -----------------------------------------------------
// Feed URL points at GitHub Releases assets (electron-builder's "latest" file).
// autoUpdater is only wired in packaged builds; dev runs skip it entirely.
let updateInfo = null  // { version, releaseNotes } once an update is found

function setupAutoUpdater() {
  if (!autoUpdater) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', info => {
    updateInfo = { version: info.version, releaseNotes: info.releaseNotes }
    console.log(`[Mojing Updater] update ${info.version} available, downloading…`)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mojing:update-status', {
        state: 'available', version: info.version,
      })
    }
  })
  autoUpdater.on('update-not-available', () => {
    console.log('[Mojing Updater] up to date')
  })
  autoUpdater.on('update-downloaded', info => {
    console.log(`[Mojing Updater] update ${info.version} downloaded; will install on quit`)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mojing:update-status', {
        state: 'downloaded', version: info.version,
      })
    }
  })
  autoUpdater.on('error', err => {
    console.error('[Mojing Updater] error:', err?.message || err)
  })
  // Check on launch (quietly) and then every 4 hours.
  autoUpdater.checkForUpdatesAndNotify().catch(() => {})
  setInterval(() => { autoUpdater.checkForUpdatesAndNotify().catch(() => {}) }, 4 * 60 * 60 * 1000)
}

// Install the downloaded update immediately (called from the renderer "restart & update").
ipcMain.handle('updater:install', () => {
  if (autoUpdater) {
    // setImmediate ensures the renderer gets the ack before the process exits.
    setImmediate(() => autoUpdater.quitAndInstall())
  }
})

// Native folder picker for the data directory. Defaults to the current path.
ipcMain.handle('dialog:chooseDataDir', async (_event, defaultPath) => {
  const result = await dialog.showOpenDialog({
    title: '选择墨境数据保存位置',
    defaultPath: defaultPath || undefined,
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

function createWindow() {
  const smokeTest = process.env.MOJING_SMOKE_TEST === '1'
  // (#6) Persist window size/position; falls back to defaults on first launch.
  const winState = windowStateKeeper({
    defaultWidth: 1440,
    defaultHeight: 900,
    file: 'window-state.json',
  })
  mainWindow = new BrowserWindow({
    x: winState.x,
    y: winState.y,
    width: winState.width,
    height: winState.height,
    minWidth: 1100,
    minHeight: 720,
    frame: false,
    backgroundColor: '#f5f2eb',
    title: '墨境 · AI 小说创作工作台',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  winState.manage(mainWindow)

  // Push maximize state changes to the titlebar button (event-driven — the
  // renderer used to re-invoke windowIsMaximized on every resize tick).
  const sendMaxState = () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mojing:maximize-changed', mainWindow.isMaximized())
    }
  }
  mainWindow.on('maximize', sendMaxState)
  mainWindow.on('unmaximize', sendMaxState)

  // ── 渲染进程导航加固 ──
  // 页面内的 window.open / target=_blank 一律拒绝（应用没有多窗口场景）；
  // 导航只允许应用自身（打包的 file:// 或开发用的 Vite dev server），
  // 其余跳转转交系统浏览器，防止渲染层被引到任意远程页面。
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isAppPage = url.startsWith('file://') || url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')
    if (isAppPage) return
    event.preventDefault()
    void shell.openExternal(url)
  })
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault())

  const developmentUrl = process.env.MOJING_DEV_SERVER_URL
  if (developmentUrl) mainWindow.loadURL(developmentUrl)
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  if (smokeTest) {
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[Mojing Desktop] smoke test passed')
      setTimeout(() => app.quit(), 250)
    })
  } else {
    mainWindow.once('ready-to-show', () => mainWindow.show())
  }
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  try {
    await startBackend()
    createWindow()
    setupAutoUpdater()  // (#10) only acts in packaged builds
  } catch (error) {
    console.error(error)
    app.quit()
  }
})

// 杀掉后端子进程。before-quit 之外再挂 exit/信号兜底：主进程崩溃或被
// 强杀时，PyInstaller 后端不会变成占用端口、吃 CPU 的孤儿进程。
function killBackend() {
  if (backendProcess && !backendProcess.killed) {
    try { backendProcess.kill() } catch { /* already exited */ }
    backendProcess = null
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (!mainWindow) createWindow()
})

app.on('before-quit', killBackend)
app.on('quit', killBackend)
process.on('exit', killBackend)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { killBackend(); process.exit(0) })
}
