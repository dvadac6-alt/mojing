const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('mojingDesktop', {
  platform: process.platform,
  getBackendUrl: () => 'http://127.0.0.1:8765/api',
})

