#!/usr/bin/env node
'use strict';
// Xynapse Code - a terminal CLI with a good-looking interface.
// No dependencies: only Node's built-in modules.

// Self-update hand-over: when a newer signed copy has been downloaded (see lib/updater.js), run that one instead.
if (require('../lib/updater').boot(__filename, require('../package.json').version)) return;

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const VERSION = require('../package.json').version;
const IS_WIN = process.platform === 'win32';
const updater = require('../lib/updater');
const SITE = () => String(process.env.XYNAPSE_URL || 'https://xynapse.eu').replace(/\/+$/, '');
let updateNotice = null; // set when a background check has downloaded a newer version

// ---- colors -----------------------------------------------------------------
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const esc = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = (s) => esc('1', s);
const dim = (s) => esc('2', s);
const red = (s) => esc('38;2;255;107;107', s);
const green = (s) => esc('38;2;120;220;150', s);
const rgb = (c, s) => esc(`38;2;${c[0]};${c[1]};${c[2]}`, s);
const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

const THEMES = {
  aurora: [[141, 147, 255], [110, 231, 239]],
  sunset: [[255, 138, 91], [255, 122, 168]],
  matrix: [[34, 197, 94], [190, 242, 100]],
  ocean: [[76, 194, 255], [94, 240, 208]],
  mono: [[255, 255, 255], [140, 140, 140]],
  nebula: [[76, 139, 245], [236, 102, 165]],
};

// ---- config (theme + history live in ~/.xynapse) ---------------------------
const CONFIG_DIR = path.join(os.homedir(), '.xynapse');
const CONFIG_FILE = path.join(CONFIG_DIR, 'code.json');
const HISTORY_FILE = path.join(CONFIG_DIR, 'code_history');
let config = { theme: 'aurora', model: 'fast', search: 'auto' };
try {
  const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  if (saved && THEMES[saved.theme]) config.theme = saved.theme;
  if (saved && ['fast', 'pro', 'apex', 'supervl', 'code'].includes(saved.model)) config.model = saved.model;
  if (saved && ['auto', 'on', 'off'].includes(saved.search)) config.search = saved.search;
} catch { /* first run */ }
const saveConfig = () => {
  try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch { /* ignore */ }
};

const stops = () => THEMES[config.theme];
const acc = (s) => rgb(stops()[0], s);
const acc2 = (s) => rgb(stops()[1], s);
const lerp = (a, b, t) => Math.round(a + (b - a) * t);
function gradient(text, from = stops()[0], to = stops()[1]) {
  if (!COLOR) return text;
  const chars = [...text];
  return chars.map((ch, i) => {
    if (ch === ' ') return ch;
    const t = chars.length > 1 ? i / (chars.length - 1) : 0;
    return rgb([lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)], ch);
  }).join('');
}

// ---- chat (sign-in + talking to Xynapse) ---------------------------------------
const chat = require('../lib/chat')({ acc, acc2, dim, bold, red, green, gradient, config, saveConfig, configDir: CONFIG_DIR, version: VERSION });
const authLine = (who) => (who && who.user
  ? green('● ') + dim('signed in as ') + acc2(chat.displayName()) + (who.offline ? red('  (offline)') : '')
  : who && who.offline ? red('○ ') + dim('offline')
    : dim('○ not signed in - type ') + acc('/login'));

