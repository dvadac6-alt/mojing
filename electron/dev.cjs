const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')

const root = path.join(__dirname, '..')
let viteProcess = null
let electronProcess = null

function waitForVite(retries = 40) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get('http://127.0.0.1:5175', response => {
        response.resume()
        if (response.statusCode === 200) resolve()
        else retry()
      })
      request.on('error', retry)
    }
    const retry = () => {
      if (retries-- <= 0) reject(new Error('Vite failed to start'))
      else setTimeout(check, 350)
    }
    check()
  })
}

async function start() {
  viteProcess = spawn('npm.cmd', ['run', 'dev:ui'], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  })
  await waitForVite()
  electronProcess = spawn('npx.cmd', ['electron', '.'], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, MOJING_DEV_SERVER_URL: 'http://127.0.0.1:5175' },
  })
  electronProcess.on('exit', () => stop(0))
}

function stop(code = 0) {
  if (electronProcess && !electronProcess.killed) electronProcess.kill()
  if (viteProcess && !viteProcess.killed) viteProcess.kill()
  process.exit(code)
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
start().catch(error => {
  console.error(error)
  stop(1)
})

