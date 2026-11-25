'use strict';
const { app, BrowserWindow, WebContentsView, shell, session, Menu, ipcMain, dialog, Tray, nativeImage, screen, globalShortcut, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const themes = require('./themes');
const { McpManager } = require('./mcp');

// ---- config ---------------------------------------------------------------
const DEFAULT_URL = 'https://xynapse.eu/chat';
const urlArg = process.argv.find((a) => a.startsWith('--url='));
const START_URL = urlArg ? urlArg.slice('--url='.length) : DEFAULT_URL; // the chat
const ORIGIN = new URL(START_URL).origin;
const PROTOCOL = 'xynapse'; // xynapse://auth?code=... (Google sign-in hand-off from the browser)

const LOGIN_FILE = path.join(__dirname, 'login.html');
const OFFLINE_FILE = path.join(__dirname, 'offline.html');
const SETTINGS_FILE = path.join(__dirname, 'settings.html');
const LOGIN_FILE_URL = pathToFileURL(LOGIN_FILE).href;
const SETTINGS_FILE_URL = pathToFileURL(SETTINGS_FILE).href;

// Hosts that may be opened INSIDE the app window (everything else opens in the system browser).
const startHost = new URL(START_URL).hostname;
const INTERNAL_HOSTS = new Set([startHost, 'xynapse.eu', 'www.xynapse.eu', 'localhost', '127.0.0.1']);

// The website's landing / sign-in pages. The desktop app never shows them:
// it only has its own login page and the chat.
const LANDING_PATHS = new Set(['/', '/index.html', '/auth.html', '/auth']);

const isInternal = (url) => {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && INTERNAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
};
const isLandingUrl = (url) => {
  try {
    const u = new URL(url);
    return isInternal(url) && LANDING_PATHS.has(u.pathname);
  } catch {
    return false;
  }
};
const safeOpenExternal = (url) => {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.href);
  } catch { /* ignore */ }
};

// A plain Chrome user agent (no "Electron" token) so the website treats the app like a normal browser.
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

// ---- protocol (xynapse://) -------------------------------------------------
if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// ---- single instance ------------------------------------------------------
// Windows starts the app at login with --hidden: it then stays in the tray instead of opening the window.
const START_HIDDEN = process.argv.includes('--hidden');
const stayHidden = () => START_HIDDEN && Boolean(tray) && settings.closeToTray;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let mainWindow = null;
const focusWindow = () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
};
app.on('second-instance', (_e, argv) => {
  focusWindow();
  const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (link) handleDeepLink(link);
});
app.on('open-url', (e, url) => { // macOS
  e.preventDefault();
  handleDeepLink(url);
});

// ---- window size / position memory ---------------------------------------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
}
function saveState(win) {
  try {
    const maximized = win.isMaximized();
    const b = maximized ? (loadState().bounds || win.getNormalBounds()) : win.getBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ bounds: b, maximized }));
  } catch { /* ignore */ }
}

// ---- user settings (themes, zoom, ...) ------------------------------------
// Stored in userData/settings.json. Validation + defaults live in themes.js.
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { ...themes.DEFAULTS };
function loadSettings() {
  try {
    settings = themes.sanitize(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')), themes.DEFAULTS);
  } catch {
    settings = { ...themes.DEFAULTS };
  }
}
function saveSettings() {
  try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch { /* ignore */ }
}

let chatCssKey = null;
async function injectChatCss() {
  const wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
  if (!wc || wc.isDestroyed()) return;
  try {
    if (chatCssKey) { await wc.removeInsertedCSS(chatCssKey); chatCssKey = null; }
  } catch { chatCssKey = null; }
  if (!isInternal(wc.getURL())) {
    // local login / offline pages only get the drag strip, never the chat theme
    if (CUSTOM_FRAME && wc.getURL().startsWith('file://')) {
      try { chatCssKey = await wc.insertCSS(themes.buildFrameCss(), { cssOrigin: 'author' }); } catch { /* page navigated away */ }
    }
    return;
  }
  try {
    chatCssKey = await wc.insertCSS(themes.buildChatCss(settings), { cssOrigin: 'author' });
  } catch { /* page navigated away */ }
}
function applyZoom() {
  const wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
  if (wc && !wc.isDestroyed()) wc.setZoomFactor(settings.zoom);
}
function applyWindowSettings() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(settings.alwaysOnTop);
  try { session.defaultSession.setSpellCheckerEnabled(settings.spellcheck); } catch { /* ignore */ }
  // Registering the dev copy of Electron as a startup app would be wrong, so only the installed app does it.
  if (app.isPackaged) {
    try { app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, name: 'Xynapse', path: process.execPath, args: ['--hidden'] }); } catch { /* ignore */ }
  }
}
async function updateSettings(patch) {
  settings = themes.sanitize(patch, settings);
  saveSettings();
  applyWindowSettings();
  applyZoom();
  await injectChatCss();
  return settings;
}

