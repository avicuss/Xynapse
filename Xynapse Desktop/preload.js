'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Small, explicit bridge used only by the local login page (main.js ignores these
// calls from any page that is not the bundled login.html).
contextBridge.exposeInMainWorld('xynapse', {
  login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
  signup: (username, email, password) => ipcRenderer.invoke('auth:signup', { username, email, password }),
  verify: (email, code) => ipcRenderer.invoke('auth:verify', { email, code }),
  resendVerification: (email) => ipcRenderer.invoke('auth:resend', { email }),
  google: () => ipcRenderer.invoke('auth:google'),
  cancelGoogle: () => ipcRenderer.invoke('auth:google-cancel'),
  openExternal: (target) => ipcRenderer.invoke('app:open-external', target),
  onGoogleResult: (callback) => {
    ipcRenderer.on('auth:google-result', (_event, result) => callback(result));
  },
});

// Window controls for the custom title bar (minimize / maximize / close). main.js only accepts these
// from the app's own window, and they affect nothing but that window.
contextBridge.exposeInMainWorld('xynapseWin', {
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
  onState: (callback) => {
    ipcRenderer.on('win:state', (_event, maximized) => callback(Boolean(maximized)));
  },
});

// Chat page only (the website, never the local login page): lets the chat use the MCP tools the user
// connected in Settings. main.js re-checks the sender, and every tool call goes through the permission rules
// (ask / read-only auto / always allow / block) before anything runs.
if (/^https?:$/.test(location.protocol)) {
  contextBridge.exposeInMainWorld('xynapseMcp', {
    list: () => ipcRenderer.invoke('mcp:tools'),
    call: (server, tool, args) => ipcRenderer.invoke('mcp:call', server, tool, args),
  });
  // lets the chat's sidebar buttons (Plugins) open the settings view on a given page
  contextBridge.exposeInMainWorld('xynapseApp', {
    openSettings: (section) => ipcRenderer.send('settings:open', typeof section === 'string' ? section : undefined),
  });
}

// Chat page: clicking the profile row (bottom of the sidebar) opens the settings view.
// main.js only accepts this message from the chat page itself.
window.addEventListener('DOMContentLoaded', () => {
  if (!/^https?:$/.test(location.protocol)) return;
  const row = document.querySelector('.account-row');
  if (!row) return;
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');
  row.setAttribute('title', 'Settings');
  const open = () => ipcRenderer.send('settings:open');
  row.addEventListener('click', open);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
});
