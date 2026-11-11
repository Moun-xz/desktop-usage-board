'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('board', {
  /** 主进程每秒推送一次看板数据 */
  onUpdate(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('board:update', handler);
    return () => ipcRenderer.removeListener('board:update', handler);
  },
  /** 主动拉取一次当前数据 */
  snapshot: () => ipcRenderer.invoke('board:snapshot'),
  /** 主进程发来的临时提示（如「鼠标穿透已开启」） */
  onHint(callback) {
    const handler = (_event, text) => callback(text);
    ipcRenderer.on('board:hint', handler);
    return () => ipcRenderer.removeListener('board:hint', handler);
  },
  /** 打开右键菜单（设置项都在这里） */
  openMenu: () => ipcRenderer.send('ui:context-menu'),
  /** 切换「固定到桌面」 */
  togglePin: () => ipcRenderer.send('ui:toggle-pin'),
  quit: () => ipcRenderer.send('ui:quit'),
  hide: () => ipcRenderer.send('ui:hide'),
});
