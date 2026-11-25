'use strict';
// Copies the built installer (dist/Xynapse-Setup.exe) into the website's downloads folder, so the
// "Download for Windows" button on the main page serves it from /downloads/Xynapse-Setup.exe.
// Run by `npm run release` (build + copy).
const fs = require('fs');
const path = require('path');

const NAME = 'Xynapse-Setup.exe';
const source = path.join(__dirname, '..', 'dist', NAME);
const targetDir = path.join(__dirname, '..', '..', 'src', 'downloads');
const target = path.join(targetDir, NAME);

if (!fs.existsSync(source)) {
  console.error('[publish-download] Not found: ' + source + '\nRun "npm run build" first (or use "npm run release").');
  process.exit(1);
}
fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
const mb = (fs.statSync(target).size / 1048576).toFixed(1);
console.log('[publish-download] ' + target + ' (' + mb + ' MB)');
console.log('[publish-download] Upload src/downloads/' + NAME + ' together with the website.');