// ---- banner -----------------------------------------------------------------
// Chunky pixel letters with a drop shadow, like the Gemini CLI logo. Every letter is a 5-row grid of pixels; a pixel is
// drawn two characters wide so it comes out square, and the shadow is the same shape shifted one pixel down and right.
const PIXEL_FONT = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["111", "010", "010", "010", "010", "010", "111"],
  J: ["0111", "0001", "0001", "0001", "0001", "1001", "0110"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],

  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["010", "110", "010", "010", "010", "010", "111"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],

  " ": ["000", "000", "000", "000", "000", "000", "000"],
  ".": ["00", "00", "00", "00", "00", "00", "11"],
  ",": ["00", "00", "00", "00", "00", "11", "10"],
  ":": ["00", "00", "11", "00", "00", "11", "00"],
  ";": ["00", "00", "11", "00", "00", "11", "10"],
  "!": ["1", "1", "1", "1", "1", "0", "1"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "'": ["1", "1", "0", "0", "0", "0", "0"],
  '"': ["101", "101", "000", "000", "000", "000", "000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "\\": ["10000", "01000", "01000", "00100", "00010", "00010", "00001"],
  "(": ["001", "010", "010", "010", "010", "010", "001"],
  ")": ["100", "010", "010", "010", "010", "010", "100"],
  "[": ["011", "010", "010", "010", "010", "010", "011"],
  "]": ["110", "010", "010", "010", "010", "010", "110"],
  "<": ["00001", "00010", "00100", "01000", "00100", "00010", "00001"],
  ">": ["10000", "01000", "00100", "00010", "00100", "01000", "10000"],
  "*": ["00000", "00100", "10101", "01110", "10101", "00100", "00000"],
  "#": ["01010", "01010", "11111", "01010", "11111", "01010", "01010"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "@": ["01110", "10001", "10111", "10101", "10111", "10000", "01110"],
  "|": ["1", "1", "1", "1", "1", "1", "1"],
  "█": ["11111", "10001", "10001", "10001", "10001", "10001", "11111"], // tofu
};
function pixelBanner(text, scale = 1, opts = {}) {
  const {
    tracking = 1,          // blank columns between glyphs
    shadow = true,       // down-right drop shadow
    shadowMix = 0.32,       // shadow brightness multiplier
    foldCase = true,       // lowercase -> uppercase
  } = opts;
  scale = Math.max(1, scale | 0 || 1);

  // 1. resolve glyphs (unknown char -> tofu box)
  const chars = [...String(text ?? "")];
  if (chars.length === 0) chars.push(" ");
  const glyphs = chars.map((ch) => {
    const k = foldCase ? ch.toUpperCase() : ch;
    return PIXEL_FONT[k] || PIXEL_FONT["█"];
  });

  // 2. measure
  const H = glyphs.reduce((n, g) => Math.max(n, g.length), 0);
  const W = glyphs.reduce((n, g) => n + g[0].length + tracking, -tracking);

  // 3. rasterize into (H+1)×(W+1) — extra row/col is the shadow gutter
  const lit = Array.from({ length: H + 1 }, () => new Uint8Array(W + 1));
  let x = 0;
  for (const g of glyphs) {
    for (let r = 0; r < g.length; r++) {
      const row = g[r];
      for (let c = 0; c < row.length; c++) {
        if (row.charCodeAt(c) === 49) lit[r][x + c] = 1; // '1'
      }
    }
    x += g[0].length + tracking;
  }

  // 4. pre-bake one colour per COLUMN, not per cell
  const [from, to] = stops();                    // ← was called W×H times before
  const run = "█".repeat(scale);
  const pad = " ".repeat(scale);
  const shade = "░".repeat(scale);
  const fg = new Array(W + 1);
  const bg = new Array(W + 1);
  for (let c = 0; c <= W; c++) {
    const t = W === 0 ? 0 : c / W;
    const base = [0, 1, 2].map((k) => lerp(from[k], to[k], t));
    fg[c] = rgb(base, run);
    bg[c] = COLOR ? rgb(base.map((v) => Math.round(v * shadowMix)), run) : shade;
  }

  // 5. emit
  const rows = [];
  for (let r = 0; r <= H; r++) {
    let line = "";
    for (let c = 0; c <= W; c++) {
      if (lit[r][c]) line += fg[c];
      else if (shadow && r > 0 && c > 0 && lit[r - 1][c - 1]) line += bg[c];
      else line += pad;
    }
    rows.push(line.replace(/ +$/, ""));
  }
  return { rows, width: (W + 1) * scale };
}

function box(lines) {
  const w = Math.max(...lines.map((l) => strip(l).length));
  const edge = (s) => acc(s);
  const out = [edge('╭' + '─'.repeat(w + 2) + '╮')];
  for (const l of lines) out.push(edge('│') + ' ' + l + ' '.repeat(w - strip(l).length) + ' ' + edge('│'));
  out.push(edge('╰' + '─'.repeat(w + 2) + '╯'));
  return out.join('\n');
}

function banner(who) {
  const cols = process.stdout.columns || 80;
  console.log('');
  if (cols >= 52) {
    const scale = cols >= 98 ? 2 : 1; // ">XYNAPSE" is 47 pixels wide; a pixel is two characters wide when there is room
    const { rows } = pixelBanner('>XYNAPSE', scale);
    for (const r of rows) console.log('  ' + r);
    console.log(' '.repeat(2 + 5 * scale) + gradient('C O D E', stops()[0], stops()[1]) + dim('  v' + VERSION));
  } else {
    console.log('  ' + bold(gradient('❯ XYNAPSE CODE')) + dim('  v' + VERSION));
  }
  console.log('');
  console.log(box([
    bold('Welcome back, ') + acc2(os.userInfo().username || 'friend') + '.',
    dim(`${tilde(process.cwd())}  ·  node ${process.versions.node}  ·  ${process.platform} ${process.arch}`),
    authLine(who),
    '',
    acc('/chat') + dim(' talk to Xynapse   ') + acc('? question') + dim(' quick ask   ') + acc('/help') + dim(' commands   ') + acc('!cmd') + dim(' shell'),
  ]));
  console.log('');
}

// ---- helpers ----------------------------------------------------------------
function tilde(p) {
  const home = os.homedir();
  return p === home ? '~' : p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p;
}
function gitBranch() {
  let dir = process.cwd();
  for (;;) {
    try {
      const head = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8').trim();
      return head.startsWith('ref:') ? head.split('/').slice(2).join('/') : head.slice(0, 7);
    } catch { /* not here */ }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
const fmtMs = (ms) => (ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// ---- history ----------------------------------------------------------------
let history = [];
try { history = fs.readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean).slice(-1000); } catch { /* none yet */ }
function remember(line) {
  if (history[history.length - 1] === line) return;
  history.push(line);
  try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); fs.appendFileSync(HISTORY_FILE, line + '\n'); } catch { /* ignore */ }
}

// ---- built-in commands ------------------------------------------------------
let previousDir = process.cwd();
let lastCode = 0;
let mode = 'shell'; // 'shell' = commands, 'chat' = everything typed goes to Xynapse
const CHAT_COMMANDS = new Set(['login', 'logout', 'whoami', 'new', 'model', 'search', 'ask', 'chat', 'shell']);

const HELP = [
  ['help', 'Show this help'],
  ['cd [dir]', 'Change directory (cd - goes back, cd alone goes home)'],
  ['ls [-a] [-l] [dir]', 'List files, colorized'],
  ['pwd', 'Print the current directory'],
  ['clear', 'Clear the screen (also Ctrl+L)'],
  ['history', 'Show recent commands'],
  ['theme [name]', 'Show or change the color theme: ' + Object.keys(THEMES).join(', ')],
  ['about', 'Version and system info'],
  ['/login [google]', 'Sign in with email + password, or Google (opens your browser)'],
  ['/logout', 'Sign out'],
  ['/whoami', 'Show who you are signed in as'],
  ['/chat', 'Chat mode: everything you type goes to Xynapse (/shell to go back)'],
  ['? <question>', 'Ask Xynapse once from shell mode (same as /ask <question>)'],
  ['/new', 'Start a new conversation'],
  ['/model [name]', 'Show or change the model: fast, pro, apex, supervl, code'],
  ['/search [mode]', 'Web search: auto, on or off'],
  ['/update', 'Check for a new version of Xynapse Code'],
  ['exit', 'Quit (also Ctrl+D, or Ctrl+C twice)'],
  ['!<command>', 'Force a command through your system shell'],
];

function cmdHelp() {
  console.log('\n  ' + bold('Xynapse Code') + dim(' - built-ins. Everything else runs in your shell.\n'));
  for (const [name, desc] of HELP) console.log('  ' + acc(name.padEnd(22)) + dim(desc));
  console.log('');
}

function cmdCd(args) {
  let target = args[0];
  if (!target || target === '~') target = os.homedir();
  else if (target === '-') target = previousDir;
  else if (target.startsWith('~/') || target.startsWith('~\\')) target = path.join(os.homedir(), target.slice(2));
  const dest = path.resolve(process.cwd(), target);
  try {
    if (!fs.statSync(dest).isDirectory()) throw new Error('Not a directory');
    const before = process.cwd();
    process.chdir(dest);
    previousDir = before;
    return 0;
  } catch (e) {
    console.log(red(`cd: ${target}: ${e.code === 'ENOENT' ? 'no such directory' : e.message}`));
    return 1;
  }
}

function cmdLs(args) {
  const flags = args.filter((a) => a.startsWith('-')).join('');
  const all = flags.includes('a');
  const long = flags.includes('l');
  const target = args.find((a) => !a.startsWith('-')) || '.';
  const dir = path.resolve(process.cwd(), target);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    console.log(red(`ls: ${target}: ${e.code === 'ENOENT' ? 'no such file or directory' : e.message}`));
    return 1;
  }
  if (!all) entries = entries.filter((e) => !e.name.startsWith('.'));
  entries.sort((a, b) => (Number(b.isDirectory()) - Number(a.isDirectory())) || a.name.localeCompare(b.name));
  const label = (e) => (e.isDirectory() ? bold(acc(e.name + '/')) : e.name.startsWith('.') ? dim(e.name) : e.name);
  if (long) {
    for (const e of entries) {
      let size = '', when = '';
      try {
        const st = fs.statSync(path.join(dir, e.name));
        size = e.isDirectory() ? '-' : fmtSize(st.size);
        when = st.mtime.toISOString().slice(0, 16).replace('T', ' ');
      } catch { /* unreadable */ }
      console.log('  ' + dim(when.padEnd(17)) + ' ' + size.padStart(9) + '  ' + label(e));
    }
  } else if (entries.length) {
    const names = entries.map(label);
    const width = Math.max(...entries.map((e) => e.name.length + (e.isDirectory() ? 1 : 0))) + 2;
    const cols = Math.max(1, Math.floor(((process.stdout.columns || 80) - 2) / width));
    for (let i = 0; i < names.length; i += cols) {
      console.log('  ' + names.slice(i, i + cols).map((n) => n + ' '.repeat(width - strip(n).length)).join('').trimEnd());
    }
  } else {
    console.log(dim('  (empty)'));
  }
  return 0;
}

function cmdTheme(args) {
  const name = (args[0] || '').toLowerCase();
  if (!name) {
    console.log('  ' + Object.keys(THEMES).map((t) => (t === config.theme ? bold(gradient('● ' + t, THEMES[t][0], THEMES[t][1])) : dim('○ ' + t))).join('   '));
    console.log(dim('  Use: theme <name>'));
    return 0;
  }
  if (!THEMES[name]) { console.log(red(`Unknown theme "${name}". Options: ${Object.keys(THEMES).join(', ')}`)); return 1; }
  config.theme = name;
  saveConfig();
  console.log('  ' + gradient(`Theme set to ${name}`));
  return 0;
}

function cmdAbout() {
  console.log('');
  console.log('  ' + gradient('Xynapse Code') + dim(' v' + VERSION));
  console.log(dim(`  node ${process.version} · ${os.type()} ${os.release()} · ${os.cpus().length} cores · ${Math.round(os.totalmem() / 1073741824)} GB RAM`));
  console.log(dim(`  shell: ${IS_WIN ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/sh')}`));
  console.log(dim(`  config: ${tilde(CONFIG_DIR)}`));
  console.log('');
  return 0;
}

function cmdHistory() {
  const shown = history.slice(-50);
  const start = history.length - shown.length;
  shown.forEach((h, i) => console.log('  ' + dim(String(start + i + 1).padStart(4)) + '  ' + h));
  return 0;
}

const clearScreen = () => { if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); };

