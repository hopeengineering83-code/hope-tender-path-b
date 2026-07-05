# Hope Tender — Desktop App (Electron)

Optional desktop wrapper for Hope Tender Proposal Generator. Wraps the production Vercel deployment in a native window for Windows / macOS / Linux.

## Quick start (hosted mode — recommended)

The desktop app opens the live Vercel deployment in a Chromium window. No local backend setup required.

```bash
# 1. Install Electron + builder (one-time, ~300MB)
npm install --save-dev electron electron-builder cross-env

# 2. Launch in dev mode
npm run electron

# 3. Build distributable installers
npm run build:desktop          # all platforms
npm run build:desktop:win      # Windows .exe (NSIS installer)
npm run build:desktop:mac      # macOS .dmg
npm run build:desktop:linux    # Linux .AppImage + .deb
```

Installers land in `dist-electron/`.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `HOPE_TENDER_DESKTOP_MODE` | `hosted` | Set to `local-server` to spawn a local Next.js server instead of pointing at the hosted URL |
| `HOPE_TENDER_DESKTOP_URL` | `https://hope-tender-path-b.vercel.app` | The URL the desktop window loads when in hosted mode |

## Local-server mode (advanced — air-gapped or offline use)

Spawns `next start` inside the Electron process and points the window at `http://localhost:3000`. Requires:

- PostgreSQL running and `DATABASE_URL` exported
- `ANTHROPIC_API_KEY` exported
- `node_modules` installed (run `npm install` first)
- The Next.js app pre-built (`npm run build`)

```bash
npm run electron:local
```

## What's included

| File | Purpose |
|---|---|
| `electron/main.js` | Electron main process — window management, menu, mode switching |
| `electron/electron-builder.json` | Packaging config for NSIS / DMG / AppImage / DEB |
| `electron/README.md` | This file |

## Why hosted mode is the default

Bundling the full Next.js app inside Electron would require shipping Postgres, all Anthropic SDK dependencies, file storage abstractions, and ~200MB of additional binaries. The hosted mode design uses the same code that's already deployed on Vercel — desktop becomes just a distribution channel, not a separate backend stack to maintain.

For offline / air-gapped customers, local-server mode is available but requires the user to set up PostgreSQL and AI keys locally.

## Branding & icons

The installer uses `public/icon-512.png` for app icons. To customize, replace that file with your own 512×512 PNG before building.

## Auto-update

Currently disabled (`"publish": null` in `electron-builder.json`). To enable auto-updates, configure a publish provider (GitHub Releases, S3, generic HTTP server) and re-run the build. See [electron-builder publish docs](https://www.electron.build/configuration/publish).

## Security model

The hosted-mode window:
- Disables `nodeIntegration` and enables `contextIsolation` (no Node API in renderer)
- Runs the Chromium sandbox
- Routes external links to the system browser (links outside the app's domain don't open inside the window)
- Blocks `webview` attachments

These defaults are appropriate for hosting a trusted Vercel-deployed app. If you customize, do not relax `contextIsolation` without a thorough security review.
