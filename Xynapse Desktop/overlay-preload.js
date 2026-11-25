'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the quick-chat overlay (overlay.html). main.js ignores these messages from any other page.
contextBridge.exposeInMainWorld('overlay', {
  send: (id, messages) => ipcRenderer.send('overlay:send', id, messages),
  cancel: () => ipcRenderer.send('overlay:cancel'),
  hide: () => ipcRenderer.send('overlay:hide'),
  resize: (height) => ipcRenderer.send('overlay:resize', height),
  openApp: () => ipcRenderer.send('overlay:open-app'),
  onEvent: (callback) => ipcRenderer.on('overlay:event', (_event, ev) => callback(ev)),
  onShow: (callback) => ipcRenderer.on('overlay:show', (_event, theme) => callback(theme)),
});