// Returns an exit code, or undefined if `line` is not a built-in.
function builtin(line) {
  const parts = line.trim().split(/\s+/);
  let name = parts[0].toLowerCase();
  const args = parts.slice(1).map((a) => a.replace(/^["']|["']$/g, ''));
  if (name.startsWith('/')) name = name.slice(1);
  switch (name) {
    case 'help': case '?': cmdHelp(); return 0;
    case 'cd': return cmdCd(args);
    case 'ls': case 'dir': return cmdLs(args);
    case 'pwd': console.log(process.cwd()); return 0;
    case 'clear': case 'cls': clearScreen(); return 0;
    case 'history': return cmdHistory();
    case 'theme': return cmdTheme(args);
    case 'about': case 'version': return cmdAbout();
    case 'exit': case 'quit': case 'q': return 'exit';
    default: return undefined;
  }
}

// ---- running real commands ----------------------------------------------------
function runShell(command) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, { shell: true, stdio: 'inherit', cwd: process.cwd(), env: process.env });
    child.on('error', (e) => { console.log(red(e.message)); resolve({ code: 1, ms: Date.now() - started }); });
    child.on('close', (code) => resolve({ code: code === null ? 130 : code, ms: Date.now() - started }));
  });
}

// ---- prompt -----------------------------------------------------------------
const SLASH = ['help', 'cd', 'ls', 'pwd', 'clear', 'history', 'theme', 'about', 'exit', 'login', 'logout', 'whoami', 'chat', 'shell', 'new', 'model', 'search', 'ask', 'update'];

