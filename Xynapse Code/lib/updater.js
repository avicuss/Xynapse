'use strict';
// Self-updater for Xynapse Code. No dependencies.
//
// The website serves a signed bundle of this CLI's own files at /downloads/code-update.json. A running copy checks it
// in the background, verifies the ed25519 signature against the public key that shipped in the installer
// (lib/update-key.js) and stores the files in ~/.xynapse/code-app/v<version>/. On the next launch bin/xynapse.js
// hands over to that newer copy (see boot). Nothing in the install folder is modified, so it also works when the
// app is installed somewhere read-only.
//
// Publishing side: Xynapse Desktop/scripts/code-update.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_KEY = require('./update-key.js');
const CONFIG_DIR = path.join(os.homedir(), '.xynapse');
const APP_DIR = path.join(CONFIG_DIR, 'code-app');
const POINTER = path.join(APP_DIR, 'current.json');
const STATE_FILE = path.join(CONFIG_DIR, 'update-check.json');
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FILE_RE = /^(package\.json|bin\/[\w.-]+\.js|lib\/[\w.-]+\.js)$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const MAX_CHARS = 2 * 1024 * 1024;

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const nums = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);

// true when version a is higher than version b
function newer(a, b) {
  const x = nums(a), y = nums(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

// The exact text that is signed: version + every file name with the SHA-256 of its content.
function canonical(version, files) {
  const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  return 'xynapse-code-update\n' + version + '\n' + Object.keys(files).sort().map((n) => n + '\0' + sha(files[n]) + '\n').join('');
}

function verify(m) {
  if (!PUBLIC_KEY) return false;
  try { return crypto.verify(null, Buffer.from(canonical(m.version, m.files), 'utf8'), PUBLIC_KEY, Buffer.from(String(m.sig), 'base64')); } catch { return false; }
}

// Returns an error text, or null when the manifest has the expected shape.
function invalid(m) {
  if (!m || typeof m !== 'object' || typeof m.version !== 'string' || !VERSION_RE.test(m.version)) return 'the update manifest is malformed';
  if (!m.files || typeof m.files !== 'object' || typeof m.sig !== 'string') return 'the update manifest is malformed';
  const names = Object.keys(m.files);
  if (!names.length || names.length > 50) return 'the update manifest is malformed';
  let size = 0;
  for (const n of names) {
    if (!FILE_RE.test(n) || typeof m.files[n] !== 'string') return 'the update contains an unexpected file';
    size += m.files[n].length;
  }
  if (size > MAX_CHARS) return 'the update is too large';
  if (!m.files['package.json'] || !m.files['bin/xynapse.js']) return 'the update is incomplete';
  try { if (JSON.parse(m.files['package.json']).version !== m.version) return 'the update version does not match'; } catch { return 'the update is malformed'; }
  return null;
}

const overlayVersion = () => { const c = readJson(POINTER); return c && VERSION_RE.test(c.version) ? c.version : null; };

function stage(m) {
  const dir = path.join(APP_DIR, 'v' + m.version);
  const tmp = dir + '.tmp' + process.pid;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [name, text] of Object.entries(m.files)) {
    const dest = path.join(tmp, ...name.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text, 'utf8');
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  const pointerTmp = POINTER + '.tmp' + process.pid;
  fs.writeFileSync(pointerTmp, JSON.stringify({ version: m.version }));
  fs.renameSync(pointerTmp, POINTER);
  try { // keep the two newest copies
    const old = fs.readdirSync(APP_DIR).filter((d) => /^v\d+\.\d+\.\d+$/.test(d)).sort((a, b) => (newer(a.slice(1), b.slice(1)) ? -1 : 1)).slice(2);
    for (const d of old) fs.rmSync(path.join(APP_DIR, d), { recursive: true, force: true });
  } catch { /* best effort */ }
}

// Looks for a newer version and stores it. Never throws.
// -> { status: 'updated' | 'current' | 'skipped' | 'disabled' | 'error', version?, message? }
async function check({ baseUrl, version, force = false }) {
  if (!PUBLIC_KEY) return { status: 'disabled' };
  if (!force && Date.now() - ((readJson(STATE_FILE) || {}).last || 0) < CHECK_EVERY_MS) return { status: 'skipped' };
  let m;
  try {
    const res = await fetch(`${baseUrl}/downloads/code-update.json?t=${Date.now()}`, { headers: { 'User-Agent': 'XynapseCode/' + version }, signal: AbortSignal.timeout(10000) });
    if (res.status !== 404 && !res.ok) return { status: 'error', message: 'the server answered ' + res.status };
    try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify({ last: Date.now() })); } catch { /* ignore */ }
    if (res.status === 404) return { status: 'current', version };
    m = await res.json();
  } catch {
    return { status: 'error', message: 'could not reach the server' };
  }
  const bad = invalid(m);
  if (bad) return { status: 'error', message: bad };
  const have = overlayVersion() && newer(overlayVersion(), version) ? overlayVersion() : version;
  if (!newer(m.version, have)) return { status: 'current', version: have };
  if (!verify(m)) return { status: 'error', message: 'the update failed its signature check and was ignored' };
  try { stage(m); } catch (e) { return { status: 'error', message: 'could not save the update (' + (e.code || e.message) + ')' }; }
  return { status: 'updated', version: m.version };
}

// Called first thing by bin/xynapse.js. When a newer downloaded copy exists, runs it and returns true
// (the caller then stops). Returns false to carry on with the copy that is already running.
function boot(entry, ownVersion) {
  if (process.env.XYNAPSE_NO_OVERLAY || process.argv.includes('--no-update')) return false;
  const have = overlayVersion();
  if (!have || !newer(have, ownVersion)) return false;
  const target = path.join(APP_DIR, 'v' + have, 'bin', 'xynapse.js');
  if (path.resolve(target) === path.resolve(entry) || !fs.existsSync(target)) return false;
  try {
    require(target);
    return true;
  } catch (e) {
    process.stderr.write('Xynapse Code: the downloaded update could not start (' + e.message + '). Using the installed version; run with --reset-update to remove the update.\n');
    return false;
  }
}

const reset = () => fs.rmSync(APP_DIR, { recursive: true, force: true });

module.exports = { boot, check, reset, canonical, newer, overlayVersion };
