const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tradelinkDesktop', {
  http: (req) => ipcRenderer.invoke('http', req),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openSide: (url) => ipcRenderer.invoke('open-side', url),
  version: () => ipcRenderer.invoke('version'),
  checkForUpdate: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdateState: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('update-state', h);
    return () => ipcRenderer.removeListener('update-state', h);
  },
});
