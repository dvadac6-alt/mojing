const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')

const BACKEND_PORT = 8765
let mainWindow = null
let backendProcess = null

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

function backendIsReady() {
  return new Promise(resolve => {
    const request = http.get(`http://127.0.0.1:${BACKEND_PORT}/api/health`, response => {
      response.resume()
      resolve(response.statusCode === 200)
    })
    request.on('error', () => resolve(false))
    request.setTimeout(500, () => {
      request.destroy()
      resolve(false)
    })
  })
}

function waitForBackend(retries = 40) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(`http://127.0.0.1:${BACKEND_PORT}/api/health`, response => {
        response.resume()
        if (response.statusCode === 200) resolve()
        else retry()
      })
      request.on('error', retry)
    }
    const retry = () => {
      if (retries-- <= 0) reject(new Error('Local backend failed to start'))
      else setTimeout(check, 350)
    }
    check()
  })
}

async function startBackend() {
  if (await backendIsReady()) {
    console.log('[Mojing API] using existing local service')
    return
  }
  const backendDirectory = path.join(__dirname, '..', 'backend')
  // In development, the FastAPI backend stores data in <new>/墨境数据 by default
  // (overridable via the Settings page). Only when packaged do we redirect it to
  // a writable per-user folder, since the install dir may be read-only.
  const spawnEnv = { ...process.env }
  if (app.isPackaged) {
    const dataDirectory = path.join(app.getPath('userData'), 'data')
    spawnEnv.MOJING_DATA_DIR = dataDirectory
  }
  backendProcess = spawn('python', ['main.py', String(BACKEND_PORT)], {
    cwd: backendDirectory,
    windowsHide: true,
    env: spawnEnv,
  })
  backendProcess.stdout.on('data', value => console.log(`[Mojing API] ${value}`))
  backendProcess.stderr.on('data', value => console.error(`[Mojing API] ${value}`))
  backendProcess.on('exit', code => console.log(`[Mojing API] exited with ${code}`))
  await waitForBackend()
}

function createWindow() {
  const smokeTest = process.env.MOJING_SMOKE_TEST === '1'
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
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
