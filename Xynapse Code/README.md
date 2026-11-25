# Xynapse Code

A terminal CLI with a good-looking interface. No dependencies, just Node 18+.

## Run

```bash
cd "Xynapse Code"
node bin/xynapse.js
```

Install the `xynapse` command globally (once):

```bash
npm link
xynapse
```

One-off command: `xynapse -c "git status"`

## What it does

- Gradient banner and a two-line prompt that shows the folder and git branch; the arrow turns red when the last command failed
- Runs any command through your shell (cmd.exe / PowerShell-compatible on Windows, `$SHELL` elsewhere) and shows the exit status and time
- Built-ins: `cd` (`cd -`, `~`), `ls` (`-a`, `-l`), `pwd`, `clear`, `history`, `theme`, `about`, `help`, `exit`; `/help` style also works
- `!command` forces a command through the shell
- Tab completion for commands and file paths, persistent history (up/down arrows), Ctrl+L to clear, Ctrl+C twice or Ctrl+D to quit
- Themes: `aurora`, `sunset`, `matrix`, `ocean`, `mono` (saved in `~/.xynapse/code.json`)

## Chat with Xynapse

```
/login            sign in with email + password, or press Enter at the email prompt for Google
/login google     sign in with Google directly (opens your browser)
/chat             chat mode: everything you type goes to Xynapse (/shell goes back)
? what is a mutex   ask once from shell mode (same as /ask ...)
/new              start a fresh conversation
/model pro        fast, pro, apex, supervl or code
/search on        web search: auto, on or off
/whoami  /logout
```

Replies stream live with formatted headings, bullets and code blocks. Press Ctrl+C while a reply is coming in to stop it. In chat mode, `!command` still runs a shell command.

By default it talks to https://xynapse.eu. To use a local server, set `XYNAPSE_URL=http://localhost:20280` before starting.

Google sign-in opens your browser and returns to the terminal through a one-time code on `127.0.0.1`. It needs the updated `server.js` (the `port` option on `/api/auth/desktop-handoff`) to be deployed to xynapse.eu.

## Updates

Xynapse Code updates itself. While it runs it checks `/downloads/code-update.json` on the site (at most every 6 hours),
verifies the signature and stores the new files in `~/.xynapse/code-app/`; the next start uses them. `/update` checks
right now. `xynapse --no-update` runs the installed copy, `xynapse --reset-update` deletes downloaded updates.

To release a change (no new installer needed):

1. Raise `version` in `package.json`.
2. From `Xynapse Desktop`: `npm run publish-code` (signs the files, writes `src/downloads/code-update.json`).
3. Deploy the website.

A new installer is only needed when the Xynapse Desktop app itself changes. The signing key is
`~/.xynapse/code-update-private.pem` (created on the first build): back it up and never upload it.

## Ideas for next steps

- Save CLI chats to your history on the website, use your MCP tools from the terminal
- Command palette / fuzzy history search (Ctrl+R)
- Pipes-aware syntax highlighting, aliases, a config file for startup commands
