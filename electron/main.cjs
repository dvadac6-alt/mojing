const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { spawn } = require('node:child_process')
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
// Reads /api/health to (a) detect a ready backend, (b) confirm it is actually
// Mojing via the pid/started_at fingerprint, and (c) grab the bearer token.
function probeBackend(port) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, response => {
      let body = ''
      response.on('data', chunk => { body += chunk })
      response.on('end', () => {
        if (response.statusCode !== 200) return resolve(null)
        try {
          const data = JSON.parse(body)
          if (data.app === 'mojing' && data.auth_token) {
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
  if (info) { backendToken = info.auth_token; return true }
  return false
}

function waitForBackend(port, retries = 40) {
  return new Promise((resolve, reject) => {
    const check = () => {
      probeBackend(port).then(info => {
        if (info && info.auth_token) { backendToken = info.auth_token; resolve() }
        else retry()
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
    waitForBackend(port, 30).then(() => resolve(true)).catch(() => resolve(false))
  })
}

// Sync IPC so the preload can answer getBackendUrl()/getAuthToken() immediately.
ipcMain.on('mojing:getBackendUrl', event => {
  event.returnValue = `http://127.0.0.1:${backendPort}/api`
})
ipcMain.on('mojing:getAuthToken', event => {
  event.returnValue = backendToken
})

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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (!mainWindow) createWindow()
})

app.on('before-quit', () => {
  if (backendProcess && !backendProcess.killed) backendProcess.kill()
})
