# Xynapse Desktop

The Xynapse desktop app (Electron): a thin client that opens https://xynapse.eu/chat in its own window.
The backend and API keys stay on the server; the app contains no secrets.

## Running (development)

```bash
npm install
npm start
```

Testing against a local server (first run `node server.js` in the `src` folder):

```bash
npm run start:local
```

## Icon

Put the Xynapse icon in the `build/` folder:

- `build/icon.png` - PNG, at least 256x256 (512x512 preferred), used as the window icon
- `build/icon.ico` - optional, for the installer (electron-builder can also convert `icon.png` by itself)

The original is probably at `../src/Assets/xynapse-app-icon.png` (`npm run sync-icon` copies it).

## Building the installer (Windows)

```bash
npm run build
```

The finished `.exe` installer appears in the `dist/` folder.
For a quick test without an installer: `npm run build:dir` (folder `dist/win-unpacked`).

### One installer for the website (Xynapse Desktop + Xynapse Code)

```bash
npm run release
```

Builds `dist/Xynapse-Setup.exe` and copies it to `../src/downloads/`, from where the website serves it at `/downloads/Xynapse-Setup.exe` (the "Download for Windows" button on the home page; if the file is missing, the button shows "coming soon"). The installer:

- installs Xynapse Desktop and bundles Xynapse Code (`resources/xynapse-code`),
- creates "Xynapse" and "Xynapse Code" shortcuts on the desktop (and in the Start Menu),
- enables autostart for Xynapse Desktop (starts hidden in the tray, `--hidden` argument); this can be turned off in Settings ("Launch at login").

`xynapse-code.cmd` uses Node.js if it is installed (>= 18), and otherwise falls back to the Node runtime built into the Xynapse app. The installer is not code-signed, so Windows may show a SmartScreen warning.

## What the app does

- single instance at a time; remembers window size and position
- opens links to external sites in the system browser
- email/password and Google sign-in work inside the app window (user agent without "Electron")
- when there is no internet connection, shows the `offline.html` page with a "Try again" button

## MCP (Settings -> Connectors & MCP)

Add MCP connections in Settings (Ctrl+,). They are stored in `mcp.json` in the app's data folder.

- **Local folder** - pick one or more folders (Browse button); the app launches the official `@modelcontextprotocol/server-filesystem` server via `npx` (requires Node.js). The server can only see the folders you choose.
- **Custom command** - any MCP server over stdio: command, arguments (one per line), environment variables.

Permissions (per connection, with per-tool overrides):

- Ask every time - prompt before each use
- Auto-allow read-only - read-only tools run on their own, everything else asks
- Always allow - never ask
- Block - blocked (the tool is not even shown to the chat)

The prompt also offers "Always allow this tool". The "Reset always allow approvals" button revokes all such approvals.

In the desktop app, the chat page (xynapse.eu) gets a `window.xynapseMcp` object:

```js
const tools = await window.xynapseMcp.list();   // [{ server, serverName, name, description, inputSchema, readOnly }]
const r = await window.xynapseMcp.call(tools[0].server, tools[0].name, { /* arguments */ });
// r = { ok: true, result: { content: [...], isError? } } or { ok: false, error, denied? }
```

Every `call` goes through the permission system above. For the model to actually use these tools, the chat page and `server.js` must pass the tool schemas to the model and return the results.

## To do later

- sign the installer with a certificate (so Windows does not warn about an unknown publisher)
- auto-updates (`electron-updater`)
- tray icon, keyboard shortcuts