// ---- keyboard shortcuts (the app has no menu bar, so they are handled here) ------
const MOD = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
const isChatPage = () => {
  try {
    const u = new URL(mainWindow.webContents.getURL());
    return isInternal(u.href) && u.pathname.startsWith('/chat');
  } catch {
    return false;
  }
};
const chatJs = (code) => {
  if (!isChatPage()) return;
  mainWindow.webContents.executeJavaScript(`(function(){try{${code}}catch(e){}})()`).catch(() => { /* ignore */ });
};
const zoomBy = (delta) => updateSettings({ zoom: settings.zoom + delta });

// keys: matched against KeyboardEvent.key (lower-cased); shift: undefined = either; mod: false = no Ctrl/Cmd; scope 'chat' = only on the chat page
const SHORTCUTS = [
  { label: 'New chat', display: `${MOD}+N`, keys: ['n'], shift: false, scope: 'chat', run: () => chatJs("document.getElementById('new').click()") },
  { label: 'Search chats', display: `${MOD}+H`, keys: ['h'], shift: false, scope: 'chat', run: () => chatJs("document.getElementById('searchBtn').click()") },
  { label: 'Toggle sidebar', display: `${MOD}+B`, keys: ['b'], shift: false, scope: 'chat', run: () => chatJs("document.getElementById('sidebarToggle').click()") },
  { label: 'Focus the message box', display: `${MOD}+K`, keys: ['k'], shift: false, scope: 'chat', run: () => chatJs("var i=document.getElementById('in');if(i&&!i.disabled)i.focus()") },
  { label: 'Toggle Think', display: `${MOD}+Shift+T`, keys: ['t'], shift: true, scope: 'chat', run: () => chatJs("document.getElementById('think').click()") },
  { label: 'Toggle web search', display: `${MOD}+Shift+S`, keys: ['s'], shift: true, scope: 'chat', run: () => chatJs("document.getElementById('srch').click()") },
  { label: 'Open settings', display: `${MOD}+,`, keys: [','], shift: false, scope: 'chat', run: () => openSettings() },
  { label: 'Show keyboard shortcuts', display: `${MOD}+/`, keys: ['/'], shift: false, scope: 'chat', run: () => openSettings('shortcuts') },
  { label: 'Zoom in', display: `${MOD}+=`, keys: ['=', '+'], run: () => zoomBy(0.05) },
  { label: 'Zoom out', display: `${MOD}+-`, keys: ['-', '_'], run: () => zoomBy(-0.05) },
  { label: 'Reset zoom', display: `${MOD}+0`, keys: ['0'], run: () => updateSettings({ zoom: 1 }) },
  { label: 'Reload', display: `${MOD}+R`, keys: ['r'], shift: false, run: () => mainWindow && mainWindow.webContents.reload() },
  { label: 'Full screen', display: 'F11', keys: ['f11'], mod: false, run: () => mainWindow && mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
];

function handleShortcut(event, input) {
  if (input.type !== 'keyDown' || !settings.shortcuts || input.alt) return;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key.toLowerCase();
  const hasMod = Boolean(input.control || input.meta);
  for (const sc of SHORTCUTS) {
    if ((sc.mod !== false) !== hasMod) continue;
    if (sc.shift !== undefined && sc.shift !== Boolean(input.shift)) continue;
    if (!sc.keys.includes(key)) continue;
    if (sc.scope === 'chat' && !isChatPage()) return;
    event.preventDefault();
    sc.run();
    return;
  }
}

// ---- settings view (full-window page on top of the chat) ---------------------------
let settingsView = null;
function layoutSettings() {
  if (!settingsView || !mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  settingsView.setBounds({ x: 0, y: 0, width, height }); // covers the whole window; settings draws its own window buttons
}
function openSettings(section) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (settingsView) {
    if (section) settingsView.webContents.loadFile(SETTINGS_FILE, { query: { s: section } });
    settingsView.webContents.focus();
    return;
  }
  settingsView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsView.setBackgroundColor('#000000');
  mainWindow.contentView.addChildView(settingsView);
  layoutSettings();
  const wc = settingsView.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'Escape') { e.preventDefault(); closeSettings(); }
    else if (input.key === 'F11') { e.preventDefault(); mainWindow.setFullScreen(!mainWindow.isFullScreen()); }
  });
  wc.once('did-finish-load', () => { if (settingsView) settingsView.webContents.focus(); });
  // The view covers the whole window, so it needs its own drag strip + minimize / maximize / close buttons
  // (the chat page's copies are hidden underneath). The close circle moves down to sit below the buttons.
  wc.on('dom-ready', () => {
    if (!CUSTOM_FRAME || wc.isDestroyed()) return;
    wc.insertCSS(themes.buildFrameCss() + '.x{top:' + (TITLEBAR_H + 14) + 'px!important}', { cssOrigin: 'author' }).catch(() => { /* page navigated away */ });
    wc.executeJavaScript(WINDOW_CONTROLS_JS).catch(() => { /* page navigated away */ });
  });
  wc.loadFile(SETTINGS_FILE, section ? { query: { s: section } } : undefined);
}
function closeSettings() {
  if (!settingsView) return;
  const view = settingsView;
  settingsView = null;
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(view); } catch { /* ignore */ }
  try { view.webContents.close(); } catch { /* ignore */ }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.focus();
}

