'use strict';
// Copies the Xynapse app icon from the website's Assets folder into build/icon.png,
// where Electron (window icon) and electron-builder (installer / exe icon) expect it.
// Runs automatically before `npm start`, `npm run start:local`, `npm run build` and `npm run build:dir`.
const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', '..', 'src', 'Assets', 'xynapse-app-icon.png');
const targetDir = path.join(__dirname, '..', 'build');
const target = path.join(targetDir, 'icon.png');

try {
  if (!fs.existsSync(source)) {
    console.warn('[sync-icon] Not found: ' + source + ' - keeping any existing build/icon.png');
    process.exit(0);
  }
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(source, target);
  console.log('[sync-icon] build/icon.png updated from src/Assets/xynapse-app-icon.png');
} catch (err) {
  console.warn('[sync-icon] Could not copy the icon: ' + err.message);
}
