/**
 * Electron main process for Hope Tender Proposal Generator desktop app.
 *
 * TWO MODES (PR #246):
 *
 * 1) HOSTED MODE (default, recommended)
 *    The desktop window points at the production Vercel deployment
 *    (or any URL set via HOPE_TENDER_DESKTOP_URL). No local server,
 *    no local postgres, no local AI keys needed — desktop is just a
 *    distribution channel for the same web app the user already has.
 *    Set HOPE_TENDER_DESKTOP_URL=https://hope-tender-path-b.vercel.app
 *    to enable; defaults to the project's known Vercel URL.
 *
 * 2) LOCAL-SERVER MODE
 *    Spawns `next dev` (or `next start`) in-process and points the
 *    window at http://localhost:3000. Requires the user to have:
 *      • PostgreSQL running and DATABASE_URL exported
 *      • ANTHROPIC_API_KEY exported
 *      • node_modules installed
 *    Useful for offline / air-gapped builds. Enable by setting
 *    HOPE_TENDER_DESKTOP_MODE=local-server in the launch env.
 *
 * Build:
 *   npm install --save-dev electron electron-builder
 *   npm run electron               # dev launch (hosted mode)
 *   npm run build:desktop          # produce installers (Win/Mac/Linux)
 */
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const path = require("path");
const { exec } = require("child_process");

let mainWindow;
let nextServer;

const isDev = process.env.NODE_ENV === "development";
const PORT = 3000;
// Mode selection — see comments at top of file. Defaults to hosted mode
// because it's a simpler user experience and works on any machine
// without requiring local backend setup.
const MODE = (process.env.HOPE_TENDER_DESKTOP_MODE || "hosted").toLowerCase();
const HOSTED_URL = process.env.HOPE_TENDER_DESKTOP_URL || "https://hope-tender-path-b.vercel.app";
const LOCAL_URL = `http://localhost:${PORT}`;
const TARGET_URL = MODE === "local-server" ? LOCAL_URL : HOSTED_URL;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // SECURITY (audit H-11): enable the Chromium sandbox so a renderer
      // compromise cannot reach Node.js APIs even via the preload bridge.
      // Compatible with this app because no preload script is used.
      sandbox: true,
      // SECURITY: <webview> tags are not used and would bypass sandboxing.
      webviewTag: false,
    },
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    title: "Hope Tender Proposal Generator",
    icon: path.join(__dirname, "../public/icon-512.png"),
    show: false,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.loadURL(TARGET_URL).catch((err) => {
    dialog.showErrorBox(
      "Cannot connect to Hope Tender",
      `The desktop app could not reach ${TARGET_URL}.\n\nCheck your network connection and try again. To use a different server, set the HOPE_TENDER_DESKTOP_URL environment variable before launching.`,
    );
  });

  // SECURITY (audit C-7): global navigation guard. Prevents the renderer
  // from being navigated to any origin other than the configured TARGET_URL
  // origin. Without this, a crafted link inside a generated proposal could
  // navigate the main window to an attacker-controlled URL.
  const ALLOWED_ORIGIN = (() => {
    try { return new URL(TARGET_URL).origin; }
    catch { return TARGET_URL; }
  })();

  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).origin !== ALLOWED_ORIGIN) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  // SECURITY (audit C-7): window-open handler with explicit scheme
  // allowlist. Only http(s) and mailto: URLs are passed to shell.openExternal;
  // dangerous schemes (ms-msdt:, search-ms:, file://, javascript:) are silently
  // dropped. The previous implementation passed any URL to openExternal.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      const isSameOrigin = parsed.origin === ALLOWED_ORIGIN;
      const isSafeExternal = ["http:", "https:", "mailto:"].includes(parsed.protocol);
      if (isSameOrigin) {
        return { action: "allow" };
      }
      if (isSafeExternal) {
        shell.openExternal(url);
      }
      // Unsafe schemes (ms-msdt:, file:, javascript:, etc.) are silently dropped.
      return { action: "deny" };
    } catch {
      // Invalid URL — silently drop.
      return { action: "deny" };
    }
  });

  buildMenu();
}

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "New Tender", accelerator: "CmdOrCtrl+N", click: () => mainWindow.loadURL(`${TARGET_URL}/dashboard/tenders/new`) },
        { label: "Dashboard", accelerator: "CmdOrCtrl+D", click: () => mainWindow.loadURL(`${TARGET_URL}/dashboard`) },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(isDev ? [{ role: "toggleDevTools" }] : []),
      ],
    },
    {
      label: "Navigate",
      submenu: [
        { label: "Company Vault", click: () => mainWindow.loadURL(`${TARGET_URL}/dashboard/company`) },
        { label: "Analysis", click: () => mainWindow.loadURL(`${TARGET_URL}/dashboard/analysis`) },
        { label: "Compliance", click: () => mainWindow.loadURL(`${TARGET_URL}/dashboard/compliance`) },
        { label: "Export Packages", click: () => mainWindow.loadURL(`${TARGET_URL}/dashboard/export`) },
      ],
    },
  ];

  if (process.platform === "darwin") {
    template.unshift({
      label: app.name,
      submenu: [
        { role: "about" }, { type: "separator" },
        { role: "services" }, { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" }, { role: "quit" },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function startNextServer() {
  return new Promise((resolve, reject) => {
    // SECURITY (audit C-8): bind explicitly to 127.0.0.1 so the local Next.js
    // server is NOT reachable from other hosts on the LAN. The previous
    // implementation passed only --port, which left Next.js binding to
    // 0.0.0.0 by default.
    const cmd = isDev
      ? `npx next dev --hostname 127.0.0.1 --port ${PORT}`
      : `npx next start --hostname 127.0.0.1 --port ${PORT}`;

    nextServer = exec(cmd, { cwd: path.join(__dirname, "..") }, (err) => {
      if (err && !err.killed) reject(err);
    });

    // Wait for Next.js to be ready
    const checkReady = () => {
      fetch(`${TARGET_URL}`).then(() => resolve()).catch(() => setTimeout(checkReady, 500));
    };
    setTimeout(checkReady, 1500);
  });
}

app.whenReady().then(async () => {
  // Hosted mode skips the local server entirely — the URL is already
  // a live Vercel deployment, no need to spawn `next start`.
  if (MODE === "local-server") {
    try {
      await startNextServer();
    } catch (err) {
      console.error("Failed to start Next.js server:", err);
      dialog.showErrorBox(
        "Local-server mode failed to start",
        `Could not start the local Next.js server.\n\n${err?.message ?? err}\n\nMake sure DATABASE_URL and ANTHROPIC_API_KEY are exported and node_modules are installed. To use the hosted Vercel deployment instead, unset HOPE_TENDER_DESKTOP_MODE.`,
      );
      app.quit();
      return;
    }
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // SECURITY (audit L-11): graceful shutdown. Send SIGTERM first so Next.js
  // can finish in-flight requests, then SIGKILL after 3s as a fallback.
  if (nextServer) {
    try { nextServer.kill("SIGTERM"); } catch {}
    setTimeout(() => { try { nextServer.kill("SIGKILL"); } catch {} }, 3000);
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (nextServer) {
    try { nextServer.kill("SIGTERM"); } catch {}
  }
});
