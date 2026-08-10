const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mojingDesktop', {
  platform: process.platform,
  // The main process resolves the actual backend URL (port may shift if 8765 is
  // taken) and the bearer token; the renderer never hardcodes either.
  getBackendUrl: () => ipcRenderer.sendSync('mojing:getBackendUrl'),
  getAuthToken: () => ipcRenderer.sendSync('mojing:getAuthToken'),
  // Opens a native folder picker; returns the chosen absolute path or null.
  chooseDataDir: (defaultPath) => ipcRenderer.invoke('dialog:chooseDataDir', defaultPath),
  // Auto-update (#10): subscribe to status events; "restart & update" installs.
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status)
    ipcRenderer.on('mojing:update-status', handler)
    return () => ipcRenderer.removeListener('mojing:update-status', handler)
  },
  installUpdate: () => ipcRenderer.invoke('updater:install'),
})