// ---- talking to the Xynapse backend ----------------------------------------
// Requests are made here (main process) and the session cookie is stored in the app's
// own cookie jar, so the chat window is signed in as soon as the cookie lands.
const ses = () => session.defaultSession;

async function cookieHeader() {
  const cookies = await ses().cookies.get({ url: ORIGIN });
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function storeSetCookies(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const raw of list) {
    const parts = raw.split(';').map((s) => s.trim());
    const eq = parts[0].indexOf('=');
    if (eq <= 0) continue;
    const name = parts[0].slice(0, eq);
    const value = parts[0].slice(eq + 1);
    const attrs = {};
    for (const p of parts.slice(1)) {
      const i = p.indexOf('=');
      if (i < 0) attrs[p.toLowerCase()] = true;
      else attrs[p.slice(0, i).toLowerCase()] = p.slice(i + 1);
    }
    const maxAge = attrs['max-age'] !== undefined ? Number(attrs['max-age']) : undefined;
    try {
      if (maxAge !== undefined && maxAge <= 0) {
        await ses().cookies.remove(ORIGIN, name);
        continue;
      }
      await ses().cookies.set({
        url: ORIGIN,
        name,
        value,
        path: attrs.path || '/',
        httpOnly: Boolean(attrs.httponly),
        secure: Boolean(attrs.secure),
        sameSite: ({ lax: 'lax', strict: 'strict', none: 'no_restriction' })[String(attrs.samesite || '').toLowerCase()] || 'unspecified',
        ...(maxAge ? { expirationDate: Math.floor(Date.now() / 1000) + maxAge } : {}),
      });
    } catch { /* ignore a bad cookie */ }
  }
}

async function api(pathname, { method = 'GET', body, timeoutMs = 15000 } = {}) {
  const res = await fetch(ORIGIN + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': CHROME_UA,
      Cookie: await cookieHeader(),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  await storeSetCookies(res);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { ok: res.ok, status: res.status, data };
}

// 'chat' = signed in, 'login' = signed out, 'offline' = server unreachable
async function bootRoute() {
  try {
    const r = await api('/api/auth/me', { timeoutMs: 8000 });
    if (r.status >= 500) return 'offline';
    return r.ok && r.data?.user?.verified ? 'chat' : 'login';
  } catch {
    return 'offline';
  }
}

function show(route) {
  if (!mainWindow) return;
  closeSettings();
  if (route === 'chat') mainWindow.loadURL(START_URL);
  else if (route === 'offline') mainWindow.loadFile(OFFLINE_FILE, { query: { url: START_URL } });
  else mainWindow.loadFile(LOGIN_FILE);
}

// Whenever the website tries to show its own landing/sign-in page, decide here instead.
let routing = false;
let routeBurst = [];
async function routeLanding() {
  if (routing) return;
  routing = true;
  try {
    const now = Date.now();
    routeBurst = routeBurst.filter((t) => now - t < 5000).concat(now);
    // Safety net against a redirect loop: after a burst, just show the login page.
    show(routeBurst.length > 4 ? 'login' : await bootRoute());
  } finally {
    routing = false;
  }
}

// ---- Google sign-in (system browser -> xynapse://auth?code=...) ------------
let pendingGoogle = null; // { verifier, startedAt }
const GOOGLE_WAIT_MS = 10 * 60 * 1000;

const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const fromLoginPage = (event) => {
  const url = event.senderFrame && event.senderFrame.url;
  return typeof url === 'string' && url.startsWith(LOGIN_FILE_URL);
};
const fromSettingsPage = (event) => {
  const url = event.senderFrame && event.senderFrame.url;
  return typeof url === 'string' && url.startsWith(SETTINGS_FILE_URL);
};
const fromChatPage = (event) => {
  try {
    const u = new URL(event.senderFrame.url);
    return isInternal(u.href) && u.pathname.startsWith('/chat');
  } catch {
    return false;
  }
};
const notifyGoogle = (result) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('auth:google-result', result);
};

async function handleDeepLink(link) {
  focusWindow();
  let code = '';
  try {
    const u = new URL(link);
    if (u.protocol !== `${PROTOCOL}:`) return;
    code = u.searchParams.get('code') || '';
  } catch {
    return;
  }
  const pending = pendingGoogle;
  // Ignore links the app did not ask for.
  if (!pending || Date.now() - pending.startedAt > GOOGLE_WAIT_MS || !code) return;
  pendingGoogle = null;
  try {
    const r = await api('/api/auth/desktop-exchange', { method: 'POST', body: { code, verifier: pending.verifier } });
    if (r.ok && r.data?.user) return show('chat');
    notifyGoogle({ ok: false, error: r.data?.error?.message || 'Google sign-in could not be completed.' });
  } catch {
    notifyGoogle({ ok: false, error: 'No connection. Check your internet and try again.' });
  }
}

