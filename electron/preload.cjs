const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mojingDesktop', {
  platform: process.platform,
  getBackendUrl: () => 'http://127.0.0.1:8765/api',
  // Opens a native folder picker; returns the chosen absolute path or null.
  chooseDataDir: (defaultPath) => ipcRenderer.invoke('dialog:chooseDataDir', defaultPath),
})