function completer(line) {
  const last = line.split(/\s+/).pop() || '';
  let hits = [];
  if (!/\s/.test(line.trimStart())) {
    const bare = last.replace(/^\//, '');
    hits = SLASH.filter((c) => c.startsWith(bare)).map((c) => (last.startsWith('/') ? '/' + c : c));
  }
  if (!hits.length || /\s/.test(line.trimStart())) {
    const idx = Math.max(last.lastIndexOf('/'), last.lastIndexOf('\\'));
    const dirPart = last.slice(0, idx + 1);
    const base = last.slice(idx + 1).toLowerCase();
    try {
      hits = fs.readdirSync(path.resolve(process.cwd(), dirPart || '.'), { withFileTypes: true })
        .filter((e) => e.name.toLowerCase().startsWith(base) && (base.startsWith('.') || !e.name.startsWith('.')))
        .map((e) => dirPart + e.name + (e.isDirectory() ? path.sep : ''));
    } catch { /* unreadable dir */ }
  }
  return [hits, last];
}

function printPromptHeader() {
  if (updateNotice) {
    console.log('\n  ' + acc2('↑ ') + dim('Xynapse Code v' + updateNotice + ' is ready - restart to use it.'));
    updateNotice = null;
  }
  const branch = gitBranch();
  console.log('\n' + acc('╭─ ') + bold(acc2(tilde(process.cwd()))) + (branch ? dim('  git:') + acc(branch) : '') + (mode === 'chat' ? '  ' + bold(acc2('✦ chat')) + dim(' · ' + config.model) : ''));
}

function ask() {
  return new Promise((resolve) => {
    printPromptHeader();
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      history: history.slice().reverse(),
      historySize: 1000,
      completer,
      prompt: acc('╰─') + (lastCode === 0 ? acc2(mode === 'chat' ? '✦ ' : '❯ ') : red(mode === 'chat' ? '✦ ' : '❯ ')),
    });
    let lastSigint = 0;
    rl.on('SIGINT', () => {
      if (rl.line.length) { rl.write(null, { ctrl: true, name: 'u' }); process.stdout.write('\n'); rl.prompt(); return; }
      if (Date.now() - lastSigint < 1500) { rl.close(); return; }
      lastSigint = Date.now();
      process.stdout.write(dim('\n(press Ctrl+C again or type exit to quit)\n'));
      rl.prompt();
    });
    // Never remove readline's own 'close' listeners: they detach the keyboard handler from stdin.
    // Removing them leaves old prompts alive, and every one of them echoes what you type.
    let finished = false;
    const finish = (value) => { if (!finished) { finished = true; resolve(value); } };
    rl.on('close', () => finish(null)); // Ctrl+D / double Ctrl+C
    rl.on('line', (line) => { finish(line); rl.close(); });
    rl.prompt();
  });
}

