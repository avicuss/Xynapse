'use strict';
// MCP (Model Context Protocol) support for Xynapse Desktop.
//
//  - McpClient   : talks to ONE MCP server over stdio (newline-delimited JSON-RPC). No dependencies.
//  - McpManager  : stores the connections (userData/mcp.json), starts/stops them and decides,
//                  for every tool call, whether it is allowed (permission system).
//
// Permission model
//   connection policy : 'ask'      ask before every tool call
//                       'readonly' tools marked read-only run automatically, everything else asks
//                       'always'   everything runs without asking
//                       'never'    everything is blocked
//   per-tool override : 'ask' | 'always' | 'never'  (beats the connection policy)
//   "Always allow this tool" in the permission dialog simply stores a per-tool 'always'.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IS_WIN = process.platform === 'win32';
const PROTOCOL_VERSION = '2025-06-18';
const START_TIMEOUT_MS = 120000; // the first `npx` run may have to download the server
const LIST_TIMEOUT_MS = 30000;
const CALL_TIMEOUT_MS = 120000;
const MAX_BUFFER = 16 * 1024 * 1024;
const MAX_RESULT_CHARS = 200000;
const MAX_SERVERS = 20;
const FOLDER_PACKAGE = '@modelcontextprotocol/server-filesystem';

const POLICIES = ['ask', 'readonly', 'always', 'never'];
const TOOL_POLICIES = ['ask', 'always', 'never'];

