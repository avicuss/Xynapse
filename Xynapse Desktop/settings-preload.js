'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Window controls for the custom title bar. The settings view covers the whole window, so it draws its own buttons
// (inserted by main.js). main.js only accepts these from the app's own window and settings view.
contextBridge.exposeInMainWorld('xynapseWin', {
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
  onState: (callback) => {
    ipcRenderer.on('win:state', (_event, maximized) => callback(Boolean(maximized)));
  },
});

// Bridge for the bundled settings.html only (main.js ignores these calls from any other page).
contextBridge.exposeInMainWorld('xySettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  reset: () => ipcRenderer.invoke('settings:reset'),
  close: () => ipcRenderer.invoke('settings:close'),
  account: () => ipcRenderer.invoke('settings:account'),
  logout: () => ipcRenderer.invoke('account:logout'),
  clearCache: () => ipcRenderer.invoke('data:clear-cache'),
  openDataFolder: () => ipcRenderer.invoke('data:open-folder'),
  openExternal: (target) => ipcRenderer.invoke('settings:open-external', target),
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    upload: (payload) => ipcRenderer.invoke('plugins:upload', payload),
    toggle: (id, enabled) => ipcRenderer.invoke('plugins:toggle', id, enabled),
    remove: (id) => ipcRenderer.invoke('plugins:remove', id),
  },
  mcp: {
    state: () => ipcRenderer.invoke('mcp:state'),
    save: (input) => ipcRenderer.invoke('mcp:save', input),
    remove: (id) => ipcRenderer.invoke('mcp:remove', id),
    setEnabled: (id, enabled) => ipcRenderer.invoke('mcp:set-enabled', id, enabled),
    setPolicy: (id, policy) => ipcRenderer.invoke('mcp:set-policy', id, policy),
    setToolPolicy: (id, tool, policy) => ipcRenderer.invoke('mcp:set-tool-policy', id, tool, policy),
    restart: (id) => ipcRenderer.invoke('mcp:restart', id),
    resetApprovals: () => ipcRenderer.invoke('mcp:reset-approvals'),
    pickFolders: () => ipcRenderer.invoke('mcp:pick-folders'),
    onChanged: (callback) => { ipcRenderer.on('mcp:changed', () => callback()); },
  },
});