// ---- main loop --------------------------------------------------------------
async function handle(line) {
  const text = line.trim();
  if (!text) return;
  remember(text);
  if (text.startsWith('?')) { lastCode = await chat.send(text.slice(1)); return; }
  if (text.startsWith('!')) {
    const r = await runShell(text.slice(1).trim());
    lastCode = r.code;
    console.log(dim(r.code === 0 ? `  ✓ ${fmtMs(r.ms)}` : `  ✗ exit ${r.code} · ${fmtMs(r.ms)}`));
    return 'ran';
  }
  if (/^\/update\s*$/i.test(text)) { lastCode = await cmdUpdate(); return; }
  const cmd = /^\/(\w+)\s*([\s\S]*)$/.exec(text);
  if (cmd && CHAT_COMMANDS.has(cmd[1].toLowerCase())) {
    const name = cmd[1].toLowerCase();
    const rest = cmd[2].trim();
    if (name === 'chat') {
      mode = 'chat';
      console.log('  ' + gradient('✦ Chat mode') + dim(' - everything you type goes to Xynapse. /shell goes back, !cmd runs a command.'));
      if (!chat.signedIn()) console.log(red('  You are not signed in yet. Type /login.'));
      lastCode = rest ? await chat.send(rest) : 0;
      return;
    }
    if (name === 'shell') { mode = 'shell'; console.log('  ' + gradient('Shell mode') + dim(' - commands run in your shell. /chat to talk to Xynapse.')); lastCode = 0; return; }
    lastCode = await chat.command(name, rest);
    return;
  }
  if (mode === 'chat' && !text.startsWith('/')) { lastCode = await chat.send(text); return; }
  const result = builtin(text);
  if (result === 'exit') return 'exit';
  if (typeof result === 'number') { lastCode = result; return; }
  if (mode === 'chat') { console.log(red('  Unknown command. /help lists them; use !<cmd> to run something in your shell.')); lastCode = 1; return; }
  const r = await runShell(text);
  lastCode = r.code;
  console.log(dim(r.code === 0 ? `  ✓ ${fmtMs(r.ms)}` : `  ✗ exit ${r.code} · ${fmtMs(r.ms)}`));
}