// ---- validation -------------------------------------------------------------
const clip = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// cmd.exe expands %VAR% even inside quotes and we always pass quotes through, so those are refused on Windows.
const badText = (s) => /[\0\r\n]/.test(s) || (IS_WIN && /["%]/.test(s));

function cleanToolPolicies(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (n >= 500) break;
    if (typeof k === 'string' && k.length > 0 && k.length <= 200 && TOOL_POLICIES.includes(v)) { out[k] = v; n++; }
  }
  return out;
}

// Returns { server } or { error }. `existing` = the stored server being edited (keeps id / type / tool overrides).
function sanitizeServer(input, existing, checkPaths) {
  const p = input && typeof input === 'object' ? input : {};
  const type = existing ? existing.type : (p.type === 'custom' ? 'custom' : 'folder');
  const server = {
    id: existing ? existing.id : (typeof p.id === 'string' && /^[a-f0-9]{12}$/.test(p.id) ? p.id : crypto.randomBytes(6).toString('hex')),
    type,
    name: clip(p.name, 60) || (existing ? existing.name : (type === 'folder' ? 'Local folder' : 'Custom server')),
    enabled: typeof p.enabled === 'boolean' ? p.enabled : (existing ? existing.enabled : true),
    policy: POLICIES.includes(p.policy) ? p.policy : (existing ? existing.policy : (type === 'folder' ? 'readonly' : 'ask')),
    toolPolicies: cleanToolPolicies(existing ? existing.toolPolicies : p.toolPolicies),
    paths: [],
    command: '',
    args: [],
    env: {},
  };

  if (type === 'folder') {
    const src = Array.isArray(p.paths) ? p.paths : (existing ? existing.paths : []);
    const seen = new Set();
    for (const raw of src) {
      if (typeof raw !== 'string') continue;
      let v = raw.trim();
      if (!v) continue;
      if (v.length > 500 || badText(v)) return { error: 'A folder path contains characters that are not allowed (such as % or quotes).' };
      if (!path.isAbsolute(v)) return { error: '"' + v + '" is not a full path. Use something like C:\\Users\\you\\Documents.' };
      v = path.normalize(v);
      if (v.length > 3 && /[\\/]$/.test(v)) v = v.replace(/[\\/]+$/, '');
      if (checkPaths) {
        try {
          if (!fs.statSync(v).isDirectory()) return { error: '"' + v + '" is not a folder.' };
        } catch {
          return { error: 'Folder not found: ' + v };
        }
      }
      if (!seen.has(v)) { seen.add(v); server.paths.push(v); }
    }
    if (!server.paths.length) return { error: 'Add at least one folder.' };
    if (server.paths.length > 10) return { error: 'A connection can share up to 10 folders.' };
    return { server };
  }

  const command = clip(p.command !== undefined ? p.command : (existing && existing.command), 300);
  if (!command) return { error: 'Enter the command that starts the server (for example npx or node).' };
  if (badText(command)) return { error: 'The command contains characters that are not allowed.' };
  server.command = command;

  const argsIn = Array.isArray(p.args) ? p.args : (existing ? existing.args : []);
  for (const a of argsIn) {
    if (typeof a !== 'string' || a === '') continue;
    if (a.length > 1000 || badText(a)) return { error: 'An argument contains characters that are not allowed (such as % or quotes).' };
    server.args.push(a);
  }
  if (server.args.length > 50) return { error: 'Too many arguments (max 50).' };

  const envIn = p.env && typeof p.env === 'object' ? p.env : (existing ? existing.env : {});
  for (const [k, v] of Object.entries(envIn || {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) return { error: 'Invalid environment variable name: ' + k };
    if (typeof v !== 'string' || v.length > 2000 || v.includes('\0')) return { error: 'Invalid value for ' + k + '.' };
    server.env[k] = v;
  }
  if (Object.keys(server.env).length > 30) return { error: 'Too many environment variables (max 30).' };
  return { server };
}

// What actually gets started for a stored connection.
function launchSpec(s) {
  if (s.type === 'folder') return { command: 'npx', args: ['-y', FOLDER_PACKAGE, ...s.paths], env: {} };
  return { command: s.command, args: s.args, env: s.env };
}

// ---- process helpers --------------------------------------------------------
// MSVCRT-style quoting for the single command line that cmd.exe receives.
function quoteWin(arg) {
  if (arg !== '' && /^[A-Za-z0-9_\-.,:@=+\\/]+$/.test(arg) && !/\\$/.test(arg)) return arg;
  const trailing = arg.match(/\\+$/); // a backslash right before the closing quote would escape it
  return '"' + (trailing ? arg + trailing[0] : arg) + '"';
}

function spawnServer(spec) {
  const env = { ...process.env, ...spec.env };
  if (IS_WIN) {
    // shell: true so that npx.cmd / .bat launchers work; every part is quoted above.
    const line = [spec.command, ...spec.args].map(quoteWin).join(' ');
    return spawn(line, { shell: true, windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] });
  }
  return spawn(spec.command, spec.args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
}

function killTree(child) {
  try {
    if (IS_WIN && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill();
  } catch { /* already gone */ }
}

function limitResult(r) {
  const out = r && typeof r === 'object' ? { ...r } : { content: [] };
  if (!Array.isArray(out.content)) out.content = [];
  let budget = MAX_RESULT_CHARS;
  out.content = out.content.map((c) => {
    if (c && c.type === 'text' && typeof c.text === 'string') {
      const text = c.text.length > budget ? c.text.slice(0, Math.max(0, budget)) + '\n…[truncated]' : c.text;
      budget -= c.text.length;
      return { ...c, text };
    }
    if (c && typeof c.data === 'string' && c.data.length > 5 * 1024 * 1024) return { type: 'text', text: '[binary content omitted: too large]' };
    return c;
  });
  return out;
}

// ---- one MCP server over stdio ---------------------------------------------
class McpClient {
  constructor(spec, hooks) {
    this.spec = spec;
    this.hooks = hooks || {};
    this.status = 'stopped'; // stopped | starting | ready | error
    this.error = '';
    this.tools = [];
    this.serverInfo = null;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buf = '';
    this.stderrTail = '';
  }

  _changed() { try { if (this.hooks.onChange) this.hooks.onChange(); } catch { /* ignore */ } }

  async start() {
    this.status = 'starting';
    this.error = '';
    this._changed();
    let child;
    try {
      child = spawnServer(this.spec);
    } catch (e) {
      this._fail('Could not start: ' + e.message);
      return;
    }
    this.child = child;
    child.on('error', (e) => this._fail('Could not start: ' + e.message));
    child.on('exit', (code, signal) => {
      if (this.child !== child || this.status === 'stopped') return;
      const tail = this.stderrTail.trim();
      this._fail('The server stopped (' + (code !== null ? 'exit code ' + code : signal) + ').' + (tail ? '\n' + tail : ''));
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => this._onData(d));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { this.stderrTail = (this.stderrTail + d).slice(-1500); });
    child.stdin.on('error', () => { /* server closed its input */ });

    try {
      const init = await this._request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'xynapse-desktop', version: this.hooks.appVersion || '1.0.0' },
      }, START_TIMEOUT_MS);
      this.serverInfo = (init && init.serverInfo) || null;
      this._send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      await this._listTools();
      if (this.status === 'starting') { this.status = 'ready'; this._changed(); }
    } catch (e) {
      const tail = this.stderrTail.trim();
      this._fail(e.message + (tail ? '\n' + tail : ''));
    }
  }

  stop() {
    this.status = 'stopped';
    this._rejectAll(new Error('The connection was closed.'));
    this._kill();
    this._changed();
  }

  async call(name, args) {
    if (this.status !== 'ready') throw new Error('The connection is not ready.');
    const r = await this._request('tools/call', { name, arguments: args || {} }, CALL_TIMEOUT_MS);
    return limitResult(r);
  }

  async _listTools() {
    const tools = [];
    let cursor;
    for (let page = 0; page < 20; page++) {
      const r = await this._request('tools/list', cursor ? { cursor } : {}, LIST_TIMEOUT_MS);
      for (const t of (r && r.tools) || []) {
        if (!t || typeof t.name !== 'string') continue;
        tools.push({
          name: t.name,
          description: typeof t.description === 'string' ? t.description : '',
          inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} },
          annotations: t.annotations && typeof t.annotations === 'object' ? t.annotations : {},
        });
      }
      cursor = r && r.nextCursor;
      if (!cursor) break;
    }
    this.tools = tools;
  }

  _fail(message) {
    if (this.status === 'error' || this.status === 'stopped') return;
    this.status = 'error';
    this.error = String(message).slice(0, 1500);
    this._rejectAll(new Error(this.error));
    this._kill();
    this._changed();
  }

  _kill() {
    const c = this.child;
    this.child = null;
    if (c) killTree(c);
  }

  _rejectAll(err) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }

  _send(obj) {
    try { if (this.child) this.child.stdin.write(JSON.stringify(obj) + '\n'); } catch { /* ignore */ }
  }

  _request(method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!this.child) { reject(new Error('The server is not running.')); return; }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The server did not answer in time (' + method + ').'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  _onData(chunk) {
    this.buf += chunk;
    if (this.buf.length > MAX_BUFFER) { this._fail('The server sent a message that is too large.'); return; }
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (line) this._onMessage(line);
    }
  }

  _onMessage(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; } // stray log line on stdout
    if (!msg || typeof msg !== 'object') return;
    if (msg.method) {
      if (msg.id !== undefined) { // a request from the server
        if (msg.method === 'ping') this._send({ jsonrpc: '2.0', id: msg.id, result: {} });
        else this._send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Not supported by Xynapse Desktop' } });
      } else if (msg.method === 'notifications/tools/list_changed') {
        this._listTools().then(() => this._changed()).catch(() => { /* keep old list */ });
      }
      return;
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message || 'MCP error'));
      else p.resolve(msg.result);
    }
  }
}

