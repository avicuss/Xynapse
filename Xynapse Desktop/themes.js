'use strict';
// Themes, default settings, validation and the CSS that is injected into the chat page.
// Used only by main.js (the settings page gets this data over IPC).

// The chat page defines its colors as CSS variables on :root (--bg, --s1, --s2, --line, --ink, --mute, --v, --c, --glow).
// A theme just overrides those variables (plus a few colors the page hard-codes).
const THEMES = [
  { id: 'midnight', name: 'Midnight', bg: '#000000', s1: '#111114', s2: '#1b1b20', line: '#2a2a31', ink: '#f4f4f6', mute: '#9090a0', v: '#8d93ff', c: '#6ee7ef', glow: 'rgba(120,130,255,.35)', sidebar: 'rgba(9,9,12,.97)' },
  { id: 'graphite', name: 'Graphite', bg: '#0e0e10', s1: '#18181b', s2: '#232327', line: '#323238', ink: '#f2f2f4', mute: '#9a9aa5', v: '#b8bdd1', c: '#8fd3c8', glow: 'rgba(170,175,200,.22)', sidebar: 'rgba(13,13,15,.97)' },
  { id: 'ocean', name: 'Ocean', bg: '#020a12', s1: '#0a1620', s2: '#102130', line: '#1e3548', ink: '#eaf6ff', mute: '#7f9db3', v: '#4cc2ff', c: '#5ef0d0', glow: 'rgba(70,180,255,.35)', sidebar: 'rgba(3,11,18,.97)' },
  { id: 'forest', name: 'Forest', bg: '#020805', s1: '#0b1410', s2: '#121f19', line: '#1f3329', ink: '#effaf3', mute: '#86a394', v: '#5fd08a', c: '#7fe3c1', glow: 'rgba(80,200,130,.3)', sidebar: 'rgba(3,10,7,.97)' },
  { id: 'ember', name: 'Ember', bg: '#0b0504', s1: '#17100e', s2: '#221814', line: '#36251f', ink: '#fff3ec', mute: '#a58e82', v: '#ff8a5b', c: '#ffc857', glow: 'rgba(255,120,70,.32)', sidebar: 'rgba(13,7,5,.97)' },
  { id: 'rose', name: 'Rose', bg: '#0a0408', s1: '#170e13', s2: '#22161d', line: '#38232d', ink: '#fff0f5', mute: '#a88b97', v: '#ff7aa8', c: '#c79bff', glow: 'rgba(255,110,160,.3)', sidebar: 'rgba(12,5,9,.97)' },
  { id: 'mono', name: 'Mono', bg: '#000000', s1: '#0d0d0d', s2: '#181818', line: '#2b2b2b', ink: '#ffffff', mute: '#8c8c8c', v: '#ffffff', c: '#bdbdbd', glow: 'rgba(255,255,255,.16)', sidebar: 'rgba(5,5,5,.97)' },
];

const CHAT_WIDTHS = { narrow: 640, standard: 760, wide: 980 };
const TITLEBAR_H = 46; // height of the custom title bar (the window buttons on the right match it)

const DEFAULTS = Object.freeze({
  theme: 'midnight',
  accent: '', // '' = use the theme's own accent, otherwise #rrggbb
  zoom: 1, // interface zoom, 0.8 - 1.5
  chatWidth: 'standard',
  animatedBackground: true, // stars + horizon glow
  reduceMotion: false,
  alwaysOnTop: false,
  launchAtLogin: true, // the installer also sets this up; Settings can turn it off
  spellcheck: true,
  shortcuts: true,
  closeToTray: true, // closing the window keeps the app running in the tray
});

const BOOLEAN_KEYS = ['animatedBackground', 'reduceMotion', 'alwaysOnTop', 'launchAtLogin', 'spellcheck', 'shortcuts', 'closeToTray'];

