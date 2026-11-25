# Xynapse

Xynapse is an AI assistant available on the web at [xynapse.eu](https://xynapse.eu). This repository contains its two client applications:

| Project | What it is | Tech |
| --- | --- | --- |
| [**Xynapse Desktop**](./Xynapse%20Desktop) | Windows desktop app: a thin Electron client for the Xynapse chat, with MCP (Model Context Protocol) tool support | Electron, Node.js |
| [**Xynapse Code**](./Xynapse%20Code) | A terminal CLI with a polished interface: a shell with built-in chat with Xynapse | Node.js 18+, zero dependencies |

The backend and API keys live on the server and are **not** part of this repository. The clients contain no secrets.

## Xynapse Desktop

- Opens `https://xynapse.eu/chat` in its own window; single instance, remembers window size and position
- Email/password and Google sign-in work inside the app window
- Shows an offline page with a retry button when there is no internet connection
- Settings -> Connectors & MCP: connect local folders or any stdio MCP server, with per-connection and per-tool permissions (ask every time, auto-allow read-only, always allow, block)
- The Windows installer also bundles Xynapse Code and adds desktop and Start Menu shortcuts

Run in development:

```bash
cd "Xynapse Desktop"
npm install
npm start
```

Build the Windows installer: `npm run build` (output in `dist/`). See the [Desktop README](./Xynapse%20Desktop/README.md) for details.

## Xynapse Code

- Gradient banner and a two-line prompt showing the current folder and git branch
- Runs any command through your shell and shows exit status and duration
- Built-ins: `cd`, `ls`, `pwd`, `clear`, `history`, `theme`, `about`, `help`, `exit`
- Tab completion, persistent history, five color themes
- `/login`, then `/chat` to talk to Xynapse from the terminal, with streaming replies, model selection and optional web search
- Self-updates with signed update bundles

Run it (Node.js 18+ required):

```bash
cd "Xynapse Code"
node bin/xynapse.js
```

See the [Xynapse Code README](./Xynapse%20Code/README.md) for all commands.

## Repository layout

```
Xynapse Desktop/   Electron desktop client
Xynapse Code/      Terminal CLI
```

## License

Proprietary. All rights reserved.