// ---- MCP connections (engine + permission rules live in mcp.js) ----------------------
let mcp = null;
let mcpNotifyTimer = null;
function notifyMcpChanged() {
  if (mcpNotifyTimer) return;
  mcpNotifyTimer = setTimeout(() => {
    mcpNotifyTimer = null;
    try {
      if (settingsView && !settingsView.webContents.isDestroyed()) settingsView.webContents.send('mcp:changed');
    } catch { /* settings view is closing */ }
  }, 120);
}

// Shown whenever a tool call needs the user's OK. Returns 'once' | 'always' | 'deny'.
async function askToolPermission({ serverName, toolName, description, args }) {
  let argText = '';
  try { argText = JSON.stringify(args, null, 2); } catch { argText = '(unreadable)'; }
  if (argText.length > 1200) argText = argText.slice(0, 1200) + '\n…';
  const opts = {
    type: 'question',
    buttons: ['Allow once', 'Always allow this tool', 'Deny'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: 'Xynapse - tool permission',
    message: 'Allow "' + toolName + '" from "' + serverName + '"?',
    detail: (description ? String(description).slice(0, 300) + '\n\n' : '') + 'Arguments:\n' + argText,
  };
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (win) focusWindow();
  const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  return ['once', 'always', 'deny'][r.response] || 'deny';
}

function registerMcpIpc() {
  // ---- settings page: manage connections ----
  ipcMain.handle('mcp:state', (event) => (fromSettingsPage(event) ? mcp.state() : null));
  ipcMain.handle('mcp:save', (event, input) => (fromSettingsPage(event) ? mcp.save(input) : { ok: false }));
  ipcMain.handle('mcp:remove', (event, id) => { if (fromSettingsPage(event)) mcp.remove(String(id)); return { ok: true }; });
  ipcMain.handle('mcp:set-enabled', (event, id, enabled) => { if (fromSettingsPage(event)) mcp.setEnabled(String(id), enabled === true); return { ok: true }; });
  ipcMain.handle('mcp:set-policy', (event, id, policy) => { if (fromSettingsPage(event)) mcp.setPolicy(String(id), String(policy)); return { ok: true }; });
  ipcMain.handle('mcp:set-tool-policy', (event, id, tool, policy) => { if (fromSettingsPage(event)) mcp.setToolPolicy(String(id), String(tool), String(policy)); return { ok: true }; });
  ipcMain.handle('mcp:restart', (event, id) => { if (fromSettingsPage(event)) mcp.restart(String(id)); return { ok: true }; });
  ipcMain.handle('mcp:reset-approvals', (event) => { if (fromSettingsPage(event)) mcp.resetApprovals(); return { ok: true }; });
  ipcMain.handle('mcp:pick-folders', async (event) => {
    if (!fromSettingsPage(event)) return { paths: [] };
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Choose folders Xynapse may access', properties: ['openDirectory', 'multiSelections'] });
    return { paths: r.canceled ? [] : r.filePaths };
  });

  // ---- chat page: use the tools (every call still goes through the permission rules) ----
  ipcMain.handle('mcp:tools', (event) => (fromChatPage(event) ? mcp.allTools() : []));
  ipcMain.handle('mcp:call', async (event, server, tool, args) => {
    if (!fromChatPage(event)) return { ok: false, error: 'Not allowed.' };
    if (typeof server !== 'string' || typeof tool !== 'string') return { ok: false, error: 'Invalid request.' };
    return mcp.callTool(server, tool, args);
  });
}

function initMcp() {
  mcp = new McpManager({
    file: path.join(app.getPath('userData'), 'mcp.json'),
    ask: askToolPermission,
    onChange: notifyMcpChanged,
    appVersion: app.getVersion(),
  });
  registerMcpIpc();
  mcp.startAll();
}

const OPEN_ALLOWED = new Set(['/terms', '/privacy', '/auth.html']);
const SETTINGS_LINKS = new Set(['/terms', '/privacy', '/refunds', '/support', '/pricing.html']);
const NO_CONNECTION = 'No connection. Check your internet and try again.';

async function fetchAccount() {
  try {
    const me = await api('/api/auth/me', { timeoutMs: 8000 });
    const user = me.data?.user || null;
    let usage = null;
    if (user) {
      const u = await api('/api/usage', { timeoutMs: 8000 });
      usage = u.data?.usage || null;
    }
    return { user, usage };
  } catch {
    return { user: null, usage: null, offline: true };
  }
}

function registerIpc() {
  // ---- login page ----
  ipcMain.handle('auth:login', async (event, payload) => {
    if (!fromLoginPage(event)) return { ok: false };
    const email = String(payload?.email || '').trim().slice(0, 254);
    const password = String(payload?.password || '').slice(0, 128);
    if (!email || !password) return { ok: false, error: 'Enter your email and password.' };
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      if (r.ok && r.data?.user) { show('chat'); return { ok: true }; }
      return { ok: false, code: r.data?.error?.code, error: r.data?.error?.message || 'Could not sign in.' };
    } catch {
      return { ok: false, error: NO_CONNECTION };
    }
  });

  // Registration: the server creates the account and e-mails a link + 6-digit code.
  ipcMain.handle('auth:signup', async (event, payload) => {
    if (!fromLoginPage(event)) return { ok: false };
    const username = String(payload?.username || '').trim().slice(0, 64);
    const email = String(payload?.email || '').trim().slice(0, 254);
    const password = String(payload?.password || '').slice(0, 128);
    if (!username || !email || !password) return { ok: false, error: 'Fill in all fields.' };
    try {
      const r = await api('/api/auth/signup', { method: 'POST', body: { username, email, password }, timeoutMs: 30000 });
      if (r.ok) return { ok: true };
      return { ok: false, code: r.data?.error?.code, error: r.data?.error?.message || 'Could not create the account.' };
    } catch {
      return { ok: false, error: NO_CONNECTION };
    }
  });

  // Confirms the e-mail with the 6-digit code; the server then signs the app in.
  ipcMain.handle('auth:verify', async (event, payload) => {
    if (!fromLoginPage(event)) return { ok: false };
    const email = String(payload?.email || '').trim().slice(0, 254);
    const code = String(payload?.code || '').trim().slice(0, 12);
    if (!email || !/^\d{6}$/.test(code)) return { ok: false, error: 'Enter the 6-digit code from the email.' };
    try {
      const r = await api('/api/auth/verify', { method: 'POST', body: { email, code } });
      if (r.ok && r.data?.user) { show('chat'); return { ok: true }; }
      return { ok: false, code: r.data?.error?.code, error: r.data?.error?.message || 'Verification failed.' };
    } catch {
      return { ok: false, error: NO_CONNECTION };
    }
  });

  ipcMain.handle('auth:resend', async (event, payload) => {
    if (!fromLoginPage(event)) return { ok: false };
    const email = String(payload?.email || '').trim().slice(0, 254);
    try {
      const r = await api('/api/auth/resend-verification', { method: 'POST', body: { email } });
      return { ok: r.ok, error: r.data?.error?.message };
    } catch {
      return { ok: false, error: NO_CONNECTION };
    }
  });

  ipcMain.handle('auth:google', (event) => {
    if (!fromLoginPage(event)) return { ok: false };
    const verifier = crypto.randomBytes(32).toString('hex');
    pendingGoogle = { verifier, startedAt: Date.now() };
    // Server flow: Google account chooser -> /api/auth/desktop-handoff (page that opens xynapse://auth?code=...)
    const next = `/api/auth/desktop-handoff?c=${sha256hex(verifier)}`;
    safeOpenExternal(`${ORIGIN}/auth/google?next=${encodeURIComponent(next)}`);
    return { ok: true };
  });

  ipcMain.handle('auth:google-cancel', (event) => {
    if (fromLoginPage(event)) pendingGoogle = null;
    return { ok: true };
  });

  ipcMain.handle('app:open-external', (event, target) => {
    if (!fromLoginPage(event)) return { ok: false };
    try {
      const u = new URL(String(target), ORIGIN);
      if (u.origin === ORIGIN && OPEN_ALLOWED.has(u.pathname)) safeOpenExternal(u.href);
    } catch { /* ignore */ }
    return { ok: true };
  });

  // ---- profile click in the chat -> settings ----
  // the profile row opens Settings; the sidebar's Plugins button passes a page name (e.g. 'plugins')
  ipcMain.on('settings:open', (event, section) => {
    if (!fromChatPage(event)) return;
    openSettings(typeof section === 'string' && /^[a-z]{1,20}$/.test(section) ? section : undefined);
  });

  // ---- settings page ----
  ipcMain.handle('settings:close', (event) => {
    if (fromSettingsPage(event)) closeSettings();
    return { ok: true };
  });

  ipcMain.handle('settings:get', (event) => {
    if (!fromSettingsPage(event)) return null;
    return {
      settings,
      themes: themes.THEMES,
      shortcuts: SHORTCUTS.map(({ label, display }) => ({ label, display })),
      packaged: app.isPackaged,
      about: {
        version: app.getVersion(),
        electron: process.versions.electron,
        chromium: process.versions.chrome,
        platform: `${process.platform} ${process.arch}`,
        server: ORIGIN,
        dataPath: app.getPath('userData'),
      },
    };
  });

  ipcMain.handle('settings:set', async (event, patch) => {
    if (!fromSettingsPage(event)) return null;
    return { settings: await updateSettings(patch) };
  });

  ipcMain.handle('settings:reset', async (event) => {
    if (!fromSettingsPage(event)) return null;
    return { settings: await updateSettings({ ...themes.DEFAULTS }) };
  });

  ipcMain.handle('settings:account', async (event) => {
    if (!fromSettingsPage(event)) return null;
    return fetchAccount();
  });

  // ---- plugins & skills: stored on the account (same list as the website). The settings page cannot reach the
  // network (strict CSP), so these go through the main process, which sends the session cookie. ----
  const pluginsApi = async (pathname, opts) => {
    try {
      const r = await api(pathname, { timeoutMs: 60000, ...opts });
      return { ok: r.ok, status: r.status, data: r.data };
    } catch {
      return { ok: false, status: 0, data: { error: { message: NO_CONNECTION } } };
    }
  };
  ipcMain.handle('plugins:list', (event) => (fromSettingsPage(event) ? pluginsApi('/api/plugins') : null));
  ipcMain.handle('plugins:upload', (event, p) => {
    if (!fromSettingsPage(event)) return null;
    const filename = String(p?.filename || '').slice(0, 200);
    const encoding = p?.encoding === 'base64' ? 'base64' : 'text';
    const data = typeof p?.data === 'string' ? p.data : '';
    return pluginsApi('/api/plugins', { method: 'POST', body: { filename, encoding, data } });
  });
  ipcMain.handle('plugins:toggle', (event, id, enabled) => (fromSettingsPage(event)
    ? pluginsApi('/api/plugins/' + encodeURIComponent(String(id)), { method: 'PATCH', body: { enabled: enabled === true } }) : null));
  ipcMain.handle('plugins:remove', (event, id) => (fromSettingsPage(event)
    ? pluginsApi('/api/plugins/' + encodeURIComponent(String(id)), { method: 'DELETE' }) : null));

  ipcMain.handle('account:logout', async (event) => {
    if (!fromSettingsPage(event)) return { ok: false };
    try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* server unreachable */ }
    try { await ses().cookies.remove(ORIGIN, 'xynapse_session'); } catch { /* ignore */ }
    show('login');
    return { ok: true };
  });

  ipcMain.handle('data:clear-cache', async (event) => {
    if (!fromSettingsPage(event)) return { ok: false };
    try {
      await ses().clearCache();
      await ses().clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('data:open-folder', (event) => {
    if (!fromSettingsPage(event)) return { ok: false };
    shell.openPath(app.getPath('userData'));
    return { ok: true };
  });

  ipcMain.handle('settings:open-external', (event, target) => {
    if (!fromSettingsPage(event)) return { ok: false };
    try {
      const u = new URL(String(target), ORIGIN);
      if (u.origin === ORIGIN && SETTINGS_LINKS.has(u.pathname)) safeOpenExternal(u.href);
    } catch { /* ignore */ }
    return { ok: true };
  });
}

// ---- tray icon + quick-chat overlay ---------------------------------------------
// The app lives in the notification area (the ^ arrow next to the clock). Left-click opens a small floating
// chat bar (overlay.html); right-click shows a menu. Ctrl+Shift+Space opens the bar from anywhere.
// ---- custom title bar (no native bar: the app draws its own Claude-style window buttons) -------------
const TITLEBAR_H = themes.TITLEBAR_H;
const CUSTOM_FRAME = process.platform !== 'darwin';

const WINDOW_CONTROLS_JS = `(function(){try{
  if(!window.xynapseWin||!document.documentElement)return;
  var mk=function(){
    if(document.getElementById('xyn-winctl'))return;
    var box=document.createElement('div');box.id='xyn-winctl';
    box.innerHTML=''
      +'<button class="min" aria-label="Minimize" title="Minimize"><svg viewBox="0 0 12 12"><path d="M2 6h8"/></svg></button>'
      +'<button class="maximize" aria-label="Maximize" title="Maximize"><svg viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="1.8"/></svg></button>'
      +'<button class="restore" aria-label="Restore" title="Restore"><svg viewBox="0 0 12 12"><rect x="2" y="3.6" width="6.4" height="6.4" rx="1.6"/><path d="M4 3.6V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-.6"/></svg></button>'
      +'<button class="close" aria-label="Close" title="Close"><svg viewBox="0 0 12 12"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg></button>';
    box.querySelector('.min').addEventListener('click',function(){window.xynapseWin.minimize()});
    box.querySelector('.maximize').addEventListener('click',function(){window.xynapseWin.toggleMaximize()});
    box.querySelector('.restore').addEventListener('click',function(){window.xynapseWin.toggleMaximize()});
    box.querySelector('.close').addEventListener('click',function(){window.xynapseWin.close()});
    box.addEventListener('dblclick',function(e){e.stopPropagation()});
    document.documentElement.appendChild(box);
  };
  mk();
  if(!window.__xynWinObs){
    window.__xynWinObs=true;
    new MutationObserver(mk).observe(document.documentElement,{childList:true});
    window.xynapseWin.onState(function(m){var b=document.getElementById('xyn-winctl');if(b)b.classList.toggle('max',m)});
  }
  window.xynapseWin.isMaximized().then(function(m){var b=document.getElementById('xyn-winctl');if(b)b.classList.toggle('max',m)});
}catch(e){}})()`;

function injectWindowControls() {
  if (!CUSTOM_FRAME) return;
  const wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
  if (!wc || wc.isDestroyed()) return;
  const url = wc.getURL();
  if (!(isInternal(url) || url.startsWith('file://'))) return;
  wc.executeJavaScript(WINDOW_CONTROLS_JS).catch(() => { /* page navigated away */ });
}

function registerWindowIpc() {
  const fromMain = (event) => Boolean(mainWindow && !mainWindow.isDestroyed() && (event.sender === mainWindow.webContents || (settingsView && event.sender === settingsView.webContents)));
  ipcMain.on('win:minimize', (event) => { if (fromMain(event)) mainWindow.minimize(); });
  ipcMain.on('win:toggle-maximize', (event) => {
    if (!fromMain(event)) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  });
  ipcMain.on('win:close', (event) => { if (fromMain(event)) mainWindow.close(); });
  ipcMain.handle('win:is-maximized', (event) => (fromMain(event) ? mainWindow.isMaximized() : false));
}
function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { mainWindow.webContents.send('win:state', mainWindow.isMaximized()); } catch { /* ignore */ }
  try { if (settingsView && !settingsView.webContents.isDestroyed()) settingsView.webContents.send('win:state', mainWindow.isMaximized()); } catch { /* ignore */ }
}

const OVERLAY_FILE = path.join(__dirname, 'overlay.html');
const OVERLAY_FILE_URL = pathToFileURL(OVERLAY_FILE).href;
const OVERLAY_W = 700;
const OVERLAY_MIN_H = 74;
const OVERLAY_MAX_H = 620;
let tray = null;
let overlay = null;
let overlayStream = null;
let overlayHiddenAt = 0;
let isQuitting = false;

const findIcon = () => [
  path.join(__dirname, 'build', 'icon.png'),
  path.join(__dirname, '..', 'src', 'Assets', 'xynapse-app-icon.png'),
].find((p) => fs.existsSync(p));

function openMainWindow() {
  hideOverlay();
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else focusWindow();
}

function overlayTheme() {
  const t = themes.THEMES.find((x) => x.id === settings.theme) || themes.THEMES[0];
  return { v: settings.accent || t.v, c: t.c };
}

function createOverlay() {
  if (overlay && !overlay.isDestroyed()) return;
  overlay = new BrowserWindow({
    width: OVERLAY_W,
    height: OVERLAY_MIN_H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    title: 'Xynapse quick chat',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  const wc = overlay.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  overlay.on('blur', hideOverlay);
  overlay.on('closed', () => { overlay = null; });
  overlay.loadFile(OVERLAY_FILE);
}

function showOverlay() {
  if (!overlay || overlay.isDestroyed()) createOverlay();
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const { height } = overlay.getBounds();
  overlay.setBounds({
    x: Math.round(area.x + (area.width - OVERLAY_W) / 2),
    y: Math.round(area.y + area.height * 0.16),
    width: OVERLAY_W,
    height,
  });
  overlay.webContents.send('overlay:show', overlayTheme());
  overlay.show();
  overlay.focus();
}

function hideOverlay() {
  if (overlay && !overlay.isDestroyed() && overlay.isVisible()) {
    overlayHiddenAt = Date.now();
    overlay.hide();
  }
}

function toggleOverlay() {
  if (overlay && !overlay.isDestroyed() && overlay.isVisible()) return hideOverlay();
  // Clicking the tray icon blurs the overlay first (which hides it); do not instantly reopen it for that same click.
  if (Date.now() - overlayHiddenAt < 250) return;
  showOverlay();
}

function createTray() {
  const iconPath = findIcon();
  if (!iconPath) return;
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) return;
  image = image.resize({ width: 32, height: 32, quality: 'best' });
  tray = new Tray(image);
  tray.setToolTip('Xynapse');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Xynapse', click: openMainWindow },
    { label: 'Quick chat', accelerator: 'CommandOrControl+Shift+Space', click: showOverlay },
    { type: 'separator' },
    { label: 'Quit Xynapse', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', toggleOverlay);
  tray.on('double-click', openMainWindow);
}

// Streams a chat reply from the Xynapse backend (main process, so the app's session cookie is used).
async function streamChat(messages, emit, signal) {
  const res = await fetch(ORIGIN + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': CHROME_UA, Accept: 'text/event-stream', Cookie: await cookieHeader() },
    body: JSON.stringify({ messages, model: 'fast', searchMode: 'auto' }),
    signal,
  });
  await storeSetCookies(res);
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    const auth = res.status === 401;
    emit({ type: 'error', code: auth ? 'auth' : undefined, message: auth ? 'Sign in to Xynapse to use quick chat.' : (data?.error?.message || `Server returned ${res.status}`) });
    return;
  }
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (['status', 'thought', 'delta', 'error'].includes(ev.type)) emit(ev);
      }
    }
  }
}