async function cmdUpdate() {
  console.log(dim('  Checking for updates...'));
  const r = await updater.check({ baseUrl: SITE(), version: VERSION, force: true });
  if (r.status === 'updated') console.log(green('  ✓ ') + 'Updated to v' + r.version + dim(' - restart Xynapse Code to use it.'));
  else if (r.status === 'current') console.log(dim('  You are on the latest version (v' + (r.version || VERSION) + ').'));
  else if (r.status === 'disabled') console.log(dim('  Updates are not set up in this build.'));
  else console.log(red('  Could not check for updates: ' + r.message + '.'));
  return r.status === 'error' ? 1 : 0;
}

function goodbye() {
  console.log('\n  ' + gradient('See you soon  ◆') + '\n');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--version') || argv.includes('-v')) return console.log(VERSION);
  if (argv.includes('--reset-update')) { updater.reset(); console.log('Removed downloaded Xynapse Code updates.'); return; }
  if (argv.includes('--update')) { process.exitCode = await cmdUpdate(); return; }
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Xynapse Code v${VERSION}\n\nUsage:\n  xynapse            start the interactive terminal\n  xynapse -c "cmd"   run one command and exit\n  xynapse --version`);
    return;
  }
  const c = argv.indexOf('-c');
  if (c !== -1) {
    const text = argv.slice(c + 1).join(' ');
    const r = builtin(text);
    if (typeof r === 'number') process.exit(r);
    const out = await runShell(text);
    process.exit(out.code);
  }
  if (!process.stdin.isTTY) {
    console.error('Xynapse Code needs an interactive terminal. Use: xynapse -c "<command>" for one-off commands.');
    process.exit(1);
  }

  chat.loadSession();
  const who = await chat.refreshUser();
  clearScreen();
  banner(who);
  // look for a newer version in the background (at most every 6 hours); it is used from the next start
  updater.check({ baseUrl: SITE(), version: VERSION }).then((r) => { if (r.status === 'updated') updateNotice = r.version; }).catch(() => {});
  for (;;) {
    const line = await ask();
    if (line === null) break;
    if ((await handle(line)) === 'exit') break;
  }
  goodbye();
  process.exit(0);
}

// Ctrl+C belongs to the running command / the prompt, never to this process directly.
process.on('SIGINT', () => { chat.abortActive(); /* otherwise handled by readline or the child process */ });

main().catch((err) => {
  console.error(red('Xynapse Code crashed: ' + (err && err.message ? err.message : err)));
  process.exit(1);
});