// ---- connections + permissions ----------------------------------------------
class McpManager {
  // opts: { file, ask(request) -> 'once' | 'always' | 'deny', onChange(), appVersion }
  constructor(opts) {
    this.file = opts.file;
    this.ask = opts.ask;
    this.onChange = opts.onChange || (() => {});
    this.appVersion = opts.appVersion || '1.0.0';
    this.clients = new Map();
    this.activity = [];
    this.askChain = Promise.resolve(); // permission dialogs are shown one at a time
    this.config = { servers: [] };
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const list = Array.isArray(raw && raw.servers) ? raw.servers : [];
      for (const item of list.slice(0, MAX_SERVERS)) {
        const r = sanitizeServer(item, null, false); // folders may be offline right now; that is shown as a start error
        if (r.server) this.config.servers.push(r.server);
      }
    } catch { /* first run or unreadable file */ }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.config, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch { /* keep working in memory */ }
  }

  find(id) { return this.config.servers.find((s) => s.id === id) || null; }

  _log(server, tool, decision, ok) {
    this.activity.push({ t: Date.now(), server: server.name, tool, decision, ok });
    if (this.activity.length > 50) this.activity.shift();
    this.onChange();
  }

  // What the settings page sees.
  state() {
    return {
      servers: this.config.servers.map((s) => {
        const c = this.clients.get(s.id);
        return {
          id: s.id, type: s.type, name: s.name, enabled: s.enabled, policy: s.policy,
          paths: s.paths, command: s.command, args: s.args, env: s.env,
          toolPolicies: s.toolPolicies,
          status: !s.enabled ? 'off' : (c ? c.status : 'stopped'),
          error: c ? c.error : '',
          tools: (c ? c.tools : []).map((t) => ({
            name: t.name,
            description: (t.description || '').slice(0, 300),
            readOnly: t.annotations.readOnlyHint === true,
            destructive: t.annotations.destructiveHint === true,
          })),
        };
      }),
      activity: this.activity.slice().reverse().slice(0, 20),
    };
  }

  // ---- managing connections ----
  async save(input) {
    const existing = input && typeof input.id === 'string' ? this.find(input.id) : null;
    if (!existing && this.config.servers.length >= MAX_SERVERS) return { ok: false, error: 'Too many connections.' };
    const r = sanitizeServer(input, existing, true);
    if (r.error) return { ok: false, error: r.error };
    if (existing) Object.assign(existing, r.server);
    else this.config.servers.push(r.server);
    this._save();
    this.restart(r.server.id); // not awaited: the first npx run can take a while
    this.onChange();
    return { ok: true, id: r.server.id };
  }

  remove(id) {
    this._stopClient(id);
    this.config.servers = this.config.servers.filter((s) => s.id !== id);
    this._save();
    this.onChange();
  }

  setEnabled(id, enabled) {
    const s = this.find(id);
    if (!s) return;
    s.enabled = !!enabled;
    this._save();
    if (s.enabled) this.restart(id); else this._stopClient(id);
    this.onChange();
  }

  setPolicy(id, policy) {
    const s = this.find(id);
    if (!s || !POLICIES.includes(policy)) return;
    s.policy = policy;
    this._save();
    this.onChange();
  }

  setToolPolicy(id, tool, policy) {
    const s = this.find(id);
    if (!s || typeof tool !== 'string' || !tool || tool.length > 200) return;
    if (policy === 'default') delete s.toolPolicies[tool];
    else if (TOOL_POLICIES.includes(policy)) s.toolPolicies[tool] = policy;
    else return;
    this._save();
    this.onChange();
  }

  resetApprovals() {
    for (const s of this.config.servers) {
      for (const [k, v] of Object.entries(s.toolPolicies)) if (v === 'always') delete s.toolPolicies[k];
    }
    this._save();
    this.onChange();
  }

  // ---- running ----
  _stopClient(id) {
    const c = this.clients.get(id);
    if (c) { c.stop(); this.clients.delete(id); }
  }

  async restart(id) {
    this._stopClient(id);
    const s = this.find(id);
    if (!s || !s.enabled) { this.onChange(); return; }
    const client = new McpClient(launchSpec(s), { onChange: this.onChange, appVersion: this.appVersion });
    this.clients.set(id, client);
    await client.start();
  }

  startAll() { for (const s of this.config.servers) if (s.enabled) this.restart(s.id); }
  stopAll() { for (const id of [...this.clients.keys()]) this._stopClient(id); }

  // ---- permissions ----
  // -> 'allow' | 'ask' | 'deny'
  _decide(server, tool) {
    const override = server.toolPolicies[tool.name];
    if (override === 'never') return 'deny';
    if (override === 'always') return 'allow';
    if (override === 'ask') return 'ask';
    if (server.policy === 'never') return 'deny';
    if (server.policy === 'always') return 'allow';
    if (server.policy === 'readonly') return tool.annotations && tool.annotations.readOnlyHint === true ? 'allow' : 'ask';
    return 'ask';
  }

  // Tools the chat may offer to the model (blocked tools are left out).
  allTools() {
    const out = [];
    for (const s of this.config.servers) {
      const c = this.clients.get(s.id);
      if (!s.enabled || !c || c.status !== 'ready') continue;
      for (const t of c.tools) {
        if (this._decide(s, t) === 'deny') continue;
        out.push({
          server: s.id,
          serverName: s.name,
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          readOnly: t.annotations.readOnlyHint === true,
        });
      }
    }
    return out;
  }

  async callTool(serverId, toolName, args) {
    const s = this.find(serverId);
    const c = s && this.clients.get(s.id);
    if (!s || !s.enabled || !c || c.status !== 'ready') return { ok: false, error: 'That connection is not available.' };
    const tool = c.tools.find((t) => t.name === toolName);
    if (!tool) return { ok: false, error: 'Unknown tool.' };
    let safeArgs = {};
    if (args !== undefined && args !== null) {
      if (typeof args !== 'object' || Array.isArray(args)) return { ok: false, error: 'Tool arguments must be an object.' };
      try { if (JSON.stringify(args).length > 1000000) return { ok: false, error: 'Tool arguments are too large.' }; } catch { return { ok: false, error: 'Invalid tool arguments.' }; }
      safeArgs = args;
    }

    const decision = this._decide(s, tool);
    let how = 'auto';
    if (decision === 'deny') {
      this._log(s, toolName, 'blocked', null);
      return { ok: false, denied: true, error: 'This tool is blocked in Xynapse settings.' };
    }
    if (decision === 'ask') {
      const answer = await this._askUser({ serverName: s.name, toolName, description: tool.description, args: safeArgs });
      if (answer === 'always') { s.toolPolicies[toolName] = 'always'; this._save(); how = 'always'; }
      else if (answer === 'once') how = 'once';
      else {
        this._log(s, toolName, 'denied', null);
        return { ok: false, denied: true, error: 'The user did not allow this tool call.' };
      }
    }

    try {
      const result = await c.call(toolName, safeArgs);
      this._log(s, toolName, how, !result.isError);
      return { ok: true, result };
    } catch (e) {
      this._log(s, toolName, how, false);
      return { ok: false, error: e.message };
    }
  }

  _askUser(request) {
    const run = () => Promise.resolve().then(() => this.ask(request)).catch(() => 'deny');
    const next = this.askChain.then(run, run);
    this.askChain = next.catch(() => {});
    return next;
  }
}

module.exports = { McpManager, McpClient, _internal: { sanitizeServer, quoteWin, launchSpec } };