async function runOverlayChat(id, raw) {
  const messages = (Array.isArray(raw) ? raw : []).slice(-30)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') return;
  if (overlayStream) overlayStream.abort();
  const ctrl = new AbortController();
  overlayStream = ctrl;
  const emit = (ev) => { if (overlay && !overlay.isDestroyed()) overlay.webContents.send('overlay:event', { ...ev, id }); };
  try {
    await streamChat(messages, emit, ctrl.signal);
  } catch (e) {
    if (e && e.name !== 'AbortError') emit({ type: 'error', message: NO_CONNECTION });
  } finally {
    if (overlayStream === ctrl) overlayStream = null;
    emit({ type: 'end' });
  }
}

function registerOverlayIpc() {
  const fromOverlay = (event) => {
    const url = event.senderFrame && event.senderFrame.url;
    return typeof url === 'string' && url.startsWith(OVERLAY_FILE_URL);
  };
  ipcMain.on('overlay:send', (event, id, messages) => { if (fromOverlay(event) && Number.isFinite(id)) runOverlayChat(id, messages); });
  ipcMain.on('overlay:cancel', (event) => { if (fromOverlay(event) && overlayStream) overlayStream.abort(); });
  ipcMain.on('overlay:hide', (event) => { if (fromOverlay(event)) hideOverlay(); });
  ipcMain.on('overlay:open-app', (event) => { if (fromOverlay(event)) openMainWindow(); });
  ipcMain.on('overlay:resize', (event, height) => {
    if (!fromOverlay(event) || !overlay || overlay.isDestroyed() || !Number.isFinite(height)) return;
    const h = Math.round(Math.min(OVERLAY_MAX_H, Math.max(OVERLAY_MIN_H, height)));
    const b = overlay.getBounds();
    if (b.height !== h) overlay.setBounds({ x: b.x, y: b.y, width: OVERLAY_W, height: h });
  });
}

