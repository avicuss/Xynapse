# Xynapse Desktop

Aplikacja desktopowa Xynapse (Electron) - cienki klient, który otwiera https://xynapse.eu/chat w osobnym oknie.
Backend i klucze API zostają na serwerze, w aplikacji nie ma żadnych sekretów.

## Uruchomienie (development)

```bash
npm install
npm start
```

Test z lokalnym serwerem (najpierw uruchom `node server.js` w folderze `src`):

```bash
npm run start:local
```

## Ikona

Skopiuj ikonę Xynapse do folderu `build/`:

- `build/icon.png` - PNG min. 256x256 (najlepiej 512x512), używany jako ikona okna
- `build/icon.ico` - opcjonalnie, dla instalatora (electron-builder potrafi też sam
  przekonwertować `icon.png`)

Oryginał prawdopodobnie jest w `../src/Assets/xynapse-app-icon.png`.

## Budowanie instalatora (Windows)

```bash
npm run build
```

Gotowy instalator `.exe` pojawi się w folderze `dist/`.
Do szybkiego testu bez instalatora: `npm run build:dir` (folder `dist/win-unpacked`).

### Jeden instalator dla strony (Xynapse Desktop + Xynapse Code)

```bash
npm run release
```

Buduje `dist/Xynapse-Setup.exe` i kopiuje go do `../src/downloads/`, skąd strona oddaje go pod `/downloads/Xynapse-Setup.exe` (przycisk "Download for Windows" na stronie głównej; gdy pliku nie ma, przycisk pokazuje "coming soon"). Instalator:

- instaluje Xynapse Desktop i dołącza Xynapse Code (`resources/xynapse-code`),
- tworzy na pulpicie skróty "Xynapse" i "Xynapse Code" (oraz w Menu Start),
- włącza autostart Xynapse Desktop (start ukryty w zasobniku, argument `--hidden`); da się to wyłączyć w Ustawieniach ("Launch at login").

`xynapse-code.cmd` używa Node.js, jeśli jest zainstalowany (>= 18), a w przeciwnym razie wbudowanego Node z aplikacji Xynapse. Instalator nie jest podpisany, więc Windows może pokazać ostrzeżenie SmartScreen.

## Co robi aplikacja

- jedna instancja naraz, zapamiętuje rozmiar i pozycję okna
- linki do zewnętrznych stron otwiera w przeglądarce systemowej
- logowanie e-mail/hasło i Google działa w oknie aplikacji (user agent bez "Electron")
- gdy nie ma internetu, pokazuje stronę `offline.html` z przyciskiem "Spróbuj ponownie"

## MCP (Ustawienia -> Connectors & MCP)

Połączenia MCP dodajesz w ustawieniach (Ctrl+,). Są zapisywane w `mcp.json` w folderze danych aplikacji.

- **Local folder** - wybierasz folder(y) (przycisk Browse), aplikacja uruchamia oficjalny serwer `@modelcontextprotocol/server-filesystem` przez `npx` (wymaga Node.js). Serwer widzi tylko wskazane foldery.
- **Custom command** - dowolny serwer MCP po stdio: komenda, argumenty (po jednym w linii), zmienne środowiskowe.

Uprawnienia (dla każdego połączenia, z możliwością nadpisania dla każdego narzędzia):

- Ask every time - pytaj przed każdym użyciem
- Auto-allow read-only - narzędzia tylko do odczytu działają same, reszta pyta
- Always allow - bez pytania
- Block - zablokowane (narzędzie nie jest nawet pokazywane czatowi)

W oknie pytania jest też "Always allow this tool". Przycisk "Reset always allow approvals" cofa wszystkie takie zgody.

Czat (strona xynapse.eu) dostaje w aplikacji desktopowej obiekt `window.xynapseMcp`:

```js
const tools = await window.xynapseMcp.list();   // [{ server, serverName, name, description, inputSchema, readOnly }]
const r = await window.xynapseMcp.call(tools[0].server, tools[0].name, { /* argumenty */ });
// r = { ok: true, result: { content: [...], isError? } } albo { ok: false, error, denied? }
```

Każde `call` przechodzi przez system uprawnień powyżej. Żeby model faktycznie używał tych narzędzi, strona czatu i `server.js` muszą przekazywać schematy narzędzi do modelu i odsyłać wyniki.

## Do zrobienia później

- podpisanie instalatora certyfikatem (żeby Windows nie ostrzegał o nieznanym wydawcy)
- autoaktualizacje (`electron-updater`)
- ikona w zasobniku, skróty klawiszowe