// Whitelist + validate a settings patch on top of `current`. Unknown keys / bad values are ignored.
function sanitize(patch, current) {
  const out = { ...(current || DEFAULTS) };
  const p = patch && typeof patch === 'object' ? patch : {};
  if (typeof p.theme === 'string' && THEMES.some((t) => t.id === p.theme)) out.theme = p.theme;
  if (typeof p.accent === 'string' && (p.accent === '' || /^#[0-9a-fA-F]{6}$/.test(p.accent))) out.accent = p.accent.toLowerCase();
  if (typeof p.zoom === 'number' && Number.isFinite(p.zoom)) out.zoom = Math.round(Math.min(1.5, Math.max(0.8, p.zoom)) * 20) / 20;
  if (typeof p.chatWidth === 'string' && Object.prototype.hasOwnProperty.call(CHAT_WIDTHS, p.chatWidth)) out.chatWidth = p.chatWidth;
  for (const k of BOOLEAN_KEYS) if (typeof p[k] === 'boolean') out[k] = p[k];
  return out;
}

const GEAR_ICON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23b4b4bf' stroke-width='1.8' stroke-linecap='round'%3E" +
  "%3Cpath d='M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1'/%3E%3Ccircle cx='15' cy='6' r='2'/%3E%3Ccircle cx='9' cy='12' r='2'/%3E%3Ccircle cx='17' cy='18' r='2'/%3E%3C/svg%3E\")";

// Window controls (minimize / maximize / close) drawn by the app itself, Claude-style: no native bar,
// soft rounded hover pills, red close. The buttons are inserted by main.js (injectWindowControls).
const CONTROLS_CSS =
  '#xyn-winctl{position:fixed;top:0;right:0;height:' + TITLEBAR_H + 'px;display:flex;align-items:center;gap:2px;padding:0 8px 0 0;z-index:2147483647;-webkit-app-region:no-drag;user-select:none}' +
  '#xyn-winctl button{all:unset;box-sizing:border-box;width:38px;height:30px;display:grid;place-items:center;border-radius:8px;color:var(--mute,#9a9aa5);cursor:default;transition:background .12s,color .12s;-webkit-app-region:no-drag}' +
  '#xyn-winctl button:hover{background:rgba(255,255,255,.09);color:var(--ink,#fff)}' +
  '#xyn-winctl button:active{background:rgba(255,255,255,.14)}' +
  '#xyn-winctl button:focus-visible{outline:2px solid var(--c,#6ee7ef);outline-offset:-2px}' +
  '#xyn-winctl button.close:hover{background:#d64d58;color:#fff}' +
  '#xyn-winctl button.close:active{background:#b83e48;color:#fff}' +
  '#xyn-winctl svg{width:11px;height:11px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}' +
  '#xyn-winctl .restore{display:none}' +
  '#xyn-winctl.max .restore{display:block}' +
  '#xyn-winctl.max .maximize{display:none}';

// CSS injected into the chat page (re-injected after every page load and every settings change).
function buildChatCss(s) {
  const t = THEMES.find((x) => x.id === s.theme) || THEMES[0];
  const custom = t.id !== 'midnight' || !!s.accent; // untouched site look for the default theme
  const v = s.accent || t.v;
  const glow = s.accent ? 'color-mix(in srgb, ' + v + ' 38%, transparent)' : t.glow;
  const width = CHAT_WIDTHS[s.chatWidth] || CHAT_WIDTHS.standard;
  let css = '';

  if (custom) {
    css +=
      'html:root{--bg:' + t.bg + ';--s1:' + t.s1 + ';--s2:' + t.s2 + ';--line:' + t.line + ';--ink:' + t.ink + ';--mute:' + t.mute + ';--v:' + v + ';--c:' + t.c + ';--glow:' + glow + '}' +
      'body{background:var(--bg)!important}' +
      '.sidebar{background:' + t.sidebar + '!important}' +
      '.box{background:color-mix(in srgb,var(--s1) 94%,transparent)!important}' +
      '.mmenu,.history-panel{background:var(--s1)!important}' +
      '.horizon{background:radial-gradient(closest-side,var(--bg) 80%,transparent 81%)!important}' +
      '.chatting .dock::before{background:linear-gradient(transparent,var(--bg))!important}' +
      '.scrolled .bar{background:color-mix(in srgb,var(--bg) 92%,transparent)!important}' +
      '.code{background:color-mix(in srgb,var(--bg) 60%,var(--s1))!important}' +
      '.code .ch{background:var(--s1)!important}' +
      '.tr-d pre{background:var(--bg)!important}' +
      '.account-avatar{background:linear-gradient(145deg,color-mix(in srgb,var(--v) 55%,#000),var(--s1))!important}' +
      '.quota-card{border-color:color-mix(in srgb,var(--v) 20%,transparent)!important;background:color-mix(in srgb,var(--v) 6%,transparent)!important}';
  }

  if (s.chatWidth !== 'standard') {
    css += '.inner{max-width:' + width + 'px!important}.box{max-width:' + (width - 20) + 'px!important}';
  }
  if (!s.animatedBackground) css += '#stars,.horizon{display:none!important}';
  if (s.reduceMotion) {
    css += '*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}';
  }

  // The profile row opens the settings view in the desktop app.
  css +=
    '.account-row{cursor:pointer;border-radius:11px;transition:background .15s}' +
    '.account-row:hover,.account-row:focus-visible{background:rgba(255,255,255,.06)}' +
    '.account-row::after{content:"";margin-left:auto;flex:0 0 auto;width:18px;height:18px;opacity:.6;background:' + GEAR_ICON + ' center/contain no-repeat}';
  // Custom title bar: no white native bar. The page's own header is the drag area; the min / max / close buttons
  // are drawn by Windows on the right, so the header keeps clear of them.
  if (process.platform !== 'darwin') {
    css +=
      CONTROLS_CSS +
      '.bar{-webkit-app-region:drag;height:' + TITLEBAR_H + 'px!important;padding-right:150px!important}' +
      '.bar a,.bar button,.bar input,.bar select,.bar .tools{-webkit-app-region:no-drag}' +
      '.sidebar-brand{-webkit-app-region:drag}' +
      '.sidebar-brand a,.sidebar-brand button{-webkit-app-region:no-drag}';
  }
  return css;
}

// Same idea for the app's own pages (login, offline): a drag strip along the top, clear of the window buttons.
function buildFrameCss() {
  return 'html::before{content:"";position:fixed;top:0;left:0;right:150px;height:' + TITLEBAR_H + 'px;-webkit-app-region:drag;z-index:0}' + CONTROLS_CSS;
}

module.exports = { THEMES, DEFAULTS, CHAT_WIDTHS, TITLEBAR_H, sanitize, buildChatCss, buildFrameCss };
