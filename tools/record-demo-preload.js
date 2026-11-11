const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rec', {
  source: () => ipcRenderer.invoke('rec:source'),
  region: () => ipcRenderer.invoke('rec:region'),
  frame: (dataUrl) => ipcRenderer.send('rec:frame', dataUrl),
  log: (message) => ipcRenderer.send('rec:log', String(message)),
  done: () => ipcRenderer.send('rec:done'),
});
