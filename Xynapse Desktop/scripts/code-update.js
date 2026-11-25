'use strict';
// Signs and publishes Xynapse Code updates, so installed copies can update themselves without a new installer.
//
//   node scripts/code-update.js prepare   make sure the signing key exists and its public half is in
//                                         Xynapse Code/lib/update-key.js (npm run build does this before building)
//   node scripts/code-update.js publish   sign the current Xynapse Code files and write ../src/downloads/code-update.json
//
// The private key lives in ~/.xynapse/code-update-private.pem, outside the project. Never upload or share it, and back it
// up: if it is lost, installed copies can no longer be updated and everyone needs a new installer.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CODE_DIR = path.join(__dirname, '..', '..', 'Xynapse Code');
const OUT_DIR = path.join(__dirname, '..', '..', 'src', 'downloads');
const OUT = path.join(OUT_DIR, 'code-update.json');
const KEY_FILE = process.env.XYNAPSE_UPDATE_KEY || path.join(os.homedir(), '.xynapse', 'code-update-private.pem');
const PUB_FILE = path.join(CODE_DIR, 'lib', 'update-key.js');
const { canonical, newer } = require(path.join(CODE_DIR, 'lib', 'updater.js'));

const fail = (msg) => { console.error('[code-update] ' + msg); process.exit(1); };

function prepare() {
  if (!fs.existsSync(KEY_FILE)) {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    console.log('[code-update] Created a new signing key: ' + KEY_FILE + '\n[code-update] BACK THIS FILE UP and keep it private.');
  }
  const priv = crypto.createPrivateKey(fs.readFileSync(KEY_FILE));
  const pub = crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' });
  const src = '\'use strict\';\n// Public key that update bundles must be signed with. Written by Xynapse Desktop/scripts/code-update.js - do not edit.\nmodule.exports = ' + JSON.stringify(pub) + ';\n';
  if (!fs.existsSync(PUB_FILE) || fs.readFileSync(PUB_FILE, 'utf8') !== src) {
    fs.writeFileSync(PUB_FILE, src);
    console.log('[code-update] Wrote ' + PUB_FILE);
  }
  return { priv, pub };
}

function collect() {
  const files = {};
  const add = (rel) => { files[rel] = fs.readFileSync(path.join(CODE_DIR, ...rel.split('/')), 'utf8'); };
  add('package.json');
  for (const dir of ['bin', 'lib']) {
    for (const f of fs.readdirSync(path.join(CODE_DIR, dir)).sort()) if (/^[\w.-]+\.js$/.test(f)) add(dir + '/' + f);
  }
  return files;
}

function publish() {
  const { priv, pub } = prepare(); // the bundle contains update-key.js, so keep it in sync first
  const files = collect();
  const version = JSON.parse(files['package.json']).version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail('"version" in Xynapse Code/package.json must look like 1.2.3 (got "' + version + '").');

  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* first publish */ }
  if (prev && newer(prev.version, version)) fail('The published update is v' + prev.version + ', which is newer than the v' + version + ' you are publishing.');
  if (prev && prev.version === version && canonical(prev.version, prev.files) !== canonical(version, files)) {
    fail('Xynapse Code changed but its version is still ' + version + '. Raise "version" in Xynapse Code/package.json first: installed copies only update when the version goes up.');
  }

  const data = Buffer.from(canonical(version, files), 'utf8');
  const sig = crypto.sign(null, data, priv);
  if (!crypto.verify(null, data, pub, sig)) fail('Self-check of the signature failed.');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ version, files, sig: sig.toString('base64') }));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log('[code-update] Xynapse Code v' + version + ' -> ' + OUT + ' (' + kb + ' KB, ' + Object.keys(files).length + ' files)');
  console.log('[code-update] Deploy src/downloads/code-update.json with the website. Installed copies pick it up within hours.');
}

const cmd = process.argv[2];
if (cmd === 'prepare') prepare();
else if (cmd === 'publish') publish();
else fail('Usage: node scripts/code-update.js prepare | publish');