// ---- window ---------------------------------------------------------------
function createWindow() {
  const st = loadState();
  // build/icon.png is copied from src/Assets by scripts/sync-icon.js; fall back to the website asset in dev.
  const iconCandidates = [
    path.join(__dirname, 'build', 'icon.png'),
    path.join(__dirname, '..', 'src', 'Assets', 'xynapse-app-icon.png'),
  ];
  const iconPath = iconCandidates.find((p) => fs.existsSync(p));

  mainWindow = new BrowserWindow({
    width: st.bounds?.width || 1280,
    height: st.bounds?.height || 820,
    x: st.bounds?.x,
    y: st.bounds?.y,
    minWidth: 420,
    minHeight: 600,
    title: 'Xynapse',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    ...(CUSTOM_FRAME ? { titleBarStyle: 'hidden' } : {}),
    show: false,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  if (st.maximized) {
    // maximize() would also show the window, so a hidden (login) start waits until the window is first shown
    if (START_HIDDEN) mainWindow.once('show', () => mainWindow.maximize());
    else mainWindow.maximize();
  }
  mainWindow.once('ready-to-show', () => { if (!stayHidden()) mainWindow.show(); });
  setTimeout(() => { if (mainWindow && !mainWindow.isVisible() && !stayHidden()) mainWindow.show(); }, 1500);
  mainWindow.webContents.setUserAgent(CHROME_UA);
  applyWindowSettings();

  // keep the app title instead of the page title
  mainWindow.on('page-title-updated', (e) => e.preventDefault());

  // theme + zoom + shortcuts
  mainWindow.webContents.on('dom-ready', () => { chatCssKey = null; applyZoom(); injectChatCss(); injectWindowControls(); });
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) mainWindow.on(ev, sendWindowState);
  mainWindow.webContents.on('before-input-event', handleShortcut);
  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) mainWindow.on(ev, layoutSettings);

  // external links -> system browser, internal ones stay in the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isLandingUrl(url)) { routeLanding(); return { action: 'deny' }; }
    if (isInternal(url)) return { action: 'allow' };
    safeOpenExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (isLandingUrl(url)) { e.preventDefault(); routeLanding(); return; }
    if (!isInternal(url) && !url.startsWith('file://')) {
      e.preventDefault();
      safeOpenExternal(url);
    }
  });
  // e.g. /chat -> 302 /auth.html when the session has expired
  mainWindow.webContents.on('will-redirect', (e, url) => {
    if (isLandingUrl(url)) { e.preventDefault(); routeLanding(); }
  });
  mainWindow.webContents.on('did-navigate', (_e, url) => {
    if (isLandingUrl(url)) routeLanding();
  });

  // no internet / server down -> friendly offline page with retry
  mainWindow.webContents.on('did-fail-load', (_e, code, _desc, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted */) return;
    if (failedUrl && failedUrl.startsWith('file://')) return;
    mainWindow.loadFile(OFFLINE_FILE, { query: { url: START_URL } });
  });

  mainWindow.on('close', (e) => {
    saveState(mainWindow);
    // Closing the window keeps Xynapse running in the tray (quick chat stays available). Quit from the tray menu.
    if (!isQuitting && tray && settings.closeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { settingsView = null; mainWindow = null; });

  // First screen: the chat if already signed in, otherwise the login page.
  bootRoute().then(show);
}

if (gotLock) {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    nativeTheme.themeSource = 'dark'; // dark context menus and dialogs to match the app
    loadSettings();

    // Only allow the permissions a chat app plausibly needs.
    const allowed = new Set(['clipboard-sanitized-write', 'clipboard-read', 'media', 'notifications', 'fullscreen']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));

    registerIpc();
    registerWindowIpc();
    initMcp();
    registerOverlayIpc();
    createWindow();
    createTray();
    createOverlay();
    try { globalShortcut.register('CommandOrControl+Shift+Space', toggleOverlay); } catch { /* shortcut taken by another app */ }
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on('before-quit', () => { isQuitting = true; if (mcp) mcp.stopAll(); });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch { /* ignore */ } });
app.on('window-all-closed', () => app.quit());
