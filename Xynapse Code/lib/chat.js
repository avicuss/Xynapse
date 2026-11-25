'use strict';
// Chat with Xynapse from the terminal: sign-in, streaming replies, model / search switching.
// Talks to the same backend as the website (POST /api/chat, server-sent events).

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MODELS = ['fast', 'pro', 'apex', 'supervl', 'code'];
const SEARCH_MODES = ['auto', 'on', 'off'];

module.exports = function createChat(ui) {
  const { acc, acc2, dim, bold, red, green, gradient, config, saveConfig, configDir } = ui;
  const SESSION_FILE = path.join(configDir, 'session.json');
  const baseUrl = () => String(process.env.XYNAPSE_URL || 'https://xynapse.eu').replace(/\/+$/, '');

  // ---- session (the same cookie the website uses) ----------------------------
  let session = { cookies: {}, user: null };
  function loadSession() {
    try {
      const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      if (s && s.server === baseUrl() && s.cookies && typeof s.cookies === 'object') session = { cookies: s.cookies, user: s.user || null };
    } catch { /* not signed in yet */ }
  }
  function saveSession() {
    try {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(SESSION_FILE, JSON.stringify({ server: baseUrl(), cookies: session.cookies, user: session.user }), { mode: 0o600 });
    } catch { /* ignore */ }
  }
  function clearSession() {
    session = { cookies: {}, user: null };
    try { fs.unlinkSync(SESSION_FILE); } catch { /* ignore */ }
  }
  const signedIn = () => Object.keys(session.cookies).length > 0;
  const cookieHeader = () => Object.entries(session.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const displayName = (u) => (u && (u.username || u.email)) || 'you';

  function storeCookies(res) {
    let list = [];
    if (typeof res.headers.getSetCookie === 'function') list = res.headers.getSetCookie();
    else {
      const raw = res.headers.get('set-cookie');
      if (raw) list = raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
    }
    let changed = false;
    for (const raw of list) {
      const first = raw.split(';')[0];
      const i = first.indexOf('=');
      if (i <= 0) continue;
      const name = first.slice(0, i).trim();
      const value = first.slice(i + 1).trim();
      const maxAge = /max-age=(-?\d+)/i.exec(raw);
      if (!value || (maxAge && Number(maxAge[1]) <= 0)) delete session.cookies[name];
      else session.cookies[name] = value;
      changed = true;
    }
    if (changed) saveSession();
  }

  const headers = (extra) => ({ 'Content-Type': 'application/json', 'User-Agent': `XynapseCode/${ui.version}`, Cookie: cookieHeader(), ...extra });

  async function api(pathname, { method = 'GET', body, timeoutMs = 15000 } = {}) {
    const res = await fetch(baseUrl() + pathname, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    storeCookies(res);
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    return { ok: res.ok, status: res.status, data };
  }

  // { user } when signed in, { user: null } when not, { user: null, offline: true } when the server is unreachable.
  async function refreshUser() {
    if (!signedIn()) return { user: null };
    try {
      const r = await api('/api/auth/me', { timeoutMs: 2500 });
      if (r.ok && r.data && r.data.user) { session.user = r.data.user; saveSession(); return { user: session.user }; }
      if (r.ok) { clearSession(); return { user: null }; }
      return { user: session.user, offline: r.status >= 500 };
    } catch {
      return { user: session.user, offline: true };
    }
  }

  // ---- small UI pieces -----------------------------------------------------------
  function question(label, hidden) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      let muted = false;
      const original = rl._writeToOutput;
      rl._writeToOutput = function (s) {
        if (hidden && muted) { if (/[\r\n]/.test(s)) process.stdout.write('\n'); return; }
        original.call(rl, s);
      };
      rl.on('SIGINT', () => { rl.close(); resolve(null); });
      rl.question(label, (answer) => { rl.close(); resolve(answer); });
      muted = true;
    });
  }

  function spinner(label) {
    if (!process.stdout.isTTY) return { text() {}, stop() {} };
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0, text = label, active = true;
    const draw = () => process.stdout.write('\r\x1b[K  ' + acc(frames[i++ % frames.length]) + ' ' + dim(text));
    draw();
    const timer = setInterval(draw, 80);
    return {
      text(s) { text = String(s || '').replace(/\s+/g, ' ').slice(0, 70); },
      stop() { if (!active) return; active = false; clearInterval(timer); process.stdout.write('\r\x1b[K'); },
    };
  }

  // Prints markdown a line at a time: headings, bullets, **bold**, `code` and fenced code blocks.
  function lineFormatter() {
    let buf = '', inCode = false;
    const out = (line) => {
      if (/^\s*```/.test(line)) {
        inCode = !inCode;
        const lang = line.replace(/^\s*```/, '').trim();
        console.log('  ' + dim(inCode ? '╭─ ' + (lang || 'code') : '╰─'));
        return;
      }
      if (inCode) { console.log('  ' + dim('│ ') + acc2(line)); return; }
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      if (h) { console.log('  ' + bold(gradient(h[1]))); return; }
      line = line
        .replace(/^(\s*)[-*]\s+/, (_, sp) => sp + acc('• '))
        .replace(/\*\*(.+?)\*\*/g, (_, t) => bold(t))
        .replace(/`([^`]+)`/g, (_, t) => acc2(t));
      console.log('  ' + line);
    };
    return {
      write(s) {
        buf += s;
        let i;
        while ((i = buf.indexOf('\n')) !== -1) { out(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
      },
      end() { if (buf) out(buf); buf = ''; },
    };
  }

  // ---- chat ------------------------------------------------------------------
  const state = { messages: [] };
  let activeAbort = null;
  const abortActive = () => { if (activeAbort) { activeAbort.abort(); return true; } return false; };

  async function send(text) {
    text = String(text || '').trim();
    if (!text) { console.log(dim('  Type a question after ?, or use /chat to talk in chat mode.')); return 1; }
    if (!signedIn()) { console.log(red('  You are not signed in. Type /login first.')); return 1; }

    state.messages.push({ role: 'user', content: text });
    const ctrl = new AbortController();
    activeAbort = ctrl;
    const spin = spinner('Thinking…');
    const fmt = lineFormatter();
    let answer = '', started = false, failure = null, tokens = null, sources = [], files = 0;

    const onEvent = (ev) => {
      switch (ev.type) {
        case 'status': case 'thought': spin.text(ev.text); break;
        case 'tool': if (ev.status === 'running' || ev.status === 'preparing') spin.text(ev.label || `Running ${ev.name || 'tool'}…`); break;
        case 'delta':
          if (!started) { started = true; spin.stop(); console.log('\n  ' + bold(gradient('✦ Xynapse'))); }
          answer += ev.text;
          fmt.write(ev.text);
          break;
        case 'sources': sources = Array.isArray(ev.sources) ? ev.sources : []; break;
        case 'artifacts': files = Array.isArray(ev.files) ? ev.files.length : 0; break;
        case 'usage': if (typeof ev.tokens === 'number') tokens = ev.tokens; break;
        case 'error': failure = ev.message || 'Server error'; break;
        default: break;
      }
    };

    try {
      const res = await fetch(baseUrl() + '/api/chat', {
        method: 'POST',
        headers: headers({ Accept: 'text/event-stream' }),
        body: JSON.stringify({ messages: state.messages, model: config.model || 'fast', searchMode: config.search || 'auto' }),
        signal: ctrl.signal,
      });
      storeCookies(res);
      if (!res.ok) {
        let data = null;
        try { data = await res.json(); } catch { /* no body */ }
        failure = (data && data.error && data.error.message) || `Server returned ${res.status}`;
        if (res.status === 401) { clearSession(); failure = 'Your session expired. Type /login to sign in again.'; }
      } else {
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
              try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* ignore a broken event */ }
            }
          }
        }
      }
    } catch (e) {
      failure = e && e.name === 'AbortError' ? '__stopped' : ((e && e.message) || 'Connection lost');
    } finally {
      activeAbort = null;
      spin.stop();
      fmt.end();
    }

    if (failure) {
      state.messages.pop(); // the question was not answered, so it can be asked again
      if (failure === '__stopped') console.log(dim('\n  (stopped)'));
      else console.log('\n  ' + red(failure === 'fetch failed' ? 'No connection. Check your internet and try again.' : failure));
      return 1;
    }
    if (!answer.trim()) {
      state.messages.pop();
      console.log(red('  The reply came back empty. Try again.'));
      return 1;
    }
    state.messages.push({ role: 'assistant', content: answer });
    if (sources.length) {
      console.log('\n  ' + dim('Sources'));
      for (const s of sources.slice(0, 5)) console.log('  ' + dim('· ') + acc(String(s.title || s.url).slice(0, 70)) + dim('  ' + s.url));
    }
    if (files) console.log('\n  ' + dim(`${files} file${files === 1 ? '' : 's'} created - open this chat on xynapse.eu to download.`));
    console.log('\n  ' + dim(`${config.model || 'fast'}${tokens ? ' · ' + tokens + ' tokens' : ''}`));
    return 0;
  }

  // ---- commands -------------------------------------------------------------------
  function openBrowser(url) {
    try {
      const opts = { detached: true, stdio: 'ignore' };
      const child = process.platform === 'win32' ? spawn('rundll32', ['url.dll,FileProtocolHandler', url], opts)
        : process.platform === 'darwin' ? spawn('open', [url], opts)
          : spawn('xdg-open', [url], opts);
      child.on('error', () => { /* the link is printed anyway */ });
      child.unref();
    } catch { /* ignore */ }
  }

  // Google sign-in: the browser signs you in, then hands a one-time code to a tiny server on 127.0.0.1
  // (only this program knows the secret verifier, so the code is useless to anyone else).
  function loginGoogle() {
    return new Promise((resolve) => {
      const verifier = crypto.randomBytes(32).toString('hex');
      const challenge = crypto.createHash('sha256').update(verifier).digest('hex');
      let finished = false, timer = null;

      const finish = (ok, message) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        activeAbort = null;
        try { server.close(); } catch { /* ignore */ }
        if (ok) console.log('  ' + green('✓ ') + 'Signed in as ' + bold(acc2(displayName(session.user))));
        else if (message === 'cancelled') console.log(dim('\n  (cancelled)'));
        else console.log(red('  ' + message));
        resolve(ok ? 0 : 1);
      };

      const resultPage = (ok, message) => '<!doctype html><meta charset="utf-8"><title>Xynapse Code</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#000;color:#f4f4f6;font:16px system-ui,sans-serif;text-align:center"><div><h1 style="font-weight:600">' + (ok ? 'You are signed in' : 'Sign-in failed') + '</h1><p style="color:#9090a0">' + (ok ? 'Return to your terminal. You can close this tab.' : String(message).replace(/[<>&]/g, '')) + '</p></div>';

      const server = http.createServer(async (req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
        const code = u.searchParams.get('code') || '';
        let ok = false, message = 'Sign-in could not be completed.';
        try {
          const r = await api('/api/auth/desktop-exchange', { method: 'POST', body: { code, verifier }, timeoutMs: 20000 });
          if (r.ok && r.data && r.data.user) { session.user = r.data.user; saveSession(); ok = true; }
          else if (r.data && r.data.error && r.data.error.message) message = r.data.error.message;
        } catch { message = 'No connection to Xynapse.'; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
        res.end(resultPage(ok, message));
        finish(ok, message);
      });
      server.on('error', (e) => finish(false, 'Could not start the local sign-in listener: ' + e.message));

      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const next = `/api/auth/desktop-handoff?c=${challenge}&port=${port}`;
        const url = `${baseUrl()}/auth/google?next=${encodeURIComponent(next)}`;
        console.log(dim('  Opening your browser to sign in with Google...'));
        console.log(dim('  If it does not open, visit:\n  ') + acc(url));
        console.log(dim('  Waiting for you to finish in the browser (Ctrl+C to cancel).'));
        openBrowser(url);
        timer = setTimeout(() => finish(false, 'Timed out waiting for Google sign-in.'), 5 * 60 * 1000);
        activeAbort = { abort: () => finish(false, 'cancelled') };
      });
    });
  }

  async function login(how) {
    if (String(how || '').toLowerCase() === 'google') return loginGoogle();
    console.log(dim(`  Sign in to ${baseUrl()}`));
    const email = await question('  Email ' + dim('(press Enter to use Google)') + ': ', false);
    if (email === null) return 1;
    if (!email.trim()) return loginGoogle();
    const password = await question('  Password: ', true);
    if (!password) return 1;
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { email: email.trim(), password }, timeoutMs: 20000 });
      if (r.ok && r.data && r.data.user) {
        session.user = r.data.user;
        saveSession();
        console.log('  ' + green('✓ ') + 'Signed in as ' + bold(acc2(displayName(session.user))));
        return 0;
      }
      console.log(red('  ' + ((r.data && r.data.error && r.data.error.message) || 'Could not sign in.')));
      if (r.status === 401) console.log(dim('  Signed up with Google? Use /login google instead.'));
      return 1;
    } catch {
      console.log(red('  No connection. Check your internet and try again.'));
      return 1;
    }
  }

  async function logout() {
    if (signedIn()) { try { await api('/api/auth/logout', { method: 'POST', body: {}, timeoutMs: 5000 }); } catch { /* offline */ } }
    clearSession();
    state.messages = [];
    console.log('  ' + green('✓ ') + 'Signed out.');
    return 0;
  }

  async function whoami() {
    const r = await refreshUser();
    if (!r.user) { console.log(dim('  Not signed in. Type /login.')); return 0; }
    console.log('  ' + bold(acc2(displayName(r.user))) + (r.user.email ? dim('  ' + r.user.email) : '') + (r.offline ? red('  (offline)') : ''));
    return 0;
  }

  function pick(list, current) {
    return list.map((x) => (x === current ? bold(gradient('● ' + x)) : dim('○ ' + x))).join('   ');
  }

  async function command(name, rest) {
    const args = rest.split(/\s+/).filter(Boolean);
    switch (name) {
      case 'login': return login(rest);
      case 'logout': return logout();
      case 'whoami': return whoami();
      case 'new':
        state.messages = [];
        console.log('  ' + green('✓ ') + 'Started a new conversation.');
        return 0;
      case 'model': {
        const m = (args[0] || '').toLowerCase();
        if (!m) { console.log('  ' + pick(MODELS, config.model)); console.log(dim('  Use: /model <name>')); return 0; }
        if (!MODELS.includes(m)) { console.log(red(`  Unknown model "${m}". Options: ${MODELS.join(', ')}`)); return 1; }
        config.model = m;
        saveConfig();
        console.log('  ' + green('✓ ') + 'Model: ' + bold(m));
        return 0;
      }
      case 'search': {
        const s = (args[0] || '').toLowerCase();
        if (!s) { console.log('  ' + pick(SEARCH_MODES, config.search)); console.log(dim('  Use: /search <auto|on|off>')); return 0; }
        if (!SEARCH_MODES.includes(s)) { console.log(red('  Options: auto, on, off')); return 1; }
        config.search = s;
        saveConfig();
        console.log('  ' + green('✓ ') + 'Web search: ' + bold(s));
        return 0;
      }
      case 'ask': return send(rest);
      default: return 1;
    }
  }

  return { loadSession, refreshUser, command, send, abortActive, signedIn, displayName: () => displayName(session.user) };
};
